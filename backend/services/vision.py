import asyncio
import base64
import logging
import os
import random
import time

import anthropic

from prompts.label_prompt import SYSTEM_PROMPT

logger = logging.getLogger("label-checker")

_client = None


def _get_client():
    """Lazy-initialize the Anthropic client so load_dotenv() has time to run first."""
    global _client
    if _client is None:
        _client = anthropic.AsyncAnthropic()
    return _client


MODEL_FAST = os.environ.get("MODEL_FAST_OVERRIDE", "claude-haiku-4-5")
MODEL_FALLBACK = os.environ.get("MODEL_FALLBACK_OVERRIDE", "claude-sonnet-4-5")
MAX_RETRIES = 3
MAX_TOKENS = 600

# Critical fields that trigger Sonnet fallback if Haiku returns null/suspect
CRITICAL_FIELDS = ["government_warning_present", "alcohol_by_volume", "net_contents"]

# Tool definition for structured output
EXTRACT_TOOL = {
    "name": "extract_label_data",
    "description": "Extract structured data from an alcohol beverage label image.",
    "input_schema": {
        "type": "object",
        "properties": {
            "brand_name": {
                "type": ["string", "null"],
                "description": "The brand name as it appears on the label",
            },
            "product_type": {
                "type": ["string", "null"],
                "description": "Product category, e.g. Wine, Beer, Distilled Spirits",
            },
            "alcohol_by_volume": {
                "type": ["string", "null"],
                "description": "Full ABV expression, e.g. '12.5% Alc./Vol.' or '45% Alc./Vol. (90 Proof)'",
            },
            "net_contents": {
                "type": ["string", "null"],
                "description": "Net contents, e.g. '750 mL' or '12 FL. OZ.'",
            },
            "country_of_origin": {
                "type": ["string", "null"],
                "description": "Country of origin if stated",
            },
            "government_warning_present": {
                "type": "boolean",
                "description": "Whether a government health warning statement is visible on the label",
            },
            "government_warning_text": {
                "type": ["string", "null"],
                "description": "The exact text of the government warning as it appears on the label",
            },
            "government_warning_header_all_caps": {
                "type": ["boolean", "null"],
                "description": "Whether 'GOVERNMENT WARNING:' appears in ALL CAPS",
            },
            "government_warning_header_bold": {
                "type": ["boolean", "null"],
                "description": "Whether the warning header appears to be in bold/heavier weight. Best effort.",
            },
            "sulfite_declaration_present": {
                "type": "boolean",
                "description": "Whether a sulfite declaration (e.g. 'Contains Sulfites') is visible",
            },
            "class_type_designation": {
                "type": ["string", "null"],
                "description": "Class/type designation, e.g. 'Kentucky Straight Bourbon Whiskey', 'Cabernet Sauvignon'",
            },
            "producer_name": {
                "type": ["string", "null"],
                "description": "Name of the bottler, producer, or importer ONLY — do NOT include the address. E.g. 'Stone's Throw Distillery' or 'Night Harbor Distilling Co.'",
            },
            "producer_address": {
                "type": ["string", "null"],
                "description": "Address of the bottler, producer, or importer ONLY — do NOT include the company name. E.g. 'Frankfort, KY' or 'London, England'",
            },
            "raw_text_extracted": {
                "type": ["string", "null"],
                "description": "All visible text on the label, transcribed as-is",
            },
        },
        "required": ["government_warning_present", "sulfite_declaration_present"],
    },
}


def _extract_tool_input(response) -> dict:
    """Safely extract the tool_use block from response content."""
    for block in response.content:
        if (
            getattr(block, "type", None) == "tool_use"
            and getattr(block, "name", None) == "extract_label_data"
        ):
            return block.input
    raise RuntimeError("No extract_label_data tool_use block in response")


def _needs_fallback(result: dict) -> bool:
    """Check if Haiku's result is suspect and needs Sonnet fallback."""
    if result.get("government_warning_present") is None:
        return True
    if result.get("alcohol_by_volume") is None:
        return True
    if result.get("net_contents") is None:
        return True

    warning_text = result.get("government_warning_text")
    if result.get("government_warning_present") and warning_text and len(warning_text) < 50:
        return True

    raw_text = result.get("raw_text_extracted")
    if not raw_text or len(raw_text) < 20:
        return True

    return False


async def extract_label_data(image_bytes: bytes, filename: str) -> dict:
    """
    Extract label data using Claude vision.
    Currently Haiku-only. Sonnet fallback disabled for evaluation.
    """
    start = time.time()
    result = await _call_with_retries(image_bytes, filename, MODEL_FAST)
    result["_model_used"] = MODEL_FAST

    # TODO: Re-enable Sonnet fallback after evaluating Haiku accuracy.
    # The previous heuristic triggered on null ABV, which is legitimate
    # for labels that genuinely don't show alcohol content (e.g. some beers).
    # Fallback logic needs smarter heuristics before re-enabling.
    #
    # if _needs_fallback(result):
    #     result = await _call_with_retries(image_bytes, filename, MODEL_FALLBACK)
    #     result["_model_used"] = MODEL_FALLBACK

    result["_processing_time_ms"] = int((time.time() - start) * 1000)
    return result


async def _call_with_retries(image_bytes: bytes, filename: str, model: str) -> dict:
    """Retry on 429 and 5xx errors with exponential backoff + jitter."""
    for attempt in range(MAX_RETRIES):
        try:
            return await _call_claude(image_bytes, filename, model)
        except anthropic.RateLimitError as e:
            if attempt == MAX_RETRIES - 1:
                raise
            retry_after = float(
                getattr(getattr(e, "response", None), "headers", {}).get(
                    "retry-after", 2**attempt
                )
            )
            jitter = random.uniform(0, 1 + attempt)
            await asyncio.sleep(retry_after + jitter)
        except anthropic.APIStatusError as e:
            if e.status_code == 429 and attempt < MAX_RETRIES - 1:
                retry_after = float(
                    getattr(getattr(e, "response", None), "headers", {}).get(
                        "retry-after", 2**attempt
                    )
                )
                jitter = random.uniform(0, 1 + attempt)
                await asyncio.sleep(retry_after + jitter)
            elif e.status_code >= 500 and attempt < MAX_RETRIES - 1:
                jitter = random.uniform(0, 1 + attempt)
                await asyncio.sleep(2**attempt + jitter)
            else:
                raise


async def _call_claude(image_bytes: bytes, filename: str, model: str) -> dict:
    """Single Claude API call with tool use for structured output."""
    t0 = time.time()
    b64 = base64.standard_b64encode(image_bytes).decode("utf-8")
    logger.info("[claude] %s model=%s payload=%.0fKB (base64=%.0fKB)", filename, model, len(image_bytes) / 1024, len(b64) / 1024)

    media_type = "image/jpeg"

    response = await _get_client().messages.create(
        model=model,
        max_tokens=MAX_TOKENS,
        system=[
            {
                "type": "text",
                "text": SYSTEM_PROMPT,
                "cache_control": {"type": "ephemeral"},
            }
        ],
        tools=[EXTRACT_TOOL],
        tool_choice={"type": "tool", "name": "extract_label_data"},
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": media_type,
                            "data": b64,
                        },
                    },
                    {
                        "type": "text",
                        "text": "Extract all label data from this alcohol beverage label image.",
                    },
                ],
            }
        ],
    )
    result = _extract_tool_input(response)
    logger.info("[claude] %s DONE %.1fs (input_tokens=%d, output_tokens=%d, model=%s)",
                filename, time.time() - t0,
                getattr(response.usage, "input_tokens", 0),
                getattr(response.usage, "output_tokens", 0),
                model)
    return result

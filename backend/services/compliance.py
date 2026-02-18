import re

from prompts.label_prompt import CANONICAL_WARNING
from services.comparison import compare_fields

# Number of null fields (out of main extraction fields) that indicates low confidence
LOW_CONFIDENCE_NULL_THRESHOLD = 6

# Minimum raw text length to consider extraction adequate
MIN_RAW_TEXT_LENGTH = 20

MAIN_FIELDS = [
    "brand_name",
    "product_type",
    "alcohol_by_volume",
    "net_contents",
    "country_of_origin",
    "government_warning_present",
    "government_warning_text",
    "class_type_designation",
    "producer_name",
    "producer_address",
]

# Comparison fields that should be treated as critical when mismatched
_CRITICAL_COMPARISON_FIELDS = {"brand_name", "alcohol_content", "net_contents"}


def _normalize(text: str) -> str:
    """Normalize text for comparison, handling common OCR artifacts."""
    text = text.strip()
    # Smart quotes -> straight quotes
    text = text.replace("\u2018", "'").replace("\u2019", "'")
    text = text.replace("\u201c", '"').replace("\u201d", '"')
    # En-dash / em-dash -> hyphen
    text = text.replace("\u2013", "-").replace("\u2014", "-")
    # Collapse whitespace
    text = re.sub(r"\s+", " ", text)
    return text.upper()


def _is_low_confidence(data: dict) -> bool:
    """Check if extraction quality is too low to trust critical assessments."""
    raw_text = data.get("raw_text_extracted")
    if not raw_text or len(raw_text) < MIN_RAW_TEXT_LENGTH:
        return True

    null_count = sum(1 for f in MAIN_FIELDS if data.get(f) is None)
    if null_count >= LOW_CONFIDENCE_NULL_THRESHOLD:
        return True

    return False


def check_compliance(data: dict, application_row: dict | None = None) -> dict:
    """
    Check extracted label data against TTB compliance rules.

    When *application_row* is provided, also runs field-level comparison
    against the structured application data and merges those results into
    the compliance issues.

    Severity levels:
      - "critical"     : hard failure, blocks approval
      - "needs_review" : human agent should verify before approving
      - "info"         : informational note, does NOT affect overall pass/fail

    Returns
    -------
    dict with keys:
        passed: bool
        issues: list[dict]  -- each with field, severity, message, issue_type
        comparison: dict | None  -- field-level comparison detail (when application_row given)
    """
    issues: list[dict] = []
    low_confidence = _is_low_confidence(data)

    def _severity(intended: str) -> str:
        """Downgrade critical to needs_review when extraction confidence is low."""
        if intended == "critical" and low_confidence:
            return "needs_review"
        return intended

    # ------------------------------------------------------------------ #
    # Core checks (critical / needs_review — drive pass/fail)
    # ------------------------------------------------------------------ #

    # Government warning presence
    if not data.get("government_warning_present"):
        issues.append({
            "field": "government_warning_present",
            "severity": _severity("critical"),
            "message": (
                "Government warning not detected on label"
                + (" (low confidence extraction -- manual review recommended)" if low_confidence else "")
            ),
            "issue_type": "presence",
        })

    # Government warning text match
    warning_text = data.get("government_warning_text")
    if data.get("government_warning_present") and warning_text:
        if _normalize(warning_text) == _normalize(CANONICAL_WARNING):
            pass  # Exact match
        else:
            issues.append({
                "field": "government_warning_text",
                "severity": "needs_review",
                "message": "Warning text does not exactly match the required federal text -- verify manually",
                "issue_type": "presence",
            })
    elif data.get("government_warning_present") and not warning_text:
        issues.append({
            "field": "government_warning_text",
            "severity": "needs_review",
            "message": "Warning detected but text could not be extracted -- verify manually",
            "issue_type": "presence",
        })

    # Alcohol by volume
    if not data.get("alcohol_by_volume"):
        issues.append({
            "field": "alcohol_by_volume",
            "severity": _severity("critical"),
            "message": (
                "Alcohol content (ABV) not detected"
                + (" (low confidence extraction -- manual review recommended)" if low_confidence else "")
            ),
            "issue_type": "presence",
        })

    # Net contents
    if not data.get("net_contents"):
        issues.append({
            "field": "net_contents",
            "severity": _severity("critical"),
            "message": (
                "Net contents not detected"
                + (" (low confidence extraction -- manual review recommended)" if low_confidence else "")
            ),
            "issue_type": "presence",
        })

    # Producer name and address
    if not data.get("producer_name"):
        issues.append({
            "field": "producer_name",
            "severity": "needs_review",
            "message": "Bottler/producer name not detected",
            "issue_type": "presence",
        })
    if not data.get("producer_address"):
        issues.append({
            "field": "producer_address",
            "severity": "needs_review",
            "message": "Bottler/producer address not detected",
            "issue_type": "presence",
        })

    # ------------------------------------------------------------------ #
    # Informational checks (do NOT affect pass/fail)
    # ------------------------------------------------------------------ #

    # Warning header formatting: all caps
    if data.get("government_warning_present"):
        if data.get("government_warning_header_all_caps") is False:
            issues.append({
                "field": "government_warning_header_all_caps",
                "severity": "info",
                "message": "'GOVERNMENT WARNING:' header may not be in all caps -- verify formatting",
                "issue_type": "presence",
            })
        elif data.get("government_warning_header_all_caps") is None:
            issues.append({
                "field": "government_warning_header_all_caps",
                "severity": "info",
                "message": "Could not determine if warning header is in all caps",
                "issue_type": "presence",
            })

    # Warning header formatting: bold (vision models unreliable for this)
    if data.get("government_warning_present"):
        if data.get("government_warning_header_bold") is not True:
            issues.append({
                "field": "government_warning_header_bold",
                "severity": "info",
                "message": "Could not confirm warning header is bold -- verify formatting",
                "issue_type": "presence",
            })

    # Country of origin
    if not data.get("country_of_origin"):
        issues.append({
            "field": "country_of_origin",
            "severity": "info",
            "message": "Country of origin not detected -- required for imports",
            "issue_type": "presence",
        })

    # Class/type designation
    if not data.get("class_type_designation"):
        issues.append({
            "field": "class_type_designation",
            "severity": "info",
            "message": "Class/type designation not detected",
            "issue_type": "presence",
        })

    # Sulfite declaration
    if not data.get("sulfite_declaration_present"):
        issues.append({
            "field": "sulfite_declaration_present",
            "severity": "info",
            "message": "Sulfite declaration not detected -- verify if required for this product type",
            "issue_type": "presence",
        })

    # Add overall low confidence note if applicable
    if low_confidence and not any(
        "low confidence" in i["message"] for i in issues
    ):
        issues.insert(0, {
            "field": "_extraction_quality",
            "severity": "needs_review",
            "message": "Low confidence extraction -- could not read label clearly. Manual review recommended.",
            "issue_type": "presence",
        })

    # ------------------------------------------------------------------ #
    # Comparison checks (only when application data is provided)
    # ------------------------------------------------------------------ #
    comparison: dict | None = None

    if application_row is not None:
        comparison = compare_fields(data, application_row)

        for field_result in comparison.get("fields", []):
            status = field_result["status"]
            field_name = field_result["field"]

            if status == "mismatch":
                severity = "critical" if field_name in _CRITICAL_COMPARISON_FIELDS else "needs_review"
                issues.append({
                    "field": field_name,
                    "severity": _severity(severity),
                    "message": field_result.get("message", f"{field_name} does not match application data"),
                    "issue_type": "comparison",
                })
            elif status == "not_found":
                severity = "critical" if field_name in _CRITICAL_COMPARISON_FIELDS else "needs_review"
                issues.append({
                    "field": field_name,
                    "severity": _severity(severity),
                    "message": field_result.get("message", f"{field_name} not found on label"),
                    "issue_type": "comparison",
                })
            elif status == "partial":
                issues.append({
                    "field": field_name,
                    "severity": "needs_review",
                    "message": field_result.get("message", f"{field_name} partially matches -- verify"),
                    "issue_type": "comparison",
                })
            elif status == "needs_review":
                issues.append({
                    "field": field_name,
                    "severity": "needs_review",
                    "message": field_result.get("message", f"{field_name} requires manual review"),
                    "issue_type": "comparison",
                })
            # status == "match" -> no issue

    passed = not any(i["severity"] == "critical" for i in issues)

    result = {"passed": passed, "issues": issues}
    if comparison is not None:
        result["comparison"] = comparison
    return result

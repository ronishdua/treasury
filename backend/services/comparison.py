"""
Field-level comparison engine.

Compares extracted label data (from Claude vision) against structured
application data (from Form 5100.31 CSV) and returns per-field match results.
"""

import re
from typing import Any

from prompts.label_prompt import CANONICAL_WARNING


# --------------------------------------------------------------------------- #
# Unit conversion tables for net contents normalisation
# --------------------------------------------------------------------------- #

_ML_CONVERSIONS: dict[str, float] = {
    "ml": 1.0,
    "milliliter": 1.0,
    "millilitre": 1.0,
    "milliliters": 1.0,
    "millilitres": 1.0,
    "cl": 10.0,
    "centiliter": 10.0,
    "centilitre": 10.0,
    "centiliters": 10.0,
    "centilitres": 10.0,
    "l": 1000.0,
    "liter": 1000.0,
    "litre": 1000.0,
    "liters": 1000.0,
    "litres": 1000.0,
    "fl oz": 29.5735,
    "fl. oz.": 29.5735,
    "fl. oz": 29.5735,
    "fl oz.": 29.5735,
    "fluid ounce": 29.5735,
    "fluid ounces": 29.5735,
    "oz": 29.5735,
    "gal": 3785.41,
    "gallon": 3785.41,
    "gallons": 3785.41,
    "pt": 473.176,
    "pint": 473.176,
    "pints": 473.176,
    "qt": 946.353,
    "quart": 946.353,
    "quarts": 946.353,
}


# --------------------------------------------------------------------------- #
# Text normalisation helpers
# --------------------------------------------------------------------------- #

def _norm_text(text: str) -> str:
    """Lowercase, strip punctuation (except %), collapse whitespace."""
    text = text.strip().lower()
    text = text.replace("\u2018", "'").replace("\u2019", "'")
    text = text.replace("\u201c", '"').replace("\u201d", '"')
    text = text.replace("\u2013", "-").replace("\u2014", "-")
    text = re.sub(r"[^\w\s%.]", "", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _strip_all_punct(text: str) -> str:
    """Remove every non-alphanumeric character for loose comparison."""
    return re.sub(r"[^a-z0-9]", "", text.lower())


# --------------------------------------------------------------------------- #
# Numeric parsers
# --------------------------------------------------------------------------- #

_ABV_RE = re.compile(r"(\d+(?:\.\d+)?)\s*%")

def _parse_abv(text: str) -> float | None:
    """Extract a numeric ABV percentage from text like '45% Alc./Vol.'."""
    m = _ABV_RE.search(text)
    return float(m.group(1)) if m else None


_NET_CONTENTS_RE = re.compile(
    r"(\d+(?:\.\d+)?)\s*"
    r"(ml|milliliters?|millilitres?|cl|centiliters?|centilitres?|"
    r"l|liters?|litres?|fl\.?\s*oz\.?|fluid\s+ounces?|oz\.?|"
    r"gal(?:lons?)?|pt|pints?|qt|quarts?)",
    re.IGNORECASE,
)

def _parse_net_contents_ml(text: str) -> float | None:
    """Parse net contents to millilitres for numeric comparison."""
    m = _NET_CONTENTS_RE.search(text)
    if not m:
        return None
    value = float(m.group(1))
    unit = m.group(2).lower().strip().rstrip(".")
    # Normalise multi-word units
    unit = re.sub(r"\s+", " ", unit)
    factor = _ML_CONVERSIONS.get(unit)
    if factor is None:
        # Try without trailing 's'
        factor = _ML_CONVERSIONS.get(unit.rstrip("s"))
    if factor is None:
        return None
    return round(value * factor, 2)


# --------------------------------------------------------------------------- #
# Per-field comparison functions
# --------------------------------------------------------------------------- #

def _compare_brand_name(expected: str, extracted: str | None) -> dict:
    if not extracted:
        return _result("brand_name", expected, extracted, "not_found",
                        "Brand name not found on label")

    if _strip_all_punct(expected) == _strip_all_punct(extracted):
        return _result("brand_name", expected, extracted, "match")

    # Check if one contains the other (partial match)
    e_norm = _strip_all_punct(expected)
    x_norm = _strip_all_punct(extracted)
    if e_norm in x_norm or x_norm in e_norm:
        return _result("brand_name", expected, extracted, "partial",
                        "Brand name is a partial match -- verify")

    return _result("brand_name", expected, extracted, "mismatch",
                    "Brand name does not match application data")


def _compare_alcohol_content(expected: str, extracted: str | None) -> dict:
    if not extracted:
        return _result("alcohol_content", expected, extracted, "not_found",
                        "Alcohol content not found on label")

    exp_val = _parse_abv(expected)
    ext_val = _parse_abv(extracted)

    if exp_val is not None and ext_val is not None:
        if abs(exp_val - ext_val) <= 0.15:
            return _result("alcohol_content", expected, extracted, "match")
        return _result("alcohol_content", expected, extracted, "mismatch",
                        f"ABV mismatch: expected {exp_val}%, found {ext_val}%")

    # Fall back to normalised text comparison
    if _norm_text(expected) == _norm_text(extracted):
        return _result("alcohol_content", expected, extracted, "match")

    return _result("alcohol_content", expected, extracted, "needs_review",
                    "Could not parse ABV numerically -- manual comparison required")


def _compare_net_contents(expected: str, extracted: str | None) -> dict:
    if not extracted:
        return _result("net_contents", expected, extracted, "not_found",
                        "Net contents not found on label")

    exp_ml = _parse_net_contents_ml(expected)
    ext_ml = _parse_net_contents_ml(extracted)

    if exp_ml is not None and ext_ml is not None:
        if abs(exp_ml - ext_ml) <= 1.0:
            return _result("net_contents", expected, extracted, "match")
        return _result("net_contents", expected, extracted, "mismatch",
                        f"Net contents mismatch: expected {exp_ml}mL, found {ext_ml}mL")

    if _norm_text(expected) == _norm_text(extracted):
        return _result("net_contents", expected, extracted, "match")

    return _result("net_contents", expected, extracted, "needs_review",
                    "Could not parse net contents numerically -- manual comparison required")


def _compare_class_type(expected: str, extracted: str | None) -> dict:
    if not extracted:
        return _result("class_type", expected, extracted, "not_found",
                        "Class/type designation not found on label")

    e_norm = _strip_all_punct(expected)
    x_norm = _strip_all_punct(extracted)

    if e_norm == x_norm:
        return _result("class_type", expected, extracted, "match")

    # Substring containment handles "Bourbon Whiskey" vs "Kentucky Straight Bourbon Whiskey"
    if e_norm in x_norm or x_norm in e_norm:
        return _result("class_type", expected, extracted, "partial",
                        "Class/type is a partial match -- one value contains the other")

    return _result("class_type", expected, extracted, "mismatch",
                    "Class/type designation does not match application data")


def _compare_producer_name(expected: str, extracted: str | None) -> dict:
    if not extracted:
        return _result("producer_name", expected, extracted, "not_found",
                        "Producer/bottler name not found on label")

    e_norm = _strip_all_punct(expected)
    x_norm = _strip_all_punct(extracted)

    if e_norm == x_norm:
        return _result("producer_name", expected, extracted, "match")

    if e_norm in x_norm or x_norm in e_norm:
        return _result("producer_name", expected, extracted, "partial",
                        "Producer name is a partial match -- verify")

    return _result("producer_name", expected, extracted, "mismatch",
                    "Producer name does not match application data")


def _compare_government_warning(extracted_data: dict) -> dict:
    """Compare extracted government warning text against the canonical required text."""
    present = extracted_data.get("government_warning_present", False)
    extracted_text = extracted_data.get("government_warning_text")

    if not present or not extracted_text:
        return _result(
            "government_warning", CANONICAL_WARNING,
            extracted_text or "Not detected on label",
            "not_found" if not present else "needs_review",
            "Government warning not detected on label" if not present
            else "Warning detected but text could not be extracted",
        )

    canon_norm = re.sub(r"\s+", " ", CANONICAL_WARNING.strip().upper())
    ext_norm = re.sub(r"\s+", " ", extracted_text.strip().upper())

    if canon_norm == ext_norm:
        return _result("government_warning", CANONICAL_WARNING, extracted_text, "match")

    # Check word-level similarity for partial match
    canon_words = set(_strip_all_punct(CANONICAL_WARNING).split() if False else re.findall(r"[a-z0-9]+", CANONICAL_WARNING.lower()))
    ext_words = set(re.findall(r"[a-z0-9]+", extracted_text.lower()))
    overlap = len(canon_words & ext_words)
    total = max(len(canon_words), 1)

    if overlap / total >= 0.80:
        return _result(
            "government_warning", CANONICAL_WARNING, extracted_text, "partial",
            "Warning text does not exactly match the required federal text -- verify manually",
        )

    return _result(
        "government_warning", CANONICAL_WARNING, extracted_text, "mismatch",
        "Warning text does not match the required federal text",
    )


def _compare_producer_address(expected: str, extracted: str | None) -> dict:
    if not extracted:
        return _result("producer_address", expected, extracted, "not_found",
                        "Producer address not found on label")

    # Relaxed: check if city+state tokens overlap significantly
    e_tokens = set(_strip_all_punct(expected))
    x_tokens = set(_strip_all_punct(extracted))

    e_words = set(_norm_text(expected).split())
    x_words = set(_norm_text(extracted).split())

    overlap = len(e_words & x_words)
    total = max(len(e_words), 1)

    if overlap / total >= 0.6:
        return _result("producer_address", expected, extracted, "match",
                        "Address appears to match (relaxed comparison)")

    if overlap > 0:
        return _result("producer_address", expected, extracted, "partial",
                        "Address partially matches -- verify details")

    return _result("producer_address", expected, extracted, "mismatch",
                    "Producer address does not match application data")


# --------------------------------------------------------------------------- #
# Result builder
# --------------------------------------------------------------------------- #

def _result(
    field: str,
    expected: Any,
    extracted: Any,
    status: str,
    message: str = "",
) -> dict:
    return {
        "field": field,
        "expected": expected,
        "extracted": extracted,
        "status": status,
        "message": message,
    }


# --------------------------------------------------------------------------- #
# Public API
# --------------------------------------------------------------------------- #

def compare_fields(extracted_data: dict, application_row: dict) -> dict:
    """
    Compare extracted label data against application row data.

    Parameters
    ----------
    extracted_data : dict
        Output from Claude vision extraction (keys like brand_name, alcohol_by_volume, etc.)
    application_row : dict
        ApplicationRow dict with keys: brand_name, class_type, alcohol_content,
        net_contents, producer_name, producer_address, label_id.

    Returns
    -------
    dict with keys:
        matched_row: str  -- the label_id that was matched
        fields: list[dict] -- per-field comparison results
    """
    fields: list[dict] = []

    # Map application_row fields -> extraction fields and comparison functions
    comparisons = [
        ("brand_name", application_row.get("brand_name"),
         extracted_data.get("brand_name"), _compare_brand_name),
        ("alcohol_content", application_row.get("alcohol_content"),
         extracted_data.get("alcohol_by_volume"), _compare_alcohol_content),
        ("net_contents", application_row.get("net_contents"),
         extracted_data.get("net_contents"), _compare_net_contents),
        ("class_type", application_row.get("class_type"),
         extracted_data.get("class_type_designation"), _compare_class_type),
        ("producer_name", application_row.get("producer_name"),
         extracted_data.get("producer_name"), _compare_producer_name),
        ("producer_address", application_row.get("producer_address"),
         extracted_data.get("producer_address"), _compare_producer_address),
    ]

    for field_name, expected, extracted, compare_fn in comparisons:
        if expected is not None:
            fields.append(compare_fn(expected, extracted))

    # Always include government warning comparison
    fields.append(_compare_government_warning(extracted_data))

    return {
        "matched_row": application_row.get("label_id"),
        "fields": fields,
    }

"""How one spreadsheet cell reads as a well, a Ct value or a name, the same for every kind of file."""
from __future__ import annotations

import math
import re
from typing import Any

_WELL = re.compile(r"([A-P])0?([1-9]|1[0-9]|2[0-4])")
_NO_VALUE = {"", "undetermined", "undet", "na", "n/a", "nan", "none", "-"}
UNDETERMINED = {"undetermined", "undet"}


def normalize_key(value: Any) -> str:
    if value is None:
        return ""
    return re.sub(r"[^a-z0-9]+", " ", str(value).strip().lower()).strip()


def infer_well(value: Any) -> str | None:
    """"A1", "a1" and the zero-padded "A01" all name well A1; anything else is not a well."""
    if value is None:
        return None
    match = _WELL.fullmatch(str(value).strip().upper())
    return f"{match.group(1)}{match.group(2)}" if match else None


def safe_value(value: Any) -> Any:
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def number(value: Any) -> float | None:
    if value is None or str(value).strip().lower() in _NO_VALUE:
        return None
    try:
        parsed = float(str(value).replace(",", "").strip())
        return parsed if math.isfinite(parsed) else None
    except (TypeError, ValueError):
        return None


def ct_status(value: Any) -> tuple[float | None, str]:
    """The Ct and whether it was detected, undetermined, missing, or something else (an Excel error, text)."""
    ct = number(value)
    if ct is not None:
        return ct, "detected"
    text = "" if value is None else str(value).strip()
    if not text:
        return None, "missing"
    return None, "undetermined" if text.lower() in UNDETERMINED else "invalid"


def is_omitted(value: Any) -> bool:
    return str(value).strip().lower() in {"true", "yes", "1", "y", "t", "omit", "excluded"}


def text(value: Any) -> str:
    """A cell as a name: whole numbers lose their ".0" (a sample typed as 1 is "1"), blanks are ""."""
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()

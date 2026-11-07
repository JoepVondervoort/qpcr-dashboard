"""What else a workbook holds besides Ct values: the run's details, the scientist's own analysis, or no results at all."""
from __future__ import annotations

import re
from collections.abc import Collection
from typing import Any

from .cells import normalize_key
from .workbooks import SheetRows

METADATA_ROWS = 120
NOTE_LENGTH = 40
# The scientist's calculations, by their column headers; "▲" is how many lab sheets write Δ.
_ANALYSIS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("ΔΔCt", re.compile(r"^(?:dd|δδ|∆∆|▲▲|delta\s*delta\s*)c[tq]\b")),
    ("ΔCt", re.compile(r"^(?:d|δ|∆|▲|delta\s*)c[tq]\b")),
    ("fold change", re.compile(r"fold|^fc$|^2\s*\^|^rq$|rel(?:ative)?\.?\s*(?:expression|quantity)")),
    ("Ct means", re.compile(r"^(?:average|mean|avg)\b.*c[tq]\b|^c[tq]\b.*\b(?:average|mean|avg)\b|^c[tq]\s*sd$")),
    ("a standard curve", re.compile(r"^(?:slope|efficiency|r2|r²)$")),
)
# Words that say what a sheet without Ct values is for.
_CONTENTS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("a transfection plan", ("rnaimax", "lipofectamine", "optimem", "opti-mem", "messenger max", "messengermax", "transfection")),
    ("a cell-culture plan", ("harvest", "well plate", "seeding", "confluen")),
    ("RNA isolation", ("nucleic acid", "rna concentration", "nanodrop", "rna isolation")),
    ("cDNA synthesis", ("cdna", "iscript", "reverse transcri")),
    ("a qPCR set-up", ("mastermix", "master mix", "taqman", "primer mix", "sybr green")),
    ("FACS", ("facs", "flow cytometry")),
    ("a Western blot", ("western", "tubulin", "relative int")),
)


def _label(value: Any) -> str:
    return re.sub(r"\s+", " ", value.strip().lower()) if isinstance(value, str) else ""


def workbook_metadata(sheets: SheetRows) -> dict[str, Any]:
    """The instrument's run details kept on any sheet (an edited export may keep them only on "Sample Setup")."""
    wanted = {"experiment name": "experiment", "block type": "block", "experiment file name": "instrument_file"}
    found: dict[str, Any] = {}
    for _, rows in sheets:
        for row in rows[:METADATA_ROWS]:
            key = wanted.get(normalize_key(row[0]) if row else "")
            value = next((cell for cell in row[1:] if cell is not None), None) if key else None
            if key and value is not None:
                found.setdefault(key, str(value).strip())
    block = re.search(r"\b(96|384)\b", found.get("block", ""))
    instrument_file = re.split(r"[\\/]", found["instrument_file"])[-1].strip() if found.get("instrument_file") else None
    return {"experiment": found.get("experiment") or None, "plate_size": int(block.group(1)) if block else None, "instrument_file": instrument_file or None}


def own_analysis(sheets: SheetRows, skip: Collection[str] = ()) -> list[dict[str, Any]]:
    """Per sheet, the kinds of calculation the scientist added: ΔCt, ΔΔCt, fold change, Ct means, a standard curve."""
    notes = []
    for sheet, rows in sheets:
        if sheet in skip:
            continue
        kinds = {kind for row in rows for value in row if (name := _label(value)) and len(name) <= NOTE_LENGTH
                 for kind, pattern in _ANALYSIS if pattern.search(name)}
        if kinds:
            notes.append({"sheet": sheet, "kinds": [kind for kind, _ in _ANALYSIS if kind in kinds]})
    return notes


def _contents(sheets: SheetRows) -> list[str]:
    words = " ".join(_label(value) for _, rows in sheets for row in rows[:METADATA_ROWS] for value in row if isinstance(value, str))
    return [kind for kind, keys in _CONTENTS if any(key in words for key in keys)]


def _join(items: list[str]) -> str:
    return items[0] if len(items) == 1 else f"{', '.join(items[:-1])} and {items[-1]}"


def without_ct(sheets: SheetRows) -> str:
    """Why a file gave no Ct values, and what it seems to be instead, in the scientist's words."""
    names = [name for name, _ in sheets]
    where = f"on sheet {names[0]}" if len(names) == 1 else f"on its {len(names)} sheets ({_join(names)})"
    kinds = _contents(sheets)
    seems = f" It looks like {_join(kinds)}, not qPCR results." if kinds else ""
    return (f"No table with a well, a gene (target) and a Ct or Cq column was found {where}.{seems} "
            "Upload the file with the qPCR results: the instrument's export, or a workbook into which its results table "
            "(Well Position, Sample Name, Target Name, CT) was pasted.")

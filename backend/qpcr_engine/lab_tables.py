"""Ct tables in a lab workbook: the instrument's results pasted next to the scientist's own work.

An instrument export marks its result table with an "Experiment Name" block; a lab workbook does not. There any
sheet may hold Ct tables: stacked one per gene, or side by side (the reference dye beside the target dye of the same
wells), surrounded by ΔCt, ΔΔCt and fold-change columns. This module finds those tables and reads only what was
measured: well, gene, sample and Ct. A sheet that repeats another sheet's Ct values (a "clean" copy) is left out.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

from .cells import ct_status, infer_well, is_omitted, number, safe_value, text
from .workbooks import SheetRows

Rows = list[tuple[Any, ...]]

# "CT", "Cq", "Ct value", "CT FAM"; never "▲Ct", "dCT", "Ct Mean" or "CT (triplo average)".
_CT = re.compile(r"c[tq](?:\s*(?:value|fam|vic|hex|sybr|cy5|rox|joe|tamra))?")
_FIELDS: dict[str, tuple[str, ...]] = {
    "position": ("well position", "well address", "position", "pos"),
    "well": ("well", "well id"),
    "target": ("target name", "primer target", "target", "gene", "gene name", "detector", "assay", "assay name"),
    "sample": ("sample name", "sample", "sample id"),
    "replicate": ("sample #", "sample nr", "sample no", "sample number", "replicate", "rep", "biological replicate", "bio rep"),
    "omit": ("omit",),
    "task": ("task", "content"),
    "reporter": ("reporter", "fluor", "dye"),
    "quencher": ("quencher",),
}
_ALIASES = {alias: name for name, aliases in _FIELDS.items() for alias in aliases}
_PRIORITY = {name: {alias: rank for rank, alias in enumerate(aliases)} for name, aliases in _FIELDS.items()}
# Columns an instrument writes that say nothing about the sample; and the scientist's own calculations.
_NOT_NAMES = {"sample color", "biogroup name", "biogroup color", "target color", "quantity", "comments", "well number"}
_DERIVED = re.compile(r"(?:^|\W)(?:[dδ∆▲]{1,2}|delta)\s*c[tq]|average|mean|avg|\bsd\b|fold|^fc$|2\s*\^|^rq$|relative|efficiency|slope")
MAX_HEADER_CELLS = 80
PLATE_96_ROWS, PLATE_96_COLUMNS = "ABCDEFGH", 12


def label(value: Any) -> str:
    """A header cell as text to match: lower case, single spaces, symbols kept (so "▲Ct" stays apart from "Ct")."""
    return re.sub(r"\s+", " ", value.strip().lower()) if isinstance(value, str) else ""


@dataclass(frozen=True)
class Segment:
    """One table's columns in a header row; side-by-side tables are separate segments of the same row."""
    header: int
    span: tuple[int, ...]
    columns: dict[str, int]
    names: tuple[int, ...]
    replicate: int | None


@dataclass(frozen=True)
class Measurement:
    row: int
    well: str
    well_number: Any
    target: str
    sample: str
    ct_value: Any
    reporter: Any
    task: Any
    omit: bool


@dataclass(frozen=True)
class Table:
    sheet: str
    segment: Segment
    measurements: tuple[Measurement, ...]
    skipped: int


def _field(name: str) -> str | None:
    return "ct" if _CT.fullmatch(name) else _ALIASES.get(name)


def _split(span: list[tuple[int, str]]) -> list[list[tuple[int, str]]]:
    """Tables pasted without an empty column between them: a new well column after a Ct column starts the next."""
    parts: list[list[tuple[int, str]]] = [[]]
    for column, name in span:
        seen = {_field(n) for _, n in parts[-1]}
        if _field(name) in {"well", "position"} and "ct" in seen:
            parts.append([])
        parts[-1].append((column, name))
    return parts


def _names(part: list[tuple[int, str]], columns: dict[str, int]) -> tuple[int, ...]:
    """The columns that name a well's sample: the sample column and the unnamed label columns beside it ("saRNA", "Sample #")."""
    anchors = [columns[name] for name in ("sample", "replicate") if name in columns]
    if not anchors:
        return ()
    order = [column for column, _ in part]
    loose = {column for column, name in part if _field(name) is None and name not in _NOT_NAMES and not _DERIVED.search(name)}
    chosen = set(anchors)
    for anchor in anchors:
        for step in (-1, 1):
            at = order.index(anchor) + step
            while 0 <= at < len(order) and order[at] in loose:
                chosen.add(order[at])
                at += step
    return tuple(sorted(chosen))


def _segment(header: int, part: list[tuple[int, str]]) -> Segment | None:
    """The table's columns; where two headers could be the gene ("Primer Target", "Assay"), the more specific wins."""
    best: dict[str, tuple[int, int]] = {}
    for column, name in part:
        field = _field(name)
        rank = 0 if field == "ct" else _PRIORITY.get(field or "", {}).get(name, 0)
        if field and (field not in best or rank < best[field][0]):
            best[field] = (rank, column)
    columns = {field: column for field, (_, column) in best.items()}
    if "ct" not in columns or "target" not in columns or not ({"position", "well"} & columns.keys()):
        return None
    return Segment(header, tuple(c for c, _ in part), columns, _names(part, columns), columns.get("replicate"))


def segments(row: tuple[Any, ...], header: int) -> list[Segment]:
    labels = [(column, label(value)) for column, value in enumerate(row)]
    filled = [(column, name) for column, name in labels if name]
    if len(filled) < 3 or len(filled) > MAX_HEADER_CELLS or not any(_CT.fullmatch(name) for _, name in filled):
        return []
    spans: list[list[tuple[int, str]]] = []
    for column, name in filled:
        if spans and spans[-1][-1][0] == column - 1:
            spans[-1].append((column, name))
        else:
            spans.append([(column, name)])
    found = [_segment(header, part) for span in spans for part in _split(span)]
    return [segment for segment in found if segment]


def _cell(row: tuple[Any, ...], column: int | None) -> Any:
    return row[column] if column is not None and column < len(row) else None


def _sample(row: tuple[Any, ...], segment: Segment) -> str:
    values = [text(_cell(row, column)) for column in segment.names]
    values = [value for value in values if value]
    if segment.replicate is not None and len(values) > 1 and text(_cell(row, segment.replicate)) == values[-1]:
        return f"{' '.join(values[:-1])}.{values[-1]}"
    return " ".join(values)


def _well_from_number(value: Any, columns: int) -> str | None:
    position = number(value)
    if position is None or not position.is_integer() or not 1 <= position <= columns * (8 if columns == 12 else 16):
        return None
    index = int(position) - 1
    return f"{chr(65 + index // columns)}{index % columns + 1}"


def read_table(sheet: str, rows: Rows, segment: Segment) -> Table | None:
    """The table's measurements, down to the first empty row; None when its well column holds no wells."""
    entries: list[tuple[int, Any, tuple[Any, ...]]] = []
    for index in range(segment.header + 1, len(rows)):
        row = rows[index]
        if all(_cell(row, column) is None for column in segment.span):
            break
        if _CT.fullmatch(label(_cell(row, segment.columns["ct"]))):
            break  # the next table starts right below
        target, ct = _cell(row, segment.columns["target"]), _cell(row, segment.columns["ct"])
        if target is None and ct is None:
            continue  # an unused well
        entries.append((index, _cell(row, segment.columns.get("position", segment.columns.get("well"))), row))
    numbered = "position" not in segment.columns and entries and all(number(raw) is not None for _, raw, _ in entries)
    columns = 24 if numbered and max(number(raw) or 0 for _, raw, _ in entries) > 96 else PLATE_96_COLUMNS
    measurements = []
    for index, raw, row in entries:
        well = _well_from_number(raw, columns) if numbered else infer_well(raw)
        if well is None:
            continue
        measurements.append(Measurement(index, well, safe_value(_cell(row, segment.columns.get("well"))), text(_cell(row, segment.columns["target"])),
                                        _sample(row, segment), _cell(row, segment.columns["ct"]), safe_value(_cell(row, segment.columns.get("reporter"))),
                                        safe_value(_cell(row, segment.columns.get("task"))), is_omitted(_cell(row, segment.columns.get("omit")))))
    if not measurements or len(measurements) * 2 < len(entries):
        return None
    return Table(sheet, segment, tuple(measurements), len(entries) - len(measurements))


def _with_neighbour_names(tables: list[Table]) -> list[Table]:
    """A table without a sample column (often the reference dye's) takes the names of the table beside it, well by well."""
    named = {}
    for table in tables:
        for item in table.measurements:
            if item.sample:
                named.setdefault((table.segment.header, item.well), item.sample)
    return [table if table.segment.names else
            replace(table, measurements=tuple(replace(item, sample=named.get((table.segment.header, item.well), "")) for item in table.measurements))
            for table in tables]


def sheet_tables(sheet: str, rows: Rows) -> list[Table]:
    tables = []
    for index, row in enumerate(rows):
        for segment in segments(row, index):
            table = read_table(sheet, rows, segment)
            if table:
                tables.append(table)
    return _with_neighbour_names(tables)


def _key(item: Measurement) -> tuple[str, str, str]:
    return item.well, item.target.lower(), text(item.reporter).lower()


def _plates(tables: list[Table]) -> list[list[Table]]:
    """One sheet is one plate, unless a well and gene come back with another Ct: then a second plate starts."""
    plates: list[list[Table]] = []
    seen: dict[tuple[str, str, str], Any] = {}
    for table in tables:
        clash = any(seen.get(_key(item), item.ct_value) != item.ct_value for item in table.measurements)
        if not plates or clash:
            plates.append([])
            seen = {}
        plates[-1].append(table)
        seen.update({_key(item): item.ct_value for item in table.measurements})
    return plates


def _fingerprint(plate: list[Table]) -> set[tuple[str, str, float]]:
    return {(item.well, item.target.lower(), ct) for table in plate for item in table.measurements
            if (ct := number(item.ct_value)) is not None}


@dataclass(frozen=True)
class Plate:
    sheet: str
    tables: tuple[Table, ...]


def distinct_plates(sheets: SheetRows) -> tuple[list[Plate], list[dict[str, str]]]:
    """Every plate in the workbook once; a sheet that repeats another's Ct values is reported, not imported."""
    found = [Plate(sheet, tuple(plate)) for sheet, rows in sheets for plate in _plates(sheet_tables(sheet, rows))]
    kept: list[Plate] = []
    copies: list[dict[str, str]] = []
    for plate in found:
        mine = _fingerprint(plate.tables)
        same = next((index for index, other in enumerate(kept) if mine and (theirs := _fingerprint(other.tables))
                     and (mine <= theirs or theirs <= mine)), None)
        if same is None:
            kept.append(plate)
        elif len(mine) > len(_fingerprint(kept[same].tables)):
            copies.append({"sheet": kept[same].sheet, "same_as": plate.sheet})
            kept[same] = plate
        else:
            copies.append({"sheet": plate.sheet, "same_as": kept[same].sheet})
    return kept, copies


def _plate_size(plate: Plate, block_type: int | None) -> int:
    if block_type:
        return block_type
    wells = [item.well for table in plate.tables for item in table.measurements]
    large = any(well[0] not in PLATE_96_ROWS or int(well[1:]) > PLATE_96_COLUMNS for well in wells)
    return 384 if large else 96


def _assay_names(measurements: list[Measurement]) -> dict[tuple[str, str], str]:
    """A gene measured with two dyes in one plate (a multiplex set up with one target name) is told apart by its dye."""
    dyes: dict[str, set[str]] = {}
    for item in measurements:
        dyes.setdefault(item.target, set()).add(text(item.reporter))
    return {(item.target, text(item.reporter)): f"{item.target} ({text(item.reporter)})" if len(dyes[item.target]) > 1 and text(item.reporter) else item.target
            for item in measurements}


def _run_names(plates: list[Plate], file_name: str, experiment: str | None) -> list[str]:
    if len(plates) == 1:
        return [experiment or Path(file_name).stem]
    names: list[str] = []
    for plate in plates:
        base = plate.sheet.strip() or "Sheet"
        names.append(base if base not in names else f"{base} ({sum(n.startswith(base) for n in names) + 1})")
    return names


def read_lab_workbook(sheets: SheetRows, file_name: str, metadata: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[str], dict[str, Any]]:
    """Records and runs in the instrument parser's shape, plus where they came from."""
    plates, copies = distinct_plates(sheets)
    records: list[dict[str, Any]] = []
    runs: list[dict[str, Any]] = []
    warnings: list[str] = []
    for plate, run_name in zip(plates, _run_names(plates, file_name, metadata.get("experiment"))):
        first = plate.tables[0].segment.header
        run_id = f"{plate.sheet}:{first + 1}:{run_name}"
        measurements = [item for table in plate.tables for item in table.measurements]
        assays = _assay_names(measurements)
        seen: set[tuple[str, str]] = set()
        for item in measurements:
            assay = assays[(item.target, text(item.reporter))] or "Unassigned assay"
            if (item.well, assay) in seen:
                continue  # the same well copied twice on one sheet
            seen.add((item.well, assay))
            ct, status = ct_status(item.ct_value)
            records.append({"source_file": file_name, "sheet": plate.sheet, "row_number": item.row + 1, "run_id": run_id, "run_name": run_name,
                            "well": item.well, "well_number": item.well_number, "sample": item.sample or "Unassigned sample", "assay": assay,
                            "reporter": item.reporter, "task": item.task, "ct_source_value": safe_value(item.ct_value), "ct": ct,
                            "status": status, "omit": item.omit})
        skipped = sum(table.skipped for table in plate.tables)
        if skipped:
            warnings.append(f"{plate.sheet}: {skipped} row{'s' if skipped > 1 else ''} without a valid well address left out.")
        runs.append({"id": run_id, "name": run_name, "sheet": plate.sheet, "header_row": first + 1, "record_count": len(seen),
                     "plate_size": _plate_size(plate, metadata.get("plate_size")), "source_file": file_name,
                     "instrument_file": metadata.get("instrument_file") if len(plates) == 1 else None})
    source = {"kind": "lab workbook", "sheets": [plate.sheet for plate in plates], "copies": copies}
    return records, runs, warnings, source

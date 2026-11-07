from __future__ import annotations

import csv
import re
from pathlib import Path
from typing import Any

from .cells import ct_status, infer_well, is_omitted, normalize_key, safe_value
from .lab_tables import read_lab_workbook, segments
from .workbook_notes import own_analysis, without_ct, workbook_metadata
from .workbooks import SheetRows, read_xls, read_xlsx

__all__ = ["import_qpcr_file", "infer_well", "normalize_key"]


def _header_columns(values: list[Any]) -> dict[str, int]:
    normalized = [normalize_key(value) for value in values]
    aliases = {
        "well_position": ("well position", "well address", "position"),
        "well_number": ("well", "well id"),
        "sample": ("sample name", "sample id", "sample"),
        "assay": ("target name", "assay", "gene target"),
        "ct": ("ct", "cq", "ct value", "cq value"),
        "omit": ("omit", "omit flag", "excluded"),
        "task": ("task",),
        "reporter": ("reporter",),
        "quencher": ("quencher",),
    }
    found: dict[str, int] = {}
    for field, candidates in aliases.items():
        for candidate in candidates:
            try:
                found[field] = normalized.index(candidate)
                break
            except ValueError:
                continue
    if "well_position" not in found and "well_number" in found:
        found["well_position"] = found["well_number"]
    return found


def _metadata_before(rows: list[tuple[Any, ...]], header_index: int, key: str) -> Any:
    wanted = normalize_key(key)
    for row in reversed(rows[:header_index]):
        if row and normalize_key(row[0]) == wanted:
            return next((value for value in row[1:] if value is not None), None)
    return None


def _plate_size(rows: list[tuple[Any, ...]], header_index: int) -> int | None:
    block_type = _metadata_before(rows, header_index, "Block Type")
    if block_type:
        match = re.search(r"\b(96|384)\b", str(block_type))
        if match:
            return int(match.group(1))
    return None


def _instrument_file(value: Any) -> str | None:
    """The instrument's own file name ("…_hkg_af22.eds"), without the folder it was saved in."""
    name = re.split(r"[\\/]", str(value))[-1].strip() if value is not None else ""
    return name or None


def _parse_rows(
    rows: list[tuple[Any, ...]],
    sheet_name: str,
    source_file: str,
    *,
    default_run: str,
    is_workbook: bool,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[str]]:
    sections: list[tuple[int, dict[str, int], str, int | None, str | None]] = []
    for index, row in enumerate(rows):
        # A result header names at least four columns; skipping numeric rows keeps raw-curve sheets fast.
        if sum(isinstance(value, str) for value in row) < 4:
            continue
        columns = _header_columns(list(row))
        if not {"well_position", "sample", "assay", "ct"}.issubset(columns):
            continue
        run_name = _metadata_before(rows, index, "Experiment Name")
        # Instrument exports have an Experiment Name block before their result
        # table. This avoids re-importing calculation tabs that embed raw data.
        if is_workbook and run_name is None:
            continue
        sections.append(
            (
                index,
                columns,
                str(run_name).strip() if run_name is not None else default_run,
                _plate_size(rows, index),
                _instrument_file(_metadata_before(rows, index, "Experiment File Name")),
            )
        )

    records: list[dict[str, Any]] = []
    runs: list[dict[str, Any]] = []
    warnings: list[str] = []
    seen_measurements: set[tuple[str, str, str]] = set()

    for section_index, (header_index, columns, run_name, plate_size, instrument_file) in enumerate(sections):
        run_id = f"{sheet_name}:{header_index + 1}:{run_name}"
        run_records = 0
        next_header = (
            sections[section_index + 1][0]
            if section_index + 1 < len(sections)
            else len(rows)
        )
        for row_index in range(header_index + 1, next_header):
            row = rows[row_index]
            if not any(value is not None for value in row):
                break
            sample_value = row[columns["sample"]] if columns["sample"] < len(row) else None
            assay_value = row[columns["assay"]] if columns["assay"] < len(row) else None
            ct_value = row[columns["ct"]] if columns["ct"] < len(row) else None
            well_value = (
                row[columns["well_position"]]
                if columns["well_position"] < len(row)
                else None
            )

            # Stop at footer/metadata rows rather than interpreting them as
            # malformed measurements.
            if sample_value is None and assay_value is None and ct_value is None:
                break
            if sample_value is None and assay_value is None:
                continue

            well = infer_well(well_value)
            if well is None:
                warnings.append(
                    f"{sheet_name} row {row_index + 1}: invalid or missing well address."
                )
                well = str(well_value).strip() if well_value is not None else "Unknown well"

            assay = str(assay_value).strip() if assay_value is not None else ""
            sample = str(sample_value).strip() if sample_value is not None else ""
            if not sample or not assay:
                warnings.append(
                    f"{sheet_name} row {row_index + 1}: missing sample or assay assignment."
                )

            omit_value = (
                row[columns["omit"]] if "omit" in columns and columns["omit"] < len(row) else None
            )
            omitted = is_omitted(omit_value)
            ct, status = ct_status(ct_value)
            key = (run_id, well, assay)
            if key in seen_measurements:
                warnings.append(
                    f"{sheet_name} row {row_index + 1}: duplicate measurement for {well} / {assay} in {run_name}."
                )
            seen_measurements.add(key)

            def get_column(field: str) -> Any:
                column = columns.get(field)
                return row[column] if column is not None and column < len(row) else None

            record = {
                "source_file": source_file,
                "sheet": sheet_name,
                "row_number": row_index + 1,
                "run_id": run_id,
                "run_name": run_name,
                "well": well,
                "well_number": safe_value(get_column("well_number")),
                "sample": sample or "Unassigned sample",
                "assay": assay or "Unassigned assay",
                "reporter": safe_value(get_column("reporter")),
                "task": safe_value(get_column("task")),
                "ct_source_value": safe_value(ct_value),
                "ct": ct,
                "status": status,
                "omit": omitted,
            }
            records.append(record)
            run_records += 1

        runs.append(
            {
                "id": run_id,
                "name": run_name,
                "sheet": sheet_name,
                "header_row": header_index + 1,
                "record_count": run_records,
                "plate_size": plate_size,
                "source_file": source_file,
                "instrument_file": instrument_file,
            }
        )

    return records, runs, warnings


Parsed = tuple[list[dict[str, Any]], list[dict[str, Any]], list[str], dict[str, Any]]


def _import_csv(path: Path, file_name: str) -> Parsed:
    with path.open("r", newline="", encoding="utf-8-sig") as file:
        rows = [tuple(cell if cell.strip() else None for cell in row) for row in csv.reader(file)]
    stem = Path(file_name).stem
    if any(len(segments(row, index)) > 1 for index, row in enumerate(rows)):
        return _lab_or_nothing([(stem, rows)], file_name)
    records, runs, warnings = _parse_rows(rows, stem, file_name, default_run=stem, is_workbook=False)
    if records:
        return records, runs, warnings, {"kind": "instrument export"}
    return _lab_or_nothing([(stem, rows)], file_name)


def _lab_or_nothing(sheets: SheetRows, file_name: str) -> Parsed:
    """No instrument result section: Ct tables pasted into a lab workbook, or a plain account of what the file holds."""
    records, runs, warnings, source = read_lab_workbook(sheets, file_name, workbook_metadata(sheets))
    if not records:
        return [], [], [without_ct(sheets)], {"kind": "no results"}
    return records, runs, warnings, {**source, "analysis": own_analysis(sheets)}


def _import_workbook(worksheet_rows: SheetRows, file_name: str) -> Parsed:
    """Instrument result sections are authoritative; derived worksheets may repeat their Ct values without run metadata."""
    found = [(sheet_name, _parse_rows(rows, sheet_name, file_name, default_run=Path(file_name).stem, is_workbook=True))
             for sheet_name, rows in worksheet_rows]
    found = [(sheet_name, parsed) for sheet_name, parsed in found if parsed[1]]
    if not found:
        return _lab_or_nothing(worksheet_rows, file_name)
    records = [record for _, (sheet_records, _, _) in found for record in sheet_records]
    runs = [run for _, (_, sheet_runs, _) in found for run in sheet_runs]
    warnings = [warning for _, (_, _, sheet_warnings) in found for warning in sheet_warnings]
    instrument_sheets = {sheet_name for sheet_name, _ in found}
    return records, runs, warnings, {"kind": "instrument export", "analysis": own_analysis(worksheet_rows, skip=instrument_sheets)}


def import_qpcr_file(path: str, display_name: str | None = None) -> dict[str, Any]:
    """Parse one export. display_name is the user's file name when the upload is stored under another name."""
    file_path = Path(path)
    file_name = display_name or file_path.name
    suffix = file_path.suffix.lower()
    if suffix == ".csv":
        records, runs, warnings, source = _import_csv(file_path, file_name)
    elif suffix in {".xlsx", ".xlsm"}:
        records, runs, warnings, source = _import_workbook(read_xlsx(file_path), file_name)
    elif suffix == ".xls":
        records, runs, warnings, source = _import_workbook(read_xls(file_path), file_name)
    else:
        raise ValueError(f"Unsupported file type: {suffix}. Use CSV, XLSX, XLSM or XLS.")

    if source.get("kind") == "lab workbook":
        warnings.append("Read raw Ct/Cq measurements from tables in a lab workbook.")
    for analysis in source.get("analysis", []):
        warnings.append(f"{analysis['sheet']}: existing {', '.join(analysis['kinds'])} calculations recognized; only raw Ct/Cq measurements are imported. The workbench calculates its own analysis.")
    for copy in source.get("copies", []):
        warnings.append(f"{copy['sheet']}: repeated Ct table left out; measurements imported from {copy['same_as']}.")

    return {
        "file_name": file_name,
        "records": records,
        "runs": runs,
        "record_count": len(records),
        "warning_count": len(warnings),
        "warnings": warnings,
        "source": {"file": file_name, **source},
    }

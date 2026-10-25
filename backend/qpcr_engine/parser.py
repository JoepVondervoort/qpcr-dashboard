from __future__ import annotations

import csv
import math
import re
from pathlib import Path
from typing import Any

from openpyxl import load_workbook


def normalize_key(value: Any) -> str:
    if value is None:
        return ""
    return re.sub(r"[^a-z0-9]+", " ", str(value).strip().lower()).strip()


def infer_well(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip().upper()
    if re.fullmatch(r"[A-P](?:[1-9]|1[0-9]|2[0-4])", text):
        return text
    return None


def _safe_value(value: Any) -> Any:
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def _number(value: Any) -> float | None:
    if value is None or str(value).strip().lower() in {
        "",
        "undetermined",
        "undet",
        "na",
        "n/a",
        "nan",
        "none",
        "-",
    }:
        return None
    try:
        number = float(str(value).replace(",", "").strip())
        return number if math.isfinite(number) else None
    except (TypeError, ValueError):
        return None


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


def _parse_rows(
    rows: list[tuple[Any, ...]],
    sheet_name: str,
    source_file: str,
    *,
    default_run: str,
    is_workbook: bool,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[str]]:
    sections: list[tuple[int, dict[str, int], str, int | None]] = []
    for index, row in enumerate(rows):
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
            )
        )

    records: list[dict[str, Any]] = []
    runs: list[dict[str, Any]] = []
    warnings: list[str] = []
    seen_measurements: set[tuple[str, str, str]] = set()

    for section_index, (header_index, columns, run_name, plate_size) in enumerate(sections):
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
            omit_text = str(omit_value).strip().lower()
            omitted = omit_text in {"true", "yes", "1", "y", "t", "omit", "excluded"}
            ct = _number(ct_value)
            if ct is not None:
                status = "detected"
            elif ct_value is None or str(ct_value).strip() == "":
                status = "missing"
            elif str(ct_value).strip().lower() in {"undetermined", "undet"}:
                status = "undetermined"
            else:
                status = "invalid"
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
                "well_number": _safe_value(get_column("well_number")),
                "sample": sample or "Unassigned sample",
                "assay": assay or "Unassigned assay",
                "reporter": _safe_value(get_column("reporter")),
                "task": _safe_value(get_column("task")),
                "ct_source_value": _safe_value(ct_value),
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
            }
        )

    return records, runs, warnings


def _import_csv(path: Path) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[str]]:
    with path.open("r", newline="", encoding="utf-8-sig") as file:
        reader = csv.reader(file)
        rows = [tuple(row) for row in reader]
    return _parse_rows(
        rows,
        path.stem,
        path.name,
        default_run=path.stem,
        is_workbook=False,
    )


def _import_workbook(path: Path) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[str]]:
    workbook = load_workbook(path, read_only=True, data_only=True)
    try:
        worksheet_rows = [
            (sheet.title, [tuple(row) for row in sheet.iter_rows(values_only=True)])
            for sheet in workbook.worksheets
        ]
    finally:
        workbook.close()

    all_candidates: list[
        tuple[str, list[dict[str, Any]], list[dict[str, Any]], list[str]]
    ] = []
    for sheet_name, rows in worksheet_rows:
        records, runs, warnings = _parse_rows(
            rows,
            sheet_name,
            path.name,
            default_run=path.stem,
            is_workbook=True,
        )
        if runs:
            all_candidates.append((sheet_name, records, runs, warnings))

    if not all_candidates:
        return [], [], [
            "No instrument result sections were found. Expected an Experiment Name metadata field followed by Well, Sample Name, Target Name, and Ct/Cq columns."
        ]

    # Workbook exports with run metadata are authoritative; derived worksheets
    # may repeat raw measurements but do not have the instrument run metadata.
    selected = all_candidates
    records = [record for _, candidate_records, _, _ in selected for record in candidate_records]
    runs = [run for _, _, candidate_runs, _ in selected for run in candidate_runs]
    warnings = [warning for _, _, _, candidate_warnings in selected for warning in candidate_warnings]
    return records, runs, warnings


def import_qpcr_file(path: str) -> dict[str, Any]:
    file_path = Path(path)
    suffix = file_path.suffix.lower()
    if suffix == ".csv":
        records, runs, warnings = _import_csv(file_path)
    elif suffix in {".xlsx", ".xlsm"}:
        records, runs, warnings = _import_workbook(file_path)
    else:
        raise ValueError(f"Unsupported file type: {suffix}. Use CSV, XLSX, or XLSM.")

    return {
        "file_name": file_path.name,
        "records": records,
        "runs": runs,
        "record_count": len(records),
        "warning_count": len(warnings),
        "warnings": warnings,
    }

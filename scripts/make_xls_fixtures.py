"""Regenerate the synthetic legacy-Excel (.xls) test plates in backend/test_fixtures.

The plates mimic a QuantStudio .xls export: a metadata block, a Results table with
numeric Omit flags, and a derived calculation tab that the importer must ignore.
They contain invented values only. Writing .xls needs xlwt, which the app itself
does not use: ``pip install xlwt`` in a scratch environment, then run this script.
"""
from __future__ import annotations

from pathlib import Path

import xlwt

OUT = Path(__file__).resolve().parents[1] / "backend" / "test_fixtures"
HEADER = ["Well", "Well Position", "Omit", "Sample Name", "Target Name", "Task", "Reporter", "CT"]
# Target Ct per sample; the reference reads 20 everywhere, so ΔCt = target Ct − 20.
PLATES = {
    "SYNTH-PLATE_1": {"SYNTH_cells_day0.1": 25.0, "SYNTH_cells_day0.2": 25.0, "SYNTH_cells_day7.1": 24.0, "SYNTH_cells_day7.2": 24.0},
    "SYNTH-PLATE_2": {"SYNTH_cells_day 21.1": 23.0, "SYNTH_cells_day 21.2": 23.0, "SYNTH_cells_day 21.1 RS": 22.0},
}


def plate_rows(target_ct: dict[str, float]) -> list[list[object]]:
    rows: list[list[object]] = []
    for sample, ct in [*target_ct.items(), ("H2O", None)]:
        for assay, value in [("TARGET", ct), ("REF", None if ct is None else 20.0)]:
            for technical in range(2):
                index = len(rows)
                rows.append([index + 1, f"{'ABCDEFGH'[index // 12]}{index % 12 + 1}", 0, sample, assay, "UNKNOWN", "SYBR",
                             "Undetermined" if value is None else value + technical * 0.1])
    rows[1][2] = 1  # The instrument omitted one well.
    return rows


def write_plate(name: str, target_ct: dict[str, float]) -> None:
    book = xlwt.Workbook()
    results = book.add_sheet("Results")
    metadata = [("Block Type", "96-Well Block"), ("Chemistry", "SYBR_GREEN"), ("Experiment Name", name), ("Instrument Type", "QuantStudio 5 System")]
    for row, (key, value) in enumerate(metadata):
        results.write(row, 0, key)
        results.write(row, 1, value)
    header_row = len(metadata) + 1
    for column, label in enumerate(HEADER):
        results.write(header_row, column, label)
    rows = plate_rows(target_ct)
    for offset, values in enumerate(rows, start=header_row + 1):
        for column, value in enumerate(values):
            results.write(offset, column, value)
    # A hand-made analysis tab repeats raw rows but has no run metadata.
    derived = book.add_sheet("Calc")
    for column, label in enumerate(HEADER):
        derived.write(0, column, label)
    for offset, values in enumerate(rows[:4], start=1):
        for column, value in enumerate(values):
            derived.write(offset, column, value)
    book.save(str(OUT / f"{name}.xls"))


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for plate, values in PLATES.items():
        write_plate(plate, values)

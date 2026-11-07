"""Combine instrument plates into one analysis run, keeping each plate's identity.

A combined run lets samples on one plate be normalized to baseline samples on another,
as when a time course is spread over several plates. Wells of one sample and assay are
never pooled across plates: such overlaps are refused.
"""
from __future__ import annotations

from typing import Any, Callable

from .layout import UNASSIGNED_ASSAY, UNASSIGNED_SAMPLE, placeholder_names

Record = dict[str, Any]
Run = dict[str, Any]
IsControl = Callable[[Record], bool]

PLATE_SEPARATOR = " › "
_NAME_SEPARATORS = "_- "


def plate_names(run: Run) -> list[str]:
    return [plate["name"] for plate in run.get("plates", [])] or [run["name"]]


def check_new_plates(existing_runs: list[Run], new_runs: list[Run]) -> None:
    """Refuse a plate whose instrument run name is already present. One export may repeat a name."""
    taken = {name for run in existing_runs for name in plate_names(run)}
    for run in new_runs:
        if run["name"] in taken:
            raise ValueError(f"Plate “{run['name']}” appears more than once: it is already in this experiment or in another chosen file. Each plate can be imported once.")


def combined_run_name(names: list[str]) -> str:
    """"X_1" and "X_3" become "X_1 + 3"; names without a shared stem are joined in full."""
    prefix = names[0]
    for name in names[1:]:
        length = 0
        while length < min(len(prefix), len(name)) and prefix[length] == name[length]:
            length += 1
        prefix = prefix[:length]
    while prefix and prefix[-1] not in _NAME_SEPARATORS:
        prefix = prefix[:-1]
    if prefix and all(len(name) > len(prefix) for name in names):
        return " + ".join([names[0], *(name[len(prefix):] for name in names[1:])])
    return " + ".join(names)


def _plate_entry(run: Run) -> dict[str, Any]:
    return {key: run.get(key) for key in ("name", "sheet", "header_row", "record_count", "plate_size", "source_file", "instrument_file")}


def _shared_measurements(existing: list[Record], plate: list[Record], is_control: IsControl) -> list[tuple[str, str]]:
    # Wells without a sample or assay name are never analyzed, so they cannot be pooled. A name on more
    # wells than technical replicates is a placeholder, not a sample: the plate layout check asks for real names.
    placeholders = placeholder_names(existing, is_control) | placeholder_names(plate, is_control)
    named = lambda r: (not is_control(r) and r["sample"] != UNASSIGNED_SAMPLE and r["assay"] != UNASSIGNED_ASSAY
                       and r["sample"] not in placeholders)
    measured = {(r["sample"], r["assay"]) for r in existing if named(r)}
    return sorted({(r["sample"], r["assay"]) for r in plate if named(r)} & measured)


def add_plates_to_run(records: list[Record], runs: list[Run], target_id: str, new_records: list[Record],
                      new_runs: list[Run], is_control: IsControl) -> tuple[list[Record], list[Run]]:
    """Return new record and run lists in which new_runs have become plates of the run target_id."""
    target = next((run for run in runs if run["id"] == target_id), None)
    if target is None:
        raise ValueError("The run to combine with is not part of this experiment.")
    check_new_plates(runs, new_runs)
    # Earlier wells keep their run, sheet and row, so saved exclusions still identify them.
    labelled = [{**r, "plate": r.get("plate") or target["name"]} if r["run_id"] == target_id else r for r in records]
    in_run = [r for r in labelled if r["run_id"] == target_id]
    plates = target.get("plates") or [_plate_entry(target)]
    added: list[Record] = []
    for run in new_runs:
        plate_records = [r for r in new_records if r["run_id"] == run["id"]]
        shared = _shared_measurements(in_run + added, plate_records, is_control)
        if shared:
            sample, assay = shared[0]
            raise ValueError(f"These plates cannot be combined: {len(shared)} sample/assay pair(s) are measured on both plates "
                             f"(for example {sample} · {assay}). Combining would pool wells from different plates; import them as separate runs instead.")
        added += [{**r, "run_id": target_id, "plate": run["name"], "sheet": f"{run['name']}{PLATE_SEPARATOR}{r['sheet']}"} for r in plate_records]
        plates = [*plates, _plate_entry(run)]
    name = combined_run_name([plate["name"] for plate in plates])
    sizes = {plate["plate_size"] for plate in plates}
    combined = {**target, "name": name, "record_count": len(in_run) + len(added),
                "plate_size": next(iter(sizes)) if len(sizes) == 1 else None, "plates": plates}
    merged = [{**r, "run_name": name} if r["run_id"] == target_id else r for r in [*labelled, *added]]
    return merged, [combined if run["id"] == target_id else run for run in runs]


def combine_all(records: list[Record], runs: list[Run], is_control: IsControl) -> tuple[list[Record], list[Run]]:
    """Make every run of a fresh import a plate of its first run."""
    if len(runs) < 2:
        return records, runs
    first, rest = runs[0], runs[1:]
    rest_ids = {run["id"] for run in rest}
    return add_plates_to_run([r for r in records if r["run_id"] not in rest_ids], [first], first["id"],
                             [r for r in records if r["run_id"] in rest_ids], rest, is_control)

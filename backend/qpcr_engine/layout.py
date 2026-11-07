"""Which sample is in which well, when the instrument export does not say.

Many exports name no samples, or put one placeholder name on a whole plate. The analysis cannot
guess the plate layout: it reports the wells that need a name (layout checks) and applies the
names the scientist gives (apply_layout). The instrument's own name is kept on every renamed well.
"""
from __future__ import annotations

import re
from collections import defaultdict
from typing import Any, Callable, Iterable

from .review import canonical_hash, quality_flag_id

Record = dict[str, Any]
IsControl = Callable[[Record], bool]

UNASSIGNED_SAMPLE, UNASSIGNED_ASSAY = "Unassigned sample", "Unassigned assay"
# Technical replicates are two to four wells; more wells of one gene under one name usually
# means that several samples share a placeholder name.
MAX_TECHNICAL_WELLS = 4
SAMPLE_NAME_MAX = 120
# Control characters and bidirectional overrides could disguise a name.
_HIDDEN_CHARACTERS = re.compile(r"[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]")
_WELL = re.compile(r"([A-Z])(\d+)")

PlateKey = tuple[str, str | None]


def _plate_of(record: Record) -> PlateKey:
    return str(record.get("run_id", "")), record.get("plate")


def well_order(well: str) -> tuple[int, int, str]:
    match = _WELL.fullmatch(str(well))
    return (ord(match.group(1)), int(match.group(2)), "") if match else (999, 999, str(well))


def _measured(record: Record) -> bool:
    return record.get("assay") != UNASSIGNED_ASSAY


def _named(record: Record) -> bool:
    return record.get("sample") != UNASSIGNED_SAMPLE


def wells_per_assay(records: Iterable[Record]) -> dict[tuple[str, str | None, str], int]:
    """The largest number of wells one sample name covers for a single gene, per plate."""
    wells: dict[tuple[str, str | None, str, str], set[str]] = defaultdict(set)
    for r in records:
        if _measured(r) and _named(r):
            wells[(*_plate_of(r), r["sample"], r["assay"])].add(r["well"])
    most: dict[tuple[str, str | None, str], int] = defaultdict(int)
    for (run, plate, sample, _), found in wells.items():
        most[(run, plate, sample)] = max(most[(run, plate, sample)], len(found))
    return dict(most)


def placeholder_names(records: list[Record], is_control: IsControl) -> set[str]:
    """Names that cover more wells of one gene on one plate than technical replicates do."""
    controls = {r["sample"] for r in records if is_control(r)}
    return {sample for (_, _, sample), count in wells_per_assay(records).items()
            if count > MAX_TECHNICAL_WELLS and sample not in controls}


def _wells_of(records: Iterable[Record], run_id: str, plate: str | None, sample: str) -> list[str]:
    return sorted({r["well"] for r in records if r.get("run_id") == run_id and r.get("plate") == plate and r["sample"] == sample},
                  key=well_order)


def confirmation(records: list[Record], run_id: str, plate: str | None, sample: str) -> dict[str, Any]:
    """The scientist's statement that these exact wells are technical replicates of one sample.

    It names the wells, so it lapses by itself when the layout gives the name other wells.
    """
    return {"run_id": run_id, "plate": plate, "sample": sample, "wells": _wells_of(records, run_id, plate, sample)}


def _confirmed_keys(confirmations: Iterable[dict[str, Any]]) -> set[tuple[Any, ...]]:
    return {(c.get("run_id"), c.get("plate"), c.get("sample"), tuple(c.get("wells", []))) for c in confirmations if isinstance(c, dict)}


def confirmations_on_plate(confirmations: Iterable[dict[str, Any]], run: dict[str, Any]) -> list[dict[str, Any]]:
    """When other plates join a single-plate run, its wells belong to a plate named after the run."""
    return [{**c, "plate": run["name"]} if c.get("run_id") == run["id"] and c.get("plate") is None else c
            for c in confirmations if isinstance(c, dict)]


def reopened_reviews(decisions: dict[str, Any], before: list[Record], after: list[Record]) -> dict[str, Any]:
    """QC review decisions no longer describe a sample whose wells changed; those findings open again."""
    stale = {quality_flag_id(kind, str(r.get("run_id", "")), r["sample"], r["assay"], r.get("plate"))
             for old, new in zip(before, after) if old["sample"] != new["sample"]
             for r in (old, new) for kind in ("control_signal", "technical_spread")}
    return {key: value for key, value in decisions.items() if key not in stale}


def analysable_assays(records: Iterable[Record], is_control: IsControl) -> list[str]:
    """Genes measured in at least one named biological sample; a mastermix-only "assay" is not a gene."""
    return sorted({r["assay"] for r in records if _measured(r) and _named(r) and not is_control(r)})


def open_layout_questions(records: list[Record], checks: list[dict[str, Any]], is_control: IsControl) -> int:
    """Checks that stop an analysis: blocking ones, and runs in which no sample is named yet."""
    bare = {c["run_id"] for c in checks if c["kind"] == "unnamed_wells"
            and not analysable_assays([r for r in records if r.get("run_id") == c["run_id"]], is_control)}
    return sum(c["blocking"] for c in checks) + len(bare)


def _unnamed_checks(records: list[Record]) -> list[dict[str, Any]]:
    unnamed: dict[PlateKey, set[str]] = defaultdict(set)
    for r in records:
        if _measured(r) and not _named(r):
            unnamed[_plate_of(r)].add(r["well"])
    return [{"id": canonical_hash(["unnamed_wells", run, plate]), "kind": "unnamed_wells", "run_id": run, "plate": plate,
             "sample": None, "wells": sorted(wells, key=well_order), "blocking": False,
             "message": f"{len(wells)} well(s) have a gene but no sample name. They are left out of the analysis until you name them."}
            for (run, plate), wells in unnamed.items()]


def _shared_name_checks(records: list[Record], is_control: IsControl, confirmed: set[tuple[Any, ...]]) -> list[dict[str, Any]]:
    controls = {r["sample"] for r in records if is_control(r)}
    wells: dict[tuple[str, str | None, str], set[str]] = defaultdict(set)
    for r in records:
        wells[(*_plate_of(r), r["sample"])].add(r["well"])
    checks = []
    for (run, plate, sample), count in wells_per_assay(records).items():
        found = sorted(wells[(run, plate, sample)], key=well_order)
        if count <= MAX_TECHNICAL_WELLS or sample in controls or (run, plate, sample, tuple(found)) in confirmed:
            continue
        checks.append({"id": canonical_hash(["shared_name", run, plate, sample]), "kind": "shared_name", "run_id": run, "plate": plate,
                       "sample": sample, "wells": found, "wells_per_assay": count,
                       "blocking": True,
                       "message": f"“{sample}” is on {count} wells for one gene. Name the separate samples in the plate layout, "
                                  "or confirm that these wells are technical replicates of one sample."})
    return checks


def _split_checks(records: list[Record], is_control: IsControl) -> list[dict[str, Any]]:
    plates: dict[tuple[str, str, str], set[str]] = defaultdict(set)
    for r in records:
        if r.get("plate") and _measured(r) and _named(r) and not is_control(r):
            plates[(str(r.get("run_id", "")), r["sample"], r["assay"])].add(r["plate"])
    split: dict[tuple[str, str], set[str]] = defaultdict(set)
    for (run, sample, _), found in plates.items():
        if len(found) > 1:
            split[(run, sample)] |= found
    return [{"id": canonical_hash(["split_across_plates", run, sample]), "kind": "split_across_plates", "run_id": run,
             "plate": None, "plates": sorted(found), "sample": sample, "wells": [], "blocking": True,
             "message": f"“{sample}” is measured for the same gene on plates {', '.join(sorted(found))}. Give it a different "
                        "name on each plate: wells are never pooled across plates."}
            for (run, sample), found in split.items()]


def layout_checks(records: list[Record], is_control: IsControl, confirmations: Iterable[dict[str, Any]] = ()) -> list[dict[str, Any]]:
    """Questions about the plate layout that only the scientist can answer; blocking ones stop the analysis."""
    checks = [*_unnamed_checks(records), *_shared_name_checks(records, is_control, _confirmed_keys(confirmations)),
              *_split_checks(records, is_control)]
    return sorted(checks, key=lambda c: (c["run_id"], c["plate"] or "", not c["blocking"], c["sample"] or ""))


def clean_sample_name(value: str) -> str:
    name = " ".join(_HIDDEN_CHARACTERS.sub(" ", value).split())
    if len(name) > SAMPLE_NAME_MAX:
        raise ValueError(f"Use at most {SAMPLE_NAME_MAX} characters for a sample name.")
    if name.casefold() == UNASSIGNED_SAMPLE.casefold():
        raise ValueError(f"“{UNASSIGNED_SAMPLE}” is reserved for wells without a name; leave the name empty instead.")
    return name


def _resolve_plate(run_records: list[Record], plate: str | None) -> str | None:
    if not run_records:
        raise ValueError("This run is not part of the experiment.")
    plates = {r.get("plate") for r in run_records}
    if plates == {None}:
        if plate:
            raise ValueError("This run has a single plate; leave the plate empty.")
        return None
    if plate not in plates:
        raise ValueError("Choose one plate of this combined run.")
    return plate


def _relabel(record: Record, name: str) -> Record:
    original = record.get("instrument_sample", record["sample"])
    target = name or original
    if target == original:
        return {**{k: v for k, v in record.items() if k != "instrument_sample"}, "sample": original}
    return {**record, "sample": target, "instrument_sample": original}


def _pooled_pairs(records: list[Record], run_id: str, plate: str, names: set[str], is_control: IsControl) -> list[tuple[str, str]]:
    on_plate = {(r["sample"], r["assay"]) for r in records
                if r.get("run_id") == run_id and r.get("plate") == plate and r["sample"] in names and not is_control(r)}
    elsewhere = {(r["sample"], r["assay"]) for r in records if r.get("run_id") == run_id and r.get("plate") != plate}
    return sorted(on_plate & elsewhere)


def apply_layout(records: list[Record], run_id: str, plate: str | None, assignments: dict[str, str],
                 is_control: IsControl) -> tuple[list[Record], dict[str, Any]]:
    """Return new records in which the given wells carry the given names; an empty name restores the instrument's."""
    run_records = [r for r in records if r.get("run_id") == run_id]
    plate = _resolve_plate(run_records, plate)
    known = {r["well"] for r in run_records if r.get("plate") == plate}
    unknown = sorted(set(assignments) - known, key=well_order)
    if unknown:
        raise ValueError(f"Well(s) {', '.join(unknown[:5])} are not on this plate.")
    names = {well: clean_sample_name(value) for well, value in assignments.items()}
    on_target = lambda r: r.get("run_id") == run_id and r.get("plate") == plate and r["well"] in names
    updated = [_relabel(r, names[r["well"]]) if on_target(r) else r for r in records]
    given = {name for name in names.values() if name}
    if plate is not None:
        pooled = _pooled_pairs(updated, run_id, plate, given, is_control)
        if pooled:
            sample, assay = pooled[0]
            raise ValueError(f"“{sample}” is already measured for {assay} on another plate of this run. Use a different name: "
                             "wells are never pooled across plates.")
    changed = {r["well"] for r, before in zip(updated, records) if r["sample"] != before["sample"]}
    restored = {r["well"] for r, before in zip(updated, records) if on_target(r) and not names[r["well"]] and "instrument_sample" in before}
    return updated, {"wells": len(changed), "names": sorted(given), "restored": len(restored)}

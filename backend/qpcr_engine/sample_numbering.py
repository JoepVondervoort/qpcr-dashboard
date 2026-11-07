"""Applying the workbench's numbering of unnamed samples (layout_guess.py), and taking it back.

Numbered samples form one group: the export says nothing about conditions, and pooling samples into conditions is
the scientist's call. Each numbering is recorded with what it assumed, so the experiment can show it until every
numbered sample has a real name, and undo it in one step.
"""
from __future__ import annotations

from typing import Any, Callable

from .layout import UNASSIGNED_SAMPLE, apply_layout, reopened_reviews
from .layout_guess import NO_TEMPLATE
from .review import sample_instance_id

Record = dict[str, Any]
IsControl = Callable[[Record], bool]

UNKNOWN_CONDITION = "All samples"
_KEPT = ("run_id", "plate", "kind", "wells", "samples", "shape", "numbering", "summary", "doubts", "late")


def _number(name: str) -> str:
    return name.rsplit(" ", 1)[1]


def numbering_problem(error: Exception, suggestions: list[dict[str, Any]]) -> str:
    """What went wrong, and how to import the plates so that it works."""
    combined = any(s.get("plate") for s in suggestions)
    advice = ("Import the plates again with “One experiment, each plate its own run”, or name the samples under Plate layout."
              if combined else "Name the samples under Plate layout.")
    return f"The workbench could not number the samples: {error} {advice}"


def numbered_annotations(suggestion: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """One group, “All samples”, with the sample number as the replicate; also for numbers held for late wells."""
    held = {group["sample"] for group in suggestion.get("late", []) if group.get("sample")}
    names = sorted({name for name in suggestion["wells"].values() if name != NO_TEMPLATE} | held, key=lambda name: int(_number(name)))
    return {sample_instance_id(suggestion["run_id"], name): {
        "condition": UNKNOWN_CONDITION, "series": UNKNOWN_CONDITION, "timepoint": None, "time_unit": "day",
        "replicate": _number(name), "biological_unit_id": "", "cell_line": None, "confluency": None, "role": "biological"}
        for name in names}


def _with_ntc(is_control: IsControl) -> IsControl:
    """Wells this numbering names NTC are controls before any annotation says so."""
    return lambda record: record["sample"] == NO_TEMPLATE or is_control(record)


def _changed(metadata: dict[str, Any], before: list[Record], after: list[Record], events: list[dict[str, Any]]) -> dict[str, Any]:
    return {**metadata, "qc_decisions": reopened_reviews(metadata.get("qc_decisions", {}), before, after),
            "context_revision": metadata.get("context_revision", 0) + 1, "audit_events": [*metadata.get("audit_events", []), *events]}


def apply_suggestions(records: list[Record], metadata: dict[str, Any], suggestions: list[dict[str, Any]], is_control: IsControl,
                      now: str) -> tuple[list[Record], dict[str, Any]]:
    """New records and metadata with the proposed names applied, the numbered samples grouped and the change logged.

    Raises ValueError when a name cannot be applied (see apply_layout); nothing is changed then.
    """
    updated = records
    for s in suggestions:
        updated, _ = apply_layout(updated, s["run_id"], s["plate"], s["wells"], _with_ntc(is_control))
        updated = _undecided(updated, s)
    annotations = {key: value for s in suggestions for key, value in numbered_annotations(s).items()}
    placed = {(s["run_id"], s["plate"]) for s in suggestions}
    kept = [a for a in metadata.get("auto_layouts", []) if isinstance(a, dict) and (a.get("run_id"), a.get("plate")) not in placed]
    events = [{"at": now, "action": "samples_numbered", "run_id": s["run_id"], "plate": s["plate"], "samples": s["samples"],
               "wells": len(s["wells"]), "summary": s["summary"], "doubts": s["doubts"]} for s in suggestions]
    # Conditions the scientist already gave a sample name are kept; a numbering that now worked has no problem left.
    return updated, {**{key: value for key, value in _changed(metadata, records, updated, events).items() if key != "numbering_problem"},
                     "auto_layouts": [*kept, *({key: s[key] for key in _KEPT} | {"at": now} for s in suggestions)],
                     "sample_instances": {**annotations, **metadata.get("sample_instances", {})}}


def _undecided(records: list[Record], suggestion: dict[str, Any]) -> list[Record]:
    """Wells left for the scientist carry no sample name, also on a plate whose export gave every well a placeholder."""
    wells = {well for group in suggestion.get("late", []) for well in group["wells"]}
    on_plate = lambda r: r.get("run_id") == suggestion["run_id"] and r.get("plate") == suggestion["plate"] and r["well"] in wells
    return [{**r, "sample": UNASSIGNED_SAMPLE, "instrument_sample": r.get("instrument_sample", r["sample"])}
            if on_plate(r) and r["sample"] != UNASSIGNED_SAMPLE else r for r in records]


def _on_plate(records: list[Record]) -> dict[tuple[str, str | None, str], str]:
    return {(str(r.get("run_id", "")), r.get("plate"), r["well"]): r["sample"] for r in records}


def active_auto_layouts(records: list[Record], metadata: dict[str, Any]) -> list[dict[str, Any]]:
    """Applied numberings with numbers still on the plate or wells still undecided.

    A question stays open until every one of its wells has a name. Held positions the scientist answered as samples
    join the numbered wells, so renaming in number order includes them.
    """
    current = _on_plate(records)
    active = []
    for a in (a for a in metadata.get("auto_layouts", []) if isinstance(a, dict)):
        place = (a.get("run_id"), a.get("plate"))
        groups = a.get("late", [])
        late = [group for group in groups if any(current.get((*place, well)) == UNASSIGNED_SAMPLE for well in group["wells"])]
        answered = {well: group["sample"] for group in groups if group.get("sample") for well in group["wells"]
                    if current.get((*place, well)) == group["sample"]}
        numbered = any(current.get((*place, well)) == name and name != NO_TEMPLATE for well, name in a.get("wells", {}).items())
        if numbered or late:
            active.append({**a, "late": late, "wells": {**a.get("wells", {}), **answered}})
    return active


def _restorable(numbering: dict[str, Any], current: dict[tuple[str, str | None, str], str]) -> dict[str, str]:
    """Wells that still carry this numbering's names, or an answer to one of its late-well questions."""
    place = (numbering["run_id"], numbering.get("plate"))
    expected = {**{well: {name} for well, name in numbering["wells"].items()},
                **{well: {NO_TEMPLATE, UNASSIGNED_SAMPLE, group.get("sample")} for group in numbering.get("late", []) for well in group["wells"]}}
    return {well: "" for well, names in expected.items() if current.get((*place, well)) in names}


def undo_numbering(records: list[Record], metadata: dict[str, Any], is_control: IsControl, now: str) -> tuple[list[Record], dict[str, Any]]:
    """Give wells that still carry the workbench's names their names from the export again, in one step.

    Wells the scientist renamed since keep their names. Raises LookupError when no numbering is left to undo.
    """
    active = active_auto_layouts(records, metadata)
    if not active:
        raise LookupError("No samples numbered by the workbench are left to undo.")
    undone = {(a["run_id"], a.get("plate")) for a in active}
    stored = [a for a in metadata.get("auto_layouts", []) if isinstance(a, dict) and (a.get("run_id"), a.get("plate")) in undone]
    current = _on_plate(records)
    updated = records
    for numbering in stored:
        updated, _ = apply_layout(updated, numbering["run_id"], numbering.get("plate"), _restorable(numbering, current), _with_ntc(is_control))
    remaining = {sample_instance_id(str(r.get("run_id", "")), r["sample"]) for r in updated}
    created = {key for numbering in stored for key in numbered_annotations(numbering)}
    events = [{"at": now, "action": "samples_unnumbered", "run_id": a["run_id"], "plate": a.get("plate")} for a in active]
    return updated, {**_changed(metadata, records, updated, events),
                     "auto_layouts": [a for a in metadata.get("auto_layouts", []) if isinstance(a, dict) and a not in stored],
                     "sample_instances": {key: value for key, value in metadata.get("sample_instances", {}).items()
                                          if key not in created or key in remaining}}

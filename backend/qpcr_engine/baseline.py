"""Which biological samples define 1× when a target is not detected in the chosen baseline."""
from __future__ import annotations

from collections import defaultdict
from typing import Any, NamedTuple

from .sample_metadata import find_time, without_time


class Baseline(NamedTuple):
    samples: list[str]
    note: str | None
    # Samples measured before a later baseline; they get no fold change.
    before: frozenset[str]


def time_label(unit: str, value: float) -> str:
    return f"{'Hour' if unit == 'hour' else 'Day'} {value:g}"


def course_of(metadata: dict[str, Any]) -> str:
    """The time course a sample belongs to; names that are only a time point ("Day 7.1") share one."""
    series = str(metadata.get("series") or "")
    token = find_time(series)
    return "" if token and not without_time(series, token).strip(" _-·") else series


def resolve_baseline(target: str, baselines: list[str], steps: dict[str, dict[str, Any]], samples: list[str],
                     metadata: dict[str, dict[str, Any]] | None) -> Baseline:
    """Keep the chosen baseline, or move to the first later time point where every sample has the target."""
    missing = [s for s in baselines if steps[s]["delta_ct"] is None]
    if not missing:
        return Baseline(baselines, None, frozenset())
    no_reference = [s for s in missing if steps[s]["reference_ct_mean"] is None]
    if no_reference:
        absent = sorted({assay for s in no_reference for assay, value in steps[s]["reference_ct_means"].items() if value is None})
        raise ValueError(f"Baseline sample(s) {', '.join(no_reference)} have no detected, non-excluded value for reference assay(s) {', '.join(absent)}.")
    lead = f"{target} was not detected in baseline sample(s) {', '.join(missing)}"
    # A minority of failed replicates is a technical problem; moving the baseline would hide valid samples.
    if (len(baselines) - len(missing)) * 2 > len(baselines):
        raise ValueError(f"{lead}, although the other baseline samples have it. Exclude the failed sample(s) in Normalization, or choose other baseline samples.")
    times = [(metadata or {}).get(s) or {} for s in baselines]
    if any(t.get("timepoint") is None for t in times):
        raise ValueError(f"{lead}. Record time points in Samples & design to normalize to the first time point where it is measurable.")
    units = {t.get("time_unit", "day") for t in times}
    if len(units) > 1:
        raise ValueError(f"{lead}, and the baseline samples mix hours and days.")
    unit, courses, start = units.pop(), {course_of(t) for t in times}, max(t["timepoint"] for t in times)

    def time_of(sample: str, any_course: bool = False) -> float | None:
        m = (metadata or {}).get(sample) or {}
        same_course = any_course or course_of(m) in courses
        return m.get("timepoint") if same_course and m.get("time_unit", "day") == unit else None

    later: dict[float, list[str]] = defaultdict(list)
    for sample in samples:
        point = time_of(sample)
        if point is not None and point > start:
            later[point].append(sample)
    for point in sorted(later):
        if all(steps[s]["delta_ct"] is not None for s in later[point]):
            # Every series loses its earlier time points, so nothing is shown relative to a later baseline.
            before = frozenset(s for s in samples if (t := time_of(s, any_course=True)) is not None and t < point)
            note = (f"{target} was not detected in every baseline sample ({time_label(unit, start)}). Fold changes are relative to "
                    f"{time_label(unit, point)}, the first time point where it was detected in every sample; earlier time points are not shown.")
            return Baseline(sorted(later[point]), note, before)
    raise ValueError(f"{lead}, and no later time point has it detected in every sample.")

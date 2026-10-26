from __future__ import annotations

from collections import defaultdict
from statistics import mean, stdev
import math

from .statistics import summarize_groups
from .sample_roles import is_technical_control
from .review import measurement_id
from typing import Any


def _mean(values: list[float]) -> float | None:
    return float(mean(values)) if values else None


def _sd(values: list[float]) -> float | None:
    if not values:
        return None
    return float(stdev(values)) if len(values) > 1 else None


def summarize_results(
    raw_records: list[dict[str, Any]],
    target_assay: str,
    reference_assays: list[str],
    baseline_sample: str = "",
    run_id: str | None = None,
    *, baseline_samples: list[str] | None = None,
    sample_groups: dict[str, str] | None = None,
    hit_threshold: float = 1.5,
    statistics_method: str = "descriptive",
    assumptions_confirmed: bool = False,
    excluded_samples: list[str] | None = None,
    technical_control_samples: list[str] | None = None,
    excluded_measurements: dict[str, str] | None = None,
) -> dict[str, Any]:
    if not target_assay:
        raise ValueError("Select a target assay.")
    if not reference_assays:
        raise ValueError("Select at least one reference assay.")
    if target_assay in reference_assays:
        raise ValueError("The target assay cannot also be a reference assay.")
    baselines = list(dict.fromkeys(baseline_samples or ([baseline_sample] if baseline_sample else [])))
    if not baselines:
        raise ValueError("Select at least one baseline biological sample.")
    if not math.isfinite(hit_threshold) or hit_threshold <= 0:
        raise ValueError("The hit threshold must be finite and positive.")
    if len(set(reference_assays)) != len(reference_assays):
        raise ValueError("Reference assays must be unique.")
    baseline_sample = "; ".join(baselines)
    excluded = set(excluded_samples or [])
    if excluded.intersection(baselines):
        raise ValueError("Baseline samples cannot also be excluded.")

    available_runs = {str(record.get("run_id")) for record in raw_records if record.get("run_id")}
    if run_id is None:
        if len(available_runs) > 1:
            raise ValueError("Select one run; measurements from separate runs are not combined.")
        run_id = next(iter(available_runs), None)
    elif available_runs and run_id not in available_runs:
        raise ValueError("The selected run has no imported measurements.")

    run_sample_names = {str(r.get("sample")) for r in raw_records if run_id is None or r.get("run_id") == run_id}
    technical = set(technical_control_samples) if technical_control_samples is not None else {s for s in run_sample_names if is_technical_control(s)}
    if technical.intersection(baselines):
        raise ValueError("Technical controls cannot define a biological baseline. Change their role explicitly if the label was misclassified.")
    unknown = (set(baselines) | set(sample_groups or {}) | excluded | technical) - run_sample_names
    if unknown:
        raise ValueError(f"Unknown sample assignments in the selected run: {', '.join(sorted(unknown))}.")
    run_records = [
        record
        for record in raw_records
        if (run_id is None or record.get("run_id") == run_id) and record.get("sample") not in (excluded | technical)
    ]
    assays = sorted(
        {
            str(record["assay"])
            for record in run_records
            if record.get("assay") and record.get("assay") != "Unassigned assay"
        }
    )
    if target_assay not in assays:
        raise ValueError(f"Target assay '{target_assay}' is not present in this run.")
    missing_references = [assay for assay in reference_assays if assay not in assays]
    if missing_references:
        raise ValueError(
            f"Reference assay(s) not present in this run: {', '.join(missing_references)}."
        )

    excluded_wells = excluded_measurements or {}
    known_measurements = {measurement_id(r) for r in raw_records}
    if set(excluded_wells) - known_measurements or any(not reason.strip() for reason in excluded_wells.values()):
        raise ValueError("Well exclusions require a valid measurement identity and a reason.")
    grouped: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    all_samples = sorted(
        {
            str(record["sample"])
            for record in run_records
            if record.get("sample") and record.get("sample") != "Unassigned sample"
        }
    )
    for record in run_records:
        if record.get("ct") is not None and math.isfinite(float(record["ct"])) and not record.get("omit", False) and measurement_id(record) not in excluded_wells:
            grouped[(str(record["sample"]), str(record["assay"]))].append(record)

    def assay_values(sample: str, assay: str) -> list[float]:
        return [
            float(record["ct"])
            for record in grouped.get((sample, assay), [])
            if str(record.get("status", "detected")).lower() == "detected"
        ]

    def sample_steps(sample: str) -> dict[str, Any]:
        target_values = assay_values(sample, target_assay)
        reference_values = {
            assay: assay_values(sample, assay) for assay in reference_assays
        }
        reference_means = {
            assay: _mean(values)
            for assay, values in reference_values.items()
        }
        present_reference_means = [
            value for value in reference_means.values() if value is not None
        ]
        target_mean = _mean(target_values)
        # Averaging reference Ct means is equivalent to the geometric mean of
        # reference quantities, unlike taking a geometric mean of Ct numbers.
        reference_ct_mean = _mean(present_reference_means) if len(present_reference_means) == len(reference_assays) else None
        delta_ct = (
            target_mean - reference_ct_mean
            if target_mean is not None and reference_ct_mean is not None
            else None
        )
        return {
            "target_ct_values": target_values,
            "target_ct_mean": target_mean,
            "target_ct_sd": _sd(target_values),
            "reference_ct_values": reference_values,
            "reference_ct_means": reference_means,
            "reference_ct_mean": reference_ct_mean,
            "delta_ct": delta_ct,
        }

    baseline_values = [sample_steps(sample)["delta_ct"] for sample in baselines]
    if any(value is None for value in baseline_values):
        raise ValueError("Every baseline sample needs detected, non-excluded target and ALL selected reference assays.")
    baseline_delta_ct = mean(baseline_values)

    rows: list[dict[str, Any]] = []
    for sample in all_samples:
        steps = sample_steps(sample)
        delta_ct = steps["delta_ct"]
        ddct = (
            delta_ct - baseline_delta_ct
            if delta_ct is not None
            else None
        )
        if ddct is not None and (not math.isfinite(ddct) or abs(ddct) > 1000):
            raise ValueError("Ct contrast is outside the supported numerical range; inspect raw Ct values.")
        rows.append(
            {
                "sample": sample,
                "run_id": run_id,
                "target_assay": target_assay,
                "reference_assays": reference_assays,
                **steps,
                "baseline_sample": baseline_sample,
                "baseline_delta_ct": baseline_delta_ct,
                "delta_delta_ct": ddct,
                "fold_change": 2 ** (-ddct) if ddct is not None else None,
                "log2fc": -ddct if ddct is not None else None,
                "result_status": "complete" if ddct is not None else "missing_measurement",
            }
        )

    biological_groups = {s: g for s, g in (sample_groups or {}).items() if s not in technical and s not in excluded}
    statistics = summarize_groups(rows, biological_groups, baselines, hit_threshold, statistics_method, assumptions_confirmed)
    return {
        "method_version": "3.0",
        "baseline_samples": baselines,
        "sample_groups": biological_groups,
        "excluded_samples": sorted(excluded),
        "excluded_measurements": excluded_wells,
        "technical_control_samples": sorted(technical),
        "technical_control_measurement_count": sum(1 for r in raw_records if (run_id is None or r.get("run_id") == run_id) and r.get("sample") in technical),
        "hit_threshold": hit_threshold,
        "statistics": statistics,
        "run_id": run_id,
        "target_assay": target_assay,
        "reference_assays": reference_assays,
        "baseline_sample": baseline_sample,
        "baseline_delta_ct": baseline_delta_ct,
        "reference_method": "Arithmetic mean of reference-assay Ct means",
        "excluded_measurement_count": sum(
            1
            for record in run_records
            if record.get("omit", False)
            or record.get("ct") is None
            or (record.get("ct") is not None and not math.isfinite(float(record["ct"])))
            or str(record.get("status", "detected")).lower() != "detected"
        ),
        "samples": rows,
        "assays": assays,
    }

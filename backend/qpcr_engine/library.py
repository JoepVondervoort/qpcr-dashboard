"""Compact per-gene condition results for library and cross-experiment views."""
from __future__ import annotations
import math
from typing import Any
from .review import sample_instance_id
from .sample_metadata import infer_sample_metadata


def condition_results(result: dict[str, Any], annotations: dict[str, Any], run_names: dict[str, str], revision: int) -> list[dict[str, Any]]:
    """Summarize one saved target/run analysis by condition, without pooling runs.

    The mean is the geometric mean of biological-sample fold changes, 2^(mean log2 FC),
    i.e. 2^(-mean ΔΔCt). It matches the default log2 figures and the heatmap, and a
    baseline group reads exactly 1× because its mean ΔΔCt is zero by construction.
    """
    run = result.get("run_id", "")
    groups = result.get("sample_groups") or {}
    baseline = set(result.get("baseline_samples") or ([result["baseline_sample"]] if result.get("baseline_sample") else []))
    saved_annotations = result.get("sample_instances") or {}
    members: dict[str, list[dict[str, Any]]] = {}
    for row in result.get("samples", []):
        condition = groups.get(row.get("sample", ""), "")
        if condition:
            members.setdefault(condition, []).append(row)
    rows = []
    for condition, samples in members.items():
        values = [r["fold_change"] for r in samples if isinstance(r.get("fold_change"), (int, float)) and r["fold_change"] > 0]
        key = sample_instance_id(run, samples[0]["sample"])
        metadata = saved_annotations.get(key) or annotations.get(key) or infer_sample_metadata(samples[0]["sample"])
        rows.append({
            "assay": result.get("target_assay", ""),
            "run_id": run,
            "run_name": run_names.get(run, run),
            "condition": condition,
            "series": metadata.get("series", condition),
            "timepoint": metadata.get("timepoint"),
            "time_unit": metadata.get("time_unit", "day"),
            "is_baseline": all(r["sample"] in baseline for r in samples),
            "fold_change": 2 ** (sum(math.log2(v) for v in values) / len(values)) if values else None,
            "n": len(values),
            "out_of_date": result.get("context_revision") != revision,
        })
    return sorted(rows, key=lambda r: (r["assay"], r["run_name"], r["series"], r["timepoint"] if r["timepoint"] is not None else float("inf"), r["condition"]))

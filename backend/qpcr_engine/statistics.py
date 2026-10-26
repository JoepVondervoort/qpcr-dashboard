"""Biological-sample inference; technical wells never enter tests as replicates."""
from __future__ import annotations

import math
from statistics import mean, stdev
from typing import Any

import scipy
from scipy import stats


def normality(values: list[float]) -> dict[str, Any]:
    if len(values) < 3:
        return {"status": "not_assessable", "p_value": None, "reason": "Shapiro–Wilk needs at least three biological observations."}
    if len(set(values)) == 1:
        return {"status": "not_assessable", "p_value": None, "reason": "Constant observations do not support a normality assessment."}
    if len(values) > 5000:
        return {"status": "not_assessable", "p_value": None, "reason": "Shapiro–Wilk p-values are not supported here above 5000 observations."}
    result = stats.shapiro(values)
    (theoretical, observed), (slope, intercept, correlation) = stats.probplot(values, dist="norm", fit=True)
    probability_plot = {"theoretical": theoretical.tolist(), "observed": observed.tolist(),
                        "slope": float(slope), "intercept": float(intercept), "r_squared": float(correlation**2)}
    return {"status": "assessed", "probability_plot": probability_plot, "p_value": float(result.pvalue), "reason": "A large p-value does not establish normality; small samples have limited diagnostic power."}


def holm(p_values: list[float]) -> list[float]:
    order = sorted(range(len(p_values)), key=p_values.__getitem__)
    adjusted = [1.0] * len(p_values)
    running = 0.0
    for rank, index in enumerate(order):
        running = max(running, (len(p_values) - rank) * p_values[index])
        adjusted[index] = min(1.0, running)
    return adjusted


def summarize_groups(rows: list[dict[str, Any]], assignments: dict[str, str], baselines: list[str],
                     threshold: float, method: str, confirmed: bool) -> dict[str, Any]:
    if method not in {"descriptive", "welch"}:
        raise ValueError("Supported statistics modes are descriptive and welch; paired/repeated designs require a different model.")
    if method == "welch" and not confirmed:
        raise ValueError("Confirm independent biological samples and the distribution assumptions before requesting Welch tests.")
    groups: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        label = assignments.get(row["sample"], "").strip()
        if label:
            groups.setdefault(label, []).append(row)
    baseline_set = set(baselines)
    # Controls are a distinct group; mixed control/treatment labels are ambiguous.
    for label, members in groups.items():
        membership = [r["sample"] in baseline_set for r in members]
        if any(membership) and not all(membership):
            raise ValueError(f"Condition '{label}' mixes baseline and treatment samples. Give controls their own condition.")
    controls = [r["delta_ct"] for r in rows if r["sample"] in baseline_set and r["delta_ct"] is not None]
    summaries = []
    comparisons = []
    for label, members in groups.items():
        valid = [r for r in members if r["delta_ct"] is not None]
        values = [r["delta_ct"] for r in valid]
        folds = [r["fold_change"] for r in valid]
        is_baseline = all(r["sample"] in baseline_set for r in members)
        summaries.append({"condition": label, "samples": [r["sample"] for r in members],
                          "n": len(valid), "incomplete_n": len(members)-len(valid),
                          "fold_change_mean": mean(folds) if folds else None,
                          "fold_change_sd": stdev(folds) if len(folds)>1 else None,
                          "delta_ct_values": values, "normality": normality(values),
                          "is_baseline": is_baseline,
                          "above_threshold": bool(folds and mean(folds)>=threshold) if not is_baseline else None,
                          "replicates_above_threshold": sum(v>=threshold for v in folds) if not is_baseline else None})
        if is_baseline:
            continue
        comparison: dict[str, Any] = {"condition": label, "n": len(values), "control_n": len(controls),
                                      "status": "not_tested", "p_value": None, "adjusted_p_value": None,
                                      "reason": "Descriptive mode: confirm the study design before choosing inference."}
        if method == "welch":
            comparison["reason"] = "At least two complete biological samples per group are required."
            if len(values)>=2 and len(controls)>=2:
                if len(set(values)) == 1 and len(set(controls)) == 1:
                    comparison["reason"] = "Both groups have zero variance; a t-test is not estimable."
                else:
                    result = stats.ttest_ind(values, controls, equal_var=False, alternative="two-sided")
                    ci = result.confidence_interval(confidence_level=0.95)
                    if all(math.isfinite(float(x)) for x in [result.statistic, result.pvalue, result.df, ci.low, ci.high]):
                        comparison.update(status="tested", reason="Exploratory with small n; assumptions are researcher-confirmed, not established by a normality p-value.",
                                          p_value=float(result.pvalue), statistic=float(result.statistic), df=float(result.df),
                                          delta_ct_difference=mean(values)-mean(controls),
                                          delta_ct_ci=[float(ci.low), float(ci.high)],
                                          ratio_of_geometric_means=2**(-(mean(values)-mean(controls))))
        comparisons.append(comparison)
    diagnostic_warnings = []
    for group in summaries:
        p = group["normality"]["p_value"]
        if p is not None and p < 0.05:
            diagnostic_warnings.append(f"{group['condition']}: Shapiro–Wilk indicates departure from normality. Review the model before interpreting t-test results.")
        if group["n"] < 3:
            diagnostic_warnings.append(f"{group['condition']}: fewer than three complete biological samples; normality cannot be assessed and inferential results are exploratory.")
    tested = [c for c in comparisons if c["status"] == "tested"]
    # Include every planned comparison in family size, even if some are not estimable.
    adjusted = holm([c["p_value"] if c["status"] == "tested" else 1.0 for c in comparisons])
    for c, p in zip(comparisons, adjusted):
        if c["status"] == "tested":
            c["adjusted_p_value"] = p
    return {"method": method, "software": f"SciPy {scipy.__version__}", "alpha": 0.05,
            "adjustment": "Holm", "family": "All non-baseline conditions in this analysis versus the selected baseline samples",
            "planned_comparison_count": len(comparisons), "tested_comparison_count": len(tested),
            "design_confirmed": confirmed, "control_normality": normality(controls),
            "groups": summaries, "comparisons": comparisons,
            "warnings": diagnostic_warnings + ["Technical wells are averaged within biological samples and never counted as independent biological replicates.",
                         "These comparisons do not support paired, repeated-measure, nested or multi-factor designs.",
                         "Confidence intervals are individual 95% intervals on Delta Ct differences, not simultaneous intervals.",
                         "Fold-change threshold crossing and statistical evidence are separate assessments."]}

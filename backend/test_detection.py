"""Partly detected technical replicates and targets that are not detected at baseline."""
from __future__ import annotations

import pytest

from backend.qpcr_engine import summarize_results


def wells(sample, assay, *cts):
    return [{"sample": sample, "assay": assay, "ct": ct, "status": "detected" if ct is not None else "undetermined",
             "omit": False, "run_id": "run", "well": f"{sample}-{assay}-{i}", "sheet": "Results", "row_number": i}
            for i, ct in enumerate(cts)]


def time_course(target_by_day, reference=20.0):
    """Two biological samples per day; the target Ct list per day may contain None (undetermined)."""
    records, metadata = [], {}
    for day, cts in target_by_day.items():
        for replicate, target in enumerate(cts, start=1):
            sample = f"cells_day{day}.{replicate}"
            records += wells(sample, "TARGET", *target) + wells(sample, "REF", reference, reference)
            metadata[sample] = {"condition": f"cells_day{day}", "series": "cells", "timepoint": day, "time_unit": "day"}
    groups = {sample: f"cells · Day {meta['timepoint']}" for sample, meta in metadata.items()}
    return records, metadata, groups


def test_partly_undetermined_wells_are_reported_but_still_averaged():
    records, metadata, groups = time_course({0: [(25.0, 25.0), (33.6, None)], 7: [(24.0, 24.0), (24.0, 24.0)]})
    result = summarize_results(records, "TARGET", ["REF"], baseline_samples=["cells_day0.1", "cells_day0.2"],
                               sample_groups=groups, sample_metadata=metadata)
    row = next(r for r in result["samples"] if r["sample"] == "cells_day0.2")
    assert row["target_ct_values"] == [33.6]
    assert row["target_wells"] == {"detected": 1, "total": 2}
    assert result["detection_notes"] == [{"sample": "cells_day0.2", "assay": "TARGET", "role": "target", "detected": 1, "total": 2}]
    assert result["baseline_note"] is None


def test_partly_undetermined_reference_wells_are_reported():
    records, metadata, groups = time_course({0: [(25.0,), (25.0,)]})
    records = [r for r in records if not (r["sample"] == "cells_day0.1" and r["assay"] == "REF")] + wells("cells_day0.1", "REF", 20.0, None)
    result = summarize_results(records, "TARGET", ["REF"], baseline_samples=["cells_day0.1", "cells_day0.2"], sample_groups=groups)
    assert {"sample": "cells_day0.1", "assay": "REF", "role": "reference", "detected": 1, "total": 2} in result["detection_notes"]


def test_target_not_detected_at_baseline_is_normalized_to_the_first_measurable_day():
    records, metadata, groups = time_course({0: [(None, None), (None, None)], 7: [(30.0, 30.0), (None, None)],
                                             14: [(27.0, 27.0), (27.0, 27.0)], 21: [(25.0, 25.0), (25.0, 25.0)]})
    result = summarize_results(records, "TARGET", ["REF"], baseline_samples=["cells_day0.1", "cells_day0.2"],
                               sample_groups=groups, sample_metadata=metadata)
    assert result["baseline_samples"] == ["cells_day0.1", "cells_day0.2"]
    assert result["effective_baseline_samples"] == ["cells_day14.1", "cells_day14.2"]
    assert "Day 14" in result["baseline_note"] and "Day 0" in result["baseline_note"]
    rows = {r["sample"]: r for r in result["samples"]}
    assert rows["cells_day21.1"]["fold_change"] == pytest.approx(4.0)
    assert rows["cells_day14.1"]["fold_change"] == pytest.approx(1.0)
    # Earlier days are not shown relative to a later baseline.
    assert rows["cells_day7.1"]["fold_change"] is None
    assert rows["cells_day7.1"]["result_status"] == "before_baseline"
    assert rows["cells_day0.1"]["result_status"] == "before_baseline"
    conditions = {g["condition"]: g for g in result["statistics"]["groups"]}
    assert conditions["cells · Day 14"]["is_baseline"]
    assert "cells · Day 7" not in conditions and "cells · Day 0" not in conditions
    # The saved setup still assigns every sample its condition.
    assert result["sample_groups"]["cells_day0.1"] == "cells · Day 0"


def test_without_time_points_an_undetected_baseline_is_still_an_error():
    records, _, groups = time_course({0: [(None, None), (None, None)], 7: [(25.0, 25.0), (25.0, 25.0)]})
    with pytest.raises(ValueError, match="not detected in baseline sample"):
        summarize_results(records, "TARGET", ["REF"], baseline_samples=["cells_day0.1", "cells_day0.2"], sample_groups=groups)


def test_a_missing_reference_at_baseline_does_not_trigger_a_later_baseline():
    records, metadata, groups = time_course({0: [(25.0, 25.0), (25.0, 25.0)], 7: [(24.0, 24.0), (24.0, 24.0)]})
    records = [r for r in records if not (r["sample"] == "cells_day0.1" and r["assay"] == "REF")]
    with pytest.raises(ValueError, match="REF"):
        summarize_results(records, "TARGET", ["REF"], baseline_samples=["cells_day0.1", "cells_day0.2"],
                          sample_groups=groups, sample_metadata=metadata)


def test_no_later_measurable_day_explains_why():
    records, metadata, groups = time_course({0: [(None, None), (None, None)], 7: [(30.0, 30.0), (None, None)]})
    with pytest.raises(ValueError, match="no later time point"):
        summarize_results(records, "TARGET", ["REF"], baseline_samples=["cells_day0.1", "cells_day0.2"],
                          sample_groups=groups, sample_metadata=metadata)


def test_a_later_baseline_hides_earlier_time_points_of_every_series():
    records, metadata, groups = time_course({0: [(None, None), (None, None)], 7: [(25.0, 25.0), (25.0, 25.0)]})
    for day, ct in [(0, 23.0), (7, 24.0)]:
        sample = f"ko_day{day}.1"
        records += wells(sample, "TARGET", ct, ct) + wells(sample, "REF", 20.0, 20.0)
        metadata[sample] = {"condition": f"ko_day{day}", "series": "ko", "timepoint": day, "time_unit": "day"}
        groups[sample] = f"ko · Day {day}"
    result = summarize_results(records, "TARGET", ["REF"], baseline_samples=["cells_day0.1", "cells_day0.2"],
                               sample_groups=groups, sample_metadata=metadata)
    rows = {r["sample"]: r for r in result["samples"]}
    assert result["effective_baseline_samples"] == ["cells_day7.1", "cells_day7.2"]
    assert rows["ko_day0.1"]["result_status"] == "before_baseline" and rows["ko_day0.1"]["fold_change"] is None
    assert rows["ko_day7.1"]["fold_change"] == pytest.approx(2.0)


def test_one_failed_baseline_replicate_is_an_error_not_a_new_baseline():
    records, metadata, groups = time_course({0: [(25.0, 25.0), (25.0, 25.0)], 7: [(24.0, 24.0), (24.0, 24.0)]})
    records += wells("cells_day0.3", "TARGET", None, None) + wells("cells_day0.3", "REF", 20.0, 20.0)
    metadata["cells_day0.3"] = {"condition": "cells_day0", "series": "cells", "timepoint": 0, "time_unit": "day"}
    groups["cells_day0.3"] = "cells · Day 0"
    with pytest.raises(ValueError, match="Exclude"):
        summarize_results(records, "TARGET", ["REF"], baseline_samples=["cells_day0.1", "cells_day0.2", "cells_day0.3"],
                          sample_groups=groups, sample_metadata=metadata)


def test_names_that_are_only_a_time_point_form_one_time_course():
    records, metadata, groups = time_course({0: [(None, None), (None, None)], 7: [(25.0, 25.0), (25.0, 25.0)]})
    renamed = {s: s.replace("cells_day", "Day ") for s in metadata}
    records = [{**r, "sample": renamed[r["sample"]]} for r in records]
    metadata = {renamed[s]: {**m, "condition": f"Day {m['timepoint']:g}", "series": f"Day {m['timepoint']:g}"} for s, m in metadata.items()}
    groups = {renamed[s]: g for s, g in groups.items()}
    result = summarize_results(records, "TARGET", ["REF"], baseline_samples=["Day 0.1", "Day 0.2"],
                               sample_groups=groups, sample_metadata=metadata)
    assert result["effective_baseline_samples"] == ["Day 7.1", "Day 7.2"]

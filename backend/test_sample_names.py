"""Sample-name suggestions: lab spellings are recognized, guesses are marked for the scientist to check."""
from __future__ import annotations

import pytest

from backend.qpcr_engine.review import instances, name_checks, sample_instance_id
from backend.qpcr_engine.sample_metadata import analysis_group, infer_sample_metadata


@pytest.mark.parametrize("name, condition, series, time, unit, replicate", [
    ("LAD081_HDFn_confluency_100% day 0.1", "LAD081_HDFn_confluency_100% day 0", "LAD081_HDFn_confluency_100%", 0, "day", "1"),
    ("LAD080_HDFn_characterization_day0.1", "LAD080_HDFn_characterization_day0", "LAD080_HDFn_characterization", 0, "day", "1"),
    ("LAD080_HDFn_characterization_day 28.3", "LAD080_HDFn_characterization_day 28", "LAD080_HDFn_characterization", 28, "day", "3"),
    ("HDFn_iNeuron__day21.4", "HDFn_iNeuron__day21", "HDFn_iNeuron", 21, "day", "4"),
    ("HDFn_iNeuron__day28_resplit1.1", "HDFn_iNeuron__day28_resplit1", "HDFn_iNeuron_resplit1", 28, "day", "1"),
    ("MK25025-A HDFn Day21.4 10X", "MK25025-A HDFn Day21 10X", "MK25025-A HDFn 10X", 21, "day", "4"),
    ("LNP 72h.2", "LNP 72h", "LNP", 72, "hour", "2"),
    ("LNP_48hpt.1", "LNP_48hpt", "LNP", 48, "hour", "1"),
])
def test_time_points_are_read_from_common_lab_spellings(name, condition, series, time, unit, replicate):
    meta = infer_sample_metadata(name)
    assert (meta["condition"], meta["series"], meta["timepoint"], meta["time_unit"], meta["replicate"]) == (condition, series, time, unit, replicate)


@pytest.mark.parametrize("name, replicate", [("H2O", ""), ("10.2", "2"), ("HDF_iNeuron_HIGH_SCN1A-10.1", "1"),
                                             ("IMR90_iNeuron_UTR", ""), ("CHD2 AD5 2D3.1", "1"), ("LNP 0.5 ug", "")])
def test_names_without_a_time_point_stay_single_day_conditions(name, replicate):
    meta = infer_sample_metadata(name)
    assert meta["timepoint"] is None
    assert meta["replicate"] == replicate
    assert "name_check" not in meta


def test_a_label_after_the_replicate_number_becomes_its_own_condition():
    meta = infer_sample_metadata("LAD080_HDFn_characterization_day 21.2 RS")
    assert meta["timepoint"] == 21 and meta["replicate"] == "2"
    assert meta["condition"] == "LAD080_HDFn_characterization_day 21 RS"
    assert meta["series"] == "LAD080_HDFn_characterization_RS"
    assert "RS" in meta["name_check"]
    plain = infer_sample_metadata("LAD080_HDFn_characterization_day 21.2")
    assert analysis_group(meta) != analysis_group(plain)
    assert analysis_group(meta) == "LAD080_HDFn_characterization_RS · Day 21"


def test_only_guessed_spellings_ask_for_confirmation():
    assert "name_check" not in infer_sample_metadata("LAD081_HDFn_confluency_100% day 21.2")
    assert "name_check" not in infer_sample_metadata("LNP 72h.2")
    check = infer_sample_metadata("LAD080_HDFn_characterization_day0.1")["name_check"]
    assert "day0" in check


def test_group_labels_drop_glued_time_tokens():
    meta = infer_sample_metadata("LAD080_HDFn_characterization_day7.2")
    assert analysis_group(meta) == "LAD080_HDFn_characterization · Day 7"


def test_saving_a_mapping_confirms_a_guessed_name():
    record = {"run_id": "run", "sample": "LAD080_HDFn_characterization_day0.1"}
    key = sample_instance_id("run", record["sample"])
    assert "day0" in name_checks([record])[key]
    # Annotations keep their usual fields; the question is reported beside them.
    annotation = instances([record])[key]
    assert "name_check" not in annotation and annotation["timepoint"] == 0
    assert name_checks([record], overrides={key: annotation}) == {}
    assert name_checks([{"run_id": "run", "sample": "LAD081_HDFn_confluency_100% day 0.1"}]) == {}


@pytest.mark.parametrize("name, time, unit, series", [
    ("iPSC_H1_d7.1", 7, "day", "iPSC_H1"),
    ("H9_day0.1", 0, "day", "H9"),
    ("H19_KO.1", None, "day", "H19_KO"),
    ("NCI-H1299_DMSO.1", None, "day", "NCI-H1299_DMSO"),
    ("H1 day 21.2", 21, "day", "H1"),
])
def test_cell_line_codes_are_not_read_as_hours(name, time, unit, series):
    meta = infer_sample_metadata(name)
    assert (meta["timepoint"], meta["time_unit"], meta["series"]) == (time, unit, series)


def test_single_letter_units_always_ask_for_confirmation():
    assert "d7" in infer_sample_metadata("iPSC_H1_d7.1")["name_check"]
    assert "name_check" in infer_sample_metadata("cells d7.1")

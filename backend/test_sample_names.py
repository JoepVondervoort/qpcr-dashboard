"""Sample-name suggestions: lab spellings are recognized, guesses are marked for the scientist to check."""
from __future__ import annotations

import pytest

from backend.qpcr_engine.review import instances, name_checks, replicate_questions, sample_instance_id
from backend.qpcr_engine.sample_metadata import analysis_group, infer_sample_metadata, suffix_replicates


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


LAD046 = ["LAD046_LNP4_50_1", "LAD046_LNP4_50_2", "LAD046_LNP4_200_3", "LAD046_LNP4_200_4", "LAD046_LFScbrl_250_3"]


def test_trailing_numbers_shared_by_similar_names_may_be_replicates():
    found = suffix_replicates(LAD046)
    assert found["LAD046_LNP4_50_2"] == ("LAD046_LNP4_50", "_", "2")
    # Replicate numbers need not start at 1: the second dose series continues with 3 and 4.
    assert found["LAD046_LNP4_200_3"] == ("LAD046_LNP4_200", "_", "3")
    # A name without a sibling is a single sample: there is nothing to group it with.
    assert "LAD046_LFScbrl_250_3" not in found


@pytest.mark.parametrize("names", [
    ["LNP4_50", "LNP4_100", "LNP4_150"],           # doses, not a consecutive run
    ["HDFn day 1", "HDFn day 2", "HDFn day 3"],     # time points
    [f"S_{n}" for n in range(1, 13)],               # twelve numbered samples
    ["Rb_1", "Rb_1.1"],                            # ".N" already marks the replicate
    ["MM 1", "MM 1"],                              # one name, nothing to compare
    ["Week_1", "Week_2", "Week_3"],                # time points in weeks
    ["30 min 1", "30 min 2"],
    ["T 1", "T 2", "T 3"],
    ["Plate 1", "Plate 2"],                        # plates and runs, not replicates
    ["Exp 2024-11-05", "Exp 2024-11-06"],          # dates
    ["HEK_p1", "HEK_p2"],
])
def test_doses_time_points_and_sample_numbers_are_not_replicate_endings(names):
    assert suffix_replicates(names) == {}


@pytest.mark.parametrize("names, stem", [
    (["Apt 44 1-1", "Apt 44 1-2", "Apt 44 1-3"], "Apt 44 1"),
    (["IMR90 1", "IMR90 2"], "IMR90"),
    (["HDFn day 7_1", "HDFn day 7_2"], "HDFn day 7"),
])
def test_dashes_and_spaces_also_separate_a_replicate_ending(names, stem):
    assert {value[0] for value in suffix_replicates(names).values()} == {stem}


def test_replicate_endings_are_asked_about_and_not_applied():
    records = [{"run_id": "run", "sample": name} for name in LAD046]
    key = sample_instance_id("run", "LAD046_LNP4_50_2")
    # Until the scientist answers, each name stays its own condition.
    assert instances(records)[key]["condition"] == "LAD046_LNP4_50_2"
    questions = replicate_questions(records)
    assert set(questions) == {sample_instance_id("run", name) for name in LAD046[:4]}
    assert questions[key]["annotation"]["condition"] == "LAD046_LNP4_50" and questions[key]["annotation"]["replicate"] == "2"
    assert questions[key]["note"] is None
    assert "replicate 2" in name_checks(records)[key]
    # Saving either answer for a name closes its question.
    answered = {key: instances(records)[key]}
    assert key not in replicate_questions(records, overrides=answered)
    assert key not in name_checks(records, overrides=answered)


def test_replicate_questions_are_asked_per_run_and_never_for_controls():
    records = [{"run_id": "a", "sample": "HEK_1"}, {"run_id": "b", "sample": "HEK_2"},
               {"run_id": "a", "sample": "H2O_1"}, {"run_id": "a", "sample": "H2O_2"}]
    assert replicate_questions(records) == {}


def test_a_guess_elsewhere_in_the_name_is_shown_with_the_replicate_question():
    records = [{"run_id": "run", "sample": name} for name in ["iPSC_H1_d7_1", "iPSC_H1_d7_2"]]
    question = replicate_questions(records)[sample_instance_id("run", "iPSC_H1_d7_1")]
    assert question["annotation"]["condition"] == "iPSC_H1_d7" and question["annotation"]["timepoint"] == 7
    assert "d7" in question["note"]

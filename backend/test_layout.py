"""Plate layouts: which sample is in which well, when the instrument export does not say."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.qpcr_engine.layout import (
    MAX_TECHNICAL_WELLS,
    analysable_assays,
    apply_layout,
    confirmation,
    confirmations_on_plate,
    layout_checks,
    open_layout_questions,
    placeholder_names,
    reopened_reviews,
)
from backend.qpcr_engine.plates import combine_all
from backend.qpcr_engine.review import measurement_id, quality_flag_id
from backend.qpcr_engine.sample_roles import is_technical_control

ROWS = "ABCDEFGH"


def record(well: str, sample: str, assay: str, ct: float | None = 25.0, run: str = "run", plate: str | None = None, row: int = 0):
    value = {"run_id": run, "run_name": run, "sheet": "Results", "row_number": row, "well": well, "sample": sample,
             "assay": assay, "ct": ct, "status": "detected" if ct is not None else "undetermined", "omit": False}
    return {**value, "plate": plate} if plate else value


def by_name(record_: dict) -> bool:
    return is_technical_control(record_["sample"])


def placeholder_plate(sample: str = "Plate 1", run: str = "run", plate: str | None = None) -> list[dict]:
    """Two genes in two-row bands, one name on every well, and an NTC column."""
    records = []
    for band, assay in enumerate(["GAPDH", "SCN1A"]):
        for row in ROWS[band * 2:band * 2 + 2]:
            for col in range(1, 7):
                records.append(record(f"{row}{col}", sample, assay, 20.0 + col, run, plate, len(records) + 1))
        records.append(record(f"{ROWS[band * 2]}12", "H2O", assay, None, run, plate, len(records) + 1))
    return records


@pytest.mark.parametrize("name", ["mm", "MM", "mm control", "mastermix", "Master mix", "master-mix", "mastermix 2", "noRT", "no RT", "-RT", "RT-", "NRT", "minus RT"])
def test_mastermix_and_no_rt_wells_are_technical_controls(name):
    assert is_technical_control(name)


@pytest.mark.parametrize("name", ["HEK", "MM1S", "MM 1", "Mm-2", "mmu cells", "RT 4h", "LNP4_50_1", "Rb005", "mix A"])
def test_ordinary_sample_names_stay_biological(name):
    assert not is_technical_control(name)


def test_unnamed_wells_are_reported_per_plate_without_blocking():
    records = [record("A1", "Unassigned sample", "GAPDH"), record("B1", "Unassigned sample", "GAPDH"),
               record("C1", "S1", "GAPDH"), record("D1", "Unassigned sample", "Unassigned assay")]
    [check] = layout_checks(records, by_name)
    assert check["kind"] == "unnamed_wells" and not check["blocking"]
    assert check["wells"] == ["A1", "B1"]
    assert check["run_id"] == "run" and check["plate"] is None


def test_a_name_on_more_wells_than_technical_replicates_must_be_resolved():
    checks = layout_checks(placeholder_plate(), by_name)
    [check] = checks
    assert check["kind"] == "shared_name" and check["blocking"]
    assert check["sample"] == "Plate 1" and check["wells_per_assay"] == 12
    assert len(check["wells"]) == 24


def test_technical_replicates_and_controls_are_not_questioned():
    records = [record(f"A{col}", "S1", "GAPDH") for col in range(1, MAX_TECHNICAL_WELLS + 1)]
    records += [record(f"B{col}", "NTC", "GAPDH", None) for col in range(1, 9)]
    assert layout_checks(records, by_name) == []


def test_confirmed_technical_replicates_are_no_longer_questioned():
    records = placeholder_plate()
    assert layout_checks(records, by_name, [confirmation(records, "run", None, "Plate 1")]) == []


def test_a_confirmation_lapses_when_the_name_covers_other_wells():
    records = placeholder_plate()
    confirmed = [confirmation(records, "run", None, "Plate 1")]
    # Restoring is not needed: renaming one well into the confirmed sample changes its well set.
    renamed, _ = apply_layout(records, "run", None, {"A1": "Other"}, by_name)
    [check] = layout_checks(renamed, by_name, confirmed)
    assert check["kind"] == "shared_name" and check["sample"] == "Plate 1"


def test_confirmations_follow_a_single_plate_run_into_a_combined_run():
    records = placeholder_plate()
    confirmed = confirmations_on_plate([confirmation(records, "run", None, "Plate 1")], {"id": "run", "name": "P1"})
    on_plate = [{**r, "plate": "P1"} for r in records]
    assert layout_checks(on_plate, by_name, confirmed) == []


def test_review_decisions_of_renamed_samples_reopen():
    records = [record("A1", "S1", "GAPDH", 20.0), record("A2", "S1", "GAPDH", 22.0), record("A3", "S2", "GAPDH", 25.0)]
    decisions = {quality_flag_id("technical_spread", "run", sample, "GAPDH", None): {"reason": "fine"} for sample in ("S1", "S2")}
    renamed, _ = apply_layout(records, "run", None, {"A3": "S1"}, by_name)
    # S1 gained a well and S2 lost one; both reviews described other wells.
    assert reopened_reviews(decisions, records, renamed) == {}
    assert reopened_reviews(decisions, records, records) == decisions


def test_the_same_sample_and_gene_on_two_plates_of_one_run_is_blocking():
    records = [record("A1", "S1", "GAPDH", plate="P1"), record("A1", "S1", "GAPDH", plate="P2", row=2)]
    [check] = layout_checks(records, by_name)
    assert check["kind"] == "split_across_plates" and check["blocking"]
    assert check["plates"] == ["P1", "P2"]


def test_placeholder_names_are_found_per_plate():
    assert placeholder_names(placeholder_plate(), by_name) == {"Plate 1"}
    assert placeholder_names(placeholder_plate()[:4], by_name) == set()


def test_applying_a_layout_renames_wells_and_keeps_the_instrument_name():
    records = placeholder_plate()
    updated, change = apply_layout(records, "run", None, {"A1": "  LNP 50 .1 ", "B1": "LNP 50 .1", "C1": "LNP 50 .1"}, by_name)
    renamed = {r["well"]: r for r in updated if r["well"] in {"A1", "B1", "C1"}}
    assert {r["sample"] for r in renamed.values()} == {"LNP 50 .1"}
    assert {r["instrument_sample"] for r in renamed.values()} == {"Plate 1"}
    assert change == {"wells": 3, "names": ["LNP 50 .1"], "restored": 0}
    # Input is unchanged and well identities (used by exclusions) survive the rename.
    assert records[0]["sample"] == "Plate 1" and "instrument_sample" not in records[0]
    assert [measurement_id(r) for r in updated] == [measurement_id(r) for r in records]


def test_an_empty_name_restores_the_instrument_name():
    renamed, _ = apply_layout(placeholder_plate(), "run", None, {"A1": "S1"}, by_name)
    restored, change = apply_layout(renamed, "run", None, {"A1": ""}, by_name)
    well = next(r for r in restored if r["well"] == "A1")
    assert well["sample"] == "Plate 1" and "instrument_sample" not in well
    assert change["restored"] == 1


@pytest.mark.parametrize("wells, message", [
    ({"Z99": "S1"}, "not on this plate"),
    ({"A1": "Unassigned sample"}, "reserved"),
    ({"A1": "x" * 200}, "at most"),
])
def test_invalid_layouts_are_refused(wells, message):
    with pytest.raises(ValueError, match=message):
        apply_layout(placeholder_plate(), "run", None, wells, by_name)


def test_a_layout_needs_a_known_run_and_a_plate_of_a_combined_run():
    with pytest.raises(ValueError, match="run"):
        apply_layout(placeholder_plate(), "other", None, {"A1": "S1"}, by_name)
    combined = placeholder_plate(plate="P1") + placeholder_plate(plate="P2")
    with pytest.raises(ValueError, match="plate"):
        apply_layout(combined, "run", None, {"A1": "S1"}, by_name)


def test_a_layout_may_not_pool_wells_across_plates():
    combined = [record("A1", "S1", "GAPDH", plate="P1"), record("A1", "Plate 2", "GAPDH", plate="P2", row=2),
                record("B1", "Plate 2", "SCN1A", plate="P2", row=3)]
    with pytest.raises(ValueError, match="pool"):
        apply_layout(combined, "run", "P2", {"A1": "S1"}, by_name)
    # The same sample may be measured for another gene on another plate.
    updated, _ = apply_layout(combined, "run", "P2", {"B1": "S1"}, by_name)
    assert {(r["plate"], r["sample"], r["assay"]) for r in updated} >= {("P1", "S1", "GAPDH"), ("P2", "S1", "SCN1A")}


def test_plates_with_placeholder_names_can_still_be_combined():
    first = placeholder_plate("Rb005", run="ab")
    second = placeholder_plate("Rb005", run="cd")
    runs = [{"id": "ab", "name": "AB", "sheet": "Results", "header_row": 48, "record_count": len(first), "plate_size": 96, "source_file": "AB.xls"},
            {"id": "cd", "name": "CD", "sheet": "Results", "header_row": 48, "record_count": len(second), "plate_size": 96, "source_file": "CD.xls"}]
    records, [run] = combine_all(first + second, runs, by_name)
    assert [plate["name"] for plate in run["plates"]] == ["AB", "CD"]
    kinds = sorted(check["kind"] for check in layout_checks(records, by_name))
    assert kinds == ["shared_name", "shared_name", "split_across_plates"]


def test_open_layout_questions_count_blocking_checks_and_runs_with_nothing_named():
    unnamed = [record("A1", "Unassigned sample", "GAPDH", run="bare")]
    partly = [record("A1", "S1", "GAPDH", run="partly"), record("B1", "Unassigned sample", "GAPDH", run="partly")]
    records = [*unnamed, *partly, *placeholder_plate(run="shared")]
    checks = layout_checks(records, by_name)
    # The bare run and the placeholder run need the scientist; leftover unnamed wells beside named samples do not.
    assert open_layout_questions(records, checks, by_name) == 2


def test_assays_measured_only_in_controls_or_unnamed_wells_are_not_analysable():
    records = [record("A1", "S1", "GAPDH"), record("A2", "mm", "mm"), record("A3", "Unassigned sample", "SCN1A")]
    assert analysable_assays(records, by_name) == ["GAPDH"]


# ---------------------------------------------------------------- API


@pytest.fixture
def api(tmp_path, monkeypatch):
    import backend.app as module
    monkeypatch.setattr(module, "DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr(module, "UPLOAD_DIR", tmp_path)
    module.init_db()
    return TestClient(module.app)


def placeholder_csv() -> bytes:
    lines = ["Well,Sample Name,Target Name,CT"]
    for band, assay in enumerate(["GAPDH", "SCN1A"]):
        for row in ROWS[band * 2:band * 2 + 2]:
            for col in range(1, 7):
                # Columns 1-3 are the baseline sample, 4-6 the treated one: SCN1A is 2 cycles lower there.
                ct = 20.0 if assay == "GAPDH" else (26.0 if col <= 3 else 24.0)
                lines.append(f"{row}{col},Plate 1,{assay},{ct + 0.01 * col}")
        lines.append(f"{ROWS[band * 2]}12,mm,{assay},Undetermined")
    return "\n".join(lines).encode()


def import_placeholder(api):
    project = api.post("/api/projects", json={"name": "layout"}).json()
    created = api.post(f"/api/projects/{project['id']}/upload", data={"name": "placeholder"},
                       files=[("files", ("placeholder.csv", placeholder_csv(), "text/csv"))]).json()
    path = f"/api/projects/{project['id']}/experiments/{created['id']}"
    return path, api.get(path).json()


def analysis_request(run_id: str, baseline: list[str]) -> dict:
    return {"target_assay": "SCN1A", "reference_assays": ["GAPDH"], "baseline_samples": baseline, "run_id": run_id}


def test_an_experiment_reports_its_layout_checks_and_blocks_analysis_until_resolved(api):
    path, experiment = import_placeholder(api)
    run_id = experiment["parsed_summary"]["runs"][0]["id"]
    [check] = experiment["layout_checks"]
    assert check["kind"] == "shared_name" and check["sample"] == "Plate 1"
    summary = api.get("/api/projects").json()[0]["experiments"][0]["library_summary"]
    assert summary["layout_issue_count"] == 1
    response = api.post(f"{path}/analyze", json=analysis_request(run_id, ["Plate 1"]))
    assert response.status_code == 409 and "plate layout" in response.json()["detail"].lower()


def test_assigning_the_layout_makes_the_samples_analysable(api):
    path, experiment = import_placeholder(api)
    run_id = experiment["parsed_summary"]["runs"][0]["id"]
    # Triplicates side by side; the first row of each gene band holds replicate 1, the second replicate 2.
    def name(row: str, col: int) -> str:
        return f"{'Scrambled' if col <= 3 else 'SCN1A saRNA'}.{1 if row in 'AC' else 2}"
    wells = {f"{row}{col}": name(row, col) for row in "ABCD" for col in range(1, 7)}
    response = api.put(f"{path}/plate-layout", json={"run_id": run_id, "wells": wells})
    assert response.status_code == 200, response.text
    updated = response.json()
    assert updated["layout_checks"] == []
    assert updated["context_revision"] == experiment["context_revision"] + 1
    summary = api.get("/api/projects").json()[0]["experiments"][0]["library_summary"]
    assert summary["layout_issue_count"] == 0 and summary["biological_sample_count"] == 4
    assert updated["audit_events"][-1]["action"] == "plate_layout_updated"
    assert {r["sample"] for r in updated["raw_records"]} == {"Scrambled.1", "Scrambled.2", "SCN1A saRNA.1", "SCN1A saRNA.2", "mm"}
    assert {r.get("instrument_sample") for r in updated["raw_records"] if r["sample"] != "mm"} == {"Plate 1"}
    # mastermix wells are recognised as technical controls.
    roles = {key: value["role"] for key, value in updated["sample_instances"].items()}
    assert roles[f'["{run_id}","mm"]'] == "technical_control"
    result = api.post(f"{path}/analyze", json=analysis_request(run_id, ["Scrambled.1", "Scrambled.2"]))
    assert result.status_code == 200, result.text
    treated = next(row for row in result.json()["samples"] if row["sample"] == "SCN1A saRNA.1")
    # SCN1A is two cycles lower relative to GAPDH in the treated wells: 2^2 = 4-fold.
    assert treated["fold_change"] == pytest.approx(4.0)
    assert treated["target_wells"] == {"detected": 3, "total": 3}


def test_confirming_technical_replicates_unblocks_analysis(api):
    path, experiment = import_placeholder(api)
    run_id = experiment["parsed_summary"]["runs"][0]["id"]
    response = api.put(f"{path}/plate-layout", json={"run_id": run_id, "confirm_replicates": ["Plate 1"]})
    assert response.status_code == 200, response.text
    assert response.json()["layout_checks"] == []
    assert response.json()["audit_events"][-1]["confirmed_replicates"] == ["Plate 1"]
    [confirmed] = response.json()["layout_confirmations"]
    assert confirmed["sample"] == "Plate 1" and len(confirmed["wells"]) == 24
    # The confirmation can be withdrawn.
    revoked = api.put(f"{path}/plate-layout", json={"run_id": run_id, "revoke_replicates": ["Plate 1"]}).json()
    assert revoked["layout_confirmations"] == [] and revoked["layout_checks"][0]["kind"] == "shared_name"


def test_recalculation_after_renaming_the_baseline_asks_for_a_new_baseline(api):
    path, experiment = import_placeholder(api)
    run_id = experiment["parsed_summary"]["runs"][0]["id"]
    halves = {f"{row}{col}": f"{'Scrambled' if col <= 3 else 'Treated'}.{1 if row in 'AC' else 2}" for row in "ABCD" for col in range(1, 7)}
    api.put(f"{path}/plate-layout", json={"run_id": run_id, "wells": halves})
    analysed = api.post(f"{path}/analyze-batch", json={**analysis_request(run_id, ["Scrambled.1", "Scrambled.2"]), "target_assays": ["SCN1A"]})
    assert analysed.status_code == 200, analysed.text
    api.put(f"{path}/plate-layout", json={"run_id": run_id, "wells": {well: name.replace("Scrambled", "Scr") for well, name in halves.items()}})
    rebuilt = api.post(f"{path}/rebuild").json()
    assert rebuilt["runs_rebuilt"] == 0
    assert "renamed in the plate layout" in rebuilt["errors"][0]["reason"]


def test_layout_requests_are_validated(api):
    path, experiment = import_placeholder(api)
    run_id = experiment["parsed_summary"]["runs"][0]["id"]
    assert api.put(f"{path}/plate-layout", json={"run_id": run_id, "wells": {"P24": "S1"}}).status_code == 422
    assert api.put(f"{path}/plate-layout", json={"run_id": run_id, "confirm_replicates": ["Nope"]}).status_code == 422
    assert api.put(f"{path}/plate-layout", json={"run_id": "unknown", "wells": {"A1": "S1"}}).status_code == 422
    unchanged = api.get(path).json()
    assert unchanged["context_revision"] == experiment["context_revision"]

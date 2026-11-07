"""Legacy .xls exports and experiments whose samples are spread over several plates."""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.qpcr_engine import import_qpcr_file
from backend.qpcr_engine.review import measurement_id, sample_instance_id

FIXTURES = Path(__file__).resolve().parent / "test_fixtures"
PLATE_1 = FIXTURES / "SYNTH-PLATE_1.xls"
PLATE_2 = FIXTURES / "SYNTH-PLATE_2.xls"


@pytest.fixture
def api(tmp_path, monkeypatch):
    import backend.app as module
    monkeypatch.setattr(module, "DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr(module, "UPLOAD_DIR", tmp_path)
    module.init_db()
    return module


@pytest.fixture
def client(api):
    return TestClient(api.app)


def upload(client, files, combine=False, name="plates"):
    project = client.post("/api/projects", json={"name": "plates"}).json()
    response = client.post(f"/api/projects/{project['id']}/upload", data={"name": name, "combine": str(combine).lower()},
                           files=[("files", (path.name, path.read_bytes(), "application/vnd.ms-excel")) for path in files])
    return project, response


def test_legacy_xls_export_imports_like_an_xlsx_export():
    parsed = import_qpcr_file(str(PLATE_1))
    assert parsed["warnings"] == []
    assert [run["name"] for run in parsed["runs"]] == ["SYNTH-PLATE_1"]
    assert parsed["runs"][0]["plate_size"] == 96
    assert parsed["runs"][0]["source_file"] == "SYNTH-PLATE_1.xls"
    # The derived "Calc" tab repeats raw rows without run metadata and is skipped.
    assert parsed["record_count"] == 20 and {r["sheet"] for r in parsed["records"]} == {"Results"}
    first, omitted = parsed["records"][0], parsed["records"][1]
    assert first["ct"] == 25.0 and first["status"] == "detected" and first["omit"] is False
    assert omitted["omit"] is True
    assert {r["status"] for r in parsed["records"] if r["sample"] == "H2O"} == {"undetermined"}


def test_an_xlsx_saved_with_an_xls_extension_still_imports(tmp_path):
    from openpyxl import Workbook
    book = Workbook()
    for row in [["Experiment Name", "renamed"], ["Well Position", "Sample Name", "Target Name", "CT"], ["A1", "s.1", "T", 21.5]]:
        book.active.append(row)
    path = tmp_path / "export.xls"
    book.save(path)
    assert import_qpcr_file(str(path))["record_count"] == 1


@pytest.mark.parametrize("name, content", [
    ("broken.xls", b"not an excel file"),
    # openpyxl alone says "File is not a zip file", which means nothing to a scientist.
    ("broken.xlsx", b"not an excel file"),
    ("cut-off.xlsx", b"PK\x03\x04 truncated"),
])
def test_a_corrupt_excel_file_gives_a_readable_error(tmp_path, name, content):
    path = tmp_path / name
    path.write_bytes(content)
    with pytest.raises(ValueError, match="could not be read as an Excel file"):
        import_qpcr_file(str(path))


def test_separate_plates_upload_as_separate_runs(client):
    _, response = upload(client, [PLATE_1, PLATE_2])
    assert response.status_code == 200, response.text
    runs = response.json()["runs"]
    assert [run["name"] for run in runs] == ["SYNTH-PLATE_1", "SYNTH-PLATE_2"]
    assert all("plates" not in run for run in runs)


def test_combined_plates_form_one_run_that_keeps_each_plate(client, api):
    project, response = upload(client, [PLATE_1, PLATE_2], combine=True)
    assert response.status_code == 200, response.text
    body = response.json()
    assert len(body["runs"]) == 1
    run = body["runs"][0]
    assert run["name"] == "SYNTH-PLATE_1 + 2"
    assert [plate["name"] for plate in run["plates"]] == ["SYNTH-PLATE_1", "SYNTH-PLATE_2"]
    assert run["record_count"] == 36
    detail = client.get(f"/api/projects/{project['id']}/experiments/{body['id']}").json()
    records = detail["raw_records"]
    assert {r["run_id"] for r in records} == {run["id"]}
    assert {r["plate"] for r in records} == {"SYNTH-PLATE_1", "SYNTH-PLATE_2"}
    # Well A1 exists on both plates; their measurement identities must stay distinct.
    assert len({r["measurement_id"] for r in records}) == len(records)
    assert detail["parsed_summary"]["files"] == ["SYNTH-PLATE_1.xls", "SYNTH-PLATE_2.xls"]


def test_cross_plate_normalization_uses_the_baseline_from_another_plate(client):
    project, response = upload(client, [PLATE_1, PLATE_2], combine=True)
    experiment = response.json()
    run_id = experiment["runs"][0]["id"]
    detail = client.get(f"/api/projects/{project['id']}/experiments/{experiment['id']}").json()
    samples = sorted({r["sample"] for r in detail["raw_records"] if r["sample"] != "H2O"})
    payload = {"target_assay": "TARGET", "reference_assays": ["REF"], "run_id": run_id,
               "baseline_samples": ["SYNTH_cells_day0.1", "SYNTH_cells_day0.2"],
               "sample_groups": {s: s.rsplit(".", 1)[0] for s in samples}}
    result = client.post(f"/api/projects/{project['id']}/experiments/{experiment['id']}/analyze", json=payload)
    assert result.status_code == 200, result.text
    fold = {row["sample"]: row["fold_change"] for row in result.json()["samples"]}
    # Baseline ΔCt on plate 1 is 4.975 (one target well is instrument-omitted); day 21.2 on plate 2 has ΔCt 3.0.
    assert fold["SYNTH_cells_day 21.2"] == pytest.approx(2 ** (4.975 - 3.0))
    assert fold["SYNTH_cells_day7.1"] == pytest.approx(2 ** (4.975 - 4.0))


def test_combining_refuses_the_same_plate_twice(client):
    _, response = upload(client, [PLATE_1, PLATE_1], combine=True)
    assert response.status_code == 422
    assert "already" in response.json()["detail"]


def test_combining_refuses_overlapping_biological_measurements(tmp_path, client):
    copy = tmp_path / "SYNTH-PLATE_1b.xls"
    copy.write_bytes(PLATE_1.read_bytes().replace(b"SYNTH-PLATE_1", b"SYNTH-PLATE_9"))
    _, response = upload(client, [PLATE_1, copy], combine=True)
    assert response.status_code == 422
    detail = response.json()["detail"]
    assert "both plates" in detail and "SYNTH_cells_day0.1" in detail


def test_a_plate_added_later_joins_a_run_without_losing_saved_mappings(client):
    project, response = upload(client, [PLATE_1])
    experiment = response.json()
    run_id = experiment["runs"][0]["id"]
    base = f"/api/projects/{project['id']}/experiments/{experiment['id']}"
    key = sample_instance_id(run_id, "SYNTH_cells_day7.1")
    before = client.get(base).json()
    mapping = {**before["sample_instances"][key], "condition": "renamed day 7"}
    assert client.patch(f"{base}/sample-instances", json={key: mapping}).status_code == 200
    revision = client.get(base).json()["context_revision"]
    added = client.post(f"{base}/plates", data={"combine_into": run_id},
                        files=[("files", (PLATE_2.name, PLATE_2.read_bytes(), "application/vnd.ms-excel"))])
    assert added.status_code == 200, added.text
    detail = added.json()
    run = detail["parsed_summary"]["runs"][0]
    assert run["id"] == run_id and len(detail["parsed_summary"]["runs"]) == 1
    assert [plate["name"] for plate in run["plates"]] == ["SYNTH-PLATE_1", "SYNTH-PLATE_2"]
    assert detail["sample_instances"][key]["condition"] == "renamed day 7"
    assert detail["context_revision"] == revision + 1
    assert detail["audit_events"][-1]["action"] == "plates_added"
    original = [r for r in detail["raw_records"] if r["plate"] == "SYNTH-PLATE_1"]
    assert {r["sheet"] for r in original} == {"Results"}  # identities of earlier wells are unchanged
    assert all(measurement_id(r) == r["measurement_id"] for r in detail["raw_records"])


def test_a_plate_added_later_can_stay_a_separate_run(client):
    project, response = upload(client, [PLATE_1])
    base = f"/api/projects/{project['id']}/experiments/{response.json()['id']}"
    added = client.post(f"{base}/plates", data={"combine_into": ""},
                        files=[("files", (PLATE_2.name, PLATE_2.read_bytes(), "application/vnd.ms-excel"))])
    assert added.status_code == 200, added.text
    assert [run["name"] for run in added.json()["parsed_summary"]["runs"]] == ["SYNTH-PLATE_1", "SYNTH-PLATE_2"]


def test_adding_the_same_plate_twice_is_refused_and_changes_nothing(client, api, tmp_path):
    project, response = upload(client, [PLATE_1])
    base = f"/api/projects/{project['id']}/experiments/{response.json()['id']}"
    before = client.get(base).json()
    stored = sorted(p.name for p in tmp_path.iterdir() if p.suffix == ".xls")
    again = client.post(f"{base}/plates", data={"combine_into": ""},
                        files=[("files", (PLATE_1.name, PLATE_1.read_bytes(), "application/vnd.ms-excel"))])
    assert again.status_code == 422 and "already" in again.json()["detail"]
    after = client.get(base).json()
    assert after["raw_records"] == before["raw_records"]
    assert sorted(p.name for p in tmp_path.iterdir() if p.suffix == ".xls") == stored


def test_single_file_upload_field_still_works(client):
    project = client.post("/api/projects", json={"name": "legacy"}).json()
    response = client.post(f"/api/projects/{project['id']}/upload", data={"name": "one"},
                           files={"file": (PLATE_1.name, PLATE_1.read_bytes(), "application/vnd.ms-excel")})
    assert response.status_code == 200, response.text
    assert json.loads(json.dumps(response.json()))["record_count"] == 20


def test_controls_on_combined_plates_are_reviewed_per_plate(client):
    project, response = upload(client, [PLATE_1, PLATE_2], combine=True)
    base = f"/api/projects/{project['id']}/experiments/{response.json()['id']}"
    from backend.qpcr_engine.review import assess_quality
    records = client.get(base).json()["raw_records"]
    signal = [{**r, "ct": 30.0, "status": "detected"} if r["sample"] == "H2O" and r["assay"] == "REF" else r for r in records]
    flags = [f for f in assess_quality(signal)["flags"] if f["kind"] == "control_signal"]
    assert sorted(f["plate"] for f in flags) == ["SYNTH-PLATE_1", "SYNTH-PLATE_2"]
    assert len({f["id"] for f in flags}) == 2


def test_review_decisions_follow_the_first_plate_when_a_run_is_combined(client, api):
    from backend.qpcr_engine.review import quality_flag_id
    project, response = upload(client, [PLATE_1])
    experiment = response.json()
    run = experiment["runs"][0]
    base = f"/api/projects/{project['id']}/experiments/{experiment['id']}"
    old_id = quality_flag_id("technical_spread", run["id"], "SYNTH_cells_day0.2", "REF")
    with api.get_db() as conn:
        row = conn.execute("SELECT metadata FROM experiments WHERE id = ?", (experiment["id"],)).fetchone()
        metadata = {**json.loads(row["metadata"]), "qc_decisions": {old_id: {"reason": "checked", "at": "now"}}}
        conn.execute("UPDATE experiments SET metadata = ? WHERE id = ?", (json.dumps(metadata), experiment["id"]))
    added = client.post(f"{base}/plates", data={"combine_into": run["id"]},
                        files=[("files", (PLATE_2.name, PLATE_2.read_bytes(), "application/vnd.ms-excel"))]).json()
    new_id = quality_flag_id("technical_spread", run["id"], "SYNTH_cells_day0.2", "REF", "SYNTH-PLATE_1")
    assert set(added["metadata"]["qc_decisions"]) == {new_id}


def test_library_marks_the_baseline_that_was_actually_used():
    from backend.qpcr_engine.library import condition_results
    result = {"run_id": "run", "target_assay": "T", "baseline_samples": ["a.1"], "effective_baseline_samples": ["b.1"],
              "sample_groups": {"a.1": "a", "b.1": "b"}, "samples": [{"sample": "a.1", "fold_change": None}, {"sample": "b.1", "fold_change": 1.0}]}
    rows = {row["condition"]: row for row in condition_results(result, {}, {"run": "run"}, 0)}
    assert rows["b"]["is_baseline"] and not rows["a"]["is_baseline"]


def test_a_damaged_xls_is_refused_and_no_upload_is_left_behind(client, tmp_path):
    damaged = tmp_path / "source" / "damaged.xls"
    damaged.parent.mkdir()
    damaged.write_bytes(PLATE_2.read_bytes()[:6000])
    _, response = upload(client, [PLATE_1, damaged])
    assert response.status_code == 422
    assert "damaged.xls" in response.json()["detail"]
    assert not [p for p in tmp_path.iterdir() if p.suffix == ".xls"]


def test_unnamed_wells_do_not_block_combining():
    from backend.qpcr_engine.plates import combine_all
    run = lambda name: {"id": name, "name": name, "sheet": "Results", "header_row": 1, "record_count": 1, "plate_size": 96}
    unnamed = lambda run_id: {"run_id": run_id, "sample": "Unassigned sample", "assay": "REF", "sheet": "Results", "row_number": 2, "well": "A1"}
    records, runs = combine_all([unnamed("P1"), unnamed("P2")], [run("P1"), run("P2")], lambda r: False)
    assert len(runs) == 1 and len(records) == 2


def test_two_files_with_the_same_plate_are_refused_but_one_file_may_repeat_a_name(client, tmp_path):
    _, response = upload(client, [PLATE_1, PLATE_1])
    assert response.status_code == 422 and "more than once" in response.json()["detail"]
    from openpyxl import Workbook
    book = Workbook()
    for _ in range(2):
        for row in [["Experiment Name", "same"], ["Well Position", "Sample Name", "Target Name", "CT"], ["A1", "s.1", "T", 21.5], [None]]:
            book.active.append(row)
    path = tmp_path / "source.xlsx"
    book.save(path)
    _, response = upload(client, [path])
    assert response.status_code == 200 and len(response.json()["runs"]) == 2

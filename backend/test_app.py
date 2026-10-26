from __future__ import annotations

import io
import xml.etree.ElementTree as ET

import pytest
from pathlib import Path

from fastapi.testclient import TestClient

from backend.app import app, get_db
from backend.qpcr_engine import import_qpcr_file, summarize_results

client = TestClient(app)


def test_calculation_summary() -> None:
    records = [
        {"sample": "sampleA", "assay": "GAPDH", "ct": 20.0, "status": "detected", "omit": False},
        {"sample": "sampleA", "assay": "GAPDH", "ct": 20.5, "status": "detected", "omit": False},
        {"sample": "sampleA", "assay": "ACTA1", "ct": 22.0, "status": "detected", "omit": False},
        {"sample": "sampleA", "assay": "ACTA1", "ct": 22.5, "status": "detected", "omit": False},
        {"sample": "sampleB", "assay": "GAPDH", "ct": 21.0, "status": "detected", "omit": False},
        {"sample": "sampleB", "assay": "ACTA1", "ct": 28.0, "status": "detected", "omit": False},
    ]
    summary = summarize_results(records, target_assay="ACTA1", reference_assays=["GAPDH"], baseline_sample="sampleA")

    sample_map = {item["sample"]: item for item in summary["samples"]}
    assert sample_map["sampleA"]["fold_change"] == 1.0
    assert sample_map["sampleB"]["fold_change"] < 1.0


def test_multiple_reference_ct_means_use_arithmetic_mean() -> None:
    records = [
        {"sample": "base", "assay": "TARGET", "ct": 25.0, "status": "detected", "omit": False},
        {"sample": "base", "assay": "REF_A", "ct": 20.0, "status": "detected", "omit": False},
        {"sample": "base", "assay": "REF_B", "ct": 30.0, "status": "detected", "omit": False},
        {"sample": "treated", "assay": "TARGET", "ct": 30.0, "status": "detected", "omit": False},
        {"sample": "treated", "assay": "REF_A", "ct": 20.0, "status": "detected", "omit": False},
        {"sample": "treated", "assay": "REF_B", "ct": 30.0, "status": "detected", "omit": False},
    ]
    summary = summarize_results(
        records,
        target_assay="TARGET",
        reference_assays=["REF_A", "REF_B"],
        baseline_sample="base",
    )
    treated = next(row for row in summary["samples"] if row["sample"] == "treated")
    assert treated["reference_ct_mean"] == 25.0
    assert treated["delta_delta_ct"] == 5.0
    assert treated["fold_change"] == 2 ** -5


def test_import_qpcr_file_handles_csv(tmp_path) -> None:
    csv_path = tmp_path / "example.csv"
    csv_path.write_text(
        "Well,Sample Name,Target Name,CT,Omit\n"
        "A1,sampleA,ACTA1,22.0,FALSE\n"
        "A2,sampleA,GAPDH,Undetermined,FALSE\n"
        "A3,sampleA,GAPDH,,FALSE\n"
        "A4,sampleA,GAPDH,20.0,TRUE\n",
        encoding="utf-8",
    )

    parsed = import_qpcr_file(str(csv_path))
    assert parsed["record_count"] == 4
    assert parsed["records"][0]["assay"] == "ACTA1"
    assert parsed["records"][0]["run_name"] == "example"
    assert [record["status"] for record in parsed["records"]] == [
        "detected",
        "undetermined",
        "missing",
        "detected",
    ]
    assert parsed["records"][3]["omit"] is True


def test_lad081_import_uses_only_quantstudio_raw_sections() -> None:
    workbook_path = Path(__file__).resolve().parents[1] / "Analysis LAD081_ qPCR_09042026_example.xlsx"
    if not workbook_path.exists():
        pytest.skip("Optional private LAD081 development workbook is not installed.")
    parsed = import_qpcr_file(str(workbook_path))

    assert parsed["record_count"] == 560
    assert [run["record_count"] for run in parsed["runs"]] == [280, 280]
    assert [run["name"].rsplit("_", 1)[-1] for run in parsed["runs"]] == ["2", "3"]
    assert {record["sheet"] for record in parsed["records"]} == {"Sheet1"}
    assert {record["row_number"] for record in parsed["records"]}.issuperset({49, 381})
    first_run = parsed["runs"][0]
    baseline = "LAD081_HDFn_confluency_100% day 0.1"
    result = summarize_results(
        parsed["records"],
        target_assay="ACTA1",
        reference_assays=["GAPDH", "c1orf43"],
        baseline_sample=baseline,
        run_id=first_run["id"],
    )
    baseline_result = next(row for row in result["samples"] if row["sample"] == baseline)
    assert len(baseline_result["target_ct_values"]) == 4
    assert baseline_result["fold_change"] == 1.0


def test_analysis_does_not_combine_runs_implicitly() -> None:
    records = [
        {"run_id": "run1", "sample": "base", "assay": "TARGET", "ct": 20.0},
        {"run_id": "run1", "sample": "base", "assay": "REF", "ct": 18.0},
        {"run_id": "run2", "sample": "base", "assay": "TARGET", "ct": 30.0},
        {"run_id": "run2", "sample": "base", "assay": "REF", "ct": 18.0},
    ]
    try:
        summarize_results(records, "TARGET", ["REF"], "base")
    except ValueError as error:
        assert "Select one run" in str(error)
    else:
        raise AssertionError("Separate runs were combined without an explicit run selection.")


def test_upload_and_analysis_flow() -> None:
    create_response = client.post("/api/projects", json={"name": "Smoke test project"})
    assert create_response.status_code == 200
    project_id = create_response.json()["id"]

    csv_data = b"Well,Sample Name,Target Name,CT\nA1,sampleA,ACTA1,22.0\nA2,sampleA,GAPDH,20.0\nB1,sampleB,ACTA1,28.0\nB2,sampleB,GAPDH,21.0\n"
    upload_response = client.post(
        f"/api/projects/{project_id}/upload",
        files={"file": ("test.csv", io.BytesIO(csv_data), "text/csv")},
        data={"name": "smoke-example"},
    )
    assert upload_response.status_code == 200, upload_response.text
    experiment_id = upload_response.json()["id"]
    run_id = upload_response.json()["runs"][0]["id"]

    analysis_response = client.post(
        f"/api/projects/{project_id}/experiments/{experiment_id}/analyze",
        json={
            "target_assay": "ACTA1",
            "reference_assays": ["GAPDH"],
            "baseline_sample": "sampleA",
            "run_id": run_id,
        },
    )
    assert analysis_response.status_code == 200, analysis_response.text
    payload = analysis_response.json()
    assert payload["target_assay"] == "ACTA1"
    assert len(payload["samples"]) == 2

    history = client.get(f"/api/projects/{project_id}/experiments/{experiment_id}/analyses")
    assert history.status_code == 200
    assert len(history.json()) == 1
    version_id = history.json()[0]["id"]
    snapshot = client.get(f"/api/projects/{project_id}/experiments/{experiment_id}/analyses/{version_id}/export.json")
    assert snapshot.status_code == 200
    assert snapshot.json()["result"]["input_sha256"]
    assert snapshot.json()["settings"]["target_assay"] == "ACTA1"

    csv_export = client.get(f"/api/projects/{project_id}/experiments/{experiment_id}/export.csv")
    assert csv_export.status_code == 200
    assert "target_ct_values" in csv_export.text
    assert "baseline_delta_ct" in csv_export.text

    svg_export = client.get(f"/api/projects/{project_id}/experiments/{experiment_id}/export.svg")
    assert svg_export.status_code == 200
    assert "1× baseline" in svg_export.text
    root = ET.fromstring(svg_export.text)
    ns = {'s': 'http://www.w3.org/2000/svg'}
    anchor = next(float(line.attrib['y1']) for line in root.findall('s:line', ns) if 'stroke-dasharray' in line.attrib)
    bars = [rect for rect in root.findall('s:rect', ns) if rect.attrib.get('fill') == '#3b82f6']
    assert len(bars) == 2
    assert float(bars[0].attrib['height']) == 0  # exactly 1x
    assert float(bars[1].attrib['y']) == anchor  # downregulation descends from 1x
    assert float(bars[1].attrib['height']) > 0


    with get_db() as conn:
        uploaded_paths = [
            row["file_path"]
            for row in conn.execute(
                "SELECT file_path FROM experiments WHERE project_id = ?",
                (project_id,),
            ).fetchall()
        ]
        conn.execute("DELETE FROM analysis_versions WHERE experiment_id IN (SELECT id FROM experiments WHERE project_id = ?)", (project_id,))
        conn.execute("DELETE FROM experiments WHERE project_id = ?", (project_id,))
        conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))
    for uploaded_path in uploaded_paths:
        Path(uploaded_path).unlink(missing_ok=True)

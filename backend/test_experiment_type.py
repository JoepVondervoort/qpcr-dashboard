"""Experiment types: fold-change expression, or a comparison of candidate reference genes."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.qpcr_engine.experiment_type import (
    EXPRESSION,
    STABILITY,
    analysis_type_state,
    is_reference_gene,
    measured_assays,
    suggest_analysis_type,
)
from backend.qpcr_engine.parser import import_qpcr_file
from backend.qpcr_engine.sample_roles import is_technical_control

HOUSEKEEPING = ["SCN1A 3", "CDKN1A", "18sr", "GAPDH 2", "rpl32", "c1orf43"]


def record(sample: str, assay: str, ct: float | None = 20.0, run: str = "run") -> dict:
    return {"run_id": run, "sample": sample, "assay": assay, "ct": ct, "status": "detected" if ct is not None else "undetermined", "omit": False}


def by_name(row: dict) -> bool:
    return is_technical_control(row["sample"])


@pytest.mark.parametrize("assay", ["GAPDH 1", "GAPDH_2", "rpl32", "c1orf43", "18sr", "18S rRNA", "TBP", "ACTB"])
def test_reference_genes_are_recognized_whatever_the_primer_set_suffix(assay):
    assert is_reference_gene(assay)


@pytest.mark.parametrize("assay", ["SCN1A 3", "CDKN1A", "tsc2", "MAP2", "P21"])
def test_target_genes_are_not_reference_genes(assay):
    assert not is_reference_gene(assay)


@pytest.mark.parametrize("text", ["housekeeping genes _stability 2  .xls", "2025_housekeepi9nggene stability_2_19022025.eds",
                                  "20250402_hkg_af22.eds", "Reference gene validation", "geNorm HEK"])
def test_a_name_about_reference_genes_suggests_a_stability_experiment(text):
    suggestion = suggest_analysis_type([text], ["GAPDH", "RPL32", "SCN1A"])
    assert suggestion["type"] == STABILITY
    assert text in suggestion["reasons"][0]


def test_many_reference_genes_suggest_a_stability_experiment_without_a_name_hint():
    suggestion = suggest_analysis_type(["20250402.xls"], ["SCN1A 3", "CDKN1A", "GAPDH 1", "c1orf43", "18sr", "rpl32"])
    assert suggestion["type"] == STABILITY
    assert "4 of the 6 genes" in suggestion["reasons"][0]


@pytest.mark.parametrize("texts, assays", [
    # Ordinary expression plates normalize to two or three reference genes.
    (["2025-11-11_lad046_plate2.xls"], ["SCN1A", "C1ORF43", "RPL32", "TBP"]),
    (["svh002_qPCR plate 1_ basal expression.xls"], ["SCN1A", "CDKN1A", "NR4A2", "SLC6A1", "gapdh", "c1orf43", "rpl32"]),
    # A name hint alone is not enough: a stability experiment compares several reference genes.
    (["housekeeping check.xls"], ["GAPDH", "SCN1A", "MAP2"]),
    # mRNA stability (actinomycin D chase) measures expression decay, not reference genes.
    (["HEK mRNA stability ActD.xls"], ["MYC", "FOS", "GAPDH", "RPL32"]),
    # Four reference genes normalizing three targets is still an expression design.
    (["20250827_mv01_hela_1_12.xls"], ["SCN1A 1", "tsc2", "CDKN1A", "GAPDH 1", "c1orf43", "rpl32", "tbp"]),
])
def test_expression_experiments_are_not_questioned(texts, assays):
    assert suggest_analysis_type(texts, assays) is None


def test_only_assays_with_signal_outside_controls_count_as_measured():
    records = [record("S1", "GAPDH 2"), record("Unassigned sample", "rpl32"), record("H2O", "18sr"),
               record("Unassigned sample", "GAPDH 1", None), record("S1", "Unassigned assay")]
    assert measured_assays(records, by_name) == ["GAPDH 2", "rpl32"]


def test_the_scientist_answer_is_kept_and_the_question_is_closed():
    texts, assays = ["housekeeping genes _stability 2  .xls"], HOUSEKEEPING
    open_question = analysis_type_state({}, texts, assays)
    assert open_question["type"] == EXPRESSION and not open_question["confirmed"] and open_question["suggestion"]["type"] == STABILITY
    answered = analysis_type_state({"analysis_type": {"type": STABILITY, "stability_genes": ["rpl32", "18sr"]}}, texts, assays)
    assert answered["type"] == STABILITY and answered["confirmed"] and answered["stability_genes"] == ["rpl32", "18sr"]


def test_the_instrument_file_name_is_kept_without_its_folder(tmp_path):
    lines = ["Block Type\t96-Well Block", "Experiment File Name\tS:\\data\\group\\qPCR methods\\20250402_hkg_af22.eds",
             "Experiment Name\t20250402", "", "Well\tWell Position\tSample Name\tTarget Name\tCT", "1\tA1\tS1\tGAPDH\t20"]
    path = tmp_path / "export.xlsx"
    _write_xlsx(path, [line.split("\t") for line in lines])
    [run] = import_qpcr_file(str(path))["runs"]
    assert run["instrument_file"] == "20250402_hkg_af22.eds"


def _write_xlsx(path, rows: list[list[str]]) -> None:
    from openpyxl import Workbook
    book = Workbook()
    sheet = book.active
    sheet.title = "Results"
    for row in rows:
        sheet.append([float(value) if value.replace(".", "", 1).isdigit() else value for value in row])
    book.save(path)


@pytest.fixture
def api(tmp_path, monkeypatch):
    import backend.app as module
    monkeypatch.setattr(module, "DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr(module, "UPLOAD_DIR", tmp_path)
    module.init_db()
    return TestClient(module.app)


def stability_csv() -> bytes:
    lines = ["Well,Sample Name,Target Name,CT"]
    for index, assay in enumerate(["GAPDH", "RPL32", "C1ORF43", "18S", "SCN1A"]):
        for sample in range(1, 5):
            lines.append(f"{'ABCDE'[index]}{sample},S{sample},{assay},{20 + index + 0.1 * sample}")
    return "\n".join(lines).encode()


def import_stability(api, name: str = "housekeeping genes stability"):
    project = api.post("/api/projects", json={"name": "stability"}).json()
    created = api.post(f"/api/projects/{project['id']}/upload", data={"name": name},
                       files=[("files", ("plate.csv", stability_csv(), "text/csv"))]).json()
    path = f"/api/projects/{project['id']}/experiments/{created['id']}"
    return path, api.get(path).json()


def library_entry(api) -> dict:
    return api.get("/api/projects").json()[0]["experiments"][0]["library_summary"]


def test_an_uploaded_stability_experiment_asks_which_type_it_is(api):
    _, experiment = import_stability(api)
    state = experiment["analysis_type"]
    assert state["type"] == EXPRESSION and not state["confirmed"]
    assert state["suggestion"]["type"] == STABILITY
    summary = library_entry(api)
    assert summary["analysis_type"] == EXPRESSION and summary["analysis_type_question"]


def test_choosing_stability_saves_the_compared_genes_with_an_audit_event(api):
    path, _ = import_stability(api)
    response = api.put(f"{path}/analysis-type", json={"type": STABILITY, "stability_genes": ["RPL32", "GAPDH", "C1ORF43"]})
    assert response.status_code == 200
    experiment = response.json()
    assert experiment["analysis_type"]["type"] == STABILITY and experiment["analysis_type"]["confirmed"]
    assert experiment["analysis_type"]["stability_genes"] == ["RPL32", "GAPDH", "C1ORF43"]
    event = experiment["audit_events"][-1]
    assert event["action"] == "analysis_type_set" and event["after"]["type"] == STABILITY
    summary = library_entry(api)
    assert summary["analysis_type"] == STABILITY and not summary["analysis_type_question"]
    # Saved expression results stay valid: the type changes what is shown, not the data.
    assert experiment["context_revision"] == 0


def test_answering_expression_closes_the_question(api):
    path, _ = import_stability(api)
    experiment = api.put(f"{path}/analysis-type", json={"type": EXPRESSION}).json()
    assert experiment["analysis_type"]["confirmed"] and experiment["analysis_type"]["type"] == EXPRESSION
    assert not library_entry(api)["analysis_type_question"]


@pytest.mark.parametrize("payload, message", [
    ({"type": "fold"}, None),
    ({"type": STABILITY, "stability_genes": ["GAPDH", "TUBB3"]}, "TUBB3"),
    ({"type": STABILITY, "stability_genes": ["GAPDH", "GAPDH"]}, "twice"),
    ({"type": STABILITY, "stability_genes": ["GAPDH", "Unassigned assay"]}, "Unassigned assay"),
])
def test_analysis_type_requests_are_validated(api, payload, message):
    path, _ = import_stability(api)
    response = api.put(f"{path}/analysis-type", json=payload)
    assert response.status_code == 422
    if message:
        assert message in response.json()["detail"]

"""Exports without sample names: the workbench proposes which wells are one sample and numbers them."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.qpcr_engine.layout import UNASSIGNED_SAMPLE
from backend.qpcr_engine.layout_guess import suggest_layouts
from backend.qpcr_engine.sample_numbering import UNKNOWN_CONDITION, active_auto_layouts, apply_suggestions, undo_numbering
from backend.qpcr_engine.sample_roles import is_technical_control

ROWS = "ABCDEFGHIJKLMNOP"
# Neighbouring samples differ by more than half a cycle; sample 5 had little RNA and is late in every gene.
OFFSETS = [0.0, 1.1, -0.8, 0.6, 3.0, -1.2, 0.3, 1.6, -0.5, 0.9, -1.6, 0.2]


def well(name: str, assay: str, ct: float | None, sample: str = UNASSIGNED_SAMPLE, run: str = "run", plate: str | None = None) -> dict:
    record = {"run_id": run, "run_name": run, "sheet": "Results", "row_number": 0, "well": name, "sample": sample, "assay": assay,
              "ct": ct, "status": "detected" if ct is not None else "undetermined", "omit": False}
    return {**record, "plate": plate} if plate else record


def by_name(record: dict) -> bool:
    return is_technical_control(record["sample"])


def duplicate(ct: float, index: int) -> tuple[float, float]:
    return ct - 0.04 - 0.01 * (index % 3), ct + 0.05


def band_plate(genes=("GAPDH", "RPL32", "ACTB"), run: str = "run", plate: str | None = None) -> list[dict]:
    """A 96-well plate: each gene in two rows of six side-by-side duplicates, NTC pairs and one stray pair in row G."""
    records = []
    for band, (gene, base) in enumerate(zip(genes, (18.0, 15.0, 21.0))):
        for index, offset in enumerate(OFFSETS):
            row, col = ROWS[band * 2 + index // 6], (index % 6) * 2 + 1
            for step, ct in enumerate(duplicate(base + offset, index)):
                records.append(well(f"{row}{col + step}", gene, ct, run=run, plate=plate))
    for index, gene in enumerate(genes):
        records += [well(f"G{index * 2 + 1}", gene, None, run=run, plate=plate), well(f"G{index * 2 + 2}", gene, None, run=run, plate=plate)]
    return records + [well("G7", "GAPDH", 24.0, run=run, plate=plate), well("G8", "GAPDH", 24.1, run=run, plate=plate)]


def names(records: list[dict], suggestion: dict, gene: str) -> dict[str, str]:
    return {r["well"]: suggestion["wells"].get(r["well"]) for r in records if r["assay"] == gene}


def test_duplicates_in_gene_bands_are_numbered_by_position_so_one_number_is_one_sample():
    records = band_plate()
    [suggestion] = suggest_layouts(records, by_name)
    assert suggestion["confident"] and suggestion["doubts"] == []
    assert suggestion["shape"] == [1, 2] and suggestion["numbering"] == "band" and suggestion["samples"] == 12
    assert {suggestion["wells"][w] for w in ("A1", "A2", "C1", "C2", "E1", "E2")} == {"Sample 1"}
    assert {suggestion["wells"][w] for w in ("B11", "B12", "D11", "D12", "F11", "F12")} == {"Sample 12"}
    # Sample 5 is late in every gene: the numbering pairs it with itself.
    assert suggestion["wells"]["A9"] == suggestion["wells"]["C9"] == suggestion["wells"]["E9"] == "Sample 5"
    assert [suggestion["wells"][w] for w in ("G1", "G2", "G5", "G6")] == ["NTC"] * 4
    assert suggestion["unfitted"] == ["G7", "G8"] and "G7" not in suggestion["wells"]
    assert "12 samples" in suggestion["summary"] and "2 wells side by side" in suggestion["summary"]


def test_a_second_gene_in_a_band_takes_the_numbers_of_its_positions():
    records = [{**r, "assay": "CDKN1A"} if r["well"] in {"B5", "B6", "B7", "B8"} else r for r in band_plate()]
    [suggestion] = suggest_layouts(records, by_name)
    assert suggestion["confident"]
    assert names(records, suggestion, "CDKN1A") == {"B5": "Sample 9", "B6": "Sample 9", "B7": "Sample 10", "B8": "Sample 10"}
    assert suggestion["wells"]["B9"] == "Sample 11"
    assert "CDKN1A" in suggestion["summary"]


def wrapping_plate() -> list[dict]:
    """Samples in 2 × 2 squares, one gene after the other in plate order, wrapping into the next pair of rows."""
    records, block = [], 0
    for gene, base in (("GAPDH", 18.0), ("NES", 25.0), ("PAX6", 23.0)):
        for index in range(5):
            top, left = (block // 6) * 2, (block % 6) * 2
            for row in (top, top + 1):
                for col in (left, left + 1):
                    records.append(well(f"{ROWS[row]}{col + 1}", gene, base + OFFSETS[index] + 0.03 * (row - top) - 0.02 * (col - left)))
            block += 1
    return records


def test_genes_that_wrap_across_rows_are_numbered_in_plate_order():
    [suggestion] = suggest_layouts(wrapping_plate(), by_name)
    assert suggestion["confident"], suggestion["doubts"]
    assert suggestion["shape"] == [2, 2] and suggestion["numbering"] == "gene" and suggestion["samples"] == 5
    # NES starts in the last square of the first two rows and continues in the next two.
    assert suggestion["wells"]["A11"] == suggestion["wells"]["B12"] == "Sample 1"
    assert suggestion["wells"]["C1"] == "Sample 2"


def test_wells_that_do_not_agree_like_replicates_are_offered_but_with_doubts():
    records = [well(f"{ROWS[i // 12]}{i % 12 + 1}", "GAPDH", 18.0 + (i * 7 % 11) * 0.6) for i in range(48)]
    [suggestion] = suggest_layouts(records, by_name)
    assert not suggestion["confident"]
    assert any("replicate" in doubt for doubt in suggestion["doubts"])


def test_genes_with_different_sample_counts_make_the_numbering_doubtful():
    records = [r for r in wrapping_plate() if not (r["assay"] == "PAX6" and r["well"] in {"E5", "E6", "F5", "F6", "E7", "E8", "F7", "F8"})]
    [suggestion] = suggest_layouts(records, by_name)
    assert not suggestion["confident"]
    assert any("different numbers of samples" in doubt for doubt in suggestion["doubts"])


def test_plates_with_sample_names_get_no_suggestion():
    named = [{**r, "sample": f"S{i // 2}"} for i, r in enumerate(band_plate())]
    assert suggest_layouts(named, by_name) == []


def test_named_controls_are_kept_and_left_out_of_the_numbering():
    records = [{**r, "sample": "mm"} if r["well"] in {"G1", "G2", "G3", "G4", "G5", "G6"} else r for r in band_plate()]
    [suggestion] = suggest_layouts(records, by_name)
    assert suggestion["confident"] and not {"G1", "G2"} & set(suggestion["wells"])


def test_plates_of_one_run_measuring_the_same_gene_get_distinct_names():
    records = band_plate(run="combined", plate="P1") + band_plate(run="combined", plate="P2")
    first, second = suggest_layouts(records, by_name)
    assert first["wells"]["A1"] == "P1 Sample 1" and second["wells"]["A1"] == "P2 Sample 1"


def triplicate_plate() -> list[dict]:
    """Two genes in bands of two rows, samples in three wells side by side."""
    records = []
    for band, (gene, base) in enumerate((("GAPDH", 18.0), ("RPL32", 15.0))):
        for index, offset in enumerate(OFFSETS[:8]):
            row, col = ROWS[band * 2 + index // 4], (index % 4) * 3 + 1
            records += [well(f"{row}{col + step}", gene, base + offset + 0.04 * step) for step in range(3)]
    return records


def test_triplicates_side_by_side_are_one_sample_not_a_pair_and_a_stray_well():
    [suggestion] = suggest_layouts(triplicate_plate(), by_name)
    assert suggestion["shape"] == [1, 3] and suggestion["samples"] == 8 and suggestion["confident"], suggestion["doubts"]
    assert {suggestion["wells"][w] for w in ("A1", "A2", "A3", "C1", "C2", "C3")} == {"Sample 1"}
    assert suggestion["wells"]["A4"] == "Sample 2"


def ntc_in_bands(late_gene: str | None = "ACTB") -> list[dict]:
    """Each gene band ends in an NTC pair (position 12); one gene's NTC shows a late primer dimer."""
    records = [r for r in band_plate() if r["well"][0] != "G"]
    for band, gene in enumerate(("GAPDH", "RPL32", "ACTB")):
        row = ROWS[band * 2 + 1]
        records = [r for r in records if r["well"] not in {f"{row}11", f"{row}12"}]
        ct = 34.0 if gene == late_gene else None
        records += [well(f"{row}11", gene, ct), well(f"{row}12", gene, ct)]
    return records


def test_wells_with_only_a_late_ct_are_left_for_the_scientist_to_decide():
    [suggestion] = suggest_layouts(ntc_in_bands(), by_name)
    # The position keeps its number, so the answer does not renumber the other samples.
    [late] = suggestion["late"]
    assert late["sample"] == "Sample 12" and late["wells"] == ["B11", "B12", "D11", "D12", "F11", "F12"]
    assert late["cts"] == "ACTB Ct 34.0, 34.0"
    assert not {"B11", "F12"} & set(suggestion["wells"]) and suggestion["samples"] == 11
    assert suggestion["confident"] and "late Ct" in suggestion["summary"]
    # Without any Ct the position is an NTC.
    [clean] = suggest_layouts(ntc_in_bands(None), by_name)
    assert clean["late"] == [] and {clean["wells"][w] for w in ("B11", "D12", "F11")} == {"NTC"}


def test_a_late_block_outside_the_pattern_is_asked_about_too():
    records = [{**r, "ct": 34.5, "status": "detected"} if r["well"] in {"G3", "G4"} else r for r in band_plate()]
    [suggestion] = suggest_layouts(records, by_name)
    assert suggestion["late"] == [{"sample": None, "wells": ["G3", "G4"], "reason": "late", "cts": "RPL32 Ct 34.5, 34.5"}]
    assert suggestion["wells"]["G1"] == "NTC" and "G3" not in suggestion["wells"]


def test_late_wells_answered_from_the_notice_close_the_question_and_undo_with_the_numbering():
    records = ntc_in_bands()
    updated, metadata = apply_suggestions(records, {}, suggest_layouts(records, by_name), by_name, "t")
    assert metadata["sample_instances"]['["run","Sample 12"]']["condition"] == UNKNOWN_CONDITION
    [active] = active_auto_layouts(updated, metadata)
    assert [group["sample"] for group in active["late"]] == ["Sample 12"]
    from backend.qpcr_engine.layout import apply_layout
    answered, _ = apply_layout(updated, "run", None, {w: "NTC" for w in active["late"][0]["wells"]}, by_name)
    assert active_auto_layouts(answered, metadata)[0]["late"] == []
    restored, _ = undo_numbering(answered, metadata, by_name, "t2")
    assert {r["sample"] for r in restored} == {UNASSIGNED_SAMPLE}


POSITION_6 = {"A11", "A12", "C11", "C12", "E11", "E12"}


def with_cts(records: list[dict], wells: set[str], ct=None, gene: str | None = None) -> list[dict]:
    """The given wells (of one gene, if named) get this Ct: None for no Ct at all."""
    hit = lambda r: r["well"] in wells and (gene is None or r["assay"] == gene)
    return [{**r, "ct": ct, "status": "detected" if ct is not None else "undetermined"} if hit(r) else r for r in records]


def test_a_number_is_a_position_so_plates_sharing_numbers_stay_matched():
    # Position 6 is an NTC on both plates; on P1 one gene shows a primer dimer, on P2 nothing.
    first = with_cts(with_cts(band_plate(run="combined", plate="P1"), POSITION_6), {"E11", "E12"}, 34.0)
    second = with_cts(band_plate(genes=("TBP", "B2M", "SCN1A"), run="combined", plate="P2"), POSITION_6)
    one, two = suggest_layouts(first + second, by_name)
    assert one["wells"]["B1"] == two["wells"]["B1"] == "Sample 7"
    assert [g["sample"] for g in one["late"] if g["sample"]] == [g["sample"] for g in two["late"] if g["sample"]] == ["Sample 6"]
    assert one["confident"] and two["confident"]


def test_a_position_without_any_ct_between_samples_is_asked_about_not_named_ntc():
    [suggestion] = suggest_layouts(with_cts(band_plate(), {"A7", "A8", "C7", "C8", "E7", "E8"}), by_name)
    [held] = [g for g in suggestion["late"] if g["sample"]]
    assert held == {"sample": "Sample 4", "wells": ["A7", "A8", "C7", "C8", "E7", "E8"], "reason": "none", "cts": "no Ct"}
    assert suggestion["wells"]["A9"] == "Sample 5" and "A7" not in suggestion["wells"]


def test_a_gene_with_only_late_cts_keeps_its_band():
    records = [{**r, "ct": 33.5 + 0.01 * i} if r["assay"] == "ACTB" and r["ct"] is not None else r for i, r in enumerate(band_plate())]
    [suggestion] = suggest_layouts(records, by_name)
    assert suggestion["wells"]["E1"] == suggestion["wells"]["A1"] == "Sample 1" and suggestion["unfitted"] == ["G7", "G8"]


def test_a_question_stays_open_until_every_well_is_answered():
    records = ntc_in_bands()
    updated, metadata = apply_suggestions(records, {"numbering_problem": "old"}, suggest_layouts(records, by_name), by_name, "t")
    assert "numbering_problem" not in metadata
    from backend.qpcr_engine.layout import apply_layout
    partly, _ = apply_layout(updated, "run", None, {"F11": "NTC", "F12": "NTC"}, by_name)
    assert len(active_auto_layouts(partly, metadata)[0]["late"]) == 1
    # Answered as a sample, the held position joins the numbered wells for renaming in number order.
    as_sample, _ = apply_layout(updated, "run", None, {w: "Sample 12" for w in ("B11", "B12", "D11", "D12", "F11", "F12")}, by_name)
    [active] = active_auto_layouts(as_sample, metadata)
    assert active["late"] == [] and active["wells"]["B11"] == "Sample 12"


def test_undecided_wells_of_a_placeholder_plate_are_left_out_until_answered():
    records = [{**r, "sample": "Plate 1"} for r in ntc_in_bands()]
    [suggestion] = suggest_layouts(records, by_name)
    updated, metadata = apply_suggestions(records, {}, [suggestion], by_name, "t")
    f11 = next(r for r in updated if r["well"] == "F11")
    assert f11["sample"] == UNASSIGNED_SAMPLE and f11["instrument_sample"] == "Plate 1"
    restored, _ = undo_numbering(updated, metadata, by_name, "t2")
    assert {r["sample"] for r in restored} == {"Plate 1"}


def test_plates_of_one_run_sharing_a_gene_in_a_multiplex_well_get_distinct_names():
    first = band_plate(run="combined", plate="P1")
    multiplex = first + [{**r, "assay": "HPRT1"} for r in first if r["assay"] == "GAPDH"]
    one, two = suggest_layouts(multiplex + band_plate(run="combined", plate="P2"), by_name)
    assert one["wells"]["A1"] == "P1 Sample 1" and two["wells"]["A1"] == "P2 Sample 1"


def test_plates_with_different_genes_share_numbers_but_doubt_unequal_sample_counts():
    first = band_plate(genes=("GAPDH", "RPL32", "ACTB"), run="combined", plate="P1")
    second = [r for r in band_plate(genes=("TBP", "B2M", "SCN1A"), run="combined", plate="P2") if r["well"] not in {"B11", "B12", "D11", "D12", "F11", "F12"}]
    one, two = suggest_layouts(first + second, by_name)
    assert one["wells"]["A1"] == two["wells"]["A1"] == "Sample 1"
    assert not one["confident"] and any("different numbers of sample positions" in doubt for doubt in two["doubts"])


def test_a_placeholder_confirmed_as_replicates_is_not_offered_for_numbering():
    placeholder = [{**r, "sample": "Plate 1"} for r in band_plate() if r["ct"] is not None]
    assert suggest_layouts(placeholder, by_name)[0]["kind"] == "placeholder"
    confirmed = [{"run_id": "run", "plate": None, "sample": "Plate 1", "wells": []}]
    assert suggest_layouts(placeholder, by_name, confirmed) == []


def test_numbering_keeps_conditions_already_given_and_undo_removes_only_its_own():
    records = band_plate()
    own = {"condition": "Ctrl", "series": "Ctrl", "timepoint": None, "time_unit": "day", "replicate": "1",
           "biological_unit_id": "", "cell_line": None, "confluency": None, "role": "biological"}
    updated, metadata = apply_suggestions(records, {"sample_instances": {'["run","Sample 1"]': own}}, suggest_layouts(records, by_name), by_name, "t")
    assert metadata["sample_instances"]['["run","Sample 1"]'] == own
    renamed = [{**r, "sample": "Mine"} if r["well"] in {"A3", "A4", "C3", "C4", "E3", "E4"} else r for r in updated]
    restored, after = undo_numbering(renamed, metadata, by_name, "t2")
    assert {r["sample"] for r in restored} == {UNASSIGNED_SAMPLE, "Mine"}
    assert '["run","Sample 3"]' not in after["sample_instances"] and after["auto_layouts"] == []
    assert after["audit_events"][-1]["action"] == "samples_unnumbered"
    with pytest.raises(LookupError):
        undo_numbering(restored, after, by_name, "t3")


def test_applying_a_suggestion_names_the_wells_groups_the_samples_and_can_be_undone():
    records = band_plate()
    suggestions = suggest_layouts(records, by_name)
    updated, metadata = apply_suggestions(records, {}, suggestions, by_name, "2026-11-07T10:00:00+00:00")
    a1 = next(r for r in updated if r["well"] == "A1")
    assert a1["sample"] == "Sample 1" and a1["instrument_sample"] == UNASSIGNED_SAMPLE
    annotation = metadata["sample_instances"]['["run","Sample 1"]']
    assert annotation["condition"] == UNKNOWN_CONDITION and annotation["replicate"] == "1" and annotation["role"] == "biological"
    assert '["run","NTC"]' not in metadata["sample_instances"]
    assert metadata["audit_events"][-1]["action"] == "samples_numbered" and metadata["context_revision"] == 1
    [active] = active_auto_layouts(updated, metadata)
    assert active["samples"] == 12 and active["wells"]["A1"] == "Sample 1"
    # Renaming every numbered well ends the notice.
    renamed = [{**r, "sample": "Mine"} if r["sample"].startswith("Sample") else r for r in updated]
    assert active_auto_layouts(renamed, metadata) == []


@pytest.fixture
def api(tmp_path, monkeypatch):
    import backend.app as module
    monkeypatch.setattr(module, "DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr(module, "UPLOAD_DIR", tmp_path)
    module.init_db()
    return TestClient(module.app)


def csv(records: list[dict]) -> bytes:
    lines = ["Well,Sample Name,Target Name,CT"]
    lines += [f"{r['well']},{'' if r['sample'] == UNASSIGNED_SAMPLE else r['sample']},{r['assay']},{'Undetermined' if r['ct'] is None else r['ct']}"
              for r in records]
    return "\n".join(lines).encode()


def upload(api, records: list[dict]) -> tuple[str, dict]:
    project = api.post("/api/projects", json={"name": "guess"}).json()
    created = api.post(f"/api/projects/{project['id']}/upload", data={"name": "no names"},
                       files=[("files", ("plate.csv", csv(records), "text/csv"))])
    assert created.status_code == 200, created.text
    path = f"/api/projects/{project['id']}/experiments/{created.json()['id']}"
    return path, api.get(path).json()


def test_an_import_without_sample_names_is_numbered_when_the_pattern_is_clear(api):
    path, experiment = upload(api, band_plate())
    [auto] = experiment["auto_layouts"]
    assert auto["samples"] == 12 and "12 samples" in auto["summary"]
    assert experiment["layout_suggestions"] == []
    assert {r["sample"] for r in experiment["raw_records"]} == {*(f"Sample {i}" for i in range(1, 13)), "NTC", UNASSIGNED_SAMPLE}
    conditions = {v["condition"] for k, v in experiment["sample_instances"].items() if v["role"] == "biological" and "Sample" in k}
    assert conditions == {UNKNOWN_CONDITION}
    assert experiment["replicate_questions"] == {}
    # Restoring the instrument's names by hand ends the numbering as well.
    run_id = experiment["parsed_summary"]["runs"][0]["id"]
    restored = api.put(f"{path}/plate-layout", json={"run_id": run_id, "wells": {w: "" for w in auto["wells"]}}).json()
    assert restored["auto_layouts"] == [] and len(restored["layout_suggestions"]) == 1
    numbered = api.post(f"{path}/number-samples", json={"expected_revision": restored["context_revision"]})
    assert numbered.status_code == 200, numbered.text
    assert numbered.json()["auto_layouts"][0]["samples"] == 12 and numbered.json()["layout_suggestions"] == []
    # Undo in one step.
    undone = api.delete(f"{path}/number-samples")
    assert undone.status_code == 200, undone.text
    assert undone.json()["auto_layouts"] == [] and {r["sample"] for r in undone.json()["raw_records"]} == {UNASSIGNED_SAMPLE}
    assert undone.json()["audit_events"][-1]["action"] == "samples_unnumbered"
    assert api.delete(f"{path}/number-samples").status_code == 409


def test_numbering_a_changed_experiment_asks_to_look_again(api):
    records = [well(f"{ROWS[i // 12]}{i % 12 + 1}", "GAPDH", 18.0 + (i * 7 % 11) * 0.6) for i in range(48)]
    path, experiment = upload(api, records)
    response = api.post(f"{path}/number-samples", json={"expected_revision": experiment["context_revision"] + 1})
    assert response.status_code == 409 and "changed" in response.json()["detail"]


def test_a_combined_run_can_be_numbered_again_after_undo(api):
    project = api.post("/api/projects", json={"name": "combined"}).json()
    files = [("files", (f"{name}.csv", csv(band_plate()), "text/csv")) for name in ("plate_1", "plate_2")]
    created = api.post(f"/api/projects/{project['id']}/upload", data={"name": "two plates", "combine": "true"}, files=files)
    assert created.status_code == 200, created.text
    path = f"/api/projects/{project['id']}/experiments/{created.json()['id']}"
    numbered = api.get(path).json()
    assert len(numbered["auto_layouts"]) == 2
    assert api.delete(f"{path}/number-samples").status_code == 200
    again = api.post(f"{path}/number-samples")
    assert again.status_code == 200, again.text
    assert len(again.json()["auto_layouts"]) == 2


def test_an_import_whose_numbering_fails_still_imports_unnamed(api, monkeypatch):
    import backend.app as module

    def refuse(*args, **kwargs):
        raise ValueError("cannot apply")
    monkeypatch.setattr(module, "apply_suggestions", refuse)
    _, experiment = upload(api, band_plate())
    assert experiment["auto_layouts"] == [] and len(experiment["layout_suggestions"]) == 1
    assert experiment["numbering_problem"].startswith("The workbench could not number the samples: cannot apply")
    assert "Plate layout" in experiment["numbering_problem"]


def test_a_combined_upload_that_cannot_be_numbered_says_to_import_plates_as_separate_runs(api, monkeypatch):
    import backend.app as module

    def refuse(*args, **kwargs):
        raise ValueError("“Sample 1” is already measured for GAPDH on another plate of this run.")
    monkeypatch.setattr(module, "apply_suggestions", refuse)
    project = api.post("/api/projects", json={"name": "combined"}).json()
    files = [("files", (f"{name}.csv", csv(band_plate()), "text/csv")) for name in ("plate_1", "plate_2")]
    created = api.post(f"/api/projects/{project['id']}/upload", data={"name": "two plates", "combine": "true"}, files=files)
    assert created.status_code == 200, created.text
    assert "each plate its own run" in created.json()["numbering_problem"]
    path = f"/api/projects/{project['id']}/experiments/{created.json()['id']}"
    response = api.post(f"{path}/number-samples")
    assert response.status_code == 422 and "each plate its own run" in response.json()["detail"]


def test_numbering_follows_a_single_plate_run_into_a_combined_run(api):
    path, experiment = upload(api, band_plate())
    run = experiment["parsed_summary"]["runs"][0]
    added = api.post(f"{path}/plates", data={"combine_into": run["id"]},
                     files=[("files", ("later.csv", csv([{**r, "assay": "TBP"} for r in band_plate()]), "text/csv"))])
    assert added.status_code == 200, added.text
    [auto] = added.json()["auto_layouts"]
    assert auto["plate"] == run["name"]


def test_an_unclear_import_is_left_unnamed_and_the_guess_is_offered(api):
    records = [well(f"{ROWS[i // 12]}{i % 12 + 1}", "GAPDH", 18.0 + (i * 7 % 11) * 0.6) for i in range(48)]
    path, experiment = upload(api, records)
    assert experiment["auto_layouts"] == []
    [suggestion] = experiment["layout_suggestions"]
    assert suggestion["doubts"] and {r["sample"] for r in experiment["raw_records"]} == {UNASSIGNED_SAMPLE}
    assert api.post(f"{path}/number-samples").json()["auto_layouts"][0]["doubts"] == suggestion["doubts"]


def test_numbering_with_nothing_to_number_is_refused(api):
    path, _ = upload(api, [{**r, "sample": f"S{i // 2}"} for i, r in enumerate(band_plate())])
    response = api.post(f"{path}/number-samples")
    assert response.status_code == 409 and "already" in response.json()["detail"]

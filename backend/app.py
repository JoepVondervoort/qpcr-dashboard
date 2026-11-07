from __future__ import annotations

import csv
import hashlib
import json
import logging
import os
import re
import sqlite3
import uuid
from datetime import datetime, timezone
from io import StringIO
from pathlib import Path
from typing import Annotated, Any, Callable, Literal
from xml.sax.saxutils import escape
from zipfile import BadZipFile

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from backend import APP_NAME, __version__
from backend.qpcr_engine import import_qpcr_file, summarize_results
from backend.qpcr_engine.sample_roles import is_technical_control
from backend.qpcr_engine.sample_metadata import infer_sample_metadata, analysis_group
from backend.qpcr_engine.statistics import holm
from backend.qpcr_engine.review import sample_instance_id, measurement_id, instances, assess_quality, canonical_hash, name_checks, quality_flag_id, replicate_questions
from backend.qpcr_engine.experiment_type import analysis_type_state, experiment_texts, measured_assays
from backend.qpcr_engine.library import condition_results
from backend.qpcr_engine.plates import add_plates_to_run, check_new_plates, combine_all
from backend.qpcr_engine.layout import (UNASSIGNED_SAMPLE, analysable_assays, apply_layout, confirmation, confirmations_on_plate,
                                        layout_checks, open_layout_questions, reopened_reviews)
from backend.qpcr_engine.layout_guess import suggest_layouts
from backend.qpcr_engine.sample_numbering import active_auto_layouts, apply_suggestions, numbering_problem, undo_numbering

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("QPCR_DATA_DIR", str(BASE_DIR / "data")))
UPLOAD_DIR = Path(os.environ.get("QPCR_UPLOAD_DIR", str(BASE_DIR / "uploads")))
DB_PATH = DATA_DIR / "qpcr.db"

DATA_DIR.mkdir(parents=True, exist_ok=True)
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# Cross-origin access is off unless listed: with "*", any website open in the browser could
# read local research data. The interface itself is same-origin (packaged app or Vite proxy).
CORS_ORIGINS = [origin.strip() for origin in os.environ.get("QPCR_CORS_ORIGINS", "").split(",") if origin.strip()]

logger = logging.getLogger(__name__)
app = FastAPI(title=APP_NAME, version=__version__)
if CORS_ORIGINS:
    app.add_middleware(CORSMiddleware, allow_origins=CORS_ORIGINS, allow_methods=["*"], allow_headers=["*"])


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def row_factory(conn: sqlite3.Connection):
    conn.row_factory = sqlite3.Row
    return conn


def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with get_db() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS experiments (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                name TEXT NOT NULL,
                original_filename TEXT,
                file_path TEXT,
                created_at TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'uploaded',
                raw_records TEXT,
                parsed_summary TEXT,
                analysis_result TEXT,
                metadata TEXT,
                FOREIGN KEY(project_id) REFERENCES projects(id)
            )
            """
        )

    with get_db() as conn:
        conn.execute("""CREATE TABLE IF NOT EXISTS analysis_versions (
            id TEXT PRIMARY KEY, experiment_id TEXT NOT NULL,
            created_at TEXT NOT NULL, request_json TEXT NOT NULL, result_json TEXT NOT NULL
        )""")
        # Preserve existing analyses once, before the first new version is calculated.
        for row in conn.execute("SELECT id, analysis_result FROM experiments").fetchall():
            if read_legacy_result(row["analysis_result"]):
                exists = conn.execute("SELECT 1 FROM analysis_versions WHERE experiment_id = ?", (row["id"],)).fetchone()
                if not exists:
                    conn.execute("INSERT INTO analysis_versions VALUES (?, ?, ?, ?, ?)",
                                 (str(uuid.uuid4()), row["id"], utc_now(), '{}', row["analysis_result"]))


def read_legacy_result(value: str | None) -> bool:
    try:
        return bool(json.loads(value or '{}').get('samples'))
    except (ValueError, AttributeError):
        return False


init_db()


class SampleAnnotation(BaseModel):
    cell_line: str | None = None
    confluency: str | None = None
    condition: str
    series: str
    timepoint: float | None = Field(default=None, allow_inf_nan=False)
    time_unit: Literal["day", "hour"] = "day"
    replicate: str = ""
    biological_unit_id: str = ""
    role: Literal["biological", "technical_control"] | None = None


class ExperimentDesign(BaseModel):
    time_origin: str = ""
    design_type: Literal["unknown", "independent", "paired", "blocked", "repeated"] = "unknown"
    experimental_unit: str = ""
    confirmed: bool = False
    reference_validation_note: str = ""
    efficiency_note: str = ""


EXPERIMENT_NAME_MAX = 140
# Control characters and bidirectional overrides could disguise a name; line breaks and tabs become spaces.
_HIDDEN_NAME_CHARACTERS = re.compile(r"[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]")


class ExperimentRename(BaseModel):
    name: str = Field(max_length=400)


class AnalysisTypeRequest(BaseModel):
    """Fold-change expression, or a comparison of candidate reference genes and the genes it compares."""
    type: Literal["expression", "reference_stability"]
    stability_genes: list[str] | None = Field(default=None, max_length=200)


class ReviewDecision(BaseModel):
    reason: str = Field(min_length=1)


class QualityReviewRequest(BaseModel):
    decisions: dict[str, ReviewDecision] = Field(default_factory=dict)
    measurement_exclusions: dict[str, str] | None = None
    spread_threshold: float | None = Field(default=None, gt=0, allow_inf_nan=False)
    note: str = ""


class AnalysisRequest(BaseModel):
    target_assay: str
    sample_metadata: dict[str, SampleAnnotation] = Field(default_factory=dict)
    instance_metadata: dict[str, SampleAnnotation] = Field(default_factory=dict)
    excluded_measurements: dict[str, str] | None = None
    experiment_design: ExperimentDesign | None = None
    reference_assays: list[str] = Field(min_length=1)
    baseline_sample: str = ""
    baseline_samples: list[str] = Field(default_factory=list)
    sample_groups: dict[str, str] = Field(default_factory=dict)
    excluded_samples: list[str] = Field(default_factory=list)
    technical_control_samples: list[str] | None = None
    exclusion_reasons: dict[str, str] = Field(default_factory=dict)
    hit_threshold: float = Field(default=1.5, gt=0, allow_inf_nan=False)
    statistics_method: str = "descriptive"
    assumptions_confirmed: bool = False
    run_id: str


class BatchAnalysisRequest(AnalysisRequest):
    target_assay: str = ""
    target_assays: list[str] = Field(min_length=1)


def resolved_sample_metadata(records: list[dict[str, Any]], overrides: dict[str, Any] | None = None) -> dict[str, Any]:
    suggestions = {str(r["sample"]): infer_sample_metadata(str(r["sample"])) for r in records}
    for name, value in (overrides or {}).items():
        if name in suggestions:
            suggestions[name] = value.model_dump() if isinstance(value, SampleAnnotation) else value
    return suggestions


def analysis_context(experiment: dict[str, Any], payload: AnalysisRequest, *, allow_draft: bool = False) -> dict[str, Any]:
    metadata = experiment["metadata"]
    design = metadata.get("experiment_design", ExperimentDesign().model_dump())
    if payload.experiment_design and payload.experiment_design.model_dump() != design:
        raise HTTPException(status_code=409, detail="Save the experimental design before analysis; the request differs from the experiment's recorded design.")
    if payload.statistics_method != "descriptive" and not (design["confirmed"] and design["design_type"] == "independent" and design["experimental_unit"].strip() and design["time_origin"].strip()):
        raise HTTPException(status_code=422, detail="Inferential tests require a confirmed independent-group design, experimental unit and time origin. Paired, blocked and repeated designs currently support descriptive results only.")
    excluded = payload.excluded_measurements if payload.excluded_measurements is not None else metadata.get("measurement_exclusions", {})
    if not allow_draft and excluded != metadata.get('measurement_exclusions',{}):
        raise HTTPException(status_code=409,detail="Save the well exclusions in QC review before creating a saved analysis. Use preview for unsaved changes.")
    known = {measurement_id(r) for r in experiment["raw_records"]}
    if set(excluded) - known or any(not reason.strip() for reason in excluded.values()):
        raise HTTPException(status_code=422, detail="Every well exclusion needs a known measurement identity and a reason.")
    annotations = {**experiment["sample_instances"], **{k:v.model_dump() for k,v in payload.instance_metadata.items()}}
    if set(annotations) - set(experiment["sample_instances"]):
        raise HTTPException(status_code=422, detail="Unknown run/sample instance in the analysis mapping.")
    annotations = instances(experiment["raw_records"], overrides=annotations)
    blocking = [c for c in experiment.get("layout_checks", []) if c["blocking"] and c["run_id"] == payload.run_id]
    if blocking:
        raise HTTPException(status_code=409, detail=f"Finish the plate layout in Set up analysis first. {blocking[0]['message']}")
    if not allow_draft and annotations != experiment['sample_instances']:
        raise HTTPException(status_code=409,detail="Save the run-specific sample mapping before analysis; the request contains unsaved assignments.")
    run_records = [r for r in experiment["raw_records"] if r.get("run_id") == payload.run_id]
    expected_controls={r['sample'] for r in run_records if annotations[sample_instance_id(r['run_id'],r['sample'])].get('role')=='technical_control'}
    if payload.technical_control_samples is not None and set(payload.technical_control_samples)!=expected_controls:
        raise HTTPException(status_code=409,detail='Save technical-control role changes in the run-specific sample mapping before analysis.')
    if payload.technical_control_samples is None:
        # Use persisted per-instance roles, including explicit overrides.
        payload.technical_control_samples = sorted({r["sample"] for r in run_records if annotations[sample_instance_id(r['run_id'],r['sample'])].get('role') == 'technical_control'})
    for r in run_records:
        annotations[sample_instance_id(r['run_id'],r['sample'])]['role'] = 'technical_control' if r['sample'] in payload.technical_control_samples else 'biological'
    if payload.statistics_method != 'descriptive':
        units = {}
        for r in run_records:
            key=sample_instance_id(r['run_id'],r['sample']); unit=annotations[key].get('biological_unit_id','').strip()
            if unit and r['sample'] not in payload.excluded_samples and r['sample'] not in payload.technical_control_samples:
                units.setdefault(unit,set()).add(key)
        if any(len(values)>1 for values in units.values()):
            raise HTTPException(status_code=422,detail="A biological-unit ID is repeated across sample instances in this run. Independent-group inference cannot treat repeated material as independent samples.")
    qc = assess_quality(run_records, excluded, metadata.get('qc_decisions',{}), metadata.get('spread_threshold',1.0), {k:v.get('role') for k,v in annotations.items()})
    config = {'run_id':payload.run_id,'references':sorted(payload.reference_assays),
      'baseline':sorted(payload.baseline_samples or ([payload.baseline_sample] if payload.baseline_sample else [])),
      'groups':{k:v for k,v in payload.sample_groups.items() if v and k not in payload.technical_control_samples and k not in payload.excluded_samples},
      'sample_instances':{k:v for k,v in annotations.items() if any(sample_instance_id(r['run_id'],r['sample'])==k for r in run_records)},
      'excluded_samples':sorted(payload.excluded_samples),'excluded_measurements':excluded,
      'technical_controls':sorted(payload.technical_control_samples),'design':design,
      'statistics_method':payload.statistics_method,'hit_threshold':payload.hit_threshold,'assumptions_confirmed':payload.assumptions_confirmed}
    return {'context_revision':experiment['context_revision'],'profile_id':canonical_hash(config),
      'analysis_settings':config,'sample_instances':annotations,'experiment_design':design,
      'excluded_measurements':excluded,'input_sha256':experiment['input_sha256'],
      'qc_summary':{k:v for k,v in qc.items() if k!='flags'}}


def run_sample_metadata(records: list[dict[str, Any]], annotations: dict[str, Any], run_id: str) -> dict[str, dict[str, Any]]:
    return {r["sample"]: annotations[sample_instance_id(run_id, r["sample"])] for r in records if r.get("run_id") == run_id}


def serialize_json(value: Any) -> str:
    return json.dumps(value, default=str)


def read_json_column(value: str | None) -> Any:
    if not value:
        return {}
    try:
        parsed = json.loads(value)
        return parsed if isinstance(parsed, (dict, list)) else {}
    except json.JSONDecodeError:
        return {}


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "analysis_contract": "5", "app": APP_NAME, "version": __version__}


def library_summary(experiment: sqlite3.Row, conn: sqlite3.Connection) -> dict[str, Any]:
    """Compact library fields, derived from preserved records and current review context."""
    records = read_json_column(experiment["raw_records"]) or []
    metadata = read_json_column(experiment["metadata"]) or {}
    annotations = instances(records, metadata.get("sample_metadata", {}), metadata.get("sample_instances", {}))
    quality = assess_quality(records, metadata.get("measurement_exclusions", {}), metadata.get("qc_decisions", {}), metadata.get("spread_threshold", 1.0), {k: v.get("role") for k, v in annotations.items()})
    is_control = _annotated_control(annotations)
    layout = layout_checks(records, is_control, metadata.get("layout_confirmations", []))
    kind = _analysis_type(experiment["name"], experiment["original_filename"], read_json_column(experiment["parsed_summary"]), records, metadata, is_control)
    latest_profiles: dict[str, str] = {}
    selected: dict[tuple[str, str], dict[str, Any]] = {}
    for row in conn.execute("SELECT result_json FROM analysis_versions WHERE experiment_id = ? ORDER BY created_at DESC", (experiment["id"],)):
        result = read_json_column(row["result_json"])
        run = result.get("run_id", "")
        profile = result.get("profile_id") or canonical_hash([result.get("reference_assays"), result.get("baseline_samples", result.get("baseline_sample")), result.get("sample_groups"), result.get("excluded_samples"), result.get("excluded_measurements")])
        latest_profiles.setdefault(run, profile)
        if profile == latest_profiles[run]:
            selected.setdefault((run, result.get("target_assay", "")), result)
    legacy = read_json_column(experiment["analysis_result"])
    if not selected and legacy:
        selected[(legacy.get("run_id", ""), legacy.get("target_assay", ""))] = legacy
    outdated = sum(result.get("context_revision") != metadata.get("context_revision", 0) for result in selected.values())
    runs = (read_json_column(experiment["parsed_summary"]) or {}).get("runs", [])
    run_names = {run["id"]: run["name"] for run in runs}
    gene_results = [row for result in selected.values() if result.get("samples") for row in condition_results(result, annotations, run_names, metadata.get("context_revision", 0))]
    incomplete = False
    for run in runs:
        saved = next((r for (run_id, _), r in selected.items() if run_id == run["id"]), None)
        if saved is None:
            incomplete = True
            continue
        targets = set(analysable_assays([r for r in records if r.get("run_id") == run["id"]], is_control)) - set(saved.get("reference_assays", []))
        incomplete |= any((run["id"], assay) not in selected for assay in targets)
    return {
        "assay_count": len({r["assay"] for r in records}),
        "biological_sample_count": sum(a.get("role") != "technical_control" and json.loads(key)[1] != UNASSIGNED_SAMPLE for key, a in annotations.items()),
        "unresolved_count": quality["unresolved_count"],
        "layout_issue_count": open_layout_questions(records, layout, is_control),
        "unresolved_findings": len({(f["kind"], f["run_id"], f.get("plate"), f["sample"]) for f in quality["flags"] if f["status"] == "needs_review"}),
        "reviewed_count": quality["reviewed_count"],
        "design_confirmed": bool(metadata.get("experiment_design", {}).get("confirmed")),
        "analysis_state": "needs_recalculation" if outdated else "partial" if selected and incomplete else "saved" if selected else "not_calculated",
        "saved_result_count": len(selected),
        "outdated_result_count": outdated,
        "gene_results": gene_results,
        "analysis_type": kind["type"],
        # A suggestion the scientist has not answered yet, and that differs from the current type.
        "analysis_type_question": bool(kind["suggestion"] and not kind["confirmed"] and kind["suggestion"]["type"] != kind["type"]),
    }


@app.get("/api/projects")
def list_projects() -> list[dict[str, Any]]:
    with get_db() as conn:
        projects = conn.execute(
            "SELECT id, name, created_at, updated_at FROM projects ORDER BY created_at DESC"
        ).fetchall()
        rows: list[dict[str, Any]] = []
        for project in projects:
            experiments = conn.execute(
                "SELECT id, name, status, original_filename, created_at, parsed_summary, analysis_result, raw_records, metadata FROM experiments WHERE project_id = ? ORDER BY created_at DESC",
                (project["id"],),
            ).fetchall()
            rows.append(
                {
                    "id": project["id"],
                    "name": project["name"],
                    "created_at": project["created_at"],
                    "updated_at": project["updated_at"],
                    "experiments": [
                        {
                            "id": experiment["id"],
                            "name": experiment["name"],
                            "status": experiment["status"],
                            "original_filename": experiment["original_filename"],
                            "created_at": experiment["created_at"],
                            "library_summary": library_summary(experiment, conn),
                            "parsed_summary": read_json_column(experiment["parsed_summary"]),
                            "analysis_result": read_json_column(experiment["analysis_result"]),
                        }
                        for experiment in experiments
                    ],
                }
            )
        return rows


@app.post("/api/projects")
def create_project(payload: dict[str, str]) -> dict[str, Any]:
    project_id = str(uuid.uuid4())
    now = utc_now()
    project_name = (payload.get("name") or "Untitled project").strip() or "Untitled project"
    with get_db() as conn:
        conn.execute(
            "INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
            (project_id, project_name, now, now),
        )
    return {"id": project_id, "name": project_name, "created_at": now, "updated_at": now}


def _discard(stored: list[dict[str, Any]]) -> None:
    for item in stored:
        item["path"].unlink(missing_ok=True)


async def _store_uploads(uploads: list[UploadFile]) -> list[dict[str, Any]]:
    """Keep a copy of every upload and parse it. If any file fails, none of them is kept."""
    stored: list[dict[str, Any]] = []
    try:
        for upload in uploads:
            original = upload.filename or "upload.csv"
            destination = UPLOAD_DIR / f"{uuid.uuid4()}{Path(original).suffix}"
            destination.write_bytes(await upload.read())
            stored.append({"name": original, "path": destination})
            try:
                parsed = import_qpcr_file(str(destination), display_name=original)
            except (ValueError, BadZipFile) as error:
                raise ValueError(f"{original}: {error}") from error
            except Exception as error:  # A damaged workbook can make a reader fail in unexpected ways.
                raise ValueError(f"{original} could not be read. Export it again, or save it as .xlsx or .csv.") from error
            if not parsed["record_count"]:
                explanation = " ".join(parsed["warnings"])
                raise ValueError(f"No raw Ct/Cq measurements were found in {original}. {explanation}")
            stored[-1]["parsed"] = parsed
    except (OSError, ValueError) as error:
        _discard(stored)
        raise HTTPException(status_code=422, detail=str(error)) from error
    except BaseException:
        _discard(stored)
        raise
    return stored


def _check_plates_per_file(existing_runs: list[dict[str, Any]], stored: list[dict[str, Any]]) -> None:
    """A plate may not repeat across files or the experiment; one export may repeat a run name, as before."""
    seen = list(existing_runs)
    for item in stored:
        check_new_plates(seen, item["parsed"]["runs"])
        seen += item["parsed"]["runs"]


def _merge_parsed(stored: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[str]]:
    several = len(stored) > 1
    records = [record for item in stored for record in item["parsed"]["records"]]
    runs = [run for item in stored for run in item["parsed"]["runs"]]
    warnings = [f"{item['name']}: {warning}" if several else warning for item in stored for warning in item["parsed"]["warnings"]]
    return records, runs, warnings


def _source_files(stored: list[dict[str, Any]], added_at: str) -> list[dict[str, Any]]:
    return [{"name": item["name"], "stored_name": item["path"].name, "added_at": added_at, "import_details": item["parsed"].get("source", {})} for item in stored]


def _analysis_type(name: str, original_filename: str | None, parsed_summary: dict[str, Any] | None, records: list[dict[str, Any]],
                   metadata: dict[str, Any], is_control) -> dict[str, Any]:
    return analysis_type_state(metadata, experiment_texts(name, original_filename, parsed_summary), measured_assays(records, is_control))


def _annotated_control(annotations: dict[str, Any]):
    """Saved or suggested roles of the experiment's own sample instances."""
    return lambda record: (annotations.get(sample_instance_id(str(record.get("run_id", "")), record["sample"])) or {}).get("role") == "technical_control"


def _role_checker(records: list[dict[str, Any]], metadata: dict[str, Any]):
    """Saved sample roles where they exist, name-based suggestions for new plates."""
    annotations = instances(records, metadata.get("sample_metadata", {}), metadata.get("sample_instances", {}))

    def is_control(record: dict[str, Any]) -> bool:
        saved = annotations.get(sample_instance_id(str(record.get("run_id", "")), record["sample"]))
        return (saved or {}).get("role") == "technical_control" if saved else is_technical_control(record["sample"])
    return is_control


def _plate_scoped_decisions(decisions: dict[str, Any], records: list[dict[str, Any]], run: dict[str, Any]) -> dict[str, Any]:
    """QC findings of a run become findings of its first plate once other plates join it."""
    pairs = {(r["sample"], r["assay"]) for r in records if r.get("run_id") == run["id"] and not r.get("plate")}
    moves = {quality_flag_id(kind, run["id"], sample, assay): quality_flag_id(kind, run["id"], sample, assay, run["name"])
             for sample, assay in pairs for kind in ("control_signal", "technical_spread")}
    return {moves.get(key, key): value for key, value in decisions.items()}


def _number_clear_layouts(records: list[dict[str, Any]], metadata: dict[str, Any], now: str) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Plates without any sample names are numbered on import when the pattern is clear; the others are offered.

    Numbering is a convenience: when it cannot be applied, the plates import unnamed, and the experiment says why and
    how to import them so that it works.
    """
    def by_name(record: dict[str, Any]) -> bool:
        return is_technical_control(record["sample"])
    clear = [s for s in suggest_layouts(records, by_name) if s["confident"] and s["kind"] == "unnamed"]
    if not clear:
        return records, metadata
    try:
        return apply_suggestions(records, metadata, clear, by_name, now)
    except ValueError as error:
        logger.exception("Numbering the samples on import failed; the plates stay unnamed.")
        return records, {**metadata, "numbering_problem": numbering_problem(error, clear)}


@app.post("/api/projects/{project_id}/upload")
async def upload_experiment(project_id: str, file: Annotated[UploadFile | None, File()] = None, name: Annotated[str, Form()] = "",
                            files: Annotated[list[UploadFile] | None, File()] = None, combine: Annotated[bool, Form()] = False) -> dict[str, Any]:
    """Import one or more plates as one experiment; with combine, all plates form one analysis run."""
    with get_db() as conn:
        project = conn.execute("SELECT id FROM projects WHERE id = ?", (project_id,)).fetchone()
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    uploads = [*([file] if file else []), *(files or [])]
    if not uploads:
        raise HTTPException(status_code=422, detail="Choose at least one results file.")

    stored = await _store_uploads(uploads)
    try:
        records, runs, warnings = _merge_parsed(stored)
        _check_plates_per_file([], stored)
        if combine:
            records, runs = combine_all(records, runs, lambda record: is_technical_control(record["sample"]))
    except ValueError as error:
        _discard(stored)
        raise HTTPException(status_code=422, detail=str(error)) from error
    stored_name = (name or stored[0]["name"] or "Imported qPCR experiment").strip() or "Imported qPCR experiment"
    file_names = [item["name"] for item in stored]
    experiment_id = str(uuid.uuid4())
    now = utc_now()
    records, metadata = _number_clear_layouts(records, {"source": stored[0]["name"], "warnings": warnings,
                                                        "source_files": _source_files(stored, now)}, now)

    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO experiments (
                id, project_id, name, original_filename, file_path, created_at, status,
                raw_records, parsed_summary, analysis_result, metadata
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                experiment_id,
                project_id,
                stored_name,
                stored[0]["name"],
                str(stored[0]["path"]),
                now,
                "uploaded",
                serialize_json(records),
                serialize_json({"record_count": len(records), "warnings": warnings, "runs": runs, "files": file_names}),
                serialize_json({}),
                serialize_json(metadata),
            ),
        )

    return {
        "id": experiment_id,
        "project_id": project_id,
        "name": stored_name,
        "original_filename": stored[0]["name"],
        "files": file_names,
        "record_count": len(records),
        "runs": runs,
        "warnings": warnings,
        "numbering_problem": metadata.get("numbering_problem"),
    }


@app.post("/api/projects/{project_id}/experiments/{experiment_id}/plates")
async def add_plates(project_id: str, experiment_id: str, files: Annotated[list[UploadFile], File()],
                     combine_into: Annotated[str, Form()] = "") -> dict[str, Any]:
    """Add plates that arrived later: as new runs, or as plates of an existing run (combine_into)."""
    get_experiment(project_id, experiment_id)
    stored = await _store_uploads(files)
    try:
        with get_db() as conn:
            # Read after the upload and write in the same transaction, so reviews saved meanwhile are kept.
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute("SELECT original_filename, raw_records, parsed_summary, metadata FROM experiments WHERE project_id = ? AND id = ?",
                               (project_id, experiment_id)).fetchone()
            if row is None:
                raise ValueError("This experiment no longer exists.")
            records, summary, metadata = _merge_plates(row, stored, combine_into)
            conn.execute("UPDATE experiments SET raw_records = ?, parsed_summary = ?, metadata = ? WHERE id = ? AND project_id = ?",
                         (serialize_json(records), serialize_json(summary), serialize_json(metadata), experiment_id, project_id))
    except ValueError as error:
        _discard(stored)
        raise HTTPException(status_code=422, detail=str(error)) from error
    return get_experiment(project_id, experiment_id)


def _merge_plates(row: sqlite3.Row, stored: list[dict[str, Any]], combine_into: str) -> tuple[list[dict[str, Any]], dict[str, Any], dict[str, Any]]:
    records = read_json_column(row["raw_records"]) or []
    summary = read_json_column(row["parsed_summary"]) or {}
    metadata = read_json_column(row["metadata"]) or {}
    runs = summary.get("runs", [])
    new_records, new_runs, warnings = _merge_parsed(stored)
    _check_plates_per_file(runs, stored)
    decisions = metadata.get("qc_decisions", {})
    if combine_into:
        target = next((run for run in runs if run["id"] == combine_into), None)
        if target is None:
            raise ValueError("The run to combine with is not part of this experiment.")
        decisions = _plate_scoped_decisions(decisions, records, target)
        metadata = {**metadata, "layout_confirmations": confirmations_on_plate(metadata.get("layout_confirmations", []), target),
                    "auto_layouts": confirmations_on_plate(metadata.get("auto_layouts", []), target)}
        merged, merged_runs = add_plates_to_run(records, runs, combine_into, new_records, new_runs, _role_checker(records, metadata))
    else:
        merged, merged_runs = [*records, *new_records], [*runs, *new_runs]
    now = utc_now()
    file_names = [item["name"] for item in stored]
    event = {"at": now, "action": "plates_added", "files": file_names, "plates": [run["name"] for run in new_runs], "combined_into": combine_into or None}
    updated_metadata = {**metadata, "qc_decisions": decisions, "context_revision": metadata.get("context_revision", 0) + 1,
                        "source_files": [*metadata.get("source_files", []), *_source_files(stored, now)],
                        "audit_events": [*metadata.get("audit_events", []), event]}
    updated_summary = {**summary, "record_count": len(merged), "runs": merged_runs, "warnings": [*summary.get("warnings", []), *warnings],
                       "files": [*summary.get("files", [row["original_filename"]] if row["original_filename"] else []), *file_names]}
    return merged, updated_summary, updated_metadata


@app.get("/api/projects/{project_id}/experiments")
def list_experiments(project_id: str) -> list[dict[str, Any]]:
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, name, status, original_filename, created_at, raw_records, parsed_summary, analysis_result FROM experiments WHERE project_id = ? ORDER BY created_at DESC",
            (project_id,),
        ).fetchall()
    return [
        {
            "id": row["id"],
            "name": row["name"],
            "status": row["status"],
            "original_filename": row["original_filename"],
            "created_at": row["created_at"],
            "raw_records": read_json_column(row["raw_records"]),
            "parsed_summary": read_json_column(row["parsed_summary"]),
            "analysis_result": read_json_column(row["analysis_result"]),
        }
        for row in rows
    ]


@app.get("/api/projects/{project_id}/experiments/{experiment_id}")
def get_experiment(project_id: str, experiment_id: str) -> dict[str, Any]:
    with get_db() as conn:
        row = conn.execute(
            "SELECT id, name, status, original_filename, created_at, raw_records, parsed_summary, analysis_result, metadata FROM experiments WHERE project_id = ? AND id = ?",
            (project_id, experiment_id),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Experiment not found")
    records = read_json_column(row["raw_records"])
    metadata = read_json_column(row["metadata"])
    annotations = instances(records, metadata.get('sample_metadata',{}), metadata.get('sample_instances',{}))
    quality = assess_quality(records, metadata.get('measurement_exclusions',{}), metadata.get('qc_decisions',{}), metadata.get('spread_threshold',1.0), {k:v.get('role') for k,v in annotations.items()})
    suggestions = suggest_layouts(records, _annotated_control(annotations), metadata.get('layout_confirmations', []))
    return {
        "id": row["id"],
        "name": row["name"],
        "status": row["status"],
        "original_filename": row["original_filename"],
        "created_at": row["created_at"],
        "raw_records": [{**r, 'measurement_id':measurement_id(r), 'sample_instance_id':sample_instance_id(r.get('run_id',''),r['sample'])} for r in records],
        "sample_instances": annotations,
        "name_checks": name_checks(records, metadata.get('sample_metadata',{}), metadata.get('sample_instances',{})),
        "replicate_questions": replicate_questions(records, metadata.get('sample_metadata',{}), metadata.get('sample_instances',{})),
        "analysis_type": _analysis_type(row["name"], row["original_filename"], read_json_column(row["parsed_summary"]), records, metadata, _annotated_control(annotations)),
        "quality": quality,
        "layout_checks": layout_checks(records, _annotated_control(annotations), metadata.get('layout_confirmations', [])),
        "layout_confirmations": [c for c in metadata.get('layout_confirmations', []) if isinstance(c, dict)],
        "layout_suggestions": suggestions,
        "auto_layouts": active_auto_layouts(records, metadata),
        # Why the numbering on import failed, while the plates are still unnumbered.
        "numbering_problem": metadata.get("numbering_problem") if suggestions else None,
        "context_revision": metadata.get('context_revision',0),
        "input_sha256": hashlib.sha256(row['raw_records'].encode()).hexdigest(),
        "experiment_design": metadata.get('experiment_design',ExperimentDesign().model_dump()),
        "measurement_exclusions": metadata.get('measurement_exclusions',{}),
        "audit_events": metadata.get('audit_events',[]),
        "sample_roles": {str(r["sample"]): ("technical_control" if is_technical_control(str(r["sample"])) else "biological") for r in read_json_column(row["raw_records"])},
        "parsed_summary": read_json_column(row["parsed_summary"]),
        "analysis_result": read_json_column(row["analysis_result"]),
        "metadata": read_json_column(row["metadata"]),
        "sample_metadata": resolved_sample_metadata(read_json_column(row["raw_records"]), read_json_column(row["metadata"]).get("sample_metadata", {})),
    }


@app.post("/api/projects/{project_id}/experiments/{experiment_id}/analyze")
def analyze_experiment(
    project_id: str,
    experiment_id: str,
    payload: AnalysisRequest,
) -> dict[str, Any]:
    experiment = get_experiment(project_id, experiment_id)
    records = experiment['raw_records']
    context = analysis_context(experiment, payload)
    if any(not payload.exclusion_reasons.get(sample, "").strip() for sample in payload.excluded_samples):
        raise HTTPException(status_code=422, detail="Every excluded biological sample needs a reason.")
    try:
        summary = summarize_results(
            records,
            target_assay=payload.target_assay,
            reference_assays=payload.reference_assays,
            baseline_sample=payload.baseline_sample,
            run_id=payload.run_id,
            baseline_samples=payload.baseline_samples,
            sample_groups=payload.sample_groups,
            excluded_samples=payload.excluded_samples,
            technical_control_samples=payload.technical_control_samples,
            excluded_measurements=context["excluded_measurements"],
            hit_threshold=payload.hit_threshold,
            statistics_method=payload.statistics_method,
            assumptions_confirmed=payload.assumptions_confirmed,
            sample_metadata=run_sample_metadata(records, context["sample_instances"], payload.run_id),
        )
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    summary["sample_metadata"] = resolved_sample_metadata(records, payload.sample_metadata)
    summary.update(context)
    summary["exclusion_reasons"] = payload.exclusion_reasons
    summary["analysis_id"] = str(uuid.uuid4())
    summary["created_at"] = utc_now()
    summary_json = serialize_json(summary)
    with get_db() as conn:
        conn.execute("INSERT INTO analysis_versions VALUES (?, ?, ?, ?, ?)",
                     (summary["analysis_id"], experiment_id, summary["created_at"], serialize_json(payload.model_dump()), summary_json))
        conn.execute(
            "UPDATE experiments SET analysis_result = ?, status = 'analyzed' WHERE project_id = ? AND id = ?",
            (summary_json, project_id, experiment_id),
        )
    return summary


@app.patch("/api/projects/{project_id}/experiments/{experiment_id}/sample-metadata")
def update_sample_metadata(project_id: str, experiment_id: str, payload: dict[str, SampleAnnotation]) -> dict[str, Any]:
    experiment = get_experiment(project_id, experiment_id)
    names = {r["sample"] for r in experiment["raw_records"]}
    if set(payload) - names:
        raise HTTPException(status_code=422, detail="Sample annotations include unknown sample names.")
    metadata = experiment["metadata"]
    metadata["context_revision"] = metadata.get("context_revision",0)+1
    metadata["sample_metadata"] = {**metadata.get("sample_metadata", {}), **{k: v.model_dump() for k, v in payload.items()}}
    with get_db() as conn:
        conn.execute("UPDATE experiments SET metadata = ? WHERE id = ? AND project_id = ?", (serialize_json(metadata), experiment_id, project_id))
    return resolved_sample_metadata(experiment["raw_records"], metadata["sample_metadata"])


@app.post("/api/projects/{project_id}/experiments/{experiment_id}/analyze-batch")
def analyze_batch(project_id: str, experiment_id: str, payload: BatchAnalysisRequest) -> dict[str, Any]:
    experiment = get_experiment(project_id, experiment_id)
    context = analysis_context(experiment, payload)
    targets = list(dict.fromkeys(payload.target_assays))
    if set(targets).intersection(payload.reference_assays):
        raise HTTPException(status_code=422, detail="Batch targets cannot also be reference assays.")
    if any(not payload.exclusion_reasons.get(sample, "").strip() for sample in payload.excluded_samples):
        raise HTTPException(status_code=422, detail="Every excluded biological sample needs a reason.")
    records = experiment["raw_records"]
    summaries, failures = [], []
    for target in targets:
        try:
            summary = summarize_results(records, target_assay=target, reference_assays=payload.reference_assays,
                baseline_sample=payload.baseline_sample, baseline_samples=payload.baseline_samples, run_id=payload.run_id,
                sample_groups=payload.sample_groups, excluded_samples=payload.excluded_samples,
                technical_control_samples=payload.technical_control_samples, excluded_measurements=context["excluded_measurements"], hit_threshold=payload.hit_threshold,
                statistics_method=payload.statistics_method, assumptions_confirmed=payload.assumptions_confirmed,
                sample_metadata=run_sample_metadata(records, context["sample_instances"], payload.run_id))
            summaries.append(summary)
        except ValueError as error:
            failures.append({"target_assay": target, "reason": str(error)})
    if not summaries:
        raise HTTPException(status_code=422, detail="No target could be normalized. " + "; ".join(f"{f['target_assay']}: {f['reason']}" for f in failures))
    # All target-versus-control contrasts in this batch form one declared family.
    planned_per_failed_target = max((len(r["statistics"]["comparisons"]) for r in summaries), default=0)
    contrasts = [c for r in summaries for c in r["statistics"]["comparisons"]]
    pvalues = [c["p_value"] if c["status"] == "tested" else 1.0 for c in contrasts]
    pvalues += [1.0] * (planned_per_failed_target * len(failures))
    adjusted = holm(pvalues)
    for contrast, adjusted_p in zip(contrasts, adjusted):
        if contrast["status"] == "tested":
            contrast["adjusted_p_value"] = adjusted_p
    batch_id = str(uuid.uuid4())
    annotations = resolved_sample_metadata(records, payload.sample_metadata or experiment["sample_metadata"])
    with get_db() as conn:
        for summary in summaries:
            summary.update(context)
            summary.update(analysis_id=str(uuid.uuid4()), created_at=utc_now(), batch_id=batch_id,
                batch_errors=failures, exclusion_reasons=payload.exclusion_reasons,
                sample_metadata=annotations)
            statistics = summary["statistics"]
            statistics["family"] = "All target-assay / condition contrasts in this batch versus the selected baseline samples (one run)"
            statistics["batch_planned_comparison_count"] = len(pvalues)
            statistics["adjustment"] = "Holm across all targets in this batch"
            settings = payload.model_dump()
            settings["target_assay"] = summary["target_assay"]
            conn.execute("INSERT INTO analysis_versions VALUES (?, ?, ?, ?, ?)", (summary["analysis_id"], experiment_id,
                summary["created_at"], serialize_json(settings), serialize_json(summary)))
        conn.execute("UPDATE experiments SET analysis_result = ?, status = 'analyzed' WHERE id = ? AND project_id = ?",
                     (serialize_json(summaries[-1]), experiment_id, project_id))
    return {"batch_id": batch_id, "results": summaries, "errors": failures}


def save_experiment_metadata(project_id: str, experiment_id: str, metadata: dict[str, Any]) -> None:
    with get_db() as conn:
        conn.execute("UPDATE experiments SET metadata = ? WHERE id = ? AND project_id = ?", (serialize_json(metadata),experiment_id,project_id))


@app.patch("/api/projects/{project_id}/experiments/{experiment_id}/sample-instances")
def update_sample_instances(project_id: str, experiment_id: str, payload: dict[str, SampleAnnotation]) -> dict[str, Any]:
    experiment=get_experiment(project_id,experiment_id)
    if set(payload)-set(experiment['sample_instances']):
        raise HTTPException(status_code=422,detail="Unknown run/sample instance.")
    for key,value in payload.items():
        role=value.role or experiment['sample_instances'][key].get('role','biological')
        if role=='biological' and (not value.condition.strip() or not value.series.strip()):
            raise HTTPException(status_code=422,detail='Biological sample instances require a condition and series label.')
    metadata=experiment['metadata']
    metadata['sample_instances']={**metadata.get('sample_instances',{}),**{k:v.model_dump() for k,v in payload.items()}}
    metadata['context_revision']=metadata.get('context_revision',0)+1
    metadata.setdefault('audit_events',[]).append({'at':utc_now(),'action':'sample_instances_updated','instances':list(payload),'before':{k:experiment['sample_instances'][k] for k in payload},'after':{k:v.model_dump() for k,v in payload.items()}})
    save_experiment_metadata(project_id,experiment_id,metadata)
    return get_experiment(project_id,experiment_id)


class PlateLayoutRequest(BaseModel):
    run_id: str
    plate: str | None = None
    # Well address -> sample name; an empty name restores the name in the instrument export.
    wells: dict[str, str] = Field(default_factory=dict, max_length=384)
    # Names on this plate whose many wells the scientist confirms are technical replicates of one sample.
    confirm_replicates: list[str] = Field(default_factory=list, max_length=384)
    # Names whose confirmation is withdrawn.
    revoke_replicates: list[str] = Field(default_factory=list, max_length=384)


def _layout_update(records: list[dict[str, Any]], metadata: dict[str, Any], payload: PlateLayoutRequest) -> tuple[list[dict[str, Any]], dict[str, Any]] | None:
    updated, change = apply_layout(records, payload.run_id, payload.plate, payload.wells, _role_checker(records, metadata))
    plate = payload.plate or None
    on_plate = {r["sample"] for r in updated if r.get("run_id") == payload.run_id and r.get("plate") == plate}
    unknown = sorted((set(payload.confirm_replicates) | set(payload.revoke_replicates)) - on_plate)
    if unknown:
        raise ValueError(f"Sample(s) {', '.join(unknown)} are not on this plate.")
    previous = [c for c in metadata.get("layout_confirmations", []) if isinstance(c, dict)]
    replaced = {(payload.run_id, plate, sample) for sample in [*payload.confirm_replicates, *payload.revoke_replicates]}
    confirmations = [*(c for c in previous if (c.get("run_id"), c.get("plate"), c.get("sample")) not in replaced),
                     *(confirmation(updated, payload.run_id, plate, sample) for sample in payload.confirm_replicates)]
    if not change["wells"] and confirmations == previous:
        return None
    decisions = metadata.get("qc_decisions", {})
    # A reviewed QC finding described particular wells; once a rename changes them, it needs review again.
    reviews = reopened_reviews(decisions, records, updated)
    event = {"at": utc_now(), "action": "plate_layout_updated", "run_id": payload.run_id, "plate": plate, **change,
             "confirmed_replicates": sorted(payload.confirm_replicates), "revoked_replicates": sorted(payload.revoke_replicates),
             "reopened_reviews": len(decisions) - len(reviews)}
    return updated, {**metadata, "layout_confirmations": confirmations, "qc_decisions": reviews,
                     "context_revision": metadata.get("context_revision", 0) + 1, "audit_events": [*metadata.get("audit_events", []), event]}


@app.put("/api/projects/{project_id}/experiments/{experiment_id}/plate-layout")
def update_plate_layout(project_id: str, experiment_id: str, payload: PlateLayoutRequest) -> dict[str, Any]:
    """Name the samples in a plate's wells, or confirm that one name covers technical replicates."""
    get_experiment(project_id, experiment_id)
    try:
        with get_db() as conn:
            # Read and write in one transaction, so reviews saved meanwhile are kept.
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute("SELECT raw_records, metadata FROM experiments WHERE project_id = ? AND id = ?",
                               (project_id, experiment_id)).fetchone()
            if row is None:
                raise ValueError("This experiment no longer exists.")
            update = _layout_update(read_json_column(row["raw_records"]) or [], read_json_column(row["metadata"]) or {}, payload)
            if update is not None:
                conn.execute("UPDATE experiments SET raw_records = ?, metadata = ? WHERE id = ? AND project_id = ?",
                             (serialize_json(update[0]), serialize_json(update[1]), experiment_id, project_id))
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return get_experiment(project_id, experiment_id)


class NumberSamplesRequest(BaseModel):
    # The revision the scientist saw the suggestion at; a different one means the suggestion may have changed.
    expected_revision: int | None = None


def _change_numbering(project_id: str, experiment_id: str, change: Callable[..., tuple[list[dict[str, Any]], dict[str, Any]]],
                      expected_revision: int | None = None) -> dict[str, Any]:
    """Read, change and write the records and metadata in one transaction, so reviews saved meanwhile are kept."""
    get_experiment(project_id, experiment_id)
    try:
        with get_db() as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute("SELECT raw_records, metadata FROM experiments WHERE project_id = ? AND id = ?",
                               (project_id, experiment_id)).fetchone()
            if row is None:
                raise ValueError("This experiment no longer exists.")
            records, metadata = read_json_column(row["raw_records"]) or [], read_json_column(row["metadata"]) or {}
            if expected_revision is not None and expected_revision != metadata.get("context_revision", 0):
                raise LookupError("The experiment changed since this suggestion was shown. Check the new suggestion, then try again.")
            is_control = _annotated_control(instances(records, metadata.get("sample_metadata", {}), metadata.get("sample_instances", {})))
            updated, changed = change(records, metadata, is_control, utc_now())
            conn.execute("UPDATE experiments SET raw_records = ?, metadata = ? WHERE id = ? AND project_id = ?",
                         (serialize_json(updated), serialize_json(changed), experiment_id, project_id))
    except LookupError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return get_experiment(project_id, experiment_id)


@app.post("/api/projects/{project_id}/experiments/{experiment_id}/number-samples")
def number_samples(project_id: str, experiment_id: str, payload: NumberSamplesRequest | None = None) -> dict[str, Any]:
    """Apply the workbench's numbering, as shown in layout_suggestions, to every plate that still has no sample names."""
    def number(records, metadata, is_control, now):
        suggestions = suggest_layouts(records, is_control, metadata.get("layout_confirmations", []))
        if not suggestions:
            raise LookupError("Every plate already has sample names. Change them under Plate layout.")
        try:
            return apply_suggestions(records, metadata, suggestions, is_control, now)
        except ValueError as error:
            raise ValueError(numbering_problem(error, suggestions)) from error
    return _change_numbering(project_id, experiment_id, number, payload.expected_revision if payload else None)


@app.delete("/api/projects/{project_id}/experiments/{experiment_id}/number-samples")
def unnumber_samples(project_id: str, experiment_id: str) -> dict[str, Any]:
    """Give wells that still carry the workbench's numbers their names from the export again."""
    return _change_numbering(project_id, experiment_id, undo_numbering)


@app.patch("/api/projects/{project_id}/experiments/{experiment_id}")
def rename_experiment(project_id: str, experiment_id: str, payload: ExperimentRename) -> dict[str, Any]:
    """Display name only: the original filename, raw data and saved results are unchanged."""
    name=" ".join(_HIDDEN_NAME_CHARACTERS.sub("",payload.name).split())
    if not name:
        raise HTTPException(status_code=422,detail="Enter a name for this experiment.")
    if len(name)>EXPERIMENT_NAME_MAX:
        raise HTTPException(status_code=422,detail=f"Use at most {EXPERIMENT_NAME_MAX} characters for the experiment name.")
    experiment=get_experiment(project_id,experiment_id)
    if name==experiment['name']:
        return experiment
    metadata=experiment['metadata']
    metadata.setdefault('audit_events',[]).append({'at':utc_now(),'action':'renamed','previous':experiment['name'],'name':name})
    with get_db() as conn:
        conn.execute("UPDATE experiments SET name = ?, metadata = ? WHERE id = ? AND project_id = ?",(name,serialize_json(metadata),experiment_id,project_id))
    return get_experiment(project_id,experiment_id)


def _analysis_type_update(records: list[dict[str, Any]], metadata: dict[str, Any], payload: AnalysisTypeRequest) -> dict[str, Any] | None:
    """New metadata recording the experiment type and compared genes, or None when nothing changes."""
    genes = payload.stability_genes
    if genes is not None:
        measured = set(measured_assays(records, _role_checker(records, metadata)))
        unknown = next((gene for gene in genes if gene not in measured), None)
        if unknown is not None:
            raise ValueError(f"“{unknown[:80]}” is not a gene measured in a sample of this experiment.")
        repeated = next((gene for gene in genes if genes.count(gene) > 1), None)
        if repeated is not None:
            raise ValueError(f"“{repeated[:80]}” is listed twice. Choose each gene once.")
    after = {"type": payload.type, "stability_genes": None if genes is None else list(genes)}
    before = metadata.get("analysis_type")
    if before == after:
        return None
    event = {"at": utc_now(), "action": "analysis_type_set", "before": before, "after": after}
    return {**metadata, "analysis_type": after, "audit_events": [*metadata.get("audit_events", []), event]}


@app.put("/api/projects/{project_id}/experiments/{experiment_id}/analysis-type")
def set_analysis_type(project_id: str, experiment_id: str, payload: AnalysisTypeRequest) -> dict[str, Any]:
    """Record what the experiment measures. Raw data, annotations and saved results are unchanged."""
    get_experiment(project_id, experiment_id)
    try:
        with get_db() as conn:
            # Read and write in one transaction, so layout and QC changes saved meanwhile are kept.
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute("SELECT raw_records, metadata FROM experiments WHERE project_id = ? AND id = ?",
                               (project_id, experiment_id)).fetchone()
            if row is None:
                raise ValueError("This experiment no longer exists.")
            metadata = _analysis_type_update(read_json_column(row["raw_records"]) or [], read_json_column(row["metadata"]) or {}, payload)
            if metadata is not None:
                conn.execute("UPDATE experiments SET metadata = ? WHERE id = ? AND project_id = ?",
                             (serialize_json(metadata), experiment_id, project_id))
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return get_experiment(project_id, experiment_id)


@app.patch("/api/projects/{project_id}/experiments/{experiment_id}/design")
def update_experiment_design(project_id: str, experiment_id: str, payload: ExperimentDesign) -> dict[str, Any]:
    experiment=get_experiment(project_id,experiment_id)
    if payload.confirmed and (not payload.time_origin.strip() or not payload.experimental_unit.strip() or payload.design_type=='unknown'):
        raise HTTPException(status_code=422,detail="Confirm the time origin, experimental unit and design type before marking the design confirmed.")
    metadata=experiment['metadata'];metadata['experiment_design']=payload.model_dump()
    metadata['context_revision']=metadata.get('context_revision',0)+1
    metadata.setdefault('audit_events',[]).append({'at':utc_now(),'action':'design_updated','design':payload.model_dump()})
    save_experiment_metadata(project_id,experiment_id,metadata)
    return get_experiment(project_id,experiment_id)


@app.patch("/api/projects/{project_id}/experiments/{experiment_id}/quality-review")
def update_quality_review(project_id: str, experiment_id: str, payload: QualityReviewRequest) -> dict[str, Any]:
    experiment=get_experiment(project_id,experiment_id);metadata=experiment['metadata']
    known_flags={f['id'] for f in experiment['quality']['flags']}
    if set(payload.decisions)-known_flags or any(not d.reason.strip() for d in payload.decisions.values()):
        raise HTTPException(status_code=422,detail="Each reviewed flag needs its current identity and a nonempty review note.")
    known_measurements={r['measurement_id'] for r in experiment['raw_records']}
    if payload.measurement_exclusions is not None:
        if set(payload.measurement_exclusions)-known_measurements or any(not v.strip() for v in payload.measurement_exclusions.values()):
            raise HTTPException(status_code=422,detail="Every excluded well needs a valid identity and reason.")
        if payload.measurement_exclusions != metadata.get('measurement_exclusions',{}):
            if not payload.note.strip(): raise HTTPException(status_code=422,detail="Describe why well exclusions were changed or restored.")
            metadata.setdefault('audit_events',[]).append({'at':utc_now(),'action':'well_exclusions_updated','before':metadata.get('measurement_exclusions',{}),'after':payload.measurement_exclusions,'reason':payload.note})
            metadata['measurement_exclusions']=payload.measurement_exclusions
            metadata['context_revision']=metadata.get('context_revision',0)+1
    if payload.spread_threshold is not None: metadata['spread_threshold']=payload.spread_threshold
    reviews=metadata.setdefault('qc_decisions',{})
    for key,value in payload.decisions.items():
        reviews[key]={'reason':value.reason,'at':utc_now()}
        metadata.setdefault('audit_events',[]).append({'at':utc_now(),'action':'qc_flag_reviewed','flag_id':key,'reason':value.reason})
    save_experiment_metadata(project_id,experiment_id,metadata)
    return get_experiment(project_id,experiment_id)


class WellPreviewRequest(BaseModel):
    run_id: str
    target_assay: str
    measurement_exclusions: dict[str,str]


@app.post("/api/projects/{project_id}/experiments/{experiment_id}/preview-well-exclusions")
def preview_well_exclusions(project_id:str,experiment_id:str,payload:WellPreviewRequest)->dict[str,Any]:
    experiment=get_experiment(project_id,experiment_id)
    with get_db() as conn:
        versions=conn.execute("SELECT request_json,result_json FROM analysis_versions WHERE experiment_id=? ORDER BY created_at DESC",(experiment_id,)).fetchall()
    settings=None;current=[]
    for row in versions:
        request=read_json_column(row['request_json']);result=read_json_column(row['result_json'])
        if request.get('run_id')==payload.run_id:
            if settings is None:settings=request
            if result.get('target_assay')==payload.target_assay:
                current=result.get('samples',[]);break
    if settings is None:raise HTTPException(status_code=422,detail="Configure and save an analysis for this run before previewing well exclusions.")
    settings.update(target_assay=payload.target_assay,excluded_measurements=payload.measurement_exclusions,
      instance_metadata=experiment['sample_instances'],experiment_design=experiment['experiment_design'],statistics_method='descriptive',assumptions_confirmed=False,technical_control_samples=None)
    request=AnalysisRequest(**settings);context=analysis_context(experiment,request,allow_draft=True)
    try:
        result=summarize_results(experiment['raw_records'],target_assay=request.target_assay,reference_assays=request.reference_assays,
          baseline_sample=request.baseline_sample,baseline_samples=request.baseline_samples,run_id=request.run_id,sample_groups=request.sample_groups,
          excluded_samples=request.excluded_samples,technical_control_samples=request.technical_control_samples,excluded_measurements=context['excluded_measurements'],hit_threshold=request.hit_threshold,
          sample_metadata=run_sample_metadata(experiment['raw_records'],context['sample_instances'],request.run_id))
    except ValueError as error:raise HTTPException(status_code=422,detail=str(error)) from error
    return {'current':current,'preview':result,'saved':False,'note':'Descriptive normalization preview only; no statistical inference or saved analysis is changed.'}


@app.post("/api/projects/{project_id}/experiments/{experiment_id}/rebuild")
def rebuild_saved_analyses(project_id: str, experiment_id: str) -> dict[str, Any]:
    experiment=get_experiment(project_id,experiment_id)
    with get_db() as conn:
        versions=conn.execute("SELECT request_json FROM analysis_versions WHERE experiment_id=? ORDER BY created_at DESC",(experiment_id,)).fetchall()
    profiles={}
    for row in versions:
        settings=read_json_column(row['request_json'])
        if settings.get('run_id'):profiles.setdefault(settings['run_id'],settings)
    results=[];errors=[]
    for run,settings in profiles.items():
        run_records=[r for r in experiment['raw_records'] if r['run_id']==run]
        renamed=sorted({*settings.get('baseline_samples',[]),*settings.get('excluded_samples',[])}-{r['sample'] for r in run_records})
        if renamed:
            errors.append({'run_id':run,'reason':f"Sample(s) {', '.join(renamed[:3])}{' …' if len(renamed)>3 else ''} in the saved baseline or exclusions were renamed in the plate layout. Choose the baseline and exclusions again in Normalization, then calculate."})
            continue
        targets=sorted(set(analysable_assays(run_records,_annotated_control(experiment['sample_instances'])))-set(settings['reference_assays']))
        groups={}
        for r in run_records:
            key=r['sample_instance_id'];current=experiment['sample_instances'][key]
            if current.get('role')=='technical_control':continue
            previous=settings.get('instance_metadata',{}).get(key)
            changed=any(previous.get(k)!=current.get(k) for k in ['condition','series','timepoint','time_unit']) if previous else key in experiment['metadata'].get('sample_instances',{})
            groups[r['sample']]=analysis_group(current) if changed or r['sample'] not in settings.get('sample_groups',{}) else settings['sample_groups'][r['sample']]
        settings.update(target_assays=targets,sample_groups=groups,instance_metadata=experiment['sample_instances'],sample_metadata={},
          experiment_design=experiment['experiment_design'],excluded_measurements=experiment['measurement_exclusions'],technical_control_samples=None)
        try:
            batch=analyze_batch(project_id,experiment_id,BatchAnalysisRequest(**settings));results.extend(batch['results']);errors.extend([{**e,'run_id':run} for e in batch['errors']])
        except HTTPException as error:errors.append({'run_id':run,'reason':str(error.detail)})
    return {'results':results,'errors':errors,'runs_rebuilt':len({r['run_id'] for r in results})}


@app.get("/api/projects/{project_id}/experiments/{experiment_id}/analyses")
def list_analysis_versions(project_id: str, experiment_id: str) -> list[dict[str, Any]]:
    get_experiment(project_id, experiment_id)
    with get_db() as conn:
        rows = conn.execute("SELECT id, created_at, request_json, result_json FROM analysis_versions WHERE experiment_id = ? ORDER BY created_at DESC", (experiment_id,)).fetchall()
    return [{"id": row["id"], "created_at": row["created_at"], "settings": read_json_column(row["request_json"]),
             "result": read_json_column(row["result_json"])} for row in rows]


@app.get("/api/projects/{project_id}/experiments/{experiment_id}/analyses/{analysis_id}/export.json")
def export_analysis_version(project_id: str, experiment_id: str, analysis_id: str) -> StreamingResponse:
    get_experiment(project_id, experiment_id)
    with get_db() as conn:
        row = conn.execute("SELECT request_json, result_json FROM analysis_versions WHERE id = ? AND experiment_id = ?", (analysis_id, experiment_id)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Analysis version not found")
    output = serialize_json({"settings": read_json_column(row["request_json"]), "result": read_json_column(row["result_json"])}).encode("utf-8")
    return StreamingResponse(iter([output]), media_type="application/json", headers={"Content-Disposition": 'attachment; filename="qpcr-analysis.json"'})


@app.get("/api/projects/{project_id}/experiments/{experiment_id}/export.csv")
def export_csv(project_id: str, experiment_id: str) -> StreamingResponse:
    with get_db() as conn:
        row = conn.execute(
            "SELECT analysis_result, name FROM experiments WHERE project_id = ? AND id = ?",
            (project_id, experiment_id),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Experiment not found")

    result = read_json_column(row["analysis_result"])
    output = StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "run_id",
        "sample",
        "target_assay",
        "reference_assays",
        "target_ct_values",
        "target_ct_mean",
        "reference_ct_values",
        "reference_ct_means",
        "reference_ct_mean",
        "delta_ct",
        "baseline_sample",
        "baseline_delta_ct",
        "delta_delta_ct",
        "fold_change",
        "log2fc",
        "result_status",
        "target_wells_detected",
        "target_wells_total",
    ])
    for sample in result.get("samples", []):
        writer.writerow([
            sample.get("run_id"),
            sample.get("sample"),
            sample.get("target_assay"),
            "; ".join(sample.get("reference_assays", [])),
            "; ".join(str(value) for value in sample.get("target_ct_values", [])),
            sample.get("target_ct_mean"),
            json.dumps(sample.get("reference_ct_values", {}), sort_keys=True),
            json.dumps(sample.get("reference_ct_means", {}), sort_keys=True),
            sample.get("reference_ct_mean"),
            sample.get("delta_ct"),
            sample.get("baseline_sample"),
            sample.get("baseline_delta_ct"),
            sample.get("delta_delta_ct"),
            sample.get("fold_change"),
            sample.get("log2fc"),
            sample.get("result_status"),
            (sample.get("target_wells") or {}).get("detected"),
            (sample.get("target_wells") or {}).get("total"),
        ])
    contents = output.getvalue().encode("utf-8")
    return StreamingResponse(iter([contents]), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{row["name"]}.csv"'})


@app.get("/api/projects/{project_id}/experiments/{experiment_id}/export.svg")
def export_svg(project_id: str, experiment_id: str) -> StreamingResponse:
    with get_db() as conn:
        row = conn.execute(
            "SELECT analysis_result, name FROM experiments WHERE project_id = ? AND id = ?",
            (project_id, experiment_id),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Experiment not found")

    result = read_json_column(row["analysis_result"])
    samples = result.get("samples", [])
    padding = 50
    width = max(800, padding * 2 + len(samples) * 80)
    height = 300
    bar_width = 48
    max_val = max((item.get("fold_change") or 0 for item in samples), default=1)
    max_val = max(max_val, 2)
    scale = (height - 2 * padding) / max_val
    baseline_y = height - padding - scale
    bars = []
    for index, item in enumerate(samples):
        value = item.get("fold_change")
        if value is None:
            continue
        x = padding + index * 80
        bar_height = abs(value - 1) * scale
        value_y = height - padding - value * scale
        y = min(value_y, baseline_y)
        label = escape(str(item.get("sample", "sample")))
        bars.append(f'<rect x="{x}" y="{y}" width="{bar_width}" height="{bar_height}" fill="#3b82f6" rx="4" />')
        bars.append(f'<text x="{x + bar_width / 2}" y="{height - padding + 18}" font-size="10" text-anchor="middle">{label[:10]}</text>')
        bars.append(f'<text x="{x + bar_width / 2}" y="{value_y - 8}" font-size="10" text-anchor="middle">{value:.2f}</text>')

    markup = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">
        <rect width="100%" height="100%" fill="white"/>
        <line x1="{padding}" y1="{height - padding}" x2="{width - padding}" y2="{height - padding}" stroke="#111827" stroke-width="1.5"/>
        <line x1="{padding}" y1="{padding}" x2="{padding}" y2="{height - padding}" stroke="#111827" stroke-width="1.5"/>
        <line x1="{padding}" y1="{baseline_y}" x2="{width - padding}" y2="{baseline_y}" stroke="#64748b" stroke-width="1" stroke-dasharray="4 4"/>
        <text x="{padding + 4}" y="{baseline_y - 5}" font-size="10" fill="#475569">1× baseline</text>
        {' '.join(bars)}
    </svg>'''
    return StreamingResponse(iter([markup.encode("utf-8")]), media_type="image/svg+xml", headers={"Content-Disposition": f'attachment; filename="{row["name"]}.svg"'})


@app.get("/api/projects/{project_id}/experiments/{experiment_id}/plate")
def get_plate(project_id: str, experiment_id: str) -> dict[str, Any]:
    with get_db() as conn:
        row = conn.execute(
            "SELECT raw_records, name FROM experiments WHERE project_id = ? AND id = ?",
            (project_id, experiment_id),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Experiment not found")
    records = read_json_column(row["raw_records"])
    plate_map: dict[str, list[dict[str, Any]]] = {}
    for item in records:
        key = str(item.get("well", "unknown")).upper()
        plate_map.setdefault(key, []).append({
            "sample": item.get("sample"),
            "assay": item.get("assay"),
            "ct": item.get("ct"),
            "status": item.get("status"),
        })
    return {"experiment": row["name"], "wells": plate_map}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("backend.app:app", host="0.0.0.0", port=8000, reload=True)

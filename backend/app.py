from __future__ import annotations

import csv
import hashlib
import json
import sqlite3
import uuid
from datetime import datetime, timezone
from io import StringIO
from pathlib import Path
from typing import Any
from xml.sax.saxutils import escape

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from backend.qpcr_engine import import_qpcr_file, summarize_results

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
UPLOAD_DIR = BASE_DIR / "uploads"
DB_PATH = DATA_DIR / "qpcr.db"

DATA_DIR.mkdir(exist_ok=True)
UPLOAD_DIR.mkdir(exist_ok=True)

app = FastAPI(title="qPCR Analysis Workbench", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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


class AnalysisRequest(BaseModel):
    target_assay: str
    reference_assays: list[str] = Field(min_length=1)
    baseline_sample: str = ""
    baseline_samples: list[str] = Field(default_factory=list)
    sample_groups: dict[str, str] = Field(default_factory=dict)
    excluded_samples: list[str] = Field(default_factory=list)
    exclusion_reasons: dict[str, str] = Field(default_factory=dict)
    hit_threshold: float = Field(default=1.5, gt=0, allow_inf_nan=False)
    statistics_method: str = "descriptive"
    assumptions_confirmed: bool = False
    run_id: str


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
    return {"status": "ok"}


@app.get("/api/projects")
def list_projects() -> list[dict[str, Any]]:
    with get_db() as conn:
        projects = conn.execute(
            "SELECT id, name, created_at, updated_at FROM projects ORDER BY created_at DESC"
        ).fetchall()
        rows: list[dict[str, Any]] = []
        for project in projects:
            experiments = conn.execute(
                "SELECT id, name, status, original_filename, created_at, parsed_summary, analysis_result FROM experiments WHERE project_id = ? ORDER BY created_at DESC",
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


@app.post("/api/projects/{project_id}/upload")
async def upload_experiment(project_id: str, file: UploadFile = File(...), name: str = Form("")) -> dict[str, Any]:
    with get_db() as conn:
        project = conn.execute("SELECT id FROM projects WHERE id = ?", (project_id,)).fetchone()
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")

    safe_name = (name or file.filename or "Imported qPCR experiment").strip() or "Imported qPCR experiment"
    stored_name = safe_name
    file_extension = Path(file.filename or "upload.csv").suffix
    unique_name = f"{uuid.uuid4()}{file_extension}"
    destination = UPLOAD_DIR / unique_name
    contents = await file.read()
    destination.write_bytes(contents)

    try:
        parsed = import_qpcr_file(str(destination))
    except (OSError, ValueError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    experiment_id = str(uuid.uuid4())
    now = utc_now()

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
                file.filename,
                str(destination),
                now,
                "uploaded",
                serialize_json(parsed["records"]),
                serialize_json(
                    {
                        "record_count": parsed["record_count"],
                        "warnings": parsed["warnings"],
                        "runs": parsed["runs"],
                    }
                ),
                serialize_json({}),
                serialize_json({"source": parsed["file_name"], "warnings": parsed["warnings"]}),
            ),
        )

    return {
        "id": experiment_id,
        "project_id": project_id,
        "name": stored_name,
        "original_filename": file.filename,
        "record_count": parsed["record_count"],
        "runs": parsed["runs"],
        "warnings": parsed["warnings"],
    }


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
    return {
        "id": row["id"],
        "name": row["name"],
        "status": row["status"],
        "original_filename": row["original_filename"],
        "created_at": row["created_at"],
        "raw_records": read_json_column(row["raw_records"]),
        "parsed_summary": read_json_column(row["parsed_summary"]),
        "analysis_result": read_json_column(row["analysis_result"]),
        "metadata": read_json_column(row["metadata"]),
    }


@app.post("/api/projects/{project_id}/experiments/{experiment_id}/analyze")
def analyze_experiment(
    project_id: str,
    experiment_id: str,
    payload: AnalysisRequest,
) -> dict[str, Any]:
    with get_db() as conn:
        row = conn.execute(
            "SELECT raw_records FROM experiments WHERE project_id = ? AND id = ?",
            (project_id, experiment_id),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Experiment not found")

    records = read_json_column(row["raw_records"])
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
            hit_threshold=payload.hit_threshold,
            statistics_method=payload.statistics_method,
            assumptions_confirmed=payload.assumptions_confirmed,
        )
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    summary["input_sha256"] = hashlib.sha256(row["raw_records"].encode("utf-8")).hexdigest()
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
    max_val = max(max_val, 1)
    scale = (height - 2 * padding) / max_val
    baseline_y = height - padding - scale
    bars = []
    for index, item in enumerate(samples):
        value = item.get("fold_change") or 0
        x = padding + index * 80
        bar_height = max(value * scale, 0)
        y = height - padding - bar_height
        label = escape(str(item.get("sample", "sample")))
        bars.append(f'<rect x="{x}" y="{y}" width="{bar_width}" height="{bar_height}" fill="#3b82f6" rx="4" />')
        bars.append(f'<text x="{x + bar_width / 2}" y="{height - padding + 18}" font-size="10" text-anchor="middle">{label[:10]}</text>')
        bars.append(f'<text x="{x + bar_width / 2}" y="{y - 8}" font-size="10" text-anchor="middle">{value:.2f}</text>')

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

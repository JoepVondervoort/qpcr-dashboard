"""Stable sample/measurement identities, conservative QC flags and analysis provenance."""
from __future__ import annotations
import hashlib
import json
from collections import defaultdict
from typing import Any
from .sample_metadata import infer_sample_metadata
from .sample_roles import is_technical_control


def sample_instance_id(run: str, sample: str) -> str:
    return json.dumps([run, sample], ensure_ascii=False, separators=(',', ':'))


def measurement_id(record: dict[str, Any]) -> str:
    return json.dumps([record.get('run_id',''), record.get('sheet',''), record.get('row_number',0), record.get('well',''), record.get('assay','')], ensure_ascii=False, separators=(',', ':'))


def instances(records, legacy=None, overrides=None):
    result = {}
    for row in records:
        name = str(row['sample']); key = sample_instance_id(str(row.get('run_id','')), name)
        inferred = {k: v for k, v in infer_sample_metadata(name).items() if k != 'name_check'}
        value = {**inferred, **(legacy or {}).get(name, {}), **(overrides or {}).get(key, {})}
        value.setdefault('biological_unit_id', '')
        value.setdefault('cell_line', None)
        value.setdefault('confluency', None)
        if value.get('role') is None: value['role'] = 'technical_control' if is_technical_control(name) else 'biological'
        result[key] = value
    return result


def name_checks(records, legacy=None, overrides=None) -> dict[str, str]:
    """Suggestions read from unusual sample names that nobody has saved yet; the scientist should confirm them."""
    checks = {}
    for row in records:
        name = str(row['sample']); key = sample_instance_id(str(row.get('run_id','')), name)
        if key in checks or key in (overrides or {}) or name in (legacy or {}):
            continue
        check = infer_sample_metadata(name).get('name_check')
        if check and not is_technical_control(name):
            checks[key] = check
    return checks


def canonical_hash(value) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, default=str, separators=(',', ':')).encode()).hexdigest()


def quality_flag_id(kind: str, run: str, sample: str, assay: str, plate: str | None = None) -> str:
    # Runs that were never combined keep the identity their saved review decisions use.
    return canonical_hash([kind, run, sample, assay] if plate is None else [kind, run, plate, sample, assay])


def assess_quality(records, exclusions=None, decisions=None, spread_threshold=1.0, roles=None):
    exclusions = exclusions or {}; decisions = decisions or {}; roles = roles or {}
    grouped = defaultdict(list)
    for row in records:
        # Plates combined into one run are reviewed separately: a control on one plate says nothing about another.
        grouped[(row.get('run_id',''),row.get('plate'),row['sample'],row['assay'])].append(row)
    flags=[]
    for (run,plate,sample,assay), rows in grouped.items():
        key=sample_instance_id(run,sample)
        technical = roles.get(key, 'technical_control' if is_technical_control(sample) else 'biological') == 'technical_control'
        # Control signals cannot be erased by excluding their wells from calculations.
        detected=[r for r in rows if r.get('ct') is not None and r.get('status','detected')=='detected' and not r.get('omit')]
        eligible=[r for r in detected if measurement_id(r) not in exclusions]
        kind = 'control_signal' if technical and detected else 'technical_spread' if not technical and len(eligible)>1 and max(r['ct'] for r in eligible)-min(r['ct'] for r in eligible)>spread_threshold else None
        if not kind: continue
        flag_id=quality_flag_id(kind,run,sample,assay,plate)
        review=decisions.get(flag_id)
        span=max((r['ct'] for r in eligible),default=0)-min((r['ct'] for r in eligible),default=0)
        flags.append({'id':flag_id,'kind':kind,'run_id':run,'plate':plate,'sample':sample,'sample_instance_id':key,'assay':assay,
          'message': f"Detected signal in technical control ({len(detected)}/{len(rows)} wells). Inspect instrument output and sample assignment; cause is not inferred." if technical else f"Technical Ct range {span:.3f} cycles exceeds review threshold {spread_threshold:g}.",
          'range':span if not technical else None,'status':'reviewed' if review else 'needs_review','review':review,
          'measurements':[{**r,'measurement_id':measurement_id(r),'excluded_reason':exclusions.get(measurement_id(r))} for r in rows]})
    flags.sort(key=lambda f:(f['status']!='needs_review',f['kind']!='control_signal',min((r['ct'] for r in f['measurements'] if r.get('ct') is not None),default=999) if f['kind']=='control_signal' else -(f['range'] or 0)))
    return {'flags':flags,'unresolved_count':sum(f['status']=='needs_review' for f in flags),'reviewed_count':sum(f['status']=='reviewed' for f in flags),
       'spread_threshold':spread_threshold,'policy':'Review flags only; no automatic well removal, diagnosis or contamination verdict.'}

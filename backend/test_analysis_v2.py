from __future__ import annotations

import asyncio
import importlib
import io
import json
import tempfile
from pathlib import Path
from statistics import mean

import pytest
from fastapi import HTTPException, UploadFile

from backend.qpcr_engine import import_qpcr_file, summarize_results
from backend.qpcr_engine.statistics import holm, normality


def records():
    rows = []
    for sample, delta in [('base.1', 2), ('base.2', 4), ('drug.1', 0), ('drug.2', 1), ('other.1', 5), ('other.2', 8)]:
        for ct in [20+delta-0.1, 20+delta+0.1]:
            rows.append(dict(sample=sample, assay='T', ct=ct, status='detected'))
        rows.append(dict(sample=sample, assay='R', ct=20, status='detected'))
    return rows


def calculate(rows=None, **kwargs):
    settings = dict(target_assay='T', reference_assays=['R'], baseline_samples=['base.1', 'base.2'],
                    sample_groups={s: s.rsplit('.', 1)[0] for s in ['base.1','base.2','drug.1','drug.2','other.1','other.2']})
    available = {r['sample'] for r in (rows if rows is not None else records())}
    settings['sample_groups'] = {s:g for s,g in settings['sample_groups'].items() if s in available}
    settings.update(kwargs)
    return summarize_results(rows if rows is not None else records(), **settings)


def test_baseline_group_and_biological_fold_summary():
    result = calculate()
    assert result['baseline_delta_ct'] == pytest.approx(3)
    samples = {r['sample']:r for r in result['samples']}
    assert samples['base.1']['fold_change'] == pytest.approx(2)
    assert samples['base.2']['fold_change'] == pytest.approx(0.5)
    drug = next(g for g in result['statistics']['groups'] if g['condition']=='drug')
    assert drug['n'] == 2
    assert drug['fold_change_mean'] == pytest.approx(6)
    assert drug['fold_change_sd'] == pytest.approx(2**0.5 * 2)
    assert drug['normality']['status'] == 'not_assessable'


def test_technical_well_duplication_does_not_increase_biological_n_or_change_inference():
    first = calculate(statistics_method='welch', assumptions_confirmed=True)
    duplicated = calculate(records()*5, statistics_method='welch', assumptions_confirmed=True)
    assert first['statistics'] == duplicated['statistics']
    comparisons = first['statistics']['comparisons']
    assert all(c['n']==2 and c['control_n']==2 for c in comparisons)
    assert all(c['adjusted_p_value']>=c['p_value'] for c in comparisons)
    assert comparisons[0]['delta_ct_difference'] == pytest.approx(-2.5)


def test_holm_known_values_and_order():
    assert holm([0.04, 0.01, 0.03]) == pytest.approx([0.06, 0.03, 0.06])


def test_small_constant_and_assessable_normality():
    assert normality([1,2])['p_value'] is None
    assert normality([1,1,1])['p_value'] is None
    assert 0 <= normality([1,2,3,4,5])['p_value'] <= 1


def test_welch_requires_confirmation():
    with pytest.raises(ValueError, match='Confirm'):
        calculate(statistics_method='welch')


def test_control_and_treatment_cannot_share_condition():
    with pytest.raises(ValueError, match='mixes'):
        calculate(sample_groups={'base.1':'mixed','drug.1':'mixed'})


def test_all_references_required_and_incomplete_baseline_rejected():
    rows = records() + [dict(sample='base.1', assay='R2', ct=21), dict(sample='base.2',assay='R2',ct=21)]
    result = calculate(rows, reference_assays=['R','R2'])
    assert next(r for r in result['samples'] if r['sample']=='drug.1')['fold_change'] is None
    with pytest.raises(ValueError, match='ALL'):
        calculate(rows, reference_assays=['R','R2'], baseline_samples=['drug.1'])


def test_nonfinite_measurements_are_not_used():
    result = calculate(records()+[dict(sample='drug.1', assay='T',ct=float('inf'))])
    assert next(r for r in result['samples'] if r['sample']=='drug.1')['target_ct_values'] == pytest.approx([19.9,20.1])


def test_exclusion_preserves_raw_and_cannot_exclude_baseline():
    rows = records()
    result = calculate(rows, excluded_samples=['drug.1'])
    assert len(rows)==18
    assert 'drug.1' not in [r['sample'] for r in result['samples']]
    with pytest.raises(ValueError, match='Baseline'):
        calculate(excluded_samples=['base.1'])


def test_zero_variance_comparison_not_tested():
    rows = [dict(sample=s, assay=a, ct=ct) for s in ['base.1','base.2','drug.1','drug.2'] for a,ct in [('T',22),('R',20)]]
    result = calculate(rows, statistics_method='welch', assumptions_confirmed=True)
    assert result['statistics']['comparisons'][0]['status']=='not_tested'
    assert result['statistics']['comparisons'][0]['p_value'] is None


def test_lad081_grouped_day_zero():
    path = Path(__file__).resolve().parents[1]/'Analysis LAD081_ qPCR_09042026_example.xlsx'
    if not path.exists():
        pytest.skip("Optional private LAD081 development workbook is not installed.")
    parsed = import_qpcr_file(str(path))
    for run in parsed['runs']:
        rows = [r for r in parsed['records'] if r['run_id']==run['id']]
        baselines = sorted({r['sample'] for r in rows if 'day 0.' in r['sample']})
        result = summarize_results(rows,'ACTA1',['GAPDH','c1orf43'],run_id=run['id'],baseline_samples=baselines,
                                   sample_groups={r['sample']:r['sample'].rsplit('.',1)[0] for r in rows if r['sample']!='H2O'})
        assert len(baselines)==2
        expected=[]
        for sample in baselines:
            values={a:[r['ct'] for r in rows if r['sample']==sample and r['assay']==a and r['ct'] is not None] for a in ['ACTA1','GAPDH','c1orf43']}
            expected.append(mean(values['ACTA1'])-(mean(values['GAPDH'])+mean(values['c1orf43']))/2)
        assert result['baseline_delta_ct']==pytest.approx(mean(expected))
        assert len(result['statistics']['groups'])==3
        assert all(g['n']==2 for g in result['statistics']['groups'])


def test_api_versions_and_legacy_migration(tmp_path, monkeypatch):
    api = importlib.import_module('backend.app')
    monkeypatch.setattr(api,'DB_PATH',tmp_path/'test.db')
    monkeypatch.setattr(api,'UPLOAD_DIR',tmp_path)
    api.init_db()
    project = api.create_project({'name':'test'})
    data = b'Well,Sample Name,Target Name,CT\nA1,base.1,T,22\nA2,base.1,R,20\nA3,base.2,T,24\nA4,base.2,R,20\nB1,drug.1,T,21\nB2,drug.1,R,20\nB3,drug.2,T,20\nB4,drug.2,R,20\n'
    with tempfile.SpooledTemporaryFile() as upload:
        upload.write(data)
        upload.seek(0)
        uploaded = asyncio.run(api.upload_experiment(project['id'],UploadFile(filename='test.csv',file=upload), 'test'))
    request = api.AnalysisRequest(target_assay='T',reference_assays=['R'],baseline_samples=['base.1','base.2'],run_id=uploaded['runs'][0]['id'],sample_groups={'base.1':'baseline','base.2':'baseline','drug.1':'drug','drug.2':'drug'})
    first=api.analyze_experiment(project['id'],uploaded['id'],request)
    second=api.analyze_experiment(project['id'],uploaded['id'],request.model_copy(update={'hit_threshold':2}))
    history=api.list_analysis_versions(project['id'],uploaded['id'])
    assert len(history)==2
    assert first['analysis_id']!=second['analysis_id']
    assert history[0]['result']['hit_threshold']==2
    assert history[1]['result']['hit_threshold']==1.5
    api.init_db()
    assert len(api.list_analysis_versions(project['id'],uploaded['id']))==2
    with pytest.raises(HTTPException) as error:
        api.list_analysis_versions('wrong-project',uploaded['id'])
    assert error.value.status_code==404
    with api.get_db() as conn:
        conn.execute("DELETE FROM analysis_versions")
        conn.execute("UPDATE experiments SET analysis_result=?",(json.dumps({'samples':[{'sample':'old'}]}),))
    api.init_db()
    assert len(api.list_analysis_versions(project['id'],uploaded['id']))==1


def test_unknown_assignment_rejected():
    with pytest.raises(ValueError, match='Unknown sample'):
        calculate(sample_groups={'typo':'treatment'})


def test_welch_contrast_matches_manual_standard_error_and_degrees_of_freedom():
    from math import sqrt
    from scipy.stats import t
    result = calculate(statistics_method='welch', assumptions_confirmed=True)
    comparison = result['statistics']['comparisons'][0]
    # Treatment Delta Ct [0, 1], baseline [2, 4]: sample variances 0.5 and 2.
    standard_error = sqrt(0.5/2 + 2/2)
    statistic = (0.5 - 3)/standard_error
    degrees = (0.5/2 + 2/2)**2 / ((0.5/2)**2 + (2/2)**2)
    assert comparison['statistic'] == pytest.approx(statistic)
    assert comparison['df'] == pytest.approx(degrees)
    assert comparison['p_value'] == pytest.approx(2*t.sf(abs(statistic), degrees))
    assert comparison['delta_ct_ci'] == pytest.approx([-2.5-t.ppf(.975,degrees)*standard_error, -2.5+t.ppf(.975,degrees)*standard_error])


def test_unestimable_comparisons_remain_in_holm_family():
    rows = records()
    rows = [r for r in rows if r['sample']!='other.2']
    result = calculate(rows, statistics_method='welch', assumptions_confirmed=True)
    comparisons = result['statistics']['comparisons']
    assert result['statistics']['planned_comparison_count']==2
    assert result['statistics']['tested_comparison_count']==1
    tested = next(c for c in comparisons if c['status']=='tested')
    assert tested['adjusted_p_value']==pytest.approx(min(1,2*tested['p_value']))

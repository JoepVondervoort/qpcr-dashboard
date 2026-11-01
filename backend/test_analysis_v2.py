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
    with pytest.raises(ValueError, match=r'drug\.1 have no detected, non-excluded value for reference assay\(s\) R2'):
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


def test_upload_rejects_empty_layout_without_saving_experiment(tmp_path, monkeypatch):
    api = importlib.import_module('backend.app')
    monkeypatch.setattr(api, 'DB_PATH', tmp_path/'test.db')
    monkeypatch.setattr(api, 'UPLOAD_DIR', tmp_path)
    api.init_db()
    project = api.create_project({'name':'empty-layout-test'})
    with tempfile.SpooledTemporaryFile() as upload:
        upload.write(b'Not,An,Instrument,Export\n1,2,3,4\n')
        upload.seek(0)
        with pytest.raises(HTTPException, match='No raw Ct/Cq') as error:
            asyncio.run(api.upload_experiment(project['id'], UploadFile(filename='empty.csv', file=upload), 'empty'))
    assert error.value.status_code == 422
    assert api.list_experiments(project['id']) == []
    assert not list(tmp_path.glob('*.csv'))


def test_synthetic_workbook_preserves_multiple_runs_and_ignores_derived_tabs(tmp_path):
    from openpyxl import Workbook
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = 'Instrument results'
    for run in ['run-one', 'run-two']:
        sheet.append(['Experiment Name', run])
        sheet.append(['Block Type', '384-Well'])
        sheet.append(['Well Position','Sample Name','Target Name','CT'])
        sheet.append(['A1', 'baseline.1', 'TARGET', 22])
        sheet.append(['A2', 'baseline.1', 'REF', 20])
        sheet.append([None])
    derived = workbook.create_sheet('Calculated results')
    derived.append(['Well Position','Sample Name','Target Name','CT'])
    derived.append(['A1', 'baseline.1', 'TARGET', 999])
    path = tmp_path/'synthetic.xlsx'
    workbook.save(path)
    parsed = import_qpcr_file(str(path))
    assert parsed['record_count'] == 4
    assert [r['name'] for r in parsed['runs']] == ['run-one', 'run-two']
    assert [r['record_count'] for r in parsed['runs']] == [2,2]
    assert {r['sheet'] for r in parsed['records']} == {'Instrument results'}
    assert all(r['ct'] != 999 for r in parsed['records'])


@pytest.mark.parametrize('name', ['H2O','h2o','H₂O','H 2 O','H20','H2O.1','H2O_2','H2O-control','water','Water 1','NTC','NTC-2','no-template control','No template','nuclease-free water','control H2O'])
def test_technical_control_names(name):
    from backend.qpcr_engine.sample_roles import is_technical_control
    assert is_technical_control(name)


@pytest.mark.parametrize('name', ['H2O2','water treatment','Waterloo','SCR.1','p21.1','saRNA-10.1','negative control','day 0.1'])
def test_biological_labels_not_silently_classified_as_technical(name):
    from backend.qpcr_engine.sample_roles import is_technical_control
    assert not is_technical_control(name)


def test_technical_controls_do_not_affect_normalization_groups_or_statistics():
    original = calculate(statistics_method='welch', assumptions_confirmed=True)
    rows = records()+[dict(sample='H₂O control', assay='T', ct=10),dict(sample='H₂O control', assay='R',ct=35)]
    groups = original['sample_groups'] | {'H₂O control':'water must not become a biological group'}
    result = calculate(rows, sample_groups=groups, statistics_method='welch', assumptions_confirmed=True)
    assert result['samples'] == original['samples']
    assert result['statistics'] == original['statistics']
    assert result['technical_control_samples'] == ['H₂O control']
    assert result['technical_control_measurement_count'] == 2
    assert 'H₂O control' not in result['sample_groups']
    with pytest.raises(ValueError, match='Technical controls'):
        calculate(rows,baseline_samples=['H₂O control'])
    override = calculate(rows,technical_control_samples=[])
    assert any(r['sample']=='H₂O control' for r in override['samples'])
    assert rows[-1]['sample']=='H₂O control'  # raw records stay intact


def test_sample_time_suggestions_preserve_series_without_asserting_pairing():
    from backend.qpcr_engine.sample_metadata import infer_sample_metadata
    first=infer_sample_metadata('LAD081_HDFn_confluency_100% day 0.1')
    later=infer_sample_metadata('LAD081_HDFn_confluency_100% day 21.2')
    assert first['series']==later['series']=='LAD081_HDFn_confluency_100%'
    assert first['timepoint']==0 and later['timepoint']==21
    assert first['replicate']=='1' and later['replicate']=='2'
    assert infer_sample_metadata('saRNA-10.2')['timepoint'] is None
    assert infer_sample_metadata('saRNA-10.2')['condition']=='saRNA-10'
    assert infer_sample_metadata('treatment hour 24.1')['time_unit']=='hour'


def prepare_batch_experiment(tmp_path, monkeypatch):
    import csv
    api=importlib.import_module('backend.app')
    monkeypatch.setattr(api,'DB_PATH',tmp_path/'test.db')
    monkeypatch.setattr(api,'UPLOAD_DIR',tmp_path)
    api.init_db()
    project=api.create_project({'name':'batch-fixture'})
    rows=records()
    for sample in {r['sample'] for r in rows}:
        target=next(r['ct'] for r in rows if r['sample']==sample and r['assay']=='T')
        rows.extend([dict(sample=sample,assay='T2',ct=target+1),dict(sample=sample,assay='UNDET',ct='Undetermined')])
    output=io.StringIO()
    writer=csv.writer(output)
    writer.writerow(['Well','Sample Name','Target Name','CT'])
    for i,row in enumerate(rows):writer.writerow([f'{chr(65+i//12)}{i%12+1}',row['sample'],row['assay'],row['ct']])
    with tempfile.SpooledTemporaryFile() as upload:
        upload.write(output.getvalue().encode());upload.seek(0)
        experiment=asyncio.run(api.upload_experiment(project['id'],UploadFile(filename='batch.csv',file=upload),'batch'))
    return api,project,experiment


def test_batch_saves_every_valid_target_and_corrects_across_all_targets(tmp_path, monkeypatch):
    api,project,experiment=prepare_batch_experiment(tmp_path,monkeypatch)
    payload=api.BatchAnalysisRequest(target_assays=['T','T2','UNDET'],reference_assays=['R'],baseline_samples=['base.1','base.2'],
        experiment_design=api.ExperimentDesign(time_origin='transfection',experimental_unit='independent culture well',design_type='independent',confirmed=True),run_id=experiment['runs'][0]['id'],sample_groups={s:s.rsplit('.',1)[0] for s in ['base.1','base.2','drug.1','drug.2','other.1','other.2']},statistics_method='welch',assumptions_confirmed=True)
    api.update_experiment_design(project['id'],experiment['id'],payload.experiment_design)
    result=api.analyze_batch(project['id'],experiment['id'],payload)
    assert len(result['results'])==2
    assert result['errors'][0]['target_assay']=='UNDET'
    assert len(api.list_analysis_versions(project['id'],experiment['id']))==2
    contrasts=[c for r in result['results'] for c in r['statistics']['comparisons']]
    # Two planned contrasts for each of three targets; failed target remains in family.
    expected=holm([c['p_value'] for c in contrasts]+[1,1])
    assert [c['adjusted_p_value'] for c in contrasts]==pytest.approx(expected[:4])
    assert all(r['statistics']['batch_planned_comparison_count']==6 for r in result['results'])
    assert all(r['batch_id']==result['batch_id'] for r in result['results'])
    assert all(r['batch_errors']==result['errors'] for r in result['results'])
    assert api.get_experiment(project['id'],experiment['id'])['analysis_result']['target_assay']=='T2'


def test_sample_mapping_is_editable_persistent_and_raw_data_unchanged(tmp_path, monkeypatch):
    api,project,experiment=prepare_batch_experiment(tmp_path,monkeypatch)
    before=api.get_experiment(project['id'],experiment['id'])
    annotations=api.update_sample_metadata(project['id'],experiment['id'],{'drug.1':api.SampleAnnotation(condition='candidate day 7',series='candidate',timepoint=7,time_unit='day',replicate='1')})
    after=api.get_experiment(project['id'],experiment['id'])
    assert after['sample_metadata']['drug.1']==annotations['drug.1']
    assert after['sample_metadata']['base.1']['replicate']=='1'
    assert after['raw_records']==before['raw_records']
    with pytest.raises(HTTPException):
        api.update_sample_metadata(project['id'],experiment['id'],{'unknown':api.SampleAnnotation(condition='x',series='x')})

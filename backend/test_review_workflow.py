from __future__ import annotations
import copy
import math
import json
import pytest
from fastapi import HTTPException
from backend.test_analysis_v2 import prepare_batch_experiment
from backend.qpcr_engine.review import sample_instance_id,measurement_id,assess_quality


def request(api,experiment,**changes):
    settings=dict(target_assay='T',reference_assays=['R'],baseline_samples=['base.1','base.2'],run_id=experiment['runs'][0]['id'],sample_groups={s:s.rsplit('.',1)[0] for s in ['base.1','base.2','drug.1','drug.2','other.1','other.2']})
    settings.update(changes)
    return api.AnalysisRequest(**settings)


def test_control_signal_cannot_be_hidden_by_excluding_its_measurement():
    rows=[dict(run_id='run',sample='H₂O',assay='T',ct=5.531,status='detected',well='A1',sheet='Sheet1',row_number=1)]
    key=measurement_id(rows[0])
    quality=assess_quality(rows,{key:'Reviewed instrument artifact'})
    assert quality['unresolved_count']==1
    assert quality['flags'][0]['kind']=='control_signal'
    reviewed=assess_quality(rows,{key:'Reviewed instrument artifact'},{quality['flags'][0]['id']:{'reason':'Instrument trace reviewed; follow-up recorded'}})
    assert reviewed['reviewed_count']==1 and reviewed['unresolved_count']==0
    assert reviewed['flags'][0]['measurements'][0]['excluded_reason']


def test_well_exclusion_preview_and_rebuild_preserve_raw_data_and_history(tmp_path,monkeypatch):
    api,project,experiment=prepare_batch_experiment(tmp_path,monkeypatch)
    original=api.analyze_experiment(project['id'],experiment['id'],request(api,experiment))
    detail=api.get_experiment(project['id'],experiment['id'])
    row=next(r for r in detail['raw_records'] if r['sample']=='drug.1' and r['assay']=='T')
    exclusions={row['measurement_id']:'Curve reviewed; exclusion documented'}
    preview=api.preview_well_exclusions(project['id'],experiment['id'],api.WellPreviewRequest(run_id=row['run_id'],target_assay='T',measurement_exclusions=exclusions))
    assert preview['saved'] is False
    assert len(api.list_analysis_versions(project['id'],experiment['id']))==1
    assert next(r for r in preview['preview']['samples'] if r['sample']=='drug.1')['target_ct_mean']!=next(r for r in original['samples'] if r['sample']=='drug.1')['target_ct_mean']
    with pytest.raises(HTTPException):api.update_quality_review(project['id'],experiment['id'],api.QualityReviewRequest(measurement_exclusions=exclusions))
    changed=api.update_quality_review(project['id'],experiment['id'],api.QualityReviewRequest(measurement_exclusions=exclusions,note='Review after checking source trace'))
    assert changed['context_revision']==original['context_revision']+1
    assert changed['raw_records']==detail['raw_records']
    assert changed['audit_events'][-1]['after']==exclusions
    rebuilt=api.rebuild_saved_analyses(project['id'],experiment['id'])
    assert rebuilt['runs_rebuilt']==1
    assert len(rebuilt['results'])==2
    assert all(r['context_revision']==changed['context_revision'] for r in rebuilt['results'])
    assert len({r['profile_id'] for r in rebuilt['results']})==1
    assert all(r['excluded_measurements']==exclusions for r in rebuilt['results'])
    old=next(v for v in api.list_analysis_versions(project['id'],experiment['id']) if v['id']==original['analysis_id'])
    assert old['result']==original
    restored=api.update_quality_review(project['id'],experiment['id'],api.QualityReviewRequest(measurement_exclusions={},note='Reinstated after independent review'))
    assert restored['context_revision']==changed['context_revision']+1
    assert restored['measurement_exclusions']=={}


def test_same_name_on_two_runs_has_independent_time_and_unit_identity(tmp_path,monkeypatch):
    api,project,experiment=prepare_batch_experiment(tmp_path,monkeypatch)
    first=api.get_experiment(project['id'],experiment['id'])
    records=[{k:v for k,v in r.items() if k not in ['measurement_id','sample_instance_id']} for r in first['raw_records']]
    second=[]
    for row in records:
        clone=copy.deepcopy(row);clone['run_id']='second-run';clone['run_name']='second-run';second.append(clone)
    with api.get_db() as conn:conn.execute('UPDATE experiments SET raw_records=? WHERE id=?',(json.dumps(records+second),experiment['id']))
    one=sample_instance_id(records[0]['run_id'],'base.1');two=sample_instance_id('second-run','base.1')
    updated=api.update_sample_instances(project['id'],experiment['id'],{two:api.SampleAnnotation(condition='baseline day 7',series='baseline',timepoint=7,biological_unit_id='material-B')})
    assert one!=two
    assert updated['sample_instances'][one]['timepoint'] is None
    assert updated['sample_instances'][two]['timepoint']==7
    assert updated['sample_instances'][one]['biological_unit_id']==''
    assert updated['sample_instances'][two]['biological_unit_id']=='material-B'
    assert len({r['measurement_id'] for r in updated['raw_records']})==len(updated['raw_records'])


@pytest.mark.parametrize('design',['unknown','paired','blocked','repeated'])
def test_unsupported_or_unconfirmed_design_never_runs_independent_inference(tmp_path,monkeypatch,design):
    api,project,experiment=prepare_batch_experiment(tmp_path,monkeypatch)
    data=api.ExperimentDesign(design_type=design,time_origin='transfection',experimental_unit='culture well',confirmed=design!='unknown')
    api.update_experiment_design(project['id'],experiment['id'],data)
    with pytest.raises(HTTPException) as error:api.analyze_experiment(project['id'],experiment['id'],request(api,experiment,statistics_method='welch',assumptions_confirmed=True))
    assert error.value.status_code==422
    descriptive=api.analyze_experiment(project['id'],experiment['id'],request(api,experiment))
    assert descriptive['statistics']['tested_comparison_count']==0


def test_confirmed_independent_design_supports_explicit_welch_test(tmp_path,monkeypatch):
    api,project,experiment=prepare_batch_experiment(tmp_path,monkeypatch)
    api.update_experiment_design(project['id'],experiment['id'],api.ExperimentDesign(design_type='independent',time_origin='transfection',experimental_unit='independently transfected culture well',confirmed=True))
    result=api.analyze_experiment(project['id'],experiment['id'],request(api,experiment,statistics_method='welch',assumptions_confirmed=True))
    assert result['statistics']['tested_comparison_count']==2
    assert result['experiment_design']['confirmed']
    assert result['profile_id']


def test_qc_acknowledgements_are_persistent_without_changing_calculation_revision(tmp_path,monkeypatch):
    api,project,experiment=prepare_batch_experiment(tmp_path,monkeypatch)
    flagged=api.update_quality_review(project['id'],experiment['id'],api.QualityReviewRequest(spread_threshold=.1))
    flag=flagged['quality']['flags'][0]
    updated=api.update_quality_review(project['id'],experiment['id'],api.QualityReviewRequest(decisions={flag['id']:api.ReviewDecision(reason='Curve inspected; retained with documented rationale')}))
    assert updated['context_revision']==flagged['context_revision']
    assert next(f for f in updated['quality']['flags'] if f['id']==flag['id'])['status']=='reviewed'
    assert updated['audit_events'][-1]['action']=='qc_flag_reviewed'
    with pytest.raises(HTTPException):api.update_quality_review(project['id'],experiment['id'],api.QualityReviewRequest(decisions={'unknown':api.ReviewDecision(reason='No')}))


def test_analysis_cannot_override_recorded_design_or_persist_unsaved_well_changes(tmp_path,monkeypatch):
    api,project,experiment=prepare_batch_experiment(tmp_path,monkeypatch)
    forged=api.ExperimentDesign(time_origin='transfection',experimental_unit='well',design_type='independent',confirmed=True)
    with pytest.raises(HTTPException) as error:api.analyze_experiment(project['id'],experiment['id'],request(api,experiment,experiment_design=forged))
    assert error.value.status_code==409
    detail=api.get_experiment(project['id'],experiment['id'])
    with pytest.raises(HTTPException):api.analyze_experiment(project['id'],experiment['id'],request(api,experiment,excluded_measurements={detail['raw_records'][0]['measurement_id']:'not yet saved'}))


def test_repeated_biological_unit_ids_are_not_independent_observations(tmp_path,monkeypatch):
    api,project,experiment=prepare_batch_experiment(tmp_path,monkeypatch)
    api.update_experiment_design(project['id'],experiment['id'],api.ExperimentDesign(time_origin='transfection',experimental_unit='donor',design_type='independent',confirmed=True))
    run=experiment['runs'][0]['id']
    api.update_sample_instances(project['id'],experiment['id'],{sample_instance_id(run,name):api.SampleAnnotation(condition='drug',series='drug',biological_unit_id='same-donor') for name in ['drug.1','drug.2']})
    with pytest.raises(HTTPException,match='biological-unit ID'):api.analyze_experiment(project['id'],experiment['id'],request(api,experiment,statistics_method='welch',assumptions_confirmed=True))


def test_rebuild_preserves_custom_groups_until_mapping_changes(tmp_path,monkeypatch):
    api,project,experiment=prepare_batch_experiment(tmp_path,monkeypatch)
    groups={s:s.rsplit('.',1)[0] for s in ['base.1','base.2','drug.1','drug.2','other.1','other.2']}
    groups['drug.1']=groups['drug.2']='Custom treatment label'
    api.analyze_experiment(project['id'],experiment['id'],request(api,experiment,sample_groups=groups))
    result=api.rebuild_saved_analyses(project['id'],experiment['id'])
    assert all(r['sample_groups']['drug.1']=='Custom treatment label' for r in result['results'])


def test_library_tracks_current_review_and_analysis_context(tmp_path, monkeypatch):
    api, project, experiment = prepare_batch_experiment(tmp_path, monkeypatch)
    def summary():
        return api.list_projects()[0]['experiments'][0]['library_summary']
    detail = api.get_experiment(project['id'], experiment['id'])
    original_records = detail['raw_records']
    first = summary()
    assert first['analysis_state'] == 'not_calculated'
    assert first['assay_count'] == len({r['assay'] for r in original_records})
    assert first['biological_sample_count'] == sum(a['role'] != 'technical_control' for a in detail['sample_instances'].values())
    assert first['unresolved_count'] == detail['quality']['unresolved_count']
    # Findings group flags with one likely cause (kind, run, sample), as the dashboard does.
    assert first['unresolved_findings'] == len({(f['kind'], f['run_id'], f['sample']) for f in detail['quality']['flags'] if f['status'] == 'needs_review'})
    assert first['unresolved_findings'] <= first['unresolved_count']
    api.analyze_experiment(project['id'], experiment['id'], request(api, experiment))
    assert summary()['analysis_state'] == 'partial'
    sample_id = next(k for k, a in detail['sample_instances'].items() if a['role'] == 'biological')
    api.update_sample_instances(project['id'], experiment['id'], {sample_id:api.SampleAnnotation(condition='updated condition', series='updated series')})
    assert summary()['analysis_state'] == 'needs_recalculation'
    assert summary()['outdated_result_count'] == 1
    api.rebuild_saved_analyses(project['id'], experiment['id'])
    # The fixture has an all-undetermined target; rebuilding cannot make it available.
    assert summary()['analysis_state'] == 'partial'
    assert summary()['outdated_result_count'] == 0
    assert summary()['saved_result_count'] == 2
    assert api.get_experiment(project['id'], experiment['id'])['raw_records'] == original_records


def test_library_lists_condition_results_per_gene_for_cross_experiment_views(tmp_path, monkeypatch):
    api, project, experiment = prepare_batch_experiment(tmp_path, monkeypatch)
    def results():
        return api.list_projects()[0]['experiments'][0]['library_summary']['gene_results']
    assert results() == []
    saved = api.analyze_experiment(project['id'], experiment['id'], request(api, experiment))
    rows = results()
    assert {row['assay'] for row in rows} == {'T'}
    assert {row['condition'] for row in rows} == {'base', 'drug', 'other'}
    baseline = next(row for row in rows if row['condition'] == 'base')
    drug = next(row for row in rows if row['condition'] == 'drug')
    assert baseline['is_baseline'] and not drug['is_baseline']
    expected = [r['fold_change'] for r in saved['samples'] if saved['sample_groups'].get(r['sample']) == 'drug']
    assert drug['n'] == len(expected) == 2
    # Geometric mean, 2^(mean log2 fold change), matching the default log2 figures.
    assert drug['fold_change'] == pytest.approx(math.prod(expected) ** (1 / len(expected)))
    # The baseline's mean ΔΔCt is zero by construction, so its geometric mean is exactly 1×.
    assert baseline['fold_change'] == pytest.approx(1.0)
    assert drug['run_id'] == experiment['runs'][0]['id'] and drug['run_name'] == experiment['runs'][0]['name']
    assert drug['out_of_date'] is False and 'series' in drug and 'timepoint' in drug
    sample_id = next(k for k, a in api.get_experiment(project['id'], experiment['id'])['sample_instances'].items() if a['role'] == 'biological')
    api.update_sample_instances(project['id'], experiment['id'], {sample_id: api.SampleAnnotation(condition='updated condition', series='updated series')})
    assert all(row['out_of_date'] for row in results())


def test_normal_probability_plot_uses_only_observed_biological_delta_ct():
    from backend.qpcr_engine.statistics import normality
    from scipy import stats
    values = [2.3, 1.1, 1.8, 1.5, 2.1, 1.3]
    diagnostic = normality(values)
    expected, fit = stats.probplot(values, dist='norm', fit=True)
    assert diagnostic['status'] == 'assessed'
    assert diagnostic['probability_plot']['observed'] == sorted(values)
    assert diagnostic['probability_plot']['theoretical'] == pytest.approx(expected[0])
    assert diagnostic['probability_plot']['slope'] == pytest.approx(fit[0])
    assert 'probability_plot' not in normality([1, 2])
    assert 'probability_plot' not in normality([2, 2, 2])

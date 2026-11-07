from openpyxl import Workbook

from backend.qpcr_engine.parser import import_qpcr_file
from backend.qpcr_engine.lab_tables import distinct_plates

HEADER = ('Well Position', 'Sample Name', 'Target Name', 'CT', 'ΔCt', 'Fold change')


def test_analyzed_workbook_imports_raw_measurements_once(tmp_path):
    book = Workbook()
    sheet = book.active
    sheet.title = 'Results'
    rows = [HEADER, ('A1', 'Control.1', 'GAPDH', 20.1234, 0, 1),
            ('A2', 'Control.1', 'TARGET', 25, 5, 0.5),
            ('A3', 'NTC', 'TARGET', 'Undetermined', None, None)]
    for row in rows:
        sheet.append(row)
    copy = book.create_sheet('Analysis copy')
    for row in rows:
        copy.append(row)
    path = tmp_path / 'analyzed.xlsx'
    book.save(path)
    result = import_qpcr_file(str(path))
    assert result['record_count'] == 3
    assert result['records'][0]['ct'] == 20.1234
    assert result['records'][2]['status'] == 'undetermined'
    assert result['source']['copies'] == [{'sheet': 'Analysis copy', 'same_as': 'Results'}]
    assert any('existing ΔCt, fold change' in note for note in result['warnings'])


def test_similar_plates_with_changed_measurements_are_not_discarded():
    rows = [HEADER, *[(f'A{i}', 'Sample', 'TARGET', 20+i/10, None, None) for i in range(1, 11)]]
    changed = [*rows[:-1], ('A10', 'Sample', 'TARGET', 21.001, None, None)]
    plates, copies = distinct_plates([('First', rows), ('Second', changed)])
    assert len(plates) == 2
    assert copies == []


def test_adjacent_dye_tables_share_sample_names(tmp_path):
    path = tmp_path / 'multiplex.csv'
    path.write_text('Well,Sample Name,Target Name,CT,Well,Target Name,CT\nA1,Control.1,TARGET,25,A1,GAPDH,20\n')
    result = import_qpcr_file(str(path))
    assert {(r['assay'], r['sample'], r['ct']) for r in result['records']} == {
        ('TARGET', 'Control.1', 25), ('GAPDH', 'Control.1', 20)}


def test_plan_without_results_explains_missing_data(tmp_path):
    path = tmp_path / 'plan.csv'
    path.write_text('Transfection,Seeding\nLipofectamine,Harvest\n')
    result = import_qpcr_file(str(path))
    assert result['record_count'] == 0
    assert 'a transfection plan' in result['warnings'][0]
    assert 'Ct or Cq column' in result['warnings'][0]


def test_upload_preserves_workbook_details_and_explains_plan(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    import backend.app as module

    monkeypatch.setattr(module, 'DB_PATH', tmp_path / 'test.db')
    monkeypatch.setattr(module, 'UPLOAD_DIR', tmp_path)
    module.init_db()
    client = TestClient(module.app)
    project = client.post('/api/projects', json={'name': 'Import checks'}).json()
    url = f"/api/projects/{project['id']}/upload"
    book = Workbook()
    for row in [HEADER, ('A1', 'Control.1', 'TARGET', 25, 5, 1)]:
        book.active.append(row)
    import io
    content = io.BytesIO()
    book.save(content)
    response = client.post(url, files={'file': ('analysis.xlsx', content.getvalue())})
    assert response.status_code == 200, response.text
    experiment = client.get(f"/api/projects/{project['id']}/experiments/{response.json()['id']}").json()
    assert any('existing ΔCt' in note for note in experiment['parsed_summary']['warnings'])
    assert experiment['metadata']['source_files'][0]['import_details']['kind'] == 'lab workbook'
    response = client.post(url, files={'file': ('plan.csv', b'Transfection,Seeding\nLipofectamine,Harvest\n')})
    assert response.status_code == 422
    assert 'a transfection plan' in response.json()['detail']
    assert 'not a workbook assembled by hand' not in response.json()['detail']

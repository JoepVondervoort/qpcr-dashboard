"""Optional browser regression: fresh workspace -> upload -> populated runs -> analysis.

Install playwright and its Chromium browser first. Uses temporary storage and ports;
never imports data into the user's real database. Defaults to a synthetic workbook.
"""
from __future__ import annotations

import argparse
import json
import os
import re
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

from openpyxl import Workbook
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.qpcr_engine import import_qpcr_file  # noqa: E402


def unused_port() -> int:
    with socket.socket() as connection:
        connection.bind(('127.0.0.1', 0))
        return connection.getsockname()[1]


def synthetic_workbook(path: Path) -> None:
    book = Workbook()
    sheet = book.active
    for run in ['screening-one', 'screening-two']:
        sheet.append(['Experiment Name', run])
        sheet.append(['Block Type', '384-Well'])
        sheet.append(['Well Position', 'Sample Name', 'Target Name', 'CT'])
        well = 1
        for day in [0, 21]:
            for replicate in [1, 2]:
                for assay in ['TARGET', 'GAPDH']:
                    for technical in range(2):
                        sheet.append([f'A{well}', f'Example day {day}.{replicate}', assay,
                                      20 + ((2 if day == 0 else 3) if assay == 'TARGET' else 0) + technical * (2.2 if assay=='TARGET' and day==21 and replicate==2 else .1)])
                        well += 1
        sheet.append(['A17', 'H₂O control', 'TARGET', 10])
        sheet.append(['A18', 'H₂O control', 'GAPDH', 30])
        sheet.append([None])
    book.save(path)


def wait_for_server(url: str, process: subprocess.Popen) -> None:
    for _ in range(150):
        if process.poll() is not None:
            raise RuntimeError(f'Server exited before becoming ready: {url}')
        try:
            urllib.request.urlopen(url, timeout=1).close()
            return
        except OSError:
            time.sleep(.1)
    raise RuntimeError(f'Server did not become ready: {url}')


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workbook', type=Path, help='Optional local LAD081 workbook; otherwise use synthetic data.')
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='qpcr-browser-') as temporary:
        data = Path(temporary)
        workbook = args.workbook.resolve() if args.workbook else data/'synthetic.xlsx'
        if not args.workbook:
            synthetic_workbook(workbook)
        parsed = import_qpcr_file(str(workbook))
        assert len(parsed['runs']) == 2, 'This regression expects two instrument runs.'
        target = 'ACTA1' if any(r['assay'] == 'ACTA1' for r in parsed['records']) else 'TARGET'
        backend_port, frontend_port = unused_port(), unused_port()
        client = data/'client'
        env = {**os.environ, 'VITE_API_ROOT': '', 'QPCR_BACKEND_URL': f'http://127.0.0.1:{backend_port}'}
        subprocess.run(['npm', 'run', 'build', '--', '--outDir', str(client)], cwd=ROOT/'frontend', env=env, check=True)
        processes = []
        try:
            backend = subprocess.Popen([sys.executable, '-m', 'uvicorn', 'backend.app:app', '--host', '127.0.0.1', '--port', str(backend_port), '--log-level', 'warning'], cwd=ROOT, env={**os.environ, 'QPCR_DATA_DIR': str(data/'store'), 'QPCR_UPLOAD_DIR': str(data/'uploads')})
            processes.append(backend)
            frontend = subprocess.Popen(['npm', 'run', 'preview', '--', '--host', '127.0.0.1', '--port', str(frontend_port), '--outDir', str(client)], cwd=ROOT/'frontend', env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            processes.append(frontend)
            wait_for_server(f'http://127.0.0.1:{backend_port}/api/health', backend)
            wait_for_server(f'http://127.0.0.1:{frontend_port}', frontend)
            with sync_playwright() as playwright:
                launch = {'headless': True}
                if os.environ.get('QPCR_TEST_CHROMIUM'):
                    launch['executable_path'] = os.environ['QPCR_TEST_CHROMIUM']
                browser = playwright.chromium.launch(**launch)
                page = browser.new_page(viewport={'width': 1440, 'height': 1000})
                errors = []
                page.on('pageerror', lambda error: errors.append(str(error)))
                def open_setup(step):
                    # Setup is a two-step flow opened from the experiment header, not a result tab.
                    if not page.locator('.stepper').is_visible():
                        page.get_by_role('button', name='Set up analysis', exact=True).click()
                    page.get_by_role('button', name=step, exact=True).click()
                page.goto(f'http://127.0.0.1:{frontend_port}')
                expect(page.get_by_text('Your qPCR overview starts here', exact=True)).to_be_visible()
                # An old running API must be identified before calculation, not rendered as [object Object].
                page.route('**/openapi.json', lambda route: route.fulfill(json={'components': {'schemas': {'AnalysisRequest': {'properties': {'baseline_sample': {'type': 'string'}}}}}}))
                page.reload()
                expect(page.get_by_role('alert').filter(has_text='backend is outdated')).to_be_visible()
                page.unroute('**/openapi.json')
                page.reload()
                expect(page.get_by_text('Your qPCR overview starts here', exact=True)).to_be_visible()
                page.get_by_role('button', name='Upload your first results', exact=True).click()
                page.get_by_label('File', exact=True).set_input_files(workbook)
                page.get_by_role('button', name='Create project and import', exact=True).click()
                expect(page.locator('.status-bar')).to_contain_text(f"Imported {parsed['record_count']} measurements",timeout=20000)
                api=f'http://127.0.0.1:{backend_port}'
                project=page.request.get(api+'/api/projects').json()[0]
                experiment_id=project['experiments'][0]['id']
                path=api+f"/api/projects/{project['id']}/experiments/{experiment_id}"
                detail=lambda:page.request.get(path).json()
                # Uploaded data opens directly to a raw overview, without analysis setup.
                expect(page.locator('.overview-heatmap')).to_contain_text('Raw Ct across conditions and time')
                page.get_by_role('button',name='All experiments',exact=False).click()
                expect(page.locator('.library-table tbody tr')).to_have_count(1)
                expect(page.locator('.library-table')).to_contain_text('Not calculated')
                page.get_by_label('Search experiments',exact=True).fill('no-such-experiment')
                expect(page.get_by_text('No experiments match these filters.',exact=True)).to_be_visible()
                page.get_by_role('button',name='Clear filters',exact=True).click()
                page.locator('.experiment-open').first.click()
                expect(page.locator('.overview-heatmap')).to_be_visible()
                # A cell keeps its run, series and time when opening the inspector.
                cell=page.locator('.heat-cell').first
                cell.click()
                expect(page.locator('.inspector-context')).to_contain_text('Selected cell:')
                expect(page.get_by_label('Dashboard run filter',exact=True)).not_to_have_value('all')
                page.get_by_role('button',name='Show all conditions',exact=True).click()
                expect(page.locator('.review-banner')).to_contain_text('QC finding')
                assert page.locator('.figure-card').count()<=1, 'Default view must be focused, not a wall of plots.'
                page.get_by_label('Inspect assay',exact=True).select_option(target)
                page.get_by_role('button',name='Target Ct',exact=True).click()
                expect(page.get_by_role('img',name=f'{target} · raw Ct values',exact=True)).to_be_visible()
                # Save all target assays for each run, preserving run boundaries.
                for run in parsed['runs']:
                    open_setup('Normalization')
                    page.get_by_role('button',name=run['name'],exact=False).click()
                    create=page.get_by_role('button',name='Calculate expression',exact=True).first
                    expect(create).to_be_enabled()
                    create.click()
                    expect(page.get_by_role('button',name='Overview',exact=True)).to_have_attribute('aria-pressed','true',timeout=20000)
                    expect(page.locator('.status-bar')).to_contain_text('Expression saved')
                page.get_by_label('Inspect assay',exact=True).select_option(target)
                expect(page.locator('.assay-inspector')).to_be_visible()
                # A missing run must be visible even while a valid run is plotted.
                if args.workbook:
                    page.get_by_role('button',name='Inspect GAD65',exact=True).click()
                    expect(page.locator('.coverage-badges')).to_contain_text('Run 3: unavailable')
                    expect(page.locator('.figure-coverage-note')).to_contain_text('Run 3 unavailable')
                    page.get_by_role('button',name='Inspect PAX6',exact=True).click()
                    page.get_by_label('Export PAX6 expression',exact=True).click()
                    expect(page.get_by_role('button',name='Download PAX6 expression SVG',exact=True)).to_be_disabled()
                    page.get_by_label('Export PAX6 expression',exact=True).click()
                page.get_by_role('button',name=f'Inspect {target}',exact=True).click()
                # Incompatible filters cannot be selected, and QC ignores biological time filters.
                page.get_by_label('Dashboard run filter',exact=True).select_option(parsed['runs'][1]['id'])
                if args.workbook:expect(page.get_by_label('Condition series',exact=True).locator('option[value*="100%"]')).to_have_attribute('disabled','')
                page.get_by_label('Dashboard run filter',exact=True).select_option('all')
                page.get_by_label('Experimental time filter',exact=True).select_option('day:21')
                page.get_by_role('button',name='Review QC',exact=True).click()
                control=page.get_by_role('img',name=f'{target} · raw Ct values',exact=True)
                expect(control).to_be_visible()
                assert ('H2O' if args.workbook else 'H₂O control') in control.locator('desc').text_content()
                # Exclusion preview is read-only; applying an exclusion requires a note.
                data=detail()
                spread=next(f for f in data['quality']['flags'] if f['kind']=='technical_spread' and f['run_id']==parsed['runs'][0]['id'])
                # Findings are grouped by run and sample; the assay is chosen inside the finding.
                button=page.locator('.quality-list button').filter(has_text=spread['sample']).filter(has_text='wide technical range').filter(has_text=parsed['runs'][0]['name'])
                button.click()
                assay_chip=page.locator('.qc-assays').get_by_role('button',name=spread['assay'],exact=True)
                if assay_chip.count():assay_chip.click()
                well=max([r for r in spread['measurements'] if r['ct'] is not None and not r['omit']],key=lambda r:r['ct'])
                field=page.get_by_label(f"Exclusion reason for {well['run_id']} {well['well']} {well['assay']}",exact=True)
                field.fill('Source curve reviewed; test exclusion rationale')
                before=page.request.get(path+'/analyses').json()
                page.get_by_role('button',name='Preview exclusion effect',exact=True).click()
                expect(page.locator('.exclusion-preview')).to_contain_text('Descriptive normalization preview only',timeout=15000)
                assert len(page.request.get(path+'/analyses').json())==len(before)
                page.get_by_role('button',name='Save exclusions',exact=True).click()
                expect(page.locator('.review-banner')).to_contain_text('out of date',timeout=10000)
                changed=detail()
                assert changed['measurement_exclusions'][well['measurement_id']]
                # The audit note is composed from the per-well reason; no second reason field is needed.
                assert 'test exclusion rationale' in changed['audit_events'][-1]['reason']
                assert changed['raw_records']==data['raw_records']
                # Acknowledge a control concern without erasing the original signal.
                concern=next(f for f in changed['quality']['flags'] if f['kind']=='control_signal')
                page.locator('.quality-list button').filter(has_text=concern['sample']).filter(has_text='signal in').filter(has_text=next(r['name'] for r in parsed['runs'] if r['id']==concern['run_id'])).click()
                page.get_by_label('Review status',exact=True).select_option('all')
                page.get_by_label('Review note',exact=True).fill('Control trace and assignment inspected; follow-up documented')
                page.locator('.qc-action').get_by_role('button',name=re.compile(r'^Mark .*reviewed$')).click()
                expect(page.locator('.review-note')).to_contain_text('Control trace and assignment inspected',timeout=10000)
                assert next(f for f in detail()['quality']['flags'] if f['id']==concern['id'])['status']=='reviewed'
                # Explicit design metadata controls the available inference model.
                open_setup('Samples & design')
                design=page.locator('.samples-workspace .design-panel')
                design.get_by_label('Time measured from',exact=True).fill('transfection')
                design.get_by_label('Experimental unit',exact=True).fill('independently transfected culture well')
                design.get_by_label('Study design',exact=False).select_option('paired')
                design.get_by_role('checkbox').check()
                design.get_by_role('button',name='Save experimental design',exact=True).click()
                expect(design).to_contain_text('Design saved.',timeout=10000)
                open_setup('Normalization')
                expect(page.get_by_label('Statistical approach',exact=False).locator('option[value="welch"]')).to_have_attribute('disabled','')
                open_setup('Samples & design')
                design.get_by_label('Study design',exact=False).select_option('independent')
                design.get_by_role('checkbox').check()
                design.get_by_role('button',name='Save experimental design',exact=True).click()
                open_setup('Normalization')
                expect(page.get_by_label('Statistical approach',exact=False).locator('option[value="welch"]')).not_to_have_attribute('disabled','',timeout=10000)
                # A sample instance can be reassigned without changing another run's material.
                page.get_by_role('button',name='Overview',exact=True).click()
                page.get_by_label('Experimental time filter',exact=True).select_option('all')
                open_setup('Samples & design')
                mapped=detail();row=next(r for r in mapped['raw_records'] if r['run_id']==parsed['runs'][0]['id'] and mapped['sample_instances'][r['sample_instance_id']]['timepoint']==21)
                other=next(r for r in mapped['raw_records'] if r['run_id']==parsed['runs'][1]['id'] and mapped['sample_instances'][r['sample_instance_id']]['timepoint']==21)
                page.get_by_label('Sample mapping run',exact=True).select_option(row['run_id'])
                page.get_by_label('Find sample',exact=True).fill(row['sample'])
                page.get_by_role('button',name='Select visible (1)',exact=True).click()
                page.get_by_label('Bulk field',exact=True).select_option('timepoint')
                page.get_by_label('Bulk value',exact=True).fill('22')
                page.get_by_role('button',name='Apply to selected',exact=True).click()
                expect(page.get_by_label(f"Time for instance {row['sample_instance_id']}",exact=True)).to_have_value('22')
                page.get_by_label('Bulk field',exact=True).select_option('cell_line')
                page.get_by_label('Bulk value',exact=True).fill('Test cells')
                page.get_by_role('button',name='Apply to selected',exact=True).click()
                page.get_by_label('Bulk field',exact=True).select_option('confluency')
                page.get_by_label('Bulk value',exact=True).fill('125%')
                page.get_by_role('button',name='Apply to selected',exact=True).click()
                page.get_by_role('button',name='Save sample mapping',exact=True).click()
                expect(page.locator('.sample-mapping')).to_contain_text('Mapping saved.',timeout=10000)
                after=detail()
                assert after['sample_instances'][row['sample_instance_id']]['cell_line']=='Test cells'
                assert after['sample_instances'][row['sample_instance_id']]['confluency']=='125%'
                assert after['sample_instances'][row['sample_instance_id']]['timepoint']==22
                assert after['sample_instances'][other['sample_instance_id']]['timepoint']==21
                page.get_by_role('button',name='Overview',exact=True).click()
                page.get_by_role('button',name='Recalculate results',exact=True).click()
                expect(page.locator('.rebuild-status')).to_contain_text('Rebuilt 2 run(s)',timeout=25000)
                page.get_by_role('button',name=f'Inspect {target}',exact=True).click()
                expect(page.locator('.assay-inspector .stale-badge')).to_have_count(0)
                page.get_by_role('button',name='Bars from 1×',exact=True).click()
                chart=page.get_by_role('img',name=f'{target} · normalized expression',exact=True)
                for bar in chart.locator('rect[data-mean]').all():
                    avg=float(bar.get_attribute('data-mean'));anchor=float(bar.get_attribute('data-baseline-y'));top=float(bar.get_attribute('y'));height=float(bar.get_attribute('height'))
                    assert abs((top if avg<1 else top+height)-anchor)<1e-6
                # Sparse/bars axes compact automatically, with an explicit proportional override.
                expect(chart).to_have_attribute('data-time-spacing','measured')
                positions=[float(t.locator('line').get_attribute('x1')) for t in chart.locator('[data-axis-tick="x"]').all()]
                gaps=[b-a for a,b in zip(positions,positions[1:])]
                assert not gaps or max(gaps)-min(gaps)<1e-6
                baseline_label=chart.locator('[data-baseline-label="true"]')
                assert float(baseline_label.get_attribute('y'))>float(chart.locator('[data-baseline="1"]').get_attribute('y1'))
                # Export physical size, readable fonts, actual plotted data and methods.
                page.locator('.figure-options summary').click()
                page.get_by_role('button',name=f'Settings for {target} expression',exact=True).click()
                page.get_by_label('Plot time spacing',exact=True).select_option('proportional')
                page.get_by_role('button',name='Save this plot',exact=True).click()
                expect(chart).to_have_attribute('data-time-spacing','proportional')
                page.get_by_role('button',name=f'Settings for {target} expression',exact=True).click()
                page.get_by_label('Plot time spacing',exact=True).select_option('auto')
                page.get_by_role('button',name='Save this plot',exact=True).click()
                page.get_by_label('Publication width',exact=True).select_option('single')
                page.get_by_label(f'Export {target} expression',exact=True).click()
                with page.expect_download() as download:page.get_by_role('button',name=f'Download {target} expression SVG',exact=True).click()
                import xml.etree.ElementTree as ET
                svg=ET.parse(download.value.path()).getroot();assert svg.attrib['width']=='85mm'
                width=float(svg.attrib['viewBox'].split()[2]);fonts=[float(e.attrib['font-size']) for e in svg.iter() if 'font-size' in e.attrib]
                assert min(fonts)*85/width*72/25.4>=8
                with page.expect_download() as download:page.get_by_role('button',name=f'Download {target} expression plotted data',exact=True).click()
                csv=Path(download.value.path()).read_text();assert 'fold_change' in csv and 'analysis_id' in csv
                with page.expect_download() as download:page.get_by_role('button',name=f'Download {target} expression methods',exact=True).click()
                methods=json.loads(Path(download.value.path()).read_text());assert len(methods['methods']['analyses'])==2
                assert methods['figure']['time_spacing']=='measured'
                with page.expect_download() as download:page.get_by_role('button',name=f'Download {target} expression PNG 600 dpi',exact=True).click()
                import struct
                download.value.save_as('/tmp/qpcr-publication-600dpi.png')
                png=Path(download.value.path()).read_bytes()
                assert struct.unpack('>I',png[16:20])[0]==round(85/25.4*600)
                density=png.index(b'pHYs')
                assert struct.unpack('>II',png[density+4:density+12])==(23622,23622)
                # Separate all-gene view preserves the inspector and respects biological filters.
                page.get_by_role('button',name='All genes',exact=True).click()
                expect(page.locator('.gene-panel-grid .figure-card').first).to_be_visible()
                expected_targets=len({r['assay'] for r in after['raw_records']}-set(detail()['analysis_result']['reference_assays']))
                # Genes without any saved result are listed under the grid instead of taking a panel.
                expect(page.locator('.gene-panel-grid .figure-card')).to_have_count(expected_targets-page.locator('.unavailable-genes li').count())
                line_filters=page.get_by_role('group',name='Cell line filter buttons',exact=True)
                line_filters.get_by_role('button',name='Test cells',exact=True).click()
                confluency_filters=page.get_by_role('group',name='Confluency filter buttons',exact=True)
                confluency_filters.get_by_role('button',name='125%',exact=True).click()
                expect(page.locator('.overview-summary')).to_contain_text('1 biological samples')
                page.get_by_role('button',name='Raw Ct',exact=True).click()
                expect(page.locator('.gene-panel-grid .figure-card')).to_have_count(len({r['assay'] for r in after['raw_records']}))
                line_filters.get_by_role('button',name='All',exact=True).click()
                confluency_filters.get_by_role('button',name='All',exact=True).click()
                # Appearance, drag order, keyboard alternatives, pins and search persist without recalculation.
                before_appearance=detail();version_count=len(page.request.get(path+'/analyses').json())
                initial_order=page.locator('.gene-panel-grid > .gene-panel').evaluate_all("nodes=>nodes.map(node=>node.dataset.assay)")
                first,second=initial_order[:2]
                source=page.locator('.gene-panel').filter(has=page.get_by_role('group',name=f'{first} plot controls',exact=True))
                destination=page.locator('.gene-panel').filter(has=page.get_by_role('group',name=f'{second} plot controls',exact=True))
                source.locator('.plot-drag-handle').drag_to(destination.locator('.gene-panel-toolbar'))
                expected_order=[second,first,*initial_order[2:]]
                expect(page.locator('.gene-panel-grid > .gene-panel').first).to_have_attribute('data-assay',second)
                page.get_by_role('button',name=f'Move {first} earlier',exact=True).click()
                expect(page.locator('.gene-panel-grid > .gene-panel').first).to_have_attribute('data-assay',first)
                page.get_by_role('button',name='Undo reorder',exact=True).click()
                source.locator('.plot-drag-handle').press('ArrowLeft')
                expect(page.locator('.gene-panel-grid > .gene-panel').first).to_have_attribute('data-assay',first)
                source.locator('.plot-drag-handle').press('ArrowRight')
                expect(page.locator('.gene-panel-grid > .gene-panel').first).to_have_attribute('data-assay',second)
                page.get_by_role('button',name=f'Pin {first}',exact=True).click()
                page.get_by_role('checkbox',name='Pinned genes only',exact=True).check()
                expect(page.locator('.gene-panel-grid > .gene-panel')).to_have_count(1)
                page.get_by_role('checkbox',name='Pinned genes only',exact=True).uncheck()
                page.get_by_label('Find gene in dashboard',exact=True).fill('no-such-gene')
                expect(page.locator('.gene-panel-grid')).to_contain_text('No genes match')
                page.get_by_role('button',name='Show all genes',exact=True).click()
                page.locator('.figure-appearance summary').click()
                color_input=page.locator('.series-color-options input[type=color]').first
                color_input.fill('#663399')
                assert page.locator('.gene-panel-grid svg [stroke="#663399"]').count()>0
                prefs=page.evaluate("key=>JSON.parse(localStorage.getItem(key))",f'qpcr-presentation-v1:{experiment_id}')
                assert prefs['order']==expected_order and first in prefs['favorites']
                assert detail()['context_revision']==before_appearance['context_revision']
                assert len(page.request.get(path+'/analyses').json())==version_count
                page.reload()
                page.locator('.experiment-open').first.click()
                page.get_by_role('button',name='All genes',exact=True).click()
                page.get_by_role('button',name='Raw Ct',exact=True).click()
                assert page.locator('.gene-panel-grid > .gene-panel').evaluate_all("nodes=>nodes.map(node=>node.dataset.assay)")==expected_order
                assert page.locator('.gene-panel-grid svg [stroke="#663399"]').count()>0
                page.get_by_role('button',name='Expression',exact=True).click()
                page.get_by_label('Gene dashboard columns' ,exact=True).select_option('3')
                page.screenshot(path='/tmp/qpcr-all-genes.png',full_page=True)
                page.emulate_media(media='print')
                assert page.locator('.gene-panel-grid .figure-scroll').first.evaluate("node=>getComputedStyle(node).aspectRatio")=='auto'
                page.pdf(path='/tmp/qpcr-all-genes.pdf',format='A4',print_background=True);page.emulate_media(media='screen')
                page.set_viewport_size({'width':390,'height':844})
                assert page.evaluate('document.body.scrollWidth')<=391
                page.set_viewport_size({'width':1440,'height':1000})
                page.get_by_role('button',name='Overview',exact=True).click()
                # Compact defaults and deliberate report expansion.
                page.get_by_role('button',name='Figure builder / report',exact=True).click()
                page.get_by_role('checkbox',name='Target Ct',exact=True).check()
                page.get_by_role('checkbox',name='Reference Ct',exact=True).check()
                page.emulate_media(media='print');page.pdf(path='/tmp/qpcr-upgrade-report.pdf',format='A4',print_background=True);page.emulate_media(media='screen')
                page.get_by_role('button',name='Overview & inspector',exact=True).click()
                page.get_by_role('button',name='Time course',exact=True).click()
                page.locator('.assay-inspector .figure-card').first.screenshot(path='/tmp/qpcr-upgrade-figure.png')
                page.evaluate('window.scrollTo(0,0)');page.screenshot(path='/tmp/qpcr-upgrade-overview.png')
                page.set_viewport_size({'width':390,'height':844});page.evaluate('window.scrollTo(0,0)')
                assert page.evaluate('document.body.scrollWidth')<=391, 'Mobile page must not overflow horizontally.'
                page.get_by_role('button',name='+ Upload results',exact=True).click()
                expect(page.locator('.sidebar .panel').first).to_be_visible()
                page.keyboard.press('Escape')
                expect(page.get_by_role('dialog',name='Upload results')).not_to_be_visible()
                page.screenshot(path='/tmp/qpcr-upgrade-mobile.png')
                page.get_by_role('button',name='All experiments',exact=False).click()
                expect(page.locator('.library-table')).to_contain_text(re.compile('Saved|Partially calculated'))
                assert page.evaluate('document.body.scrollWidth')<=391
                page.screenshot(path='/tmp/qpcr-library-mobile.png')
                page.set_viewport_size({'width':1440,'height':1000})
                page.screenshot(path='/tmp/qpcr-library-desktop.png')
                # A second upload remains a distinct library entry; duplicate names are disclosed.
                page.get_by_role('button',name='+ Upload results',exact=True).click()
                page.get_by_label('File',exact=True).set_input_files(workbook)
                expect(page.locator('.upload-duplicate')).to_contain_text('already in this project')
                page.get_by_label('Experiment label',exact=True).fill('Second experiment')
                page.get_by_role('button',name='Import raw results',exact=True).click()
                expect(page.locator('.overview-heatmap')).to_contain_text('Raw Ct across conditions and time',timeout=20000)
                page.get_by_role('button',name='All experiments',exact=False).click()
                expect(page.locator('.library-table tbody tr')).to_have_count(2)
                page.get_by_label('Library status',exact=True).select_option('setup')
                listed=page.request.get(api+'/api/projects').json()[0]['experiments']
                expected_incomplete=sum(e['library_summary']['analysis_state'] in ['partial','not_calculated'] for e in listed)
                expect(page.locator('.library-table tbody tr')).to_have_count(expected_incomplete)
                expect(page.locator('.library-table')).to_contain_text('Second experiment')
                page.get_by_label('Library status',exact=True).select_option('all')
                page.get_by_label('Library sort',exact=True).select_option('oldest')
                expect(page.locator('.experiment-open').last).to_contain_text('Second experiment')
                # A known inferential fixture checks normal probability plots and adjusted significance.
                project2=page.request.post(api+'/api/projects',data={'name':'Distribution diagnostics fixture'}).json()
                import csv as csv_module
                import io
                buffer=io.StringIO();writer=csv_module.writer(buffer);writer.writerow(['Well','Sample Name','Target Name','CT'])
                base_samples=[];groups={};well_index=0
                for day in [0,21]:
                    for replicate in range(6):
                        name=f'Fixture confluency_100% day {day}.{replicate+1}'
                        groups[name]='baseline' if day==0 else 'treatment'
                        if day==0:base_samples.append(name)
                        for assay in ['T','T2','R']:
                            for technical in range(2):
                                value=(24 if day==0 else 20)+replicate*.1 if assay!='R' else 20+replicate*.01
                                if assay=='T2':value+=2
                                writer.writerow([f'{chr(65+well_index//12)}{well_index%12+1}',name,assay,value+technical*.02]);well_index+=1
                uploaded=page.request.post(api+f"/api/projects/{project2['id']}/upload",multipart={'name':'Normality fixture','file':{'name':'normality.csv','mimeType':'text/csv','buffer':buffer.getvalue().encode()}}).json()
                normality_path=api+f"/api/projects/{project2['id']}/experiments/{uploaded['id']}"
                design={'time_origin':'treatment','experimental_unit':'independent culture','design_type':'independent','confirmed':True}
                assert page.request.patch(normality_path+'/design',data=design).ok
                calculated=page.request.post(normality_path+'/analyze-batch',data={'target_assays':['T2','T'],'target_assay':'T','reference_assays':['R'],'baseline_samples':base_samples,'sample_groups':groups,'run_id':uploaded['runs'][0]['id'],'statistics_method':'welch','assumptions_confirmed':True})
                assert calculated.ok,calculated.text()
                significant_result=calculated.json()['results'][-1]
                adjusted=significant_result['statistics']['comparisons'][0]['adjusted_p_value'];assert adjusted<.05
                page.get_by_role('button',name='Experiments',exact=True).click()
                page.get_by_label('Search experiments',exact=True).fill('Normality fixture')
                page.locator('.experiment-open').click()
                evidence_chart=page.get_by_role('img',name='T · normalized expression',exact=True)
                marker=evidence_chart.locator('[data-significance-p]')
                expect(marker).to_have_count(1)
                assert abs(float(marker.get_attribute('data-significance-p'))-adjusted)<1e-12
                expect(page.locator('.figure-comparisons summary')).to_contain_text('1 significant / 1 tested')
                page.locator('.figure-appearance summary').click()
                page.get_by_role('checkbox',name='Show significance markers',exact=True).uncheck()
                expect(marker).to_have_count(0)
                page.get_by_role('checkbox',name='Show significance markers',exact=True).check()
                page.get_by_role('button',name='QC review',exact=True).click()
                expect(page.locator('svg[data-probability-plot]')).to_have_count(2)
                assert page.locator('svg[data-probability-plot]').first.locator('circle').count()==6
                with page.expect_download() as download:page.get_by_role('button',name='Export probability plot SVG',exact=True).first.click()
                diagnostic_svg=ET.parse(download.value.path()).getroot();assert diagnostic_svg.attrib['width']=='85mm'
                page.locator('.distribution-diagnostics').screenshot(path='/tmp/qpcr-distribution-diagnostics.png')
                page.get_by_role('button',name='Expression',exact=True).click()
                page.get_by_label('Export T expression',exact=True).click()
                with page.expect_download() as download:page.get_by_role('button',name='Download T expression SVG',exact=True).click()
                significant_svg=ET.parse(download.value.path()).getroot()
                assert any('data-significance-p' in element.attrib for element in significant_svg.iter())
                page.locator('.assay-inspector .figure-card').screenshot(path='/tmp/qpcr-significance-result.png')
                # Plot settings preview and save manual bounds, colors and explicit dashboard defaults.
                page.get_by_label('Export T expression',exact=True).click()
                page.get_by_role('button',name='Bars from 1×',exact=True).click()
                before_settings=page.request.get(normality_path).json();before_versions=len(page.request.get(normality_path+'/analyses').json())
                page.get_by_role('button',name='Settings for T expression',exact=True).click()
                settings=page.get_by_role('dialog',name='Figure settings: T',exact=True)
                # Expression plots default to a log2 fold-change axis; a zero minimum is only valid on a linear axis.
                expect(evidence_chart).to_have_attribute('data-y-scale','log2')
                settings.get_by_label('Y minimum',exact=True).fill('0')
                expect(settings.get_by_role('button',name='Save this plot',exact=True)).to_be_disabled()
                settings.get_by_label('Y scale',exact=True).select_option('linear')
                settings.get_by_label('Y maximum',exact=True).fill('5')
                settings.get_by_label('Y minimum',exact=True).fill('10')
                expect(settings.get_by_role('button',name='Save this plot',exact=True)).to_be_disabled()
                settings.get_by_label('Y minimum',exact=True).fill('0')
                settings.get_by_label('Y tick spacing',exact=True).fill('1')
                settings.get_by_label('X minimum',exact=True).fill('0')
                settings.get_by_label('X maximum',exact=True).fill('10')
                settings.get_by_label('X tick spacing',exact=True).fill('5')
                settings.get_by_label('Y-axis title',exact=True).fill('Normalized expression')
                settings.get_by_label('X-axis title',exact=True).fill('Days after treatment')
                expect(page.locator('.figure-clipping-note')).to_contain_text('Display limits')
                settings.get_by_role('button',name='Save this plot',exact=True).click()
                expect(evidence_chart).to_have_attribute('data-y-max','5')
                expect(evidence_chart).to_have_attribute('data-x-max','10')
                page.get_by_label('Export T expression',exact=True).click()
                with page.expect_download() as download:page.get_by_role('button',name='Download T expression SVG',exact=True).click()
                cropped_svg=ET.parse(download.value.path()).getroot()
                metadata=next(node for node in cropped_svg if node.tag.endswith('metadata'))
                display=json.loads(metadata.text)
                assert display['limits']['y']==[0,5] and display['clipping_note']
                assert any('Display limits' in (node.text or '') for node in cropped_svg.iter())
                assert 'translateY' not in cropped_svg.attrib.get('style','')
                page.get_by_label('Export T expression',exact=True).click()
                page.get_by_role('button',name='Settings for T expression',exact=True).click()
                settings.get_by_role('button',name='Reset to automatic',exact=True).click()
                settings.get_by_role('checkbox',name='Use shared expression scale',exact=True).check()
                settings.get_by_role('button',name='Apply axes to all expression plots',exact=True).click()
                page.get_by_role('button',name='All genes',exact=True).click()
                shared=page.locator('.gene-panel-grid svg[role=img]')
                expect(shared).to_have_count(2)
                limits=shared.evaluate_all("nodes=>nodes.map(node=>[node.dataset.yMin,node.dataset.yMax])")
                assert limits[0]==limits[1]
                page.get_by_role('button',name='Settings for T expression',exact=True).click()
                settings.get_by_role('button',name='Style & colors',exact=True).click()
                settings.get_by_label('Color assignment',exact=True).select_option('sample')
                settings.locator('.color-editor-row input[type=color]').nth(1).fill('#993399')
                settings.get_by_role('checkbox',name='Filled biological points',exact=True).check()
                settings.get_by_label('Point size',exact=True).focus();page.keyboard.press('ArrowRight')
                settings.locator('.individual-colors summary').filter(has_text='Individual mean-bar colors').click()
                settings.locator('.individual-colors input[type=color]').first.fill('#e39f29')
                settings.get_by_role('button',name='Apply style to entire dashboard',exact=True).click()
                expect(shared.first).to_have_attribute('data-color-by','sample')
                assert page.locator('.gene-panel-grid svg [fill="#e39f29"]').count()>0
                assert page.locator('.gene-panel-grid svg circle[stroke="#993399"]').count()>0
                page.get_by_role('button',name='Raw Ct',exact=True).click()
                assert page.locator('.gene-panel-grid svg circle[stroke="#993399"]').count()>0
                prefs=page.evaluate("key=>JSON.parse(localStorage.getItem(key))",f"qpcr-presentation-v1:{uploaded['id']}")
                assert prefs['plotDefaults']['expression']['axes']['sharedY'] is True
                assert prefs['plotDefaults']['ct']['axes']['sharedY'] is False
                assert prefs['plotDefaults']['ct']['style']['colorBy']=='sample'
                assert page.request.get(normality_path).json()['context_revision']==before_settings['context_revision']
                assert len(page.request.get(normality_path+'/analyses').json())==before_versions
                page.get_by_role('button',name='Expression',exact=True).click()
                page.screenshot(path='/tmp/qpcr-editor-dashboard.png',full_page=True)
                page.get_by_role('button',name='Settings for T expression',exact=True).click()
                settings.get_by_label('Y maximum',exact=True).fill('40')
                settings.get_by_role('button',name='Save this plot',exact=True).click()
                expect(page.locator('.gene-panel[data-assay="T"] svg[role=img]')).to_have_attribute('data-y-max','40')
                page.get_by_role('button',name='Undo last appearance change',exact=True).click()
                assert shared.evaluate_all("nodes=>new Set(nodes.map(node=>node.dataset.yMax)).size")==1
                page.get_by_role('button',name='Settings for T expression',exact=True).click()
                settings.get_by_label('Y maximum',exact=True).fill('40')
                settings.get_by_role('button',name='Save this plot',exact=True).click()
                page.get_by_role('button',name='Settings for T expression',exact=True).click()
                settings.get_by_role('button',name='Use dashboard settings',exact=True).click()
                assert shared.evaluate_all("nodes=>new Set(nodes.map(node=>node.dataset.yMax)).size")==1
                page.get_by_role('button',name='Settings for T expression',exact=True).click()
                settings.get_by_label('Y maximum',exact=True).fill('100')
                settings.get_by_role('button',name='Cancel preview',exact=True).click()
                assert shared.evaluate_all("nodes=>new Set(nodes.map(node=>node.dataset.yMax)).size")==1
                page.set_viewport_size({'width':390,'height':844})
                page.get_by_role('button',name='Settings for T expression',exact=True).click()
                assert settings.bounding_box()['width']<=390
                assert page.evaluate('document.body.scrollWidth')<=391
                page.keyboard.press('Escape')
                expect(settings).not_to_be_visible()
                assert page.locator('.app-shell').evaluate('node=>node.inert') is False
                page.set_viewport_size({'width':1440,'height':1000})
                page.get_by_role('button',name='Overview',exact=True).click()
                expect(evidence_chart.locator('[data-significance-p]')).to_have_count(1)
                page.get_by_label('Experimental time filter',exact=True).select_option('day:21')
                page.get_by_role('button',name='Settings for T expression',exact=True).click()
                expect(settings.get_by_label('X minimum',exact=True)).to_be_enabled()
                page.keyboard.press('Escape')
                page.get_by_label('Experimental time filter',exact=True).select_option('all')
                # A changed design marks the old test historical and removes its plot star.
                open_setup('Samples & design')
                design_panel=page.locator('.samples-workspace .design-panel')
                design_panel.get_by_label('Study design',exact=False).select_option('paired')
                design_panel.get_by_role('checkbox').check()
                design_panel.get_by_role('button',name='Save experimental design',exact=True).click()
                expect(design_panel).to_contain_text('Design saved.')
                page.get_by_role('button',name='Overview',exact=True).click()
                expect(evidence_chart.locator('[data-significance-p]')).to_have_count(0)
                expect(page.locator('.figure-comparisons summary')).to_contain_text('Historical statistics')
                assert not errors, errors
                browser.close()
                print('PASS: per-plot axes/style; shared scales by quantity; independent sample/bar colors; live preview/cancel; clipping in exports; responsive editors; remembered colors; native drag and keyboard order; pins/search/undo; biological normal probability plots; Holm stars and stale suppression; compact/proportional axes; baseline label outside plot; all-gene grid and biological filters; 600 dpi PNG/SVG/PDF; experiment library, search/status/sort, duplicate upload notice, raw cell context, bulk sample editing, mobile cards; review-first overview; QC survives filters; exclusion preview and audit; missing-run coverage; per-run identities; stale/rebuild; explicit design; 1x figures; physical SVG/data/methods/PDF exports; responsive workspace; no browser errors.')
        finally:
            for process in processes:
                process.terminate()
            for process in processes:
                process.wait(timeout=10)


if __name__ == '__main__':
    main()

"""Optional browser regression: fresh workspace -> upload -> populated runs -> analysis.

Install playwright and its Chromium browser first. Uses temporary storage and ports;
never imports data into the user's real database. Defaults to a synthetic workbook.
"""
from __future__ import annotations

import argparse
import json
import os
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
        env = {**os.environ, 'VITE_API_ROOT': f'http://127.0.0.1:{backend_port}'}
        subprocess.run(['npm', 'run', 'build', '--', '--outDir', str(client)], cwd=ROOT/'frontend', env=env, check=True)
        processes = []
        try:
            backend = subprocess.Popen([sys.executable, '-m', 'uvicorn', 'backend.app:app', '--host', '127.0.0.1', '--port', str(backend_port), '--log-level', 'warning'], cwd=ROOT, env={**os.environ, 'QPCR_DATA_DIR': str(data/'store'), 'QPCR_UPLOAD_DIR': str(data/'uploads')})
            processes.append(backend)
            frontend = subprocess.Popen([sys.executable, '-m', 'http.server', str(frontend_port), '--bind', '127.0.0.1', '--directory', str(client)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
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
                page.goto(f'http://127.0.0.1:{frontend_port}')
                expect(page.get_by_text('No projects yet.', exact=True)).to_be_visible()
                # An old running API must be identified before calculation, not rendered as [object Object].
                page.route('**/openapi.json', lambda route: route.fulfill(json={'components': {'schemas': {'AnalysisRequest': {'properties': {'baseline_sample': {'type': 'string'}}}}}}))
                page.reload()
                expect(page.get_by_role('alert').filter(has_text='backend is outdated')).to_be_visible()
                page.unroute('**/openapi.json')
                page.reload()
                expect(page.get_by_text('No projects yet.', exact=True)).to_be_visible()
                page.get_by_label('File', exact=True).set_input_files(workbook)
                page.get_by_role('button', name='Create project and import', exact=True).click()
                expect(page.locator('.status-bar')).to_contain_text(f"Imported {parsed['record_count']} measurements",timeout=20000)
                api=f'http://127.0.0.1:{backend_port}'
                project=page.request.get(api+'/api/projects').json()[0]
                experiment_id=project['experiments'][0]['id']
                path=api+f"/api/projects/{project['id']}/experiments/{experiment_id}"
                detail=lambda:page.request.get(path).json()
                page.get_by_role('button',name='2 · Dashboard',exact=True).click()
                expect(page.locator('.overview-heatmap')).to_be_visible()
                expect(page.locator('.review-banner')).to_contain_text('Quality review required')
                assert page.locator('.figure-card').count()<=1, 'Default view must be focused, not a wall of plots.'
                page.get_by_role('button',name='Target Ct',exact=True).click()
                expect(page.get_by_role('img',name=f'{target} · raw Ct values',exact=True)).to_be_visible()
                # Save all target assays for each run, preserving run boundaries.
                for run in parsed['runs']:
                    page.get_by_role('button',name='1 · Import & setup',exact=True).click()
                    page.get_by_role('button',name=run['name'],exact=False).click()
                    create=page.get_by_role('button',name='Create dashboard and save analysis',exact=True).first
                    expect(create).to_be_enabled()
                    create.click()
                    expect(page.get_by_role('button',name='2 · Dashboard',exact=True)).to_have_attribute('aria-pressed','true',timeout=20000)
                    expect(page.locator('.status-bar')).to_contain_text('Dashboard created')
                page.get_by_label('Inspect assay',exact=True).select_option(target)
                expect(page.locator('.assay-inspector')).to_be_visible()
                # A missing run must be visible even while a valid run is plotted.
                if args.workbook:
                    page.get_by_role('button',name='Inspect GAD65',exact=True).click()
                    expect(page.locator('.coverage-badges')).to_contain_text('Run 3: unavailable')
                    expect(page.locator('.figure-coverage-note')).to_contain_text('Run 3 unavailable')
                    page.get_by_role('button',name='Inspect PAX6',exact=True).click()
                    expect(page.get_by_role('button',name='Download PAX6 expression SVG',exact=True)).to_be_disabled()
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
                button=page.locator('.quality-list button').filter(has_text=f"{spread['assay']} · {spread['sample']}").filter(has_text=parsed['runs'][0]['name'])
                button.click()
                well=max([r for r in spread['measurements'] if r['ct'] is not None and not r['omit']],key=lambda r:r['ct'])
                field=page.get_by_label(f"Exclusion reason for {well['run_id']} {well['well']} {well['assay']}",exact=True)
                field.fill('Source curve reviewed; test exclusion rationale')
                before=page.request.get(path+'/analyses').json()
                page.get_by_role('button',name='Preview exclusion effect',exact=True).click()
                expect(page.locator('.exclusion-preview')).to_contain_text('Descriptive normalization preview only',timeout=15000)
                assert len(page.request.get(path+'/analyses').json())==len(before)
                page.get_by_label('Reason for this exclusion / restoration change',exact=True).fill('Documented review after inspecting instrument output')
                page.get_by_role('button',name='Apply exclusions and preview recalculation',exact=True).click()
                expect(page.locator('.review-banner')).to_contain_text('need recalculation',timeout=10000)
                changed=detail()
                assert changed['measurement_exclusions'][well['measurement_id']]
                assert changed['raw_records']==data['raw_records']
                # Acknowledge a control concern without erasing the original signal.
                concern=next(f for f in changed['quality']['flags'] if f['kind']=='control_signal')
                page.locator('.quality-list button').filter(has_text=f"{concern['assay']} · {concern['sample']}").filter(has_text=next(r['name'] for r in parsed['runs'] if r['id']==concern['run_id'])).click()
                page.get_by_label('Review finding (required to acknowledge this concern)',exact=True).fill('Control trace and assignment inspected; follow-up documented')
                page.get_by_role('button',name='Record review note',exact=True).click()
                expect(page.locator('.review-note')).to_contain_text('Control trace and assignment inspected',timeout=10000)
                assert next(f for f in detail()['quality']['flags'] if f['id']==concern['id'])['status']=='reviewed'
                # Explicit design metadata controls the available inference model.
                page.get_by_role('button',name='1 · Import & setup',exact=True).click()
                design=page.locator('.analysis-panel .design-panel')
                design.get_by_label('Time measured from',exact=True).fill('transfection')
                design.get_by_label('Experimental unit',exact=True).fill('independently transfected culture well')
                design.get_by_label('Study design',exact=False).select_option('paired')
                design.get_by_role('checkbox').check()
                design.get_by_role('button',name='Save experimental design',exact=True).click()
                expect(design).to_contain_text('Design saved.',timeout=10000)
                expect(page.get_by_label('Statistical approach',exact=False).locator('option[value="welch"]')).to_have_attribute('disabled','')
                design.get_by_label('Study design',exact=False).select_option('independent')
                design.get_by_role('checkbox').check()
                design.get_by_role('button',name='Save experimental design',exact=True).click()
                expect(page.get_by_label('Statistical approach',exact=False).locator('option[value="welch"]')).not_to_have_attribute('disabled','',timeout=10000)
                # A sample instance can be reassigned without changing another run's material.
                page.get_by_role('button',name='2 · Dashboard',exact=True).click()
                page.get_by_label('Experimental time filter',exact=True).select_option('all')
                page.locator('.sample-mapping summary').click()
                mapped=detail();row=next(r for r in mapped['raw_records'] if r['run_id']==parsed['runs'][0]['id'] and mapped['sample_instances'][r['sample_instance_id']]['timepoint']==21)
                other=next(r for r in mapped['raw_records'] if r['run_id']==parsed['runs'][1]['id'] and mapped['sample_instances'][r['sample_instance_id']]['timepoint']==21)
                page.get_by_label(f"Time for instance {row['sample_instance_id']}",exact=True).fill('22')
                page.get_by_role('button',name='Save sample mapping',exact=True).click()
                expect(page.locator('.sample-mapping')).to_contain_text('Mapping saved.',timeout=10000)
                after=detail()
                assert after['sample_instances'][row['sample_instance_id']]['timepoint']==22
                assert after['sample_instances'][other['sample_instance_id']]['timepoint']==21
                page.locator('.sample-mapping summary').click()
                page.get_by_role('button',name='Rebuild saved runs',exact=True).click()
                expect(page.locator('.rebuild-status')).to_contain_text('Rebuilt 2 run(s)',timeout=25000)
                page.get_by_role('button',name=f'Inspect {target}',exact=True).click()
                expect(page.locator('.coverage-badges')).not_to_contain_text('stale')
                page.get_by_role('button',name='Bars from 1×',exact=True).click()
                chart=page.get_by_role('img',name=f'{target} · normalized expression',exact=True)
                for bar in chart.locator('rect[data-mean]').all():
                    avg=float(bar.get_attribute('data-mean'));anchor=float(bar.get_attribute('data-baseline-y'));top=float(bar.get_attribute('y'));height=float(bar.get_attribute('height'))
                    assert abs((top if avg<1 else top+height)-anchor)<1e-6
                # Export physical size, readable fonts, actual plotted data and methods.
                page.locator('.figure-options summary').click()
                page.get_by_label('Publication width',exact=True).select_option('single')
                with page.expect_download() as download:page.get_by_role('button',name=f'Download {target} expression SVG',exact=True).click()
                import xml.etree.ElementTree as ET
                svg=ET.parse(download.value.path()).getroot();assert svg.attrib['width']=='85mm'
                width=float(svg.attrib['viewBox'].split()[2]);fonts=[float(e.attrib['font-size']) for e in svg.iter() if 'font-size' in e.attrib]
                assert min(fonts)*85/width*72/25.4>=8
                with page.expect_download() as download:page.get_by_role('button',name=f'Download {target} expression plotted data',exact=True).click()
                csv=Path(download.value.path()).read_text();assert 'fold_change' in csv and 'analysis_id' in csv
                with page.expect_download() as download:page.get_by_role('button',name=f'Download {target} expression methods',exact=True).click()
                methods=json.loads(Path(download.value.path()).read_text());assert len(methods['methods']['analyses'])==2
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
                page.get_by_role('button',name='Projects / upload',exact=True).click()
                expect(page.locator('.sidebar .panel').first).to_be_visible()
                page.get_by_role('button',name='Close workspace',exact=True).click()
                page.screenshot(path='/tmp/qpcr-upgrade-mobile.png')
                assert not errors, errors
                browser.close()
                print('PASS: review-first overview; QC survives filters; exclusion preview and audit; missing-run coverage; per-run identities; stale/rebuild; explicit design; 1x figures; physical SVG/data/methods/PDF exports; responsive workspace; no browser errors.')
        finally:
            for process in processes:
                process.terminate()
            for process in processes:
                process.wait(timeout=10)


if __name__ == '__main__':
    main()

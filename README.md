# qPCR Analysis Workbench

A local browser workbench for turning raw qPCR Ct/Cq instrument exports into
processed results. Python parses the inputs and performs the scientific
calculations; the React interface presents the measurements, calculation
steps, and exports.

## Local startup

1. Create and activate a Python environment:
   ```bash
   python -m venv .venv
   source .venv/bin/activate
   ```

2. Install backend dependencies and start the API:
   ```bash
   pip install -r backend/requirements.txt
   python -m uvicorn backend.app:app --host 0.0.0.0 --port 8000
   ```

3. In another terminal, install frontend dependencies and start Vite:
   ```bash
   cd frontend
   npm install --legacy-peer-deps --force
   npm run dev -- --host 0.0.0.0 --port 4173
   ```

4. Open http://localhost:4173

## Raw input and processing

- CSV and XLSX/XLSM Ct/Cq result exports are supported. Ct calling from
  fluorescence curves is not implemented.
- For QuantStudio-style workbooks, the importer reads instrument result
  sections that have run metadata and skips derived calculation tabs.
- Repeated result sections are preserved as separate runs. The LAD081 example
  workbook was verified to import 560 measurements as two 384-well runs of
  280 measurements each. The per-gene calculation tabs are not used as input.
- Select a run, target assay, reference assay(s), and baseline sample before
  calculating. The app does not select a biological baseline on the user's
  behalf or combine measurements from separate runs.
- Technical measurements are averaged for each sample/assay. For multiple
  reference assays, the engine uses the arithmetic mean of their Ct means,
  equivalent to a geometric mean of their quantities under the standard
  equal-efficiency assumption. It does not take a geometric mean of Ct values.
- Undetermined, missing, invalid, and instrument-omitted measurements remain
  distinguishable in the imported data. Derived results are sample-level;
  biological replicates are not pooled automatically.
- The plate map reflects 96- or 384-well dimensions when identified in the
  export. A well can show multiple assay measurements.
- Results can be exported as CSV and SVG.

This initial workbook importer is verified against the included LAD081
QuantStudio workbook, not arbitrary Excel layouts. Other workbook formats may
need selectable regions and column mapping before they can be imported.

## Local data and backup

The app stores its SQLite database and preserved original uploads here:

- `backend/data/qpcr.db`
- `backend/uploads/`

Back up both together:
```bash
mkdir -p backups
tar czf backups/qpcr-backup-$(date +%F).tgz backend/data backend/uploads
```

This is a local pilot. It does not include accounts, multi-user hosting, or
public deployment.

## Biological replicate analysis (method version 2.0)

After selecting an instrument run, review suggested condition labels, references,
and day-zero baseline samples. Select all biological controls for the baseline.
Name each biological sample's condition; leave no-template controls ungrouped.
A condition cannot mix baseline and treatment samples. To exclude a biological
sample from this analysis, enter a reason; clearing it restores the sample.
The original upload and measurements are preserved.

The dashboard shows biological replicate points, condition mean fold change and
sample SD, plus the adjustable screening threshold (default 1.5×). Technical wells
are averaged within each biological sample and do not increase biological n.
All selected reference assays are required for a normalized sample result.
The baseline is the mean Delta Ct of all selected baseline biological samples.
This differs from selecting one baseline sample, and reference normalization
also differs from the historical LAD081 Excel `GEOMEAN`-of-Ct formula.

Use **Statistics · why & what it means** for the calculation rationale,
normality diagnostics, test assumptions and interpretation. Descriptive mode is
the default. Independent-group Welch comparisons require explicit confirmation
of independence and distribution assumptions; Holm correction applies to all
planned condition-versus-baseline comparisons within that saved analysis.
Paired, repeated-measure, blocked and factorial inference is not implemented.
With two biological observations normality is not assessable; any requested
assumption-based tests are exploratory. Effect threshold crossing is separate
from statistical evidence. No protocol-specific positive-control success rule
is inferred in this release.

Every calculation saves a new version. **Analysis history** opens old snapshots
and downloads their results and settings as JSON. Legacy saved results are
retained during database initialization. The current CSV/SVG exports refer to
the latest analysis; historical snapshots have their own JSON export.

The upgrade roadmap is in [docs/upgrade-plan.md](docs/upgrade-plan.md). Local
single-launcher packaging, cross-experiment comparisons and private hosted
accounts remain subsequent work. The current development startup commands above
still apply; install the updated backend requirements (including SciPy).

## Private development inputs

Research workbooks, thesis PDFs, local databases, uploads and backups are ignored
by Git. Keep them on your computer; they are not needed to install the app.
The LAD081 workbook checks run when that local file is available and otherwise
skip. Synthetic calculation and CSV tests run without private research inputs.
Do not force-add research files to commits. Ignoring a file does not remove a
copy already present in an earlier commit's history.

## First import and browser regression

You can select a file and click **Create project and import** from an empty
workspace. The app creates a project using the entered name, detects instrument
runs, and opens the first run with raw measurements and suggested setup visible.
Run cards let you switch between runs without combining their measurements.
Unsupported layouts return an error rather than saving an empty experiment.

For development, restart the backend after Python changes, or start it with
`python -m uvicorn backend.app:app --host 127.0.0.1 --port 8000 --reload`.
The frontend uses `http://localhost:8000` by default; `VITE_API_ROOT` can override
that address when starting Vite or building. Optional `QPCR_DATA_DIR` and
`QPCR_UPLOAD_DIR` settings relocate backend storage.

An optional end-to-end browser regression uses synthetic data by default and
temporary backend storage, ports and frontend output:

```bash
python -m pip install playwright
python -m playwright install chromium
python scripts/check_import_browser.py
```

Pass `--workbook /path/to/local-workbook.xlsx` to verify the LAD081 development
example. The private workbook is not part of the repository. Set
`QPCR_TEST_CHROMIUM` only when using an existing Chromium executable. The script
requires backend dependencies, Node, and installed frontend dependencies.

Reference assays and baseline biological samples use checkboxes with explicit
selection counts. The live setup summary lists exactly what is missing and
enables **Create dashboard and save analysis** when ready. Clicking the already
selected run preserves edits. Successful calculations scroll to the results;
calculation errors also appear beside the setup controls.

Expression bars are anchored at **1×**: upregulation rises above the baseline and
downregulation descends below it. Values remain on the fold-change scale, with
biological points and SD unchanged. SVG exports use the same bar origin.

Method 2.1 recognizes conservative water/no-template labels (for example H2O,
H₂O, H2O_1, H20, water and NTC) as technical controls. These measurements remain
in the upload and raw plate/table but are excluded before normalization, baseline
calculation, condition summaries and statistical testing. Review inferred roles
in sample setup and override misclassifications explicitly. Technical controls
cannot be biological baselines unless their role is changed. Historical saved
analyses are preserved; recalculate to apply the updated role policy.

## Workbook dashboard and publication figures

**1 · Import & setup** contains run selection, reference/baseline choices and the
raw plate. **2 · Dashboard** is a separate, filterable workbook overview. Raw Ct
figures are available immediately, including before normalized analysis exists.
By default setup analyses every non-reference assay in the selected run; disable
that option to analyse just one target. Each valid target gets a saved version.
Targets with incomplete baselines keep their raw Ct panel and an explicit reason
why normalization could not be calculated.

The dashboard shows separate target and housekeeping Ct facets, technical-well
points, biological-sample means and sample SD. Expression figures offer time
courses and bars originating at 1×. Run, condition-series, time-point and assay
filters change displayed observations, without recalculating baseline groups or
pooling runs. Reference/target Ct classification follows the reference selection
in setup. Instrument omissions and missing measurements are counted; omitted
numeric measurements can be inspected as crosses and never enter means.

Sample-name suggestions separate a final `.N` biological-replicate label from
condition and day/hour. LAD081's 100% and 150% series are recognized across days
0, 21 and 28. The mapping table is editable and persistent. Lines connect
condition means; suffixes never establish pairing or repeated-measure designs.
After changing annotations, recalculate to apply them to saved expression
analyses. The time-axis title is editable for transfection/differentiation or
another experimental time origin.

Every figure has a self-contained vector SVG download. **Print / Save PDF** uses
a clean figure layout. Figure exports include axes, legends, biological n,
replicate points and uncertainty labels. Colors remain consistent across assay
panels and filters. Ct axes scale per assay. Normalized figures have links to
run-specific statistical results and saved-analysis provenance.

All-target inferential analyses use one Holm family containing the planned
assay/condition contrasts for that batch and run, including conservative entries
for unestimable comparisons. Separate runs/batches are not adjusted together
automatically. Raw Ct plots are descriptive and never introduce technical-well
pseudoreplication into the inferential tests.

## Review-first upgrade (method 3.0)

The default dashboard is now a coverage/QC overview plus one focused assay
inspector. The heatmap uses log2 of the displayed mean fold change, centered on
1×; it distinguishes missing, uncalculated and stale results. Select an assay
for Expression, Target Ct, Reference Ct, QC review or Statistics. Use
**Figure builder / report** only when you want several panels at once.

QC is computed from the original records. Detected technical-control signals
and technical Ct ranges above an editable default 1-cycle review threshold are
flagged. These are review prompts, not automatic contamination diagnoses or
universal acceptance limits. Technical controls remain visible under biological
time/condition filters. Reviewing a concern requires a note and retains the
signal. Well exclusions require a reason and a change note; restorations and
review notes remain in the audit trail. **Preview exclusion effect** compares
sample normalization before and after proposed exclusions without saving a new
analysis or changing inferential statistics.

Sample mappings now use a run + sample identity, so the same label can occur on
multiple runs with different days, units or biological-unit identities. Existing
name-only annotations are read as legacy defaults; original measurements and
old analysis versions are not rewritten. Persisted mapping, design and well
exclusion changes increment an analysis-context revision. Old results are
marked stale, and **Rebuild saved runs** creates new versions using saved
references/baselines and the current persisted context. Unsaved setup edits are
not silently applied or discarded. The overview selects one coherent settings
profile per run. Historical profiles remain available in Analysis history.

Record the experimental time origin, unit and study design explicitly. Welch
inference is available only for a confirmed independent-group design and
researcher-confirmed distribution assumptions. Repeated biological-unit IDs
within a run block independent inference. Paired, blocked and repeated designs
currently support descriptive output only. Reference-validation and assay-
efficiency notes are saved with analyses; Ct exports do not validate them.

Figure presets export 85 mm or 180 mm SVGs with a minimum 8 pt figure font size.
Closely spaced times use a regular time axis with biological n in the legend.
Each figure also downloads the actual scoped data as CSV and methods/provenance
as JSON. Empty figures disable SVG export. Printed panels retain physical size,
quality/stale labels and readable text. The responsive workspace collapses on
small screens and can be opened with **Projects / upload**.

Developer checks:
```bash
python -m pytest backend/test_app.py backend/test_analysis_v2.py backend/test_review_workflow.py
npm --prefix frontend test
npm --prefix frontend run build
npm --prefix frontend run lint
python scripts/check_import_browser.py
```
The browser regression uses temporary storage and synthetic data by default;
its optional `--workbook` argument exercises the private LAD081 fixture without
modifying the user's projects. It checks QC/filter behavior, preview immutability,
review notes, mapping identity, stale/rebuild state, design gating, exports and
mobile overflow. Optional live-data reviews should remain read-only unless the
researcher explicitly requests recalculation or review changes.

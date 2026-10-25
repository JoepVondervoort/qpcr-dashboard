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

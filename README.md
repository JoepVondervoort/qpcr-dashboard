# qPCR Analysis Workbench

The qPCR Analysis Workbench turns raw Ct/Cq exports from qPCR instruments into
normalized, quality-checked results and publication figures. It runs on your own
computer and opens in your web browser. Your files and results are not uploaded
anywhere.

**[Installation](#installation)** · [Using the workbench](#using-the-workbench) ·
[Calculation conventions](#calculation-conventions) · [Development](#development) ·
[User guide](docs/user-guide.md)

## Features

- Imports CSV and Excel (XLSX/XLSM and legacy XLS) result exports, including
  QuantStudio workbooks that contain several instrument runs.
- Analyzes an experiment spread over several plates as one run with a shared
  baseline, or keeps the plates as separate runs. Plates can be added later.
- Shows raw Ct values as a heatmap, plate map and table immediately after import.
- Normalizes target genes to one or more reference genes and a group of baseline
  samples, separately for each run.
- Flags signal in no-template controls and wide spread between technical replicates,
  and records every exclusion and review note in an audit trail.
- Summarizes biological replicates. For a confirmed independent-group design it runs
  Welch tests with Holm correction.
- Exports figures as vector SVG, 600 dpi PNG and PDF, together with the plotted data
  (CSV) and the methods and settings used (JSON).
- Saves every calculation as a new version, so earlier results remain available.

## Installation

The workbench is installed as a Python package with [uv](https://docs.astral.sh/uv/).
You do not need to install Python, Node.js or Git, and you do not need administrator
rights.

**Requirements**

- Windows, macOS or Linux
- An internet connection during installation
- A GitHub account with access to this repository (while the repository is private)

**Quick install on Windows**

Run each command in **PowerShell**.

1. Install uv, then close and reopen PowerShell. Skip this step if uv is already
   installed, for example for saRNA Designer.
   ```powershell
   powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
   ```
2. Download `qpcr_workbench-0.1.0-py3-none-any.whl` from the
   [latest release](https://github.com/JoepVondervoort/qpcr-dashboard/releases/latest)
   to your Downloads folder.
3. Install the workbench, then close and reopen PowerShell:
   ```powershell
   uv tool install --python 3.11 "$env:USERPROFILE\Downloads\qpcr_workbench-0.1.0-py3-none-any.whl"
   ```
4. Start it:
   ```powershell
   qpcr-workbench
   ```
   The workbench opens in your browser at <http://127.0.0.1:8002/>. Keep the
   PowerShell window open while you work, and press **Ctrl+C** in it to stop.

For macOS, troubleshooting and a more detailed walkthrough, see
**[INSTALL.md](INSTALL.md)**.

**Updating.** Download the new `.whl` file from the releases page and run the
install command from step 3 with the new file name. `uv tool upgrade` does not
update installations made from a file. Your data is kept.

**Where your data is stored.** All projects, settings, saved analyses and copies
of imported files are kept in `.qpcr-workbench` in your home folder
(`C:\Users\<name>\.qpcr-workbench` on Windows). Updating or uninstalling the
workbench does not change this folder. To make a backup, stop the workbench and
copy the folder. The workbench only accepts connections from your own computer.

## Using the workbench

1. **Import.** Choose **Upload results**, name the project and select an instrument
   export, or several plate files of one experiment. The raw Ct overview opens
   straight away. Each instrument run is kept separate unless you combine plates
   into one run.
2. **Describe the samples.** Open **Set up analysis** and check the suggested
   conditions, time points and biological replicates under **Samples & design**.
   Save the sample mapping.
3. **Normalize.** Under **Normalization**, select the run, the reference genes and
   the baseline samples, then choose **Calculate expression**.
4. **Review quality.** The QC review lists control signals and technical replicates
   with a Ct range above 1 cycle (adjustable). Exclude wells with a reason, or mark a
   finding as reviewed with a note.
5. **Inspect and export.** Use **Overview**, **All genes**, **Statistics** and
   **History** to explore the results. Every figure has an **Export** menu.

The **Experiments** page lists all imports, and the **Gene explorer** shows one gene
across experiments and runs. The [user guide](docs/user-guide.md) describes every
view and setting.

## Calculation conventions

The main analysis choices are listed here so that results can be interpreted and
reported correctly. The [user guide](docs/user-guide.md) gives the full details.

- Technical wells are averaged within each biological sample. They do not increase
  the biological n.
- With several reference genes, the reference value is the arithmetic mean of their
  Ct means. Under the usual equal-efficiency assumption, this equals the geometric
  mean of their quantities. Every selected reference gene must be present for a
  sample to receive a normalized result.
- The baseline is the mean ΔCt of all selected baseline biological samples. A target
  that is not detected in every baseline sample is normalized to the first later
  time point where it is, and the figure says so.
- Instrument runs are never pooled unless you combine their plates into one run,
  and a sample's wells are never pooled across plates. Biological replicates are
  not combined automatically.
- No-template controls (for example H2O, water and NTC) are recognized and excluded
  from normalization and statistics. They remain visible in the raw data.
- Expression figures use a log₂ fold-change axis by default and show the geometric
  mean ×/÷ geometric SD. A linear axis is available.
- Statistics are descriptive by default. Welch tests require an explicitly confirmed
  independent-group design and confirmed assumptions. Paired, repeated-measure,
  blocked and factorial designs are currently reported descriptively only.
- The screening threshold (default 1.5×) marks large effects. Crossing it is not
  evidence of statistical significance.
- Saved analyses keep the settings and inputs they were calculated with. Changing
  the sample setup or updating the workbench never recalculates them silently.

## Scope and limitations

- Input must be Ct/Cq result exports. Ct values are not called from amplification
  curves.
- The workbook importer has been verified on QuantStudio exports of the LAD081
  layout. Other workbook layouts may not import yet; they produce an error message
  instead of an empty experiment.
- Assay efficiencies are not estimated or applied.
- This is a single-user application for one computer. It has no user accounts,
  sharing or central hosting.

## Development

**Requirements:** Python 3.11 or later and Node.js 20.19 or later.

**Set up**

```bash
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -e ".[dev]"
npm --prefix frontend ci
```

**Run in development mode** (two terminals)

```bash
python -m uvicorn backend.app:app --host 127.0.0.1 --port 8000 --reload
```

```bash
cd frontend
npm run dev -- --host 127.0.0.1 --port 4173
```

Open <http://localhost:4173>. Vite forwards `/api` and `/openapi.json` to the API on
port 8000, so the browser only talks to one address. Use `--host 0.0.0.0` only if you
need to open the development server from another device, because it makes the
server reachable from your network.

To run the packaged single-address mode from a checkout, build the interface with
`npm --prefix frontend run build` and start `python -m backend`. This is the same
launcher as the installed `qpcr-workbench` command.

**Checks**

```bash
python -m pytest
npm --prefix frontend test
npm --prefix frontend run lint
npm --prefix frontend run build
```

An end-to-end browser test uses synthetic data, temporary storage and free ports:

```bash
python -m pip install playwright
python -m playwright install chromium
python scripts/check_import_browser.py
```

Options: `--packaged` runs the same checks through the `qpcr-workbench` launcher
(this rebuilds `frontend/dist`), and `--workbook <file.xlsx>` adds checks against a
local LAD081 workbook. Set `QPCR_TEST_CHROMIUM` to use an existing Chromium
executable.

**Configuration**

| Variable | Purpose |
|---|---|
| `QPCR_DATA_DIR`, `QPCR_UPLOAD_DIR` | Database and upload folders. Default: `backend/data` and `backend/uploads` in a checkout. The `qpcr-workbench` launcher sets them from `--data-dir`. |
| `QPCR_CORS_ORIGINS` | Comma-separated origins allowed to call the API from another address. Empty by default, so other websites cannot read local data. |
| `QPCR_BACKEND_URL` | API address that the Vite development server forwards to. Default: `http://127.0.0.1:8000`. |
| `VITE_API_ROOT` | Build-time API address for deployments that serve the API separately. Requires a matching `QPCR_CORS_ORIGINS`. |

To open the data of a development checkout with the installed app, run
`qpcr-workbench --data-dir ~/qpcr-dashboard/backend`.

**Project layout**

| Path | Contents |
|---|---|
| `backend/qpcr_engine/` | File parsing, normalization, quality checks and statistics |
| `backend/app.py` | HTTP API and SQLite storage |
| `backend/__main__.py` | The `qpcr-workbench` launcher |
| `frontend/` | React and TypeScript interface (Vite) |
| `scripts/` | End-to-end browser test |
| `docs/` | User guide and development roadmap |

**Research data.** Research workbooks, PDFs, local databases, uploads and backups
are excluded by `.gitignore`. Tests that need the private LAD081 workbook are skipped
when it is absent. Do not force-add research files: removing a file later does not
remove it from the Git history.

## Releasing

1. Give each colleague read access under **Settings → Collaborators**.
2. Increase `__version__` in [backend/__init__.py](backend/__init__.py), which is
   the single source of the version number. Update the wheel file name in this
   README and in [INSTALL.md](INSTALL.md) to match. A test checks that they agree.
3. Commit, tag and push:
   ```bash
   git tag v0.1.0
   git push origin main v0.1.0
   ```
4. The [checks workflow](.github/workflows/checks.yml) runs the tests, builds the
   wheel, installs and starts it on Windows and Linux, and publishes it as a GitHub
   release for the tag.

Without GitHub Actions, build the wheel locally with `uv build --wheel` (requires
Node.js; output in `dist/`) and publish it with
`gh release create v0.1.0 dist/qpcr_workbench-0.1.0-py3-none-any.whl`.

Before a public release, rename the Python package from the generic `backend` to a
distinctive import name, choose a license, and check the Git history for research
data.

## Roadmap

Planned work includes database migrations with automatic backups, cross-experiment
comparisons and optional hosted accounts. See
[docs/upgrade-plan.md](docs/upgrade-plan.md).

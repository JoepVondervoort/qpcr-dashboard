# qPCR Analysis Workbench upgrade plan

Planning baseline: 25 October 2026. The delivery sequence below is the roadmap; the status here distinguishes implemented work from future work.

## First implementation status

Implemented locally: grouped baseline biological samples; editable suggested conditions and common-reference/day-zero suggestions; required-reference completeness; sample exclusions with reasons; sample SD; biological condition charts; adjustable hit threshold; normality diagnostics; explicitly confirmed independent Welch comparisons with Holm correction; clickable statistics explanation; saved analysis versions, input hashes and snapshot JSON exports. Existing saved analyses are retained during initialization.

Still planned: per-measurement exclusion/QC workflow, protocol-specific positive-control evaluation, paired/repeated/factorial statistical models, cross-experiment history comparisons, immutable candidate registry, single-launcher distribution and hosted private accounts. Analysis history currently compares saved snapshots by inspection, not experiments numerically.

## Product decisions

- Primary validation fixture: `Analysis LAD081_ qPCR_09042026_example.xlsx`, raw input from Sheet1. CHD2 workbooks are historical examples, not authoritative calculation specifications.
- Support differentiation/time-course experiments and saRNA screenings as separate templates on a shared experiment model.
- Suggest sample grouping and experimental setup, then require review of ambiguous assignments. All suggestions are editable.
- Default screening hit: mean biological-replicate fold change >= 1.5, adjustable. Show replicate agreement separately. This interprets the user's agreement to the proposed default; a hit does not imply statistical significance.
- Clearly flag failed positive controls as “Positive control did not work.” Distinguish missing/unassessable controls from failed controls. No P21 success threshold has yet been specified; do not assume it equals the candidate hit threshold.
- Candidate sequences are immutable. A different sequence creates a new candidate identity; labels alone must not merge candidates. Preserve strand orientation, chemistry and modifications where supplied. Missing sequence remains explicitly unknown.
- Show consistency within comparable cell/protocol contexts separately from transfer across cell types.
- Include statistics and methodology information in the workflow. Unsupported or underpowered analyses must remain visibly limited rather than producing an unjustified automatic significance label.
- Save analysis versions, original measurements, exclusions, settings and calculation provenance.
- Begin with a free local installation; retain a path to private hosted accounts and team sharing.

## Evidence from the current application and workbook

The importer reads 560 measurements from Sheet1, no warnings: two 384-well runs with 280 measurements each, ten assays, six biological sample labels and H2O per run. Runs correspond to 100% and 150% confluency. Headers are on rows 48 and 380; records occupy rows 49–328 and 381–660. Keep run identities and source coordinates.

The ACTA1 calculation tab averages four technical measurements per biological sample. Its baseline cells average the two day-zero Delta Ct values separately for each confluency (`AE2=AVERAGE(Y2,Y6)` and `AE4=AVERAGE(Y26,Y30)`). The current app uses one baseline sample, so it cannot reproduce that baseline-group behavior.

The workbook uses `GEOMEAN` on reference Ct means (`P2=GEOMEAN(M2,N2)`); the app averages reference Ct means arithmetically. Do not silently copy the workbook formula into the new scientific default. Use the documented equal-efficiency quantity interpretation, and report the discrepancy when validating against historical Excel results. Optional historical reproduction must be clearly labelled and versioned.

Derived tabs contain additional 75% confluency measurements absent from the imported Sheet1 runs. They must not be silently treated as raw input or included in complete-coverage claims. Request the original export if these measurements are needed.

The current backend saves one analysis result per experiment, replacing it on recalculation. The UI shows a raw plate and one analysis table; there is no experiment-wide chart or history comparison. Missing selected reference assays are currently silently dropped from a sample's normalization; replace this behavior with explicit incomplete-reference handling.

Thesis reference: `191591_vandeVondervoort_BNW_def_DPR.pdf`. PDF page 23 (printed 17) describes reference normalization and average non-targeting-control Delta Ct. Page 27 (printed 21) shows screening bars, individual measurements and cell-type panels. Page 122 (printed 116) shows experiment/dose colours and mean ± SD. Technical points may be inspected, but biological replicate summaries should be the primary display and inferential unit. The thesis uses differing statistical descriptions across sections; it is visual and workflow evidence, not a single executable statistical specification.

## Data model

Separate project, experiment, instrument run, biological sample, technical measurement, condition, assay, candidate and analysis version.

An experiment can contain multiple runs; a run is not automatically an independent experiment or biological replicate. Store date, cell line, differentiation state, dose/units, harvest time/units, delivery method, confluency, batch and optional notes. Presets: HeLa, AF22 NES, differentiated AF22, HEK, HepG2; allow custom values and precise sublines.

Sample names such as `10.1` suggest candidate 10 / biological replicate 1; LAD081 labels suggest confluency, day and replicate. Preserve original names and show editable structured assignments. Never infer pairing across days from `.1` alone. Use explicit biological sample IDs and optional pairing/block IDs.

Assign sample roles: treatment, scrambled/baseline, positive control, positive-control baseline, untreated, no-template control and custom. Store control mappings by analysis context, assay and relevant experimental strata. No universal control pooling across plates, doses or conditions.

Raw measurements are immutable. Exclude/restore measurements or biological samples with a reason; hiding a point changes presentation only and must not change calculations. Keep instrument omissions separate from researcher exclusions. Store settings defaults separately from resolved settings in each analysis snapshot.

## Calculation and statistics contract

1. Validate sample assignments, selected references, control mapping, assay availability and run provenance. Flag duplicate measurements and non-finite Ct values. Never convert missing Ct to zero or an arbitrary cycle maximum.
2. Average eligible technical Ct measurements per biological sample and assay. Report count and sample SD; technical wells do not increase biological n. Report precision as unavailable for a single measurement, rather than implying zero uncertainty.
3. Normalize each biological sample to the selected reference assays. Default to all required references being present. Any alternative missing-reference policy must be explicit, documented and saved. Document equal-efficiency assumptions; do not claim assay efficiency has been validated from Ct-only exports.
4. Calculate baseline-group mean Delta Ct from eligible biological controls in the explicitly mapped context. Calculate biological-sample Delta Delta Ct and fold change. Show mean biological-sample fold change and sample SD by default; distinguish this from exponentiating the mean Delta Delta Ct.
5. Separate effect threshold, replicate agreement, QC status and statistical evidence. Below-threshold does not mean no biological effect; missing is not zero; not tested is not nonsignificant.
6. Perform inferential comparisons on biological-sample Delta Ct (or explicitly modelled contrasts), not technical measurements or raw fold changes. Preserve control variability in comparisons rather than treating the estimated baseline as a known constant.
7. Establish independent versus paired/block/repeated-measure design before test selection. Same replicate suffix across conditions is insufficient evidence of pairing. LAD081 needs confirmation whether time points come from independent harvested cultures or a shared experimental block.
8. Provide Q–Q/residual diagnostics and Shapiro–Wilk where appropriate. Shapiro requires at least three observations. A nonsignificant normality result does not establish normality, particularly at small n. For paired designs assess differences; for fitted models assess residuals. Do not pool unrelated conditions merely to reach a normality-test minimum.
9. Initial supported comparisons: independent two-group Welch t-test under stated distribution assumptions; paired t-test for confirmed pairs under assumptions on differences; independent multi-treatment/control Dunnett under its normality/equal-variance assumptions, or pre-specified Welch contrasts with Holm correction where justified. Nonparametric or permutation alternatives require their own design/exchangeability assumptions and explicit estimand; do not use them as an automatic cure for small n.
10. Correct within a declared family of comparisons; record alpha, sidedness, family, adjustment and method. Default two-sided alpha 0.05. Show biological n, exclusions, effect estimates and confidence intervals when justified, raw and adjusted p-values, assumptions and limitations.
11. With n=2, show normality as not assessable and a small-sample limitation. Do not present an automatically chosen test as validated. If a researcher explicitly selects a defensible assumption-based exploratory test, label its assumptions and preserve that decision. Complex factorial/repeated/mixed designs need a separately validated model; offer descriptive results and an export until supported.
12. Cross-experiment views initially show experiment-specific effects and success frequency with denominators, separated by cell/protocol context. No automatic pooling of wells, reuse of biological samples as independent observations, or significance aggregation across runs. A later combined model must handle experiment/block effects.

## Delivery sequence and acceptance criteria

### 1. Correct, inspectable LAD081 analysis

- Add editable sample/condition mapping and grouped baselines, explicit reference policy and reversible exclusions.
- Preserve multiple analyses and record software/method versions and input hashes.
- Acceptance: all 560 Sheet1 records retained; two runs preserved; four technical wells summarized per applicable biological sample; baseline groups use both day-zero samples per confluency; no 75% data invented; reference formula discrepancy explained.
- Verify calculations against independently calculated expected values, including missing references, exclusions, baseline variability and non-finite inputs. Do not merely assert equality to the historical workbook's formulas.

### 2. Experiment dashboard with supported statistics

- Screening and time-course templates; mean ± SD with biological points and optional technical detail; baseline 1× and adjustable 1.5× hit line for screening.
- LAD081: assay selector/overview, day on x-axis, confluency panels, biological replicate points. Screening: candidate order, controls and separate positive-control assessment.
- Show diagnostics and supported test outcomes in the dashboard, including clearly explained unavailable results.
- Acceptance: tested independent/paired cases, multiplicity correction, tiny samples, constant data and incomplete controls; export figures plus results and methodology summary. No test inference from replicate suffix alone.

### 3. Research history

- Compare the same immutable candidate across experiment dates, with filters for cell model, dose, delivery and analysis settings.
- Separate within-context repeatability and across-cell-model transfer. Show QC and analysis-version provenance in comparisons.
- Acceptance: changing the hit threshold updates classification through a saved analysis version; historical results remain recoverable; different sequences with the same display label never merge.

### 4. Free local distribution

- Follow the existing saRNA Designer installation model: Python package containing the built frontend, one launcher, browser at loopback, user data outside the installation/repository.
- Serve frontend and API from one origin; replace hard-coded `http://localhost:8000`. Normal use must not require Node or two terminals.
- Add install/update instructions for Windows, macOS and Linux; packaged release and GitHub installation routes; version display, explicit upgrade action, backup/export/import and database migrations with pre-migration backup.
- Automated repository checks build the frontend, test scientific calculations and migrations, and build the distributable. Pin/review dependencies for reproducible releases.
- Acceptance: install, launch, upgrade and uninstall/reinstall preserve user data; backup round-trip works; no upload occurs in local mode. Updating code must not recalculate saved results automatically.
- Limitation: each user upgrades their own installation. This does not provide automatic central rollout or synchronized accounts/sharing.

### 5. Hosted accounts when needed

- Retain the React/Python calculation engine. Add authenticated private workspaces, ownership/authorization on every resource, persistent database and upload storage, backups and migrations before colleague access.
- Team membership and invitation-based experiment sharing follow later. A local workspace is not an account or a secure shared multi-user installation.
- Deploy tested GitHub revisions to a stable HTTPS address. Application releases and user data have separate lifecycles; migrations and analysis provenance protect old results.
- Free hosting must be evaluated with durable data storage and limits included. The current SQLite/uploads setup must not be placed on ephemeral storage. Render's current free web filesystem is ephemeral and its free Postgres expires after 30 days, so that combination is unsuitable for durable researcher data.

## Remaining scientific inputs

These do not block independent implementation work: whether LAD081 biological samples are paired/blocked across days; the positive-control threshold/protocol; whether required assay-efficiency information is available. Surface these as unresolved setup fields rather than guessing.

## Sources checked

- Local saRNA Designer README and INSTALL.md: installable local browser app and explicit `uv tool upgrade sarna-designer` update workflow.
- MIQE checklist: https://www.gene-quantification.de/miqe.html
- SciPy Shapiro–Wilk requirements: https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.shapiro.html
- SciPy independent/Welch t-test: https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.ttest_ind.html
- SciPy Dunnett test: https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.dunnett.html
- Render free service limitations: https://render.com/docs/free

Test choices, conservative small-sample behavior and release phases above are proposed application policy, not claims that these sources prescribe a universal automatic test-selection algorithm.

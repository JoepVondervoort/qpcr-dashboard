# User guide

This guide describes the views, settings and calculation conventions of the qPCR
Analysis Workbench. For installation, see [INSTALL.md](../INSTALL.md).

## Contents

1. [Importing data](#1-importing-data)
2. [Experiments and the Gene explorer](#2-experiments-and-the-gene-explorer)
3. [Samples and experimental design](#3-samples-and-experimental-design)
4. [Normalization](#4-normalization)
5. [Reference-gene stability](#5-reference-gene-stability)
6. [Quality control](#6-quality-control)
7. [Viewing results](#7-viewing-results)
8. [Statistics](#8-statistics)
9. [Figures](#9-figures)
10. [Exports](#10-exports)
11. [Versions and recalculation](#11-versions-and-recalculation)

## 1. Importing data

**Supported files.** CSV, XLSX/XLSM and legacy XLS files that contain Ct/Cq
results, as exported by the qPCR software for each plate. Ct values are not called
from fluorescence curves. Workbooks assembled by hand, such as a lab notebook with
Ct tables copied from several plates, are not imported: they lack the run
information that keeps plates apart. Upload the original export of each plate
instead.

**QuantStudio workbooks.** The importer reads the instrument result sections that
carry run metadata and skips derived calculation tabs. Repeated result sections are
kept as separate runs. The LAD081 example workbook imports as 560 measurements in
two 384-well runs of 280 measurements each; its per-gene calculation tabs are not
used as input. QuantStudio 5 exports saved in the older XLS format (for example the
LAD080 plates) import the same way; their amplification and melt-curve tabs are not
used. A file with an unsupported layout produces an error message rather than an
empty experiment.

**Exports without sample names.** Many exports do not say which sample is in which
well: the sample names are empty, or one name such as "Plate 2" is used for the whole
plate. These files still import, and the workbench reads the layout from the plate
itself (see [Numbered samples](#numbered-samples)). Give the samples their real names
under **Plate layout** to see your conditions (see [Plate layout](#plate-layout)).

**Measurement states.** Undetermined, missing, invalid and instrument-omitted
measurements stay distinguishable after import. The plate map uses the 96-well or
384-well format when the export states it.

**Importing.** Choose **Upload results** (or **Upload your first results** in an
empty workspace), or drag export files from your file manager and drop them anywhere
in the workbench window. Files you choose or drop are added to a list; remove one
with its **×**. Enter a project name and choose **Create project and import**. One
file becomes one experiment: the workbench detects its instrument runs and opens the
raw Ct overview straight away, before any analysis setup. Run cards switch between
runs without combining their measurements. If a file with the same name was imported
before, you are told so; importing it again creates a separate experiment. The
original files are stored unchanged.

**Several files at once.** The workbench cannot tell whether several files are
separate experiments or plates of one experiment, so it asks **How do these files
belong together?** and imports nothing until you choose:

- **Separate experiments**: one experiment per file, each named after its file, for
  example a week of unrelated runs. The files are imported one after another and the
  experiment list opens. A file that cannot be imported stays in the upload panel with
  the reason; the others are kept.
- **One experiment, each plate its own run**: each plate is normalized to baseline
  samples on that same plate.
- **One experiment, plates in one combined run**: the plates form one run that shares
  one baseline, for example when day 0 is on one plate and days 21 and 28 are on
  another. Each sample's ΔCt still uses the target and reference wells of its own
  plate; only the baseline comes from another plate. Plates are compared directly,
  without inter-run calibration, so plate-to-plate differences are part of the result.

Plates that arrive later are added with **Add plates** below the experiment title,
either as a separate run or into an existing run. Choose the files there, or drop them
on **Add plates**: files dropped anywhere else start the upload of a new experiment.
Saved results become out of date until you recalculate. The plate a measurement came
from is kept: the plate map has
a plate selector, and QC findings are reviewed per plate. Two safeguards apply. A
plate that is already in the experiment is refused. Plates are not combined when the
same biological sample is measured for the same assay on both, because that would
pool its wells across plates; keep such plates as separate runs. A name that covers
more wells than one sample's replicates, such as one placeholder name for every well,
does not count as a sample here: such plates can be combined, and **Plate layout**
then asks for the real names on each plate.

## 2. Experiments and the Gene explorer

**Experiments** lists every import across all projects. You can search by
experiment, file name, project or run; filter by project, QC concerns or incomplete
analysis; and sort by upload date or name. Dates are upload dates. The workbench does
not infer a run date from a file name.

- Sample counts are the distinct biological samples within each run, not wells.
- QC and analysis badges reflect the current saved setup. Partly calculated and
  out-of-date analyses are shown separately.
- **Key changes** shows the three genes with the largest fold change in either
  direction. Baseline conditions are not counted.
- The **Analysis** column names reference-gene stability experiments. **Stability
  experiment? Open it to answer** marks an experiment whose type question is open
  (see [Reference-gene stability](#5-reference-gene-stability)).

**Gene explorer** shows one gene across every experiment and run, with time points
aligned in columns. Each value comes from that run's own saved analysis and
baseline. Runs and experiments are shown side by side and never pooled.

An experiment can be renamed with **Rename**. The original file name is kept as
provenance and the rename is recorded.

## 3. Samples and experimental design

**Set up analysis**, at the top right of an experiment, opens three steps:
**Plate layout**, **Samples & design** and **Normalization**.

### Numbered samples

When an export names no samples, the workbench looks for the pattern on the plate.
Technical replicates agree within a few tenths of a cycle, so the Ct values show which
wells belong together: two wells side by side, two stacked, or a 2 × 2 square. Ct values
above 32 are left out of this judgement, because late wells scatter by chance. The
workbench then numbers the samples so that one number is one sample in every gene:

- **Genes in bands of rows** (every gene in its own block of rows, the same samples in
  each): samples are numbered left to right through each band, so Sample 27 is the same
  position in every gene. A second gene in a few positions of another gene's band takes
  the numbers of those positions.
- **Genes one after the other** (one gene's samples continue on the next rows): the
  first block of every gene is Sample 1, the second Sample 2, and so on.

A sample's number is its position, and it never shifts: if position 6 is a control,
the samples are 1–5 and 7–12. Plates of one run that share numbers therefore stay
matched, and nothing you answer renumbers anything.

Positions without any Ct before the first or after the last sample, and blocks outside
the pattern without any Ct, are named NTC. Other blocks outside the pattern keep no name
and are left out until you name them; the notice says which.

**Wells for you to decide.** Some wells could be either a control or a sample, and only
you know which:

- wells with only a late Ct (above 32): a no-template control with a primer dimer, or a
  sample with very little template;
- a position without any Ct between samples: a no-template control, or a failed sample.

The workbench leaves them unnamed (out of the analysis) and asks: **No-template
controls**, or the sample whose place they hold (for example **Sample 12**). A question
stays open until all its wells have a name. Renaming the samples from a list waits until
these questions are answered, so that your names line up with the right samples.

When the pattern is clear, the workbench numbers the samples as the file is imported
and says so above the dashboard. When it is not sure (the wells do not agree like
replicates, neighbouring samples are as similar as the replicates, or genes have
different numbers of samples), it shows its guess and the reasons, and does nothing
until you choose **Use this guess** or **Set up the layout myself**. A plate on which
every well has one placeholder name gets the same offer.

If numbering cannot be applied, for example when the plates of a combined run cannot be
told apart, the file still imports and the message says what to do: import the plates
again with **One experiment, each plate its own run**, or name the samples under
**Plate layout**.

The export says nothing about conditions, so numbered samples form one group, **All
samples**: each gene shows the mean ± SD of all samples. To see your conditions, choose
**Give the samples their names**. **Rename samples** lists Sample 1, Sample 2 … in order;
paste one name per line, ending each with `.1`, `.2`, `.3` for the biological replicates
of a condition (for example `Ctrl.1`). The tool warns when one name is given to several
samples, because their wells would become one sample. **Undo numbering** gives the
wells back their names from the export.

### Plate layout

The plate layout says which sample is in which well. Exports that already name every
sample need nothing here. The workbench asks for a layout in three situations, shown
above the plate map:

- **Wells without a sample name.** They are left out of the analysis until you name
  them. When no well of a run is named, nothing can be normalized yet.
- **One name on more wells than one sample's replicates.** Technical replicates are
  two to four wells per gene. A name on more wells, for example "Rb005" on 48 wells of
  every gene, usually means that several samples share a placeholder. Name the
  separate samples, or choose **They are replicates of one sample** if that is what
  they are. Normalization waits until you do one or the other.
- **The same sample and gene on two plates of a combined run.** Give the sample a
  different name on one of the plates; wells are never pooled across plates.

There are four ways to name samples. Each shows the result on the plate as a draft;
**Save layout** keeps it.

- **Rename samples.** Lists the samples on the plate in order and replaces them with
  names pasted one per line, in every well of each sample. This is the quickest way to
  name [numbered samples](#numbered-samples).

- **Fill from a list.** Paste the sample names in pipetting order, one per line, and
  choose how many wells one sample occupies (for example 2 stacked, 3 side by side or
  a 2 × 2 block) and the numbering direction. With **Start the list again for every
  gene**, the same list fills each gene's block of wells, as in plates where every
  gene has its own band of rows. The fill applies to the selected wells, or to every
  well when nothing is selected, and skips wells that are technical controls. Name
  the control wells first if the export leaves them unnamed.
- **Paste a plate grid.** Copy a plate layout from Excel, one cell per well, and paste
  it. Row letters and column numbers may be included; empty cells are left as they
  are.
- **Name selected wells.** Drag across the plate, or click a row letter or column
  number, to select wells, then type a name. Shift-click extends the selection and
  Ctrl-click adds wells. **Use the instrument's names** restores the selected wells.

Wells are coloured by sample (or by gene) so that each sample reads as one patch, and
the list under the plate shows how many wells each sample has per gene. The
instrument's own name stays visible for every renamed well, in the plate map and in
**Plate & samples**. Saving a layout makes saved results out of date; well
exclusions are kept because they identify the well, not the sample name.

### Sample mapping

**Sample mapping.** The workbench suggests a condition, time point and biological
replicate for each sample name. A final `.N` is read as the biological replicate
number, separate from the condition and the day or hour. The LAD081 100% and 150%
series are recognized across days 0, 21 and 28. Confluency and the HDFn, HeLa and
AF22 cell-line naming conventions are recognized; other cell lines appear as
**Not annotated** until you assign them.

Time points are read from spellings such as `day 0`, `Day21`, `d7`, `72h` and
`48 hpt`, and also when the day is attached with an underscore (`_day0`,
`__day21`). Names without a time point, as in experiments measured on a single
day, stay conditions without a time axis. A label after the replicate number, as
in `day 21.2 RS`, is read as part of the condition: replicate 2 of "… RS" at day 21,
a series separate from the samples without the label.

**Replicate numbers after `_`, `-` or a space.** Older names often count replicates
as `LAD046_LNP4_50_1`, `LAD046_LNP4_50_2`, `Apt 44 1-2` or `IMR90 2`. Such a number
can also be a dose or a sample number, so it is never applied without your answer.
**Samples & design** lists every group of names in one run that differ only in a
short run of consecutive final numbers (`_1, _2` or `_3, _4`, at most six). Tick the
groups whose names are replicates of one condition, then save: a ticked
`LAD046_LNP4_50` group becomes that condition with replicates 1 and 2, and unticked
names stay their own conditions. Any other guess in a name, such as a time point
read from `d7`, is shown next to its group. The answers are saved and not asked
again; unsaved edits of other rows stay unsaved. The workbench never asks about
doses such as `_50, _100`, time points such as `day 2`, `Week 2` or `30 min 1`,
plates, runs or dates, a name without a sibling, or names that already end in `.N`.

Suggestions read from such unusual spellings are marked **check**, and the status
line asks you to look at them. Correct anything that is wrong, then choose
**Confirm suggestions** or save the mapping. Saving a row counts as confirming it.

The mapping table can be searched, filtered by run and edited in bulk for selected
rows. Edits remain a draft until you choose **Save sample mapping**.

- Mappings are stored per run and sample, so the same label on two runs can have a
  different day, unit or biological identity.
- Give every biological sample a condition. Leave no-template controls ungrouped.
- A condition cannot mix baseline and treatment samples.
- To exclude a biological sample from the analysis, enter a reason. Clearing the
  reason restores it. The original upload and measurements are never changed.
- Sample name suffixes never define pairing or a repeated-measures design. Lines in
  time-course figures connect condition means only.

**Technical controls.** Water, no-template, mastermix-only and no-RT labels (for
example H2O, H₂O, H2O_1, H20, water, NTC, mm, mastermix, -RT and noRT) are recognized
as technical controls. A "gene" measured only in such wells, such as a mastermix
well whose target is also called "mm", is not offered as a target. They remain in the upload
and the raw plate and table, but are excluded before normalization, baseline
calculation, condition summaries and statistical tests. Check the inferred roles and
correct any misclassification. A technical control cannot be a biological baseline
unless you change its role.

**Design.** Record the time origin, time unit and study design explicitly. The
time-axis title can be edited, for example to "Days after transfection" or another
time origin.

## 4. Normalization

In **Normalization**, select the run, one or more reference genes and the baseline
biological samples. Common reference genes (for example GAPDH, ACTB, RPL32, TBP,
C1ORF43 and 18S rRNA) are preselected, also when the target name carries a
primer-set number such as "GAPDH 1"; choose the references your protocol specifies. The setup summary lists anything still missing, and
**Calculate expression** becomes available when the setup is complete. Errors are
shown next to the setup controls.

By default every non-reference gene in the run is calculated. Clear that option to
analyze a single target gene. Each target with a valid result is saved as its own
analysis version. A target whose baseline is incomplete keeps its raw Ct panel,
with the reason normalization was not possible.

**Targets not detected at the baseline.** Some genes are not expressed at the
baseline, for example a neuronal marker in day-0 fibroblasts. When a target is not
detected in every baseline sample, the workbench normalizes it to the first later
time point of the same series at which it is detected in every sample. Earlier time
points get no fold change for that gene. The figure, its readout and its exports
say which baseline was used and why. This needs time points in the sample mapping;
without them, or when no later time point qualifies, the target is reported as not
normalizable. A missing reference gene at the baseline is never handled this way.

**Partly detected wells.** When only some technical wells of a sample are detected,
its mean uses the detected wells. The readout beside the figure lists these samples
under **Wells**, and the plotted-data export includes the detected and total well
counts.

**Calculation**

- Technical wells are averaged within each biological sample. They do not increase
  the biological n.
- With several reference genes, the reference value is the arithmetic mean of their
  Ct means. Under the standard equal-efficiency assumption this equals the geometric
  mean of their quantities. The workbench does not take a geometric mean of Ct
  values, so results differ from the `GEOMEAN`-of-Ct formula in the historical
  LAD081 Excel workbook.
- Every selected reference gene must be present for a sample to receive a
  normalized result.
- The baseline is the mean ΔCt of all selected baseline biological samples. This
  differs from normalizing to a single baseline sample.
- Measurements from different runs are never combined, and biological replicates
  are not pooled automatically. Plates are only analyzed together when you combine
  them into one run, and a sample's wells are never pooled across plates.
- Assay efficiencies are not estimated or applied. Notes on reference-gene
  validation and assay efficiency can be saved with an analysis.

The screening threshold (default 1.5×, adjustable) marks conditions with a large
mean fold change. Crossing it is separate from statistical evidence.

## 5. Reference-gene stability

Some experiments do not measure expression. They test which candidate reference genes
stay stable across the samples and conditions of a study. Such a plate has no target
gene, baseline or fold change. The result is the raw Ct of each candidate gene per
condition, and a ranking of their stability.

**Experiment type.** The workbench asks **Is this a reference-gene stability
experiment?** in two cases:

- A name mentions housekeeping genes, `hkg`, gene stability, reference genes or geNorm,
  and at least two reference genes were measured. (A bare "stability", as in mRNA
  stability experiments, is not enough.) This can be the experiment's name, the
  uploaded file or the instrument's own file.
- At least four recognized reference genes were measured, and they are at least twice
  as many as the other genes.

The question lists its reasons, and nothing changes until you answer. The
**Experiment type** switch at the top of **Set up analysis** changes the answer at any
time. Saved expression results are kept.

**Setup.** A stability experiment needs the plate layout and **Samples & design**, but
not **Normalization**. **Show stability results** opens the dashboard. Name the samples
with their conditions as usual, for example `AF22 day 7.1`. Numbered samples are
compared as one group, **All samples**, until you name them.

**Genes compared.** Recognized reference genes are compared by default. When fewer than
two are recognized, all genes are compared. Tick a target gene to see how it behaves, or
untick a gene that was not measured in every sample. The choice is saved with the
experiment.

**What the dashboard shows.**

- A summary in words: the most stable pair, the least stable gene, how many reference
  genes are enough, and which genes move with the condition.
- **Ct of each gene across samples.** Each point is one sample: the mean Ct of its
  technical replicates, coloured by condition. Boxes span the middle half of the
  samples. Hover a point to follow that sample through every gene. A sample with a
  high Ct in every gene had less RNA; its genes are not unstable.
- **geNorm stability (M)** and **How many reference genes?** (pairwise variation).
- A table that gives for each gene the number of samples, the mean Ct, the SD of Ct,
  the shift between condition means, the same shift relative to the most stable genes,
  and geNorm M. **Ct per sample (table)** lists every sample's values.
- **Ct per condition**: the usual Ct figure for every compared gene, with export.
  Other genes on the plate are listed below them.

**Calculations.** Omitted, excluded and undetermined wells are left out of a sample's
mean. The SD and the condition shift use every sample measured for that gene. geNorm M
and pairwise variation use only the samples measured for every compared gene; the
other samples are listed. Ct differences are read as log₂ ratios, which assumes 100%
amplification efficiency.

- **geNorm M** (Vandesompele et al., 2002) is a gene's mean SD of Ct differences with
  every other compared gene. The least stable gene is dropped and M recalculated until
  two genes remain; these two share rank 1. M below 0.5 is typical of stable genes in
  similar samples, and M below 1 in mixed samples (Hellemans et al., 2007).
- **Pairwise variation V n/n+1** is the SD of the change in the normalization factor
  (the mean Ct of the n most stable genes) when the next gene is added. Below 0.15 the
  extra gene adds little. The cut-off is a guide, not a rule.
- **SD of Ct** above 1 cycle is inconsistent in BestKeeper (Pfaffl et al., 2004). A
  sample with less RNA raises every gene's SD. geNorm compares genes within each
  sample, so such input differences cancel.
- **Shift relative to the most stable genes** subtracts each sample's mean Ct of the
  two most stable genes (for those two, the other one) before comparing condition
  means. A gene that shifts more than one cycle this way changes with the condition.
  Do not use it as the reference for those conditions. With only two genes compared,
  a shift cannot be attributed to either, so none is flagged.

**Exports.** Each figure downloads as SVG. **Ct per sample (CSV)** and **Download
table (CSV)** give the numbers for a spreadsheet.

## 6. Quality control

Quality checks are computed from the original measurements. Two situations are
flagged:

- signal detected in a technical control, and
- a technical replicate Ct range above the review threshold (default 1 cycle,
  adjustable).

These flags are prompts for review. They are not automatic contamination diagnoses
or universal acceptance limits.

Flags that share one likely cause (same run, plate, sample and type) are grouped
into a single finding, for example "H2O · signal in 9 assays". In a combined run,
each plate's controls form their own finding, such as "H2O on LAD080_3 · signal in
10 assays". Each finding has two actions:

- **Save exclusions** excludes the selected wells. Each well needs a reason, and the
  audit note is composed from them. Restoring a well asks for a reason as well.
- **Mark as reviewed** records one note for every flag in the finding. The signal
  itself stays visible.

**Preview exclusion effect** compares the normalized sample values with and without
the proposed exclusions, without saving a new analysis or changing the statistics.
All exclusions, restorations and review notes remain in the audit trail.

The QC list can be filtered by unresolved or reviewed findings, control signals or
replicate spread, and searched by sample or assay. Technical controls stay visible
when you filter by biological time point or condition.

## 7. Viewing results

An experiment has five tabs: **Plate & samples**, **Overview**, **All genes**,
**Statistics** and **History**. A new import opens on **Plate & samples**.

**Plate & samples** shows what the workbench read from the file, so you can check that
it reads the plate as you meant it before relying on any result. A line at the top
counts wells, genes, samples, conditions, control wells and wells without a sample
name. Three views show the same wells:

- **Plate**: every well with its Ct, coloured by condition, sample, gene or Ct. Select a
  well to see its sample, condition, replicate, cell line and name in the export; the
  sample's other wells are outlined on the plate and listed with their Ct. Wells in an
  open QC finding are ringed.
- **Table**: one row per well and gene, with Ct, sample, condition, time, replicate,
  cell line and notes (control, excluded, no sample name). Filter it by well, sample,
  gene, condition or cell line, and download it as CSV.
- **Cell culture**: biological samples in visual culture vessels, with conditions sharing
  a plate and distinguished by color and label. Six samples across three conditions
  fit on one 6-well plate. These are illustrative culture vessels, separate from the
  qPCR instrument plates.
  Choose a 6-, 12-, 24-, 48- or 96-well plate, or a 35, 60 or 100 mm Petri dish.
  The initial default is a 12-well plate; **Use as my default** saves your choice in
  this browser for future visits and other experiments. Extra samples continue onto
  additional plates or dishes. Select a sample to see its replicate, cell line,
  confluency, time point and measured qPCR wells, with Ct and mean. Excluded and
  undetermined measurements are struck through. Culture positions show samples in
  display order and do not reconstruct the original culture layout; the cell drawings
  are decorative. Controls and wells without a sample name are listed below.

**Change samples** opens **Plate layout**; **Change conditions** opens **Samples &
design**. Import notes are collected at the bottom, with repeated notes counted once.

**Status line.** A single status line at the top lists what needs attention. The
most urgent item comes first, with the action that resolves it, for example
**Recalculate results** when results are out of date.

**Overview heatmap.** Switch between raw Ct and normalized expression.

- Columns are grouped by condition series and run, and baseline columns are
  labelled.
- Expression cells show log₂ of the geometric mean fold change, centred on 1×, with
  a color legend from ⅛× to 8×. Missing, uncalculated and out-of-date results are
  shown differently. A † marks out-of-date cells when only some results are out of
  date.
- Raw Ct cells average the technical wells within each sample and then weight
  samples equally. Omitted wells and saved exclusions are left out. Darker means a
  lower Ct.
- Values are shown with two significant figures; the tooltip gives the exact value.
  The biological n is shown once per column, and a cell is marked only when its n
  differs.
- **Largest change first** sorts genes by effect size. Genes without any expression
  result are listed in a footnote.
- Clicking a cell opens that gene in the inspector with its run, series and time
  point selected.

**Inspector.** For the selected gene, choose Expression, Target Ct, Reference Ct, QC
review or Statistics. The figure is shown next to a readout of the plotted values
(fold change ×/÷ SD or Ct ± SD, with n), the reference genes, the baseline, the
result status and any open QC findings.

**All genes** shows every gene as a panel in a grid of two to four columns, for
normalized expression or raw Ct.

- Confluency and cell-line buttons select one or more groups, or **All**. These
  filters select observations; they never recalculate the saved normalization.
- Drag a panel's **Move** handle to reorder panels. Arrow buttons and arrow keys work
  as alternatives. **Undo reorder** and **Reset plot order** restore earlier orders.
- Pin frequently used genes, show **Pinned genes only**, or search by assay name.
  These preferences are stored per experiment in your browser and do not affect the
  data or saved analyses.
- **Same y-axis for all genes** gives every panel one shared range. One legend above
  the grid describes all panels.

**Figure builder / report** combines several panels when you need them together.

**Filters.** Run, condition series, time point and assay filters change which
observations are displayed. They do not recalculate baselines or pool runs.
Instrument omissions and missing measurements are counted; omitted numeric values
are drawn as crosses and never enter a mean.

On small screens, experiments are shown as cards and the result filters collapse.

## 8. Statistics

Choose a run and gene in the **Statistics** tab to see replicate summaries and
normality diagnostics. **Why these statistics?** explains the reasoning, the test
assumptions and how to interpret the results.

**Inference.** Descriptive output is the default.

- Welch comparisons between independent groups are available only after you confirm
  an independent-group design and the distribution assumptions.
- Repeated biological-unit IDs within a run block independent-group inference.
  Paired, blocked, repeated-measure and factorial designs are reported descriptively.
- Holm correction covers all planned condition-versus-baseline comparisons in a
  saved analysis. In single-gene mode, that is the comparisons for that gene. When all
  targets are calculated together, it is every planned gene and condition comparison
  in that batch and run. Comparisons that cannot be estimated stay in the family, which
  is conservative. Separate runs and batches are not corrected together.
- With two biological observations, normality cannot be assessed and any requested
  assumption-based test is exploratory.
- Raw Ct plots are descriptive. Technical wells never enter a statistical test as
  replicates.
- No protocol-specific success rule for positive controls is applied.

**Biological distributions & normality** (in QC review and Statistics) shows dot
plots of biological ΔCt values and normal probability plots, computed with SciPy's
[`probplot`](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.probplot.html)
with a fitted reference line. The
[Shapiro-Wilk](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.shapiro.html)
test is shown as a diagnostic, not as a rule for choosing a test. Groups with fewer
than three observations or constant values are marked as not assessable. The
diagnostic data can be downloaded as JSON and the plots as SVG. Older analyses
without probability-plot data need a new calculation to show the plot.

**Significance markers.** An expression plot shows `*` for a condition only when all
of the following hold: the result is current and fully displayed, it covers a single
location, and its saved Welch comparison has a Holm-adjusted p-value below the
recorded alpha. Raw p-values and screening-threshold crossings never produce a
marker. Descriptive or unconfirmed analyses, filtered subsets and historical results
show an explanation instead. Filters never rerun a test. Exact adjusted p-values,
n and the reasons for each result are listed under **Statistics** below each figure.
Statistical annotations can be hidden without hiding the results.

## 9. Figures

**Marks.** Each condition has a filled marker for its summary value, with whiskers,
and lighter circles for the individual biological samples. Raw Ct figures also show
technical wells as faint dots. Bars start at 1× and sit side by side per series.

**Expression axis.** The default is a log₂ fold-change axis, so 0.5× and 2× are the
same distance from 1×. On this axis the marker and whiskers show the geometric mean
×/÷ geometric SD, which is the mean ± SD of log₂ fold change (−ΔΔCt). The heatmap,
Gene explorer and Key changes use the same geometric mean, so a baseline condition
reads exactly 1×. The Statistics cards show the arithmetic mean saved with each
analysis and state that they do. Ticks read as fold changes (⅛×, ¼×, ½×, 1×, 2×).
The range always includes 1× and at least two powers of two. A linear axis can be
chosen per plot (**Settings → Y scale**) or for the whole dashboard
(**Dashboard appearance → Expression axis**).

**Time axis.** Time is drawn to scale by default. Equal spacing is used when the
closest time points would overlap, for bar charts, or when you choose
**Measured times**; **Proportional elapsed time** always draws to scale. Labels keep
the actual day or hour values, and figures state when equal spacing is used. The
y-axis title names the baseline, for example "Fold change vs Day 0", and the baseline
explanation is placed below the plot.

**Legends and colors.** Time courses with up to four series and a constant n are
labelled at the line ends, with n stated once. Otherwise a legend is placed above the
plot. Colors stay consistent across panels and filters. Ct axes are scaled per assay.

**Settings → Axes.** Set X and Y limits, tick intervals, axis titles and time spacing.
Changes are previewed immediately.

- **Save this plot** stores only the settings that differ from the dashboard defaults.
- **Apply axes to all expression plots** (or **all Ct plots**) makes them the default
  and clears individual axis settings for that quantity. Individual styles are kept.
- **Use dashboard settings** removes a plot's own settings. **Reset to automatic**
  clears manual axes.
- **Cancel preview** or Escape discards the preview. **Undo last appearance change**
  restores the previous appearance.

Invalid limits and very dense tick intervals cannot be saved. When manual limits crop
the data, the figure states which measurements, intervals or baseline lie outside the
axes. Cropping never excludes or recalculates data.

**Settings → Style & colors.** Color by condition and run, condition, confluency,
cell line, run or biological sample, or choose a **Color palette**. Bar fills, points
and bar outlines have separate color controls, and individual bars and points can be
overridden. Point size, filled or hollow points, bar opacity, line width and grid
lines are adjustable. **Apply style to entire dashboard** sets the style as the
default for both quantities and keeps axis settings. Sample colors never turn
technical wells into biological replicates.

**Dashboard appearance & shared scales** sets shared or individual Y scales for
expression and for Ct. Shared ranges include the selected assays, the biological
observations and their SD; Ct ranges also include technical controls. Pinning and
search do not change shared ranges. Numeric X limits use proportional time and save
their time unit. A plot with an incompatible time unit falls back to an automatic X
axis and says so.

**Figure style** (under **Figure size, style & export**): **Screen** uses light grid
lines and open axes; **Journal** uses Arial, closed thin axes, outward ticks and no
grid lines. Both keep all text at 8 pt or larger at 85 mm width, on screen and in
every export.

Appearance settings are stored per experiment in your browser. They do not create
analysis versions or change results. The interface uses the bundled Inter typeface,
so it does not depend on fonts installed on the computer.

## 10. Exports

Each figure has an **Export** menu with:

- **Vector SVG**, which stays sharp at any size and can be edited;
- **600 dpi PNG**, sized for the selected publication width and including
  physical-resolution metadata;
- the plotted data as CSV, with a `visible_under_axis_limits` column; and
- the methods and provenance as JSON.

Figures are available at 85 mm (single column) and 180 mm (double column) width with
text of at least 8 pt; dashboard panels export at 85 mm. Exports include axes,
legends, biological n, replicate points, uncertainty labels, axis limits, styling,
color keys, cropping notes and provisional or out-of-date status. Notes that compact
on-screen panels hide are always included in exports. Empty figures cannot be
exported.

**Export dashboard PDF**, **Print current view / Save PDF** and
**Print selected report / Save PDF** open the browser print dialog to save a vector
PDF. Printed panels keep their physical size.

The experiment-level CSV and SVG exports refer to the latest analysis. Historical
analyses have their own JSON export in **History**.

## 11. Versions and recalculation

Every calculation is saved as a new version with its settings and input hashes.
**History** lists one row per calculation; calculating all genes at once counts as one
row. Expand a row to open a gene's saved result or download its results and settings
as JSON. Results saved by earlier releases are kept when the database is opened.

Saved changes to the sample mapping, design or well exclusions increase the analysis
revision. Existing results are then marked as out of date, and
**Recalculate results** creates new versions with the saved reference genes and
baselines and the current setup. Unsaved setup edits are never applied or discarded
silently. The overview shows one consistent set of settings per run; earlier
settings remain available in History.

Updating the workbench does not recalculate saved analyses.

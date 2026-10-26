# Dashboard critical-review implementation

All seven requested review areas have implementation coverage:

1. **QC visibility:** persistent, source-linked technical-control and Ct-spread
   concerns, editable review threshold, reviewer notes, well exclusions and
   restoration audit, plus a non-saving normalization preview. Excluding a
   technical-control well cannot hide its original detected signal.
2. **Missing results:** assay/run availability counts, explicit coverage badges
   even when another run has a valid curve, actionable reasons and disabled SVG
   controls for empty plots.
3. **Focused navigation:** log2-color/fold-value overview and a single assay
   inspector; optional multi-panel figure builder and report.
4. **Filters:** incompatible run/condition options disabled, one empty state for
   an empty assay selection, separate filtered versus workbook totals, and QC
   independent of biological time/condition filters.
5. **Identity and validity:** run-specific sample instances, explicit biological-
   unit IDs, immutable raw records, persisted revisions, coherent per-run analysis
   settings, visible draft/stale states, reversible drafts and versioned rebuild.
   The API rejects unsaved mapping/design/well overrides in saved calculations.
6. **Figures:** physical publication widths, minimum 8 pt figure fonts, readable
   print output, stable colors, common-axis option, de-duplicated titles,
   data CSV/methods JSON and no active SVG control for a missing plot.
7. **Experimental design:** recorded time origin, experimental unit and design;
   reference/efficiency notes; provisional output when unconfirmed; API and UI
   guards against independent inference for unsupported or repeated units;
   descriptive plots remain available. Between-condition/run confounding is
   disclosed when conditions occur on distinct runs.

Paired, blocked and repeated-measure statistical models are deliberately not
implemented by selecting an inappropriate independent test. They remain a
separate scientific implementation/validation task. QC thresholds request review;
no general assay-validation or contamination verdict is inferred.

Existing analyses remain archived. No user's wells are excluded, concerns
acknowledged, or study design confirmed as part of installing this upgrade.
The local LAD081 workbook and thesis remain private development inputs.

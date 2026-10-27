import { condenseWarnings, formatP, normalityLabel } from './statisticsText'
import { sharedPrefix, withoutPrefix } from './sampleNames'
import { conditionDots } from './statisticsDots'

export type Diagnostic ={ probability_plot?:{theoretical:number[];observed:number[];slope:number;intercept:number;r_squared:number}; status: string; p_value: number | null; reason: string }
export type GroupResult = {
  condition: string; samples: string[]; n: number; incomplete_n: number
  fold_change_mean: number | null; fold_change_sd: number | null
  is_baseline: boolean; above_threshold: boolean | null
  replicates_above_threshold: number | null; delta_ct_values?:number[]; normality: Diagnostic
}
export type StatisticalResult = {
  design_confirmed?:boolean
  method: string; software: string; alpha: number; adjustment: string; family: string
  warnings: string[]; groups: GroupResult[]; control_normality: Diagnostic
  comparisons: { condition: string; n: number; control_n: number; status: string
    p_value: number | null; adjusted_p_value: number | null; reason: string
    delta_ct_difference?: number; delta_ct_ci?: number[] }[]
}
const number = (value: number | null | undefined) => value == null ? '—' : String(Number(value.toPrecision(3)))
const DOT_WIDTH = 240, DOT_HEIGHT = 26

/** Biological samples on a log2 axis shared by every card, with 1× marked. */
function ConditionDots({ values, domain, label }: { values: number[]; domain: [number, number]; label: string }) {
  const x = (log2: number) => 8 + (log2 - domain[0]) / (domain[1] - domain[0]) * (DOT_WIDTH - 16)
  return <svg className="condition-dots" viewBox={`0 0 ${DOT_WIDTH} ${DOT_HEIGHT}`} role="img" aria-label={`${label}: ${values.map(v => `${Number((2 ** v).toPrecision(3))}×`).join(', ') || 'no samples'}`}>
    <line x1="8" x2={DOT_WIDTH - 8} y1={DOT_HEIGHT / 2} y2={DOT_HEIGHT / 2} stroke="var(--rule)" />
    <line x1={x(0)} x2={x(0)} y1="3" y2={DOT_HEIGHT - 3} stroke="#8d9ca1" strokeDasharray="3 2" />
    {values.map((v, i) => <circle key={i} cx={x(v)} cy={DOT_HEIGHT / 2} r="4.5" fill="var(--accent)" fillOpacity=".55" stroke="var(--accent)" />)}
  </svg>
}
const pValue = (value: number | null | undefined) => value == null ? '' : `; p = ${formatP(value)}`

export function StatisticsResults({ result }: { result?: StatisticalResult }) {
  if (!result) return <p>Calculate a new analysis to see biological replicate summaries and diagnostics.</p>
  const allSmall = result.groups.length > 0 && result.groups.every(group => group.n < 3)
  const tested = result.comparisons.some(c => c.status === 'tested')
  // Condition-specific caveats stay visible; general method statements go in the notes.
  const condensed = condenseWarnings(result.warnings)
  const specific = (warning: string) => /fewer than three|departure from normality/i.test(warning)
  const cautions = condensed.filter(w => specific(w) && !(allSmall && /fewer than three/i.test(w)))
  const general = condensed.filter(w => !specific(w))
  // Strip only whole underscore-separated labels, so a condition keeps its readable tail ("150% day 21").
  const prefix = sharedPrefix([...result.groups.map(group => group.condition), ...result.comparisons.map(c => c.condition)]).replace(/[^_]*$/, '')
  const name = (condition: string) => withoutPrefix(condition, prefix)
  const dots = conditionDots(result.groups)
  return <section className="panel statistics-results">
    <h3>Biological replicate summary</h3>
    <p>Arithmetic mean fold change ± sample SD per condition, as saved with the analysis (figures on a log₂ axis show the geometric mean).{dots ? ' Dots: biological samples on one shared log₂ scale; dashed line: 1×.' : ''} n counts biological samples; technical wells are averaged first.{allSmall ? ' Every condition has fewer than three biological samples, so normality cannot be assessed and any test would be exploratory.' : ''}{prefix ? ` Condition names omit the shared prefix “${prefix}”.` : ''}</p>
    <div className="condition-cards">{result.groups.map(group => <article className="condition-card" key={group.condition}>
      <h4 title={group.condition}>{name(group.condition)}</h4>
      <p className="condition-value"><strong>{number(group.fold_change_mean)}×</strong> ± {number(group.fold_change_sd)} SD</p>
      {dots && <ConditionDots values={dots.values[group.condition] ?? []} domain={dots.domain} label={name(group.condition)} />}
      <p>n = {group.n}{group.incomplete_n ? ` · ${group.incomplete_n} incomplete` : ''}</p>
      <p>{group.is_baseline ? 'Baseline condition' : `${group.above_threshold ? 'Mean meets' : 'Mean below'} the effect threshold · ${group.replicates_above_threshold}/${group.n} samples meet it`}</p>
      {!allSmall && <p className="condition-normality">Normality: {normalityLabel(group.normality.status)}{pValue(group.normality.p_value)}</p>}
    </article>)}</div>
    <h3>Comparisons to baseline</h3>
    <p>{result.method === 'welch' ? 'Two-sided Welch tests on biological-sample ΔCt; Holm-adjusted across the declared comparison family below.' : 'Descriptive analysis. No significance test was requested.'}</p>
    {!allSmall && <p>Baseline normality: {normalityLabel(result.control_normality.status)}{pValue(result.control_normality.p_value)}. {result.control_normality.reason}</p>}
    <div className="results-table-wrap"><table><thead><tr><th>Condition</th><th>Biological n / control n</th>{tested && <><th>Raw p</th><th>Holm p</th><th>ΔCt difference / individual 95% CI</th></>}<th>Interpretation</th></tr></thead>
      <tbody>{result.comparisons.map(c => <tr key={c.condition}><td title={c.condition}>{name(c.condition)}</td><td>{c.n} / {c.control_n}</td>{tested && <><td>{formatP(c.p_value)}</td><td>{formatP(c.adjusted_p_value)}</td>
        <td>{number(c.delta_ct_difference)} {c.delta_ct_ci && ` [${c.delta_ct_ci.map(number).join(', ')}]`}</td></>}
        <td>{c.status === 'tested' ? (c.adjusted_p_value! < result.alpha ? 'Evidence of a difference under stated assumptions. ' : 'Insufficient evidence of a difference. ') : 'Not tested. '}{c.reason}</td></tr>)}</tbody></table></div>
    {cautions.length > 0 && <ul className="statistics-cautions">{cautions.map(w => <li key={w}>{w}</li>)}</ul>}
    <details className="statistics-notes"><summary>Method notes</summary><p>Comparison family: {result.family}. {result.software}.</p>
    <ul>{general.map(w => <li key={w}>{w}</li>)}</ul></details>
  </section>
}

export function StatisticsExplanation() {
  return <details className="panel methodology">
    <summary>Why these statistics, and what do they mean?</summary>
    <p>The experiment determines the statistical method. A normality test alone cannot choose the right test. This release supports descriptive summaries and explicitly confirmed independent-group comparisons. Paired, repeated-measure and complex designs require a different model.</p>
    <details open><summary>1. What counts as a replicate?</summary>
      <p>A biological replicate is a separately prepared biological sample, such as a separately transfected culture well. Repeated qPCR measurements of that same material are technical replicates. We average technical Ct measurements first; four technical wells from two biological samples still give biological n = 2.</p>
      <p>Assign condition labels in setup. Sample-name suffixes suggest grouping but never establish independence or pairing. Confirm the experimental unit with your protocol.</p>
    </details>
    <details><summary>2. How are ΔCt, ΔΔCt and fold change calculated?</summary>
      <p>ΔCt = mean target Ct − mean of the selected reference-assay Ct means. All selected references must be present. ΔΔCt subtracts the mean ΔCt of the selected baseline biological samples. Fold change = 2^(−ΔΔCt), assuming comparable amplification efficiencies consistent with this method.</p>
      <p>Reference Ct means are averaged arithmetically, corresponding to a geometric mean of relative quantities under those assumptions. The historical LAD081 workbook instead takes a geometric mean of Ct numbers; new results can therefore differ. The mean of biological fold changes also differs from exponentiating the mean ΔΔCt.</p>
      <p>Baseline replicates need not individually equal 1×. Their average ΔCt defines zero ΔΔCt; their arithmetic mean fold change need not equal exactly 1×.</p>
    </details>
    <details><summary>3. Why test ΔCt rather than fold changes?</summary>
      <p>Exponentiation makes fold changes asymmetric. Tests here compare biological-sample ΔCt values while retaining variability in both treatment and controls. Fold change communicates effect size. A negative treatment-minus-control ΔCt difference indicates higher normalized expression.</p>
    </details>
    <details><summary>4. What does the normality check tell me?</summary>
      <p>Shapiro–Wilk checks compatibility with a normal distribution. It requires at least three observations and is not informative for constant data. With small samples, a large p-value is weak evidence about distribution shape; it does not prove normality. With two biological samples, normality is reported as not assessable.</p>
      <p>Diagnostics here concern each independent group's ΔCt. Paired tests would instead need diagnostics of within-pair differences. We do not silently switch to a rank test after a small normality p-value: those tests have different assumptions and interpretations.</p>
    </details>
    <details><summary>5. Why Welch tests and Holm correction?</summary>
      <p>For independent biological groups with an appropriate distribution model, Welch's two-sided t-test compares means without assuming equal variances. Independence and distribution assumptions require researcher confirmation. The app cannot verify these from Ct values alone. Very small samples produce fragile estimates and are labelled exploratory.</p>
      <p>Each non-baseline condition is compared with the selected control samples. Holm correction accounts for multiple comparisons. In single-assay mode, the family contains the condition-versus-control comparisons for that assay. In all-target mode, it contains all planned target-assay/condition comparisons in that batch and run. Unestimable planned comparisons remain in the family conservatively. Separate batches and runs are not corrected together automatically.</p>
    </details>
    <details><summary>6. What do p-values, confidence intervals and the hit threshold mean?</summary>
      <p>A p-value measures how incompatible the observed contrast is with equal population means under the model. It is not the probability that the saRNA works. Adjusted p &lt; 0.05 is evidence under the stated assumptions; a larger p does not demonstrate no effect.</p>
      <p>The individual 95% confidence interval describes uncertainty in a treatment-minus-control mean ΔCt difference. It is not a simultaneous interval across all comparisons. SD in the chart describes between-sample spread, not confidence in the mean.</p>
      <p>The adjustable 1.5× threshold is a screening effect criterion. Crossing it does not establish statistical significance or reproducibility. The dashboard separately reports the mean crossing and the number of biological samples crossing.</p>
    </details>
    <details><summary>7. Missing data, exclusions and reproducibility</summary>
      <p>H₂O, water and no-template control labels are suggested as technical controls. Their raw measurements are preserved, but they are excluded from expression results, baselines and statistics. Roles can be overridden in setup when a label was misclassified. Missing or undetermined Ct values are never replaced by zero. A sample missing a required reference has no normalized result. Every selected baseline sample must be complete. Sample exclusions apply only to a saved analysis; raw uploads remain intact. Exclusion reasons and settings are retained in analysis history.</p>
      <p>Do not combine instrument runs as if they were independent biological experiments. Positive-control failure needs a protocol-specific success rule; this release does not infer that rule or declare controls passed automatically.</p>
    </details>
    <details><summary>8. Study design, QC review and saved result validity</summary><p>Inferential analysis requires a recorded experimental unit, time origin and confirmed independent-group design, plus explicit distribution-assumption confirmation. Paired, blocked and repeated-measure designs support descriptive output until an appropriate model is implemented. Repeated biological-unit IDs cannot be counted as independent sample instances.</p><p>Technical-control signals and large technical Ct ranges are review flags, not diagnoses. Well exclusions and restorations need reasons and are retained in an audit trail. Previewing an exclusion does not save results or perform inferential tests. Changing mappings, design or well exclusions makes previous results stale; rebuilding creates new versions. The overview selects one coherent settings profile per run instead of silently mixing analyses made with different references or baselines.</p></details>
    <p>Method references: <a href="https://www.gene-quantification.de/miqe.html" target="_blank" rel="noreferrer">MIQE reporting guidance</a>, <a href="https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.shapiro.html" target="_blank" rel="noreferrer">Shapiro–Wilk</a>, <a href="https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.ttest_ind.html" target="_blank" rel="noreferrer">Welch test and confidence intervals</a>, <a href="https://www.statsmodels.org/stable/generated/statsmodels.stats.multitest.multipletests.html" target="_blank" rel="noreferrer">multiple-comparison methods</a>.</p>
  </details>
}

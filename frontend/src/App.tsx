import { type ChangeEvent, useEffect, useState } from 'react'
import './App.css'
import { StatisticsExplanation, StatisticsResults, type StatisticalResult } from './StatisticsPanel'

type RawRecord = {
  run_id: string
  run_name: string
  sample: string
  assay: string
  ct: number | null
  well: string
  status: string
  omit: boolean
  reporter?: string | null
  sheet: string
  row_number: number
}

type Run = {
  id: string
  name: string
  sheet: string
  header_row: number
  record_count: number
  plate_size: number | null
}

type SampleRow = {
  sample: string
  target_assay: string
  reference_assays: string[]
  target_ct_values: number[]
  target_ct_mean: number | null
  target_ct_sd: number | null
  reference_ct_values: Record<string, number[]>
  reference_ct_means: Record<string, number | null>
  reference_ct_mean: number | null
  delta_ct: number | null
  baseline_sample: string
  baseline_delta_ct: number
  delta_delta_ct: number | null
  fold_change: number | null
  log2fc: number | null
  result_status: string
}

type AnalysisResult = {
  run_id: string
  target_assay: string
  reference_assays: string[]
  baseline_sample: string
  baseline_samples?: string[]
  sample_groups?: Record<string, string>
  excluded_samples?: string[]
  exclusion_reasons?: Record<string, string>
  hit_threshold?: number
  statistics?: StatisticalResult
  analysis_id?: string
  created_at?: string
  reference_method: string
  excluded_measurement_count: number
  samples: SampleRow[]
}

type Experiment = {
  id: string
  name: string
  status: string
  original_filename?: string
  raw_records?: RawRecord[]
  parsed_summary?: { record_count?: number; warnings?: string[]; runs?: Run[] }
  analysis_result?: AnalysisResult
}

type Project = {
  id: string
  name: string
  experiments: Experiment[]
}

const API_ROOT = 'http://localhost:8000'

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_ROOT}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.detail ?? 'Request failed')
  }
  return res.json() as Promise<T>
}

function App() {
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [selectedExperimentId, setSelectedExperimentId] = useState('')
  const [detail, setDetail] = useState<Experiment | null>(null)
  const [selectedRunId, setSelectedRunId] = useState('')
  const [projectName, setProjectName] = useState('saRNA pilot project')
  const [uploadName, setUploadName] = useState('')
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [status, setStatus] = useState('Ready')
  const [analysisConfig, setAnalysisConfig] = useState({
    targetAssay: '',
    referenceAssays: [] as string[],
    baselineSample: '',
  })
  const [selectedWell, setSelectedWell] = useState('A1')
  const [activeTab, setActiveTab] = useState('dashboard')
  const [baselineSamples, setBaselineSamples] = useState<string[]>([])
  const [sampleGroups, setSampleGroups] = useState<Record<string, string>>({})
  const [excludedSamples, setExcludedSamples] = useState<Record<string, string>>({})
  const [hitThreshold, setHitThreshold] = useState(1.5)
  const [statisticsMethod, setStatisticsMethod] = useState('descriptive')
  const [assumptionsConfirmed, setAssumptionsConfirmed] = useState(false)
  const [versions, setVersions] = useState<{id: string; created_at: string; result: AnalysisResult}[]>([])
  const [historicalResult, setHistoricalResult] = useState<AnalysisResult | null>(null)
  const [busy, setBusy] = useState(false)

  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null
  const activeExperimentId = selectedProject?.experiments.some((item) => item.id === selectedExperimentId)
    ? selectedExperimentId
    : selectedProject?.experiments[0]?.id ?? ''
  const listedExperiment =
    selectedProject?.experiments.find((experiment) => experiment.id === activeExperimentId) ?? null
  const selectedExperiment =
    detail?.id === activeExperimentId
      ? { ...(listedExperiment ?? detail), ...detail }
      : listedExperiment
  const runs = selectedExperiment?.parsed_summary?.runs ?? []
  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? null
  const runRecords = selectedRun
    ? (selectedExperiment?.raw_records ?? []).filter((record) => record.run_id === selectedRun.id)
    : []
  const plateMap: Record<string, RawRecord[]> = {}
  runRecords.forEach((record) => {
    const key = String(record.well || 'Unknown').toUpperCase()
    plateMap[key] ??= []
    plateMap[key].push(record)
  })

  const assayOptions = [...new Set(runRecords.map((record) => record.assay).filter(Boolean))].sort()
  const sampleOptions = [...new Set(runRecords.map((record) => record.sample).filter(Boolean))].sort()
  const plateRows = Array.from(
    { length: selectedRun?.plate_size === 384 ? 16 : 8 },
    (_, index) => String.fromCharCode(65 + index),
  )
  const plateCols = Array.from(
    { length: selectedRun?.plate_size === 384 ? 24 : 12 },
    (_, index) => index + 1,
  )

  useEffect(() => {
    void loadProjects()
  }, [])

  useEffect(() => {
    if (!selectedProjectId || !activeExperimentId) return

    let active = true
    void apiFetch<{id: string; created_at: string; result: AnalysisResult}[]>(
      `/api/projects/${selectedProjectId}/experiments/${activeExperimentId}/analyses`,
    ).then(value => { if (active) setVersions(value) }).catch(() => { if (active) setStatus('Could not load analysis history.') })
    void apiFetch<Experiment>(
      `/api/projects/${selectedProjectId}/experiments/${activeExperimentId}`,
    )
      .then((value) => {
        if (active) {
          setDetail(value)
          setHistoricalResult(null)
          setSelectedRunId(value.analysis_result?.run_id ?? '')
          setBaselineSamples(value.analysis_result?.baseline_samples ?? (value.analysis_result?.baseline_sample ? [value.analysis_result.baseline_sample] : []))
          setSampleGroups(value.analysis_result?.sample_groups ?? {})
          setExcludedSamples(value.analysis_result?.exclusion_reasons ?? {})
          setHitThreshold(value.analysis_result?.hit_threshold ?? 1.5)
          setStatisticsMethod('descriptive')
          setAssumptionsConfirmed(false)
          setAnalysisConfig(
            value.analysis_result?.run_id
              ? {
                  targetAssay: value.analysis_result.target_assay,
                  referenceAssays: value.analysis_result.reference_assays,
                  baselineSample: value.analysis_result.baseline_sample,
                }
              : { targetAssay: '', referenceAssays: [], baselineSample: '' },
          )
        }
      })
      .catch((error: unknown) => {
        if (active) setStatus(error instanceof Error ? error.message : 'Could not load experiment data')
      })
    return () => {
      active = false
    }
  }, [selectedProjectId, activeExperimentId])

  async function loadProjects() {
    try {
      const data = await apiFetch<Project[]>('/api/projects')
      setProjects(data)
      setSelectedProjectId((current) =>
        data.some((project) => project.id === current) ? current : data[0]?.id ?? '',
      )
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to load projects')
    }
  }

  async function createProject() {
    try {
      const created = await apiFetch<{ id: string; name: string }>('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ name: projectName }),
      })
      await loadProjects()
      setSelectedProjectId(created.id)
      setStatus(`Project created: ${created.name}`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Project creation failed')
    }
  }

  async function addExperiment() {
    if (!selectedProjectId || !uploadFile) {
      setStatus('Select a project and choose a qPCR export file.')
      return
    }
    const form = new FormData()
    form.append('name', uploadName || uploadFile.name)
    form.append('file', uploadFile)

    try {
      const response = await fetch(`${API_ROOT}/api/projects/${selectedProjectId}/upload`, {
        method: 'POST',
        body: form,
      })
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new Error(body?.detail ?? 'Upload failed')
      }
      const result = (await response.json()) as { id: string; record_count: number; warnings: string[] }
      await loadProjects()
      setHistoricalResult(null)
      setVersions([])
      setSelectedExperimentId(result.id)
      setSelectedRunId('')
      setAnalysisConfig({ targetAssay: '', referenceAssays: [], baselineSample: '' })
      setStatus(
        result.warnings.length
          ? `Imported ${result.record_count} raw measurements with ${result.warnings.length} warning(s).`
          : `Imported ${result.record_count} raw measurements.`,
      )
      setUploadFile(null)
      setUploadName('')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Upload failed')
    }
  }

  async function runAnalysis() {
    if (!selectedProjectId || !activeExperimentId || !selectedRun) {
      setStatus('Select an experiment and run before calculating.')
      return
    }
    if (!analysisConfig.targetAssay || !analysisConfig.referenceAssays.length || !baselineSamples.length) {
      setStatus('Choose a target assay, at least one reference assay, and a baseline sample.')
      return
    }
    setBusy(true)
    try {
      const result = await apiFetch<AnalysisResult>(
        `/api/projects/${selectedProjectId}/experiments/${activeExperimentId}/analyze`,
        {
          method: 'POST',
          body: JSON.stringify({
            target_assay: analysisConfig.targetAssay,
            reference_assays: analysisConfig.referenceAssays,
            baseline_samples: baselineSamples,
            sample_groups: sampleGroups,
            excluded_samples: Object.keys(excludedSamples),
            exclusion_reasons: excludedSamples,
            hit_threshold: hitThreshold,
            statistics_method: statisticsMethod,
            assumptions_confirmed: assumptionsConfirmed,
            run_id: selectedRun.id,
          }),
        },
      )
      setDetail((current) => (current ? { ...current, analysis_result: result } : current))
      setHistoricalResult(null)
      setVersions(await apiFetch(`/api/projects/${selectedProjectId}/experiments/${activeExperimentId}/analyses`))
      setStatus(`Analysis complete for ${analysisConfig.targetAssay} in ${selectedRun.name}.`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Analysis failed')
    } finally {
      setBusy(false)
    }
  }

  function selectRun(runId: string) {
    setSelectedRunId(runId)
    const saved = detail?.analysis_result?.run_id === runId ? detail.analysis_result : null
    setHistoricalResult(null)
    const records = (selectedExperiment?.raw_records ?? []).filter(r => r.run_id === runId)
    const samples = [...new Set(records.map(r => r.sample))]
    setBaselineSamples(saved?.baseline_samples ?? (saved?.baseline_sample ? [saved.baseline_sample] : samples.filter(name => /day 0\.\d+$/i.test(name))))
    setSampleGroups(saved?.sample_groups ?? Object.fromEntries(samples.map(name => [name, /^(h2o|ntc|water)$/i.test(name) ? '' : name.replace(/\.\d+$/, '')])))
    setExcludedSamples(saved?.exclusion_reasons ?? {})
    setHitThreshold(saved?.hit_threshold ?? 1.5)
    setStatisticsMethod('descriptive')
    setAssumptionsConfirmed(false)
    setAnalysisConfig(
      saved
        ? {
            targetAssay: saved.target_assay,
            referenceAssays: saved.reference_assays,
            baselineSample: saved.baseline_sample,
          }
        : { targetAssay: '', referenceAssays: [...new Set(records.map(r => r.assay))].filter(a => ['gapdh', 'c1orf43', 'gusb'].includes(a.toLowerCase())), baselineSample: '' },
    )
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    setUploadFile(event.target.files?.[0] ?? null)
  }

  const analysisResult = historicalResult ?? (
    selectedExperiment && selectedExperiment.analysis_result?.run_id === selectedRun?.id
      ? selectedExperiment.analysis_result
      : null)
  const exportPath =
    selectedProjectId && activeExperimentId
      ? `/api/projects/${selectedProjectId}/experiments/${activeExperimentId}`
      : ''

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">Workbench</p>
          <h1>qPCR Analysis</h1>
        </div>
        <div className="panel">
          <label>
            <span>Project name</span>
            <input value={projectName} onChange={(event) => setProjectName(event.target.value)} />
          </label>
          <button onClick={createProject}>Create project</button>
        </div>
        <div className="panel">
          <h3>Projects</h3>
          {projects.length === 0 && <p>No projects yet.</p>}
          <ul className="project-list">
            {projects.map((project) => (
              <li key={project.id}>
                <button
                  className={selectedProjectId === project.id ? 'selected' : ''}
                  onClick={() => {
                    setHistoricalResult(null)
                    setVersions([])
                    setSelectedProjectId(project.id)
                    setSelectedExperimentId('')
                    setSelectedRunId('')
                    setAnalysisConfig({ targetAssay: '', referenceAssays: [], baselineSample: '' })
                  }}
                >
                  {project.name}
                </button>
              </li>
            ))}
          </ul>
          {selectedProject && selectedProject.experiments.length > 0 && (
            <label className="experiment-picker">
              <span>Experiment</span>
              <select
                value={activeExperimentId}
                onChange={(event) => {
                  setHistoricalResult(null)
                  setVersions([])
                  setSelectedExperimentId(event.target.value)
                  setSelectedRunId('')
                  setAnalysisConfig({ targetAssay: '', referenceAssays: [], baselineSample: '' })
                }}
              >
                {selectedProject.experiments.map((experiment) => (
                  <option key={experiment.id} value={experiment.id}>
                    {experiment.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <div className="panel">
          <h3>Raw data upload</h3>
          <p className="helper-text">Upload instrument Ct/Cq results. Derived workbook tabs are not used as input.</p>
          <label>
            <span>Experiment label</span>
            <input value={uploadName} onChange={(event) => setUploadName(event.target.value)} />
          </label>
          <label>
            <span>File</span>
            <input type="file" accept=".csv,.xlsx,.xlsm" onChange={handleFileChange} />
          </label>
          <button onClick={addExperiment} disabled={!selectedProjectId || !uploadFile}>
            Import raw results
          </button>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div>
            <p className="eyebrow">Raw input → processed dashboard</p>
            <h2>{selectedExperiment?.name ?? 'No experiment selected'}</h2>
            <p className="helper-text">
              {selectedExperiment?.original_filename ?? 'Upload a qPCR instrument export to begin.'}
            </p>
          </div>
          {analysisResult && !historicalResult && (
            <div className="button-row">
              <a className="button-link" href={`${API_ROOT}${exportPath}/export.csv`}>Export CSV</a>
              <a className="button-link" href={`${API_ROOT}${exportPath}/export.svg`}>Export SVG</a>
            </div>
          )}
        </header>
        <div className="status-bar">{status}</div>

        <nav className="view-tabs" aria-label="Workbench views">
          {['dashboard', 'statistics', 'history'].map(tab => <button key={tab} aria-pressed={activeTab === tab} onClick={() => setActiveTab(tab)}>
            {tab === 'statistics' ? 'Statistics · why & what it means' : tab === 'history' ? 'Analysis history' : 'Experiment dashboard'}
          </button>)}
        </nav>
        {activeTab === 'statistics' && <><StatisticsResults result={analysisResult?.statistics} /><StatisticsExplanation /></>}
        {activeTab === 'history' && <section className="panel"><h3>Saved analysis versions</h3><p>Each calculation is retained. Open a snapshot to inspect its results; setup controls show the current configuration for that run. Recalculate to create a new version.</p>
          {versions.length === 0 && <p>No saved analyses yet.</p>}
          {versions.map(v => <div key={v.id}><button className="history-entry" onClick={() => { selectRun(v.result.run_id); setHistoricalResult(v.result); setActiveTab('dashboard') }}>
            {new Date(v.created_at).toLocaleString()} · {v.result.target_assay} · {v.result.run_id} · method {v.result.statistics?.method ?? 'legacy'}
          </button><a href={`${API_ROOT}${exportPath}/analyses/${v.id}/export.json`}>Download saved results and settings (JSON)</a></div>)}
        </section>}
        {selectedExperiment && activeTab === 'dashboard' && (
          <>
            <section className="panel analysis-panel">
              <div className="analysis-header">
                <h3>Set up processing</h3>
                <span>{selectedExperiment.parsed_summary?.record_count ?? 0} raw measurements imported</span>
              </div>
              <div className="analysis-controls">
                <label>
                  <span>Instrument run</span>
                  <select value={selectedRun?.id ?? ''} onChange={(event) => selectRun(event.target.value)}>
                    <option value="">Select a run</option>
                    {runs.map((run) => (
                      <option key={run.id} value={run.id}>
                        {run.name} · {run.record_count} wells
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Target assay</span>
                  <select
                    value={analysisConfig.targetAssay}
                    onChange={(event) =>
                      setAnalysisConfig((current) => ({ ...current, targetAssay: event.target.value }))
                    }
                  >
                    <option value="">Select target</option>
                    {assayOptions.map((assay) => <option key={assay}>{assay}</option>)}
                  </select>
                </label>
                <label>
                  <span>Reference assay(s) · Ctrl/Cmd for multiple</span>
                  <select
                    multiple
                    value={analysisConfig.referenceAssays}
                    onChange={(event) =>
                      setAnalysisConfig((current) => ({
                        ...current,
                        referenceAssays: Array.from(event.target.selectedOptions, (option) => option.value),
                      }))
                    }
                  >
                    {assayOptions
                      .filter((assay) => assay !== analysisConfig.targetAssay)
                      .map((assay) => <option key={assay}>{assay}</option>)}
                  </select>
                </label>
                <label>
                  <span>Baseline biological samples · select all controls</span>
                  <select multiple value={baselineSamples} onChange={event => setBaselineSamples(Array.from(event.target.selectedOptions, option => option.value))}>
                    {sampleOptions.filter(sample => !Object.hasOwn(excludedSamples, sample)).map(sample => <option key={sample}>{sample}</option>)}
                  </select>
                </label>
              </div>
              <p className="helper-text">
                Day-zero baselines and common reference names are suggestions: review them against your protocol. Results are calculated within the selected instrument run. Technical wells are averaged per
                sample and assay; separate runs are never combined automatically.
              </p>
              <details className="setup-details" open><summary>Review suggested biological conditions and exclusions</summary>
                <p>Suffixes such as .1 and .2 suggest biological samples within a condition. Review every label. This does not establish pairing. Leave controls such as H₂O ungrouped.</p>
                <div className="results-table-wrap"><table><thead><tr><th>Biological sample</th><th>Condition</th><th>Exclude from this analysis</th></tr></thead><tbody>
                  {sampleOptions.map(sample => <tr key={sample}><td>{sample}</td><td><input aria-label={`Condition for ${sample}`} value={sampleGroups[sample] ?? ''} onChange={event => setSampleGroups(current => ({...current, [sample]: event.target.value}))} /></td>
                    <td><input aria-label={`Exclusion reason for ${sample}`} placeholder="Reason (blank = include)" value={excludedSamples[sample] ?? ''} onChange={event => {
                      const reason = event.target.value
                      setExcludedSamples(current => { const next = {...current}; if (reason.trim()) next[sample] = reason; else delete next[sample]; return next })
                    }} /></td></tr>)}
                </tbody></table></div>
              </details>
              <div className="analysis-controls">
                <label><span>Screening fold-change threshold</span><input type="number" min="0.01" step="0.1" value={hitThreshold} onChange={event => setHitThreshold(Number(event.target.value))} /></label>
                <label><span>Statistical approach</span><select value={statisticsMethod} onChange={event => {setStatisticsMethod(event.target.value); setAssumptionsConfirmed(false)}}>
                  <option value="descriptive">Descriptive + normality diagnostics</option><option value="welch">Independent Welch comparisons + Holm</option>
                </select></label>
              </div>
              {statisticsMethod === 'welch' && <label className="confirmation"><input type="checkbox" checked={assumptionsConfirmed} onChange={event => setAssumptionsConfirmed(event.target.checked)} />
                I confirm these are independent biological groups (no pairing, repeated samples or unmodelled blocks), and a normal-population mean comparison is justified by the protocol or prior evidence. Small-n tests are exploratory.
              </label>}
              <p><button onClick={() => setActiveTab('statistics')}>Why these statistics? Read the explanation</button></p>
              <button className="run-button" disabled={busy || (statisticsMethod === 'welch' && !assumptionsConfirmed)} onClick={runAnalysis}>{busy ? 'Calculating…' : 'Calculate and save analysis version'}</button>
            </section>

            {analysisResult && <>
              <section className="panel"><h3>{historicalResult ? 'Historical snapshot' : 'Saved analysis'} · {analysisResult.target_assay}</h3>
                <p>These results reflect saved settings, not unsaved edits above. Baseline: {analysisResult.baseline_samples?.join('; ') ?? analysisResult.baseline_sample}.</p>
                {historicalResult && <button onClick={() => setHistoricalResult(null)}>Return to latest analysis</button>}
                <ExpressionChart result={analysisResult} />
              </section>
              <StatisticsResults result={analysisResult.statistics} />
            </>}
            <div className="content-grid">
              <section className="panel plate-panel">
                <div className="panel-heading">
                  <h3>Raw plate · {selectedRun?.plate_size ?? 96}-well</h3>
                  <span>{selectedRun?.name ?? 'Select an instrument run'}</span>
                </div>
                <div className={`plate-grid ${selectedRun?.plate_size === 384 ? 'plate-grid-384' : ''}`}>
                  {plateRows.map((row) => (
                    <div
                      key={row}
                      className={`plate-row ${selectedRun?.plate_size === 384 ? 'plate-row-384' : ''}`}
                    >
                      {plateCols.map((col) => {
                        const key = `${row}${col}`
                        const wells = plateMap[key] ?? []
                        const summary = wells
                          .map((record) => `${record.assay}: ${record.sample}`)
                          .join(' / ')
                        return (
                          <button
                            key={key}
                            className={`plate-well ${selectedWell === key ? 'active' : ''} ${wells.length ? 'occupied' : ''}`}
                            onClick={() => setSelectedWell(key)}
                            title={summary || 'Empty well'}
                          >
                            <span>{key}</span>
                            <small>{wells.length ? wells.map((record) => record.assay).join(', ') : 'empty'}</small>
                          </button>
                        )
                      })}
                    </div>
                  ))}
                </div>
                <div className="well-detail">
                  <h4>Well {selectedWell}</h4>
                  {plateMap[selectedWell]?.length ? (
                    <ul>
                      {plateMap[selectedWell].map((record, index) => (
                        <li key={`${selectedWell}-${record.run_id}-${index}`}>
                          {record.assay} · {record.sample} · Ct {record.ct ?? 'Undetermined'}
                          {record.omit ? ' · excluded by instrument' : ''}
                          {record.reporter ? ` · ${record.reporter}` : ''}
                        </li>
                      ))}
                    </ul>
                  ) : <p>No assigned measurements in this well.</p>}
                </div>
              </section>

              <section className="panel results-panel">
                <div className="panel-heading">
                  <h3>Processed output</h3>
                  <span>{analysisResult?.samples.length ?? 0} samples</span>
                </div>
                {analysisResult ? (
                  <>
                    <p className="helper-text">
                      Reference normalization: {analysisResult.reference_method}. Excluded/undetermined
                      measurements: {analysisResult.excluded_measurement_count}.
                    </p>
                    <div className="results-table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Sample</th><th>Target Ct mean</th><th>Reference Ct mean</th>
                            <th>ΔCt</th><th>ΔΔCt</th><th>Fold change</th>
                          </tr>
                        </thead>
                        <tbody>
                          {analysisResult.samples.map((sample) => (
                            <tr key={sample.sample}>
                              <td>
                                <details>
                                  <summary>{sample.sample}</summary>
                                  <div className="calculation-steps">
                                    Target Ct values: {sample.target_ct_values.join(', ') || 'none'}
                                    <br />
                                    Reference Ct means: {Object.entries(sample.reference_ct_means)
                                      .map(([assay, value]) => `${assay}: ${value?.toFixed(3) ?? 'missing'}`)
                                      .join('; ')}
                                    <br />
                                    Baseline ΔCt ({sample.baseline_sample}): {sample.baseline_delta_ct.toFixed(3)}
                                  </div>
                                </details>
                              </td>
                              <td>{sample.target_ct_mean?.toFixed(3) ?? '—'}</td>
                              <td>{sample.reference_ct_mean?.toFixed(3) ?? '—'}</td>
                              <td>{sample.delta_ct?.toFixed(3) ?? '—'}</td>
                              <td>{sample.delta_delta_ct?.toFixed(3) ?? '—'}</td>
                              <td>{sample.fold_change?.toFixed(3) ?? '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : (
                  <p className="empty-state">Choose a target, reference assay, and baseline to calculate processed outputs.</p>
                )}
              </section>
            </div>

            {selectedExperiment.parsed_summary?.warnings?.length ? (
              <section className="panel warnings-panel">
                <h3>Import warnings</h3>
                <ul>
                  {selectedExperiment.parsed_summary.warnings.map((warning, index) => (
                    <li key={`${warning}-${index}`}>{warning}</li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        )}
      </main>
    </div>
  )
}

function ExpressionChart({ result }: { result: AnalysisResult }) {
  const groups = result.statistics?.groups ?? []
  const maximum = Math.max(2, result.hit_threshold ?? 1.5, ...result.samples.map(s => s.fold_change ?? 0), ...groups.map(g => (g.fold_change_mean ?? 0) + (g.fold_change_sd ?? 0)))
  if (!groups.length) return <p>Assign biological samples to conditions and calculate a new version to show the condition chart.</p>
  const height = 280
  const width = Math.max(620, groups.length * 150 + 80)
  const y = (value: number) => 230 - value / maximum * 190
  return <div className="results-table-wrap"><svg role="img" aria-label="Normalized expression by condition, with individual biological samples and sample standard deviation" width={width} height={height}>
    {[0, 1, result.hit_threshold ?? 1.5].map((value, i) => <g key={i}><line x1="60" x2={width - 20} y1={y(value)} y2={y(value)} stroke={i === 2 ? '#b45309' : '#94a3b8'} strokeDasharray={i ? '5 4' : undefined}/><text x="4" y={y(value) - 4} fontSize="12">{value}×</text></g>)}
    {groups.map((group, index) => {
      const x = 100 + index * 150
      const avg = group.fold_change_mean
      const sd = group.fold_change_sd
      const points = result.samples.filter(s => group.samples.includes(s.sample) && s.fold_change != null)
      return <g key={group.condition}>
        {avg != null && <><rect x={x - 25} y={y(avg)} width="50" height={Math.max(0,y(0)-y(avg))} fill={group.is_baseline ? '#cbd5e1' : '#93c5fd'} />
          {sd != null && <><line x1={x} x2={x} y1={y(avg + sd)} y2={y(Math.max(0,avg - sd))} stroke="#0f172a"/><line x1={x-8} x2={x+8} y1={y(avg+sd)} y2={y(avg+sd)} stroke="#0f172a"/></>}</>}
        {points.map((sample, i) => <circle key={sample.sample} cx={x + (i - (points.length-1)/2)*10} cy={y(sample.fold_change!)} r="4" fill="#1e40af"><title>{sample.sample}: {sample.fold_change?.toFixed(3)}×</title></circle>)}
        <text x={x} y="250" textAnchor="middle" fontSize="11">{group.condition.length > 22 ? `${group.condition.slice(0,20)}…` : group.condition}<title>{group.condition}</title></text>
        <text x={x} y="270" textAnchor="middle" fontSize="11">n = {group.n}</text>
      </g>
    })}
  </svg><p>Biological replicate points; mean ± sample SD (lower whisker clipped at zero). Dashed lines: 1× baseline and {result.hit_threshold ?? 1.5}× screening threshold. Full labels appear on hover and in the summary.</p></div>
}

export default App

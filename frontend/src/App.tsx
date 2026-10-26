import { type ChangeEvent, useEffect, useRef, useState, useCallback } from 'react'
import './App.css'
import { apiErrorMessage } from './apiErrors'
import { StatisticsExplanation, StatisticsResults } from './StatisticsPanel'

import type { AnalysisResult, Experiment, Project, RawRecord, Run, SampleMetadata, ExperimentDesign, QualityChange, ExclusionPreview } from './types'
import {DesignPanel} from './DesignPanel'
import {sampleKey,sampleAnnotation,analysisGroup} from './plotData'
import { Dashboard } from './Dashboard'

const API_ROOT = (import.meta.env.VITE_API_ROOT ?? 'http://localhost:8000').replace(/\/$/, '')

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_ROOT}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(apiErrorMessage(body, res.status))
  }
  return res.json() as Promise<T>
}

function App() {
  const [showWorkspace,setShowWorkspace]=useState(false)
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [selectedExperimentId, setSelectedExperimentId] = useState('')
  const [detail, setDetail] = useState<Experiment | null>(null)
  const [selectedRunId, setSelectedRunId] = useState('')
  const [projectName, setProjectName] = useState('saRNA pilot project')
  const [uploadName, setUploadName] = useState('')
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState('Ready')
  const [analysisConfig, setAnalysisConfig] = useState({
    targetAssay: '',
    referenceAssays: [] as string[],
    baselineSample: '',
  })
  const [selectedWell, setSelectedWell] = useState('A1')
  const [activeTab, setActiveTab] = useState('setup')
  const [baselineSamples, setBaselineSamples] = useState<string[]>([])
  const [technicalSamples, setTechnicalSamples] = useState<string[]>([])
  const [sampleMetadata, setSampleMetadata] = useState<Record<string, SampleMetadata>>({})
  const [sampleInstances, setSampleInstances] = useState<Record<string,SampleMetadata>>({})
  const [designDraft,setDesignDraft]=useState<ExperimentDesign|null>(null)
  const [mappingDirty,setMappingDirty]=useState(false)
  const [setupEdited,setSetupEdited]=useState(false)
  const setupDrafts=useRef<Record<string,{analysisConfig:{targetAssay:string;referenceAssays:string[];baselineSample:string};baselineSamples:string[];excludedSamples:Record<string,string>;hitThreshold:number;statisticsMethod:string;assumptionsConfirmed:boolean}>>({})
  const [analyseAll, setAnalyseAll] = useState(true)
  const [sampleGroups, setSampleGroups] = useState<Record<string, string>>({})
  const [excludedSamples, setExcludedSamples] = useState<Record<string, string>>({})
  const [hitThreshold, setHitThreshold] = useState(1.5)
  const [statisticsMethod, setStatisticsMethod] = useState('descriptive')
  const [assumptionsConfirmed, setAssumptionsConfirmed] = useState(false)
  const [versions, setVersions] = useState<{id: string; created_at: string; result: AnalysisResult}[]>([])
  const [historicalResult, setHistoricalResult] = useState<AnalysisResult | null>(null)
  const [selectedStatistics, setSelectedStatistics] = useState<AnalysisResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [analysisError, setAnalysisError] = useState('')
  const [backendIssue, setBackendIssue] = useState('Checking backend compatibility…')
  const [importing, setImporting] = useState(false)
  const shouldScrollToResults = useRef(false)

  const configureRun=useCallback((experiment:Experiment,runId:string,history:{id:string;created_at:string;result:AnalysisResult}[]=[],restore=false)=>{
    setAnalysisError('')
    setSetupEdited(false)
    const draftKey=JSON.stringify([experiment.id,runId])
    if(restore)delete setupDrafts.current[draftKey]
    setSelectedRunId(runId)
    const saved = experiment.analysis_result?.run_id === runId ? experiment.analysis_result : history.find(v=>v.result.run_id===runId)?.result??null
    setHistoricalResult(null)
    const records = (experiment.raw_records ?? []).filter(r => r.run_id === runId)
    const samples = [...new Set(records.map(r => r.sample))]
    const controls = experiment.sample_instances ? samples.filter(name=>sampleAnnotation(experiment.sample_instances,runId,name).role==='technical_control') : saved?.technical_control_samples ?? samples.filter(name => sampleAnnotation(experiment.sample_instances,runId,name).role === 'technical_control' || (!experiment.sample_instances&&experiment.sample_roles?.[name] === 'technical_control'))
    setTechnicalSamples(controls)
    setBaselineSamples(saved?.baseline_samples ?? (saved?.baseline_sample ? [saved.baseline_sample] : samples.filter(name => sampleAnnotation(experiment.sample_instances,runId,name).timepoint === 0 || /day 0\.\d+$/i.test(name))))
    setSampleGroups(saved?.sample_groups ?? Object.fromEntries(samples.map(name => [name, controls.includes(name) ? '' : analysisGroup(sampleAnnotation(experiment.sample_instances,runId,name))])))
    setExcludedSamples(saved?.exclusion_reasons ?? {})
    setHitThreshold(saved?.hit_threshold ?? 1.5)
    setStatisticsMethod(saved?.statistics?.method??'descriptive')
    setAssumptionsConfirmed(saved?.statistics?.design_confirmed??false)
    setAnalysisConfig(
      saved
        ? {
            targetAssay: saved.target_assay,
            referenceAssays: saved.reference_assays,
            baselineSample: saved.baseline_sample,
          }
        : { targetAssay: '', referenceAssays: [...new Set(records.map(r => r.assay))].filter(a => ['gapdh', 'c1orf43', 'gusb'].includes(a.toLowerCase())), baselineSample: '' },
    )
    const draft=setupDrafts.current[draftKey]
    if(draft){setAnalysisConfig(draft.analysisConfig);setBaselineSamples(draft.baselineSamples);setExcludedSamples(draft.excludedSamples);setHitThreshold(draft.hitThreshold);setStatisticsMethod(draft.statisticsMethod);setAssumptionsConfirmed(draft.assumptionsConfirmed);setSetupEdited(true)}
  },[])

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
    void apiFetch<{ paths?: Record<string, unknown>; components?: { schemas?: { AnalysisRequest?: { properties?: Record<string, unknown> } } } }>('/openapi.json')
      .then(schema => setBackendIssue(schema.components?.schemas?.AnalysisRequest?.properties?.baseline_samples && schema.paths?.['/api/projects/{project_id}/experiments/{experiment_id}/quality-review']
        ? ''
        : 'The running qPCR backend is outdated. Restart the backend with the current code, then refresh this page.'))
      .catch(() => setBackendIssue('Cannot check the backend connection. Start the qPCR backend, then refresh this page.'))
  }, [])

  useEffect(() => {
    if (shouldScrollToResults.current && detail?.analysis_result?.analysis_id) {
      shouldScrollToResults.current = false
      document.getElementById('analysis-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [detail?.analysis_result?.analysis_id])

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
          setSelectedStatistics(null)
          setDesignDraft(null);setMappingDirty(false)
          setActiveTab(Array.isArray(value.analysis_result?.samples) ? 'dashboard' : 'setup')
          setSampleMetadata(value.sample_metadata ?? {})
          setSampleInstances(value.sample_instances ?? {})
          setHistoricalResult(null)
          configureRun(value, value.analysis_result?.run_id ?? value.parsed_summary?.runs?.[0]?.id ?? '')
        }
      })
      .catch((error: unknown) => {
        if (active) setStatus(error instanceof Error ? error.message : 'Could not load experiment data')
      })
    return () => {
      active = false
    }
  }, [selectedProjectId, activeExperimentId, configureRun])

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
    if (!uploadFile || importing) return
    const file = uploadFile
    const form = new FormData()
    form.append('name', uploadName || file.name)
    form.append('file', file)
    setImporting(true)
    setStatus('Importing workbook and detecting instrument runs…')
    try {
      let projectId = selectedProjectId
      if (!projectId) {
        const created = await apiFetch<{ id: string }>('/api/projects', {
          method: 'POST', body: JSON.stringify({ name: projectName.trim() || 'My qPCR project' }),
        })
        projectId = created.id
        // Keep the created project available if parsing fails, so retrying does not create duplicates.
        setProjects(await apiFetch<Project[]>('/api/projects'))
        setSelectedProjectId(projectId)
      }
      const response = await fetch(`${API_ROOT}/api/projects/${projectId}/upload`, { method: 'POST', body: form })
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new Error(apiErrorMessage(body, response.status))
      }
      const result = await response.json() as { id: string; record_count: number; warnings: string[]; runs: Run[] }
      const data = await apiFetch<Project[]>('/api/projects')
      setProjects(data)
      setSelectedProjectId(projectId)
      setHistoricalResult(null)
      setVersions([])
      setSelectedExperimentId(result.id)
      setActiveTab('setup')
      setStatus(`Imported ${result.record_count} measurements from ${result.runs.length} instrument run(s). ${result.runs.length > 1 ? 'Viewing the first run; select another below. Runs are kept separate.' : 'Review the suggested setup below.'}${result.warnings.length ? ` ${result.warnings.length} import warning(s).` : ''}`)
      setShowWorkspace(false)
      setUploadFile(null)
      if (fileInput.current) fileInput.current.value = ''
      setUploadName('')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Upload failed')
    } finally {
      setImporting(false)
    }
  }

  function applyExperiment(value:Experiment) {
    setDetail(value);setSampleInstances(value.sample_instances??{});setSampleMetadata(value.sample_metadata??{})
  }
  async function saveAnnotations(values:Record<string,SampleMetadata>) {
    const value=await apiFetch<Experiment>(`/api/projects/${selectedProjectId}/experiments/${activeExperimentId}/sample-instances`,{method:'PATCH',body:JSON.stringify(values)})
    applyExperiment(value)
    const metadata=(sample:string)=>sampleAnnotation(value.sample_instances,selectedRunId,sample)
    setSampleGroups(Object.fromEntries(sampleOptions.map(sample=>[sample,metadata(sample).role==='technical_control'?'':analysisGroup(metadata(sample))])))
    setTechnicalSamples(sampleOptions.filter(sample=>metadata(sample).role==='technical_control'))
    setStatus('Sample-instance mapping saved. Recalculate to apply it to expression analyses.')
  }
  async function saveDesign(design:ExperimentDesign) {
    applyExperiment(await apiFetch<Experiment>(`/api/projects/${selectedProjectId}/experiments/${activeExperimentId}/design`,{method:'PATCH',body:JSON.stringify(design)}))
    setDesignDraft(null)
  }
  async function saveQuality(change:QualityChange) {
    applyExperiment(await apiFetch<Experiment>(`/api/projects/${selectedProjectId}/experiments/${activeExperimentId}/quality-review`,{method:'PATCH',body:JSON.stringify(change)}))
  }
  async function previewQuality(run_id:string,target_assay:string,measurement_exclusions:Record<string,string>) {
    return apiFetch<ExclusionPreview>(`/api/projects/${selectedProjectId}/experiments/${activeExperimentId}/preview-well-exclusions`,{method:'POST',body:JSON.stringify({run_id,target_assay,measurement_exclusions})})
  }
  async function rebuildAnalyses() {
    const path=`/api/projects/${selectedProjectId}/experiments/${activeExperimentId}`
    const result=await apiFetch<{errors:{run_id?:string;target_assay?:string;reason:string}[];runs_rebuilt:number}>(`${path}/rebuild`,{method:'POST'})
    const value=await apiFetch<Experiment>(path)
    const history=await apiFetch<{id:string;created_at:string;result:AnalysisResult}[]>(`${path}/analyses`)
    applyExperiment(value);setHistoricalResult(null);setVersions(history);setSelectedStatistics(null)
    if(!draftDirty){const saved=history.find(v=>v.result.run_id===selectedRunId)?.result;if(saved)setSampleGroups(saved.sample_groups??{})}
    setStatus(`Rebuilt ${result.runs_rebuilt} run(s). Unavailable results remain explicit.`)
    return result
  }

  async function runAnalysis() {
    if (!selectedProjectId || !activeExperimentId || !selectedRun) {
      setStatus('Select an experiment and run before calculating.')
      return
    }
    if (setupIssues.length) {
      setStatus(`Cannot calculate: ${setupIssues.join(' ')}`)
      return
    }
    setBusy(true)
    setAnalysisError('')
    try {
      const candidates = assayOptions.filter(assay => !analysisConfig.referenceAssays.includes(assay))
      // Save the selected target last so it remains the latest single-analysis snapshot.
      const targets = [...candidates.filter(a => a !== analysisConfig.targetAssay), ...candidates.filter(a => a === analysisConfig.targetAssay)]
      const payload = {
        target_assay: analysisConfig.targetAssay, target_assays: targets,
        reference_assays: analysisConfig.referenceAssays, baseline_samples: baselineSamples,
        sample_groups: sampleGroups, excluded_samples: Object.keys(excludedSamples),
        technical_control_samples: technicalSamples, exclusion_reasons: excludedSamples,
        hit_threshold: hitThreshold, statistics_method: statisticsMethod,
        assumptions_confirmed: assumptionsConfirmed, run_id: selectedRun.id, sample_metadata: sampleMetadata, instance_metadata:sampleInstances, excluded_measurements:selectedExperiment?.measurement_exclusions, experiment_design:selectedExperiment?.experiment_design,
      }
      let result: AnalysisResult
      let completed = 1
      if (analyseAll) {
        const batch = await apiFetch<{results: AnalysisResult[]; errors: {target_assay: string; reason: string}[]}>(
          `/api/projects/${selectedProjectId}/experiments/${activeExperimentId}/analyze-batch`, {method: 'POST', body: JSON.stringify(payload)})
        result = batch.results[batch.results.length - 1]
        completed = batch.results.length
      } else {
        result = await apiFetch<AnalysisResult>(`/api/projects/${selectedProjectId}/experiments/${activeExperimentId}/analyze`, {method: 'POST', body: JSON.stringify(payload)})
      }
      setSetupEdited(false)
      delete setupDrafts.current[JSON.stringify([activeExperimentId,selectedRun.id])]
      setActiveTab('dashboard')
      setSelectedStatistics(result)
      shouldScrollToResults.current = true
      setDetail((current) => (current ? { ...current, analysis_result: result } : current))
      setHistoricalResult(null)
      setStatus(`Dashboard created: ${completed} target assay(s) in ${selectedRun.name}.`)
      try {
        setVersions(await apiFetch(`/api/projects/${selectedProjectId}/experiments/${activeExperimentId}/analyses`))
      } catch {
        setStatus('Dashboard created. Analysis history could not refresh; reload to retry history.')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Analysis failed'
      setAnalysisError(message)
      setStatus(message)
    } finally {
      setBusy(false)
    }
  }

  function selectRun(runId: string) {
    if (runId === selectedRunId) return
    if(selectedExperiment&&selectedRunId&&setupEdited)setupDrafts.current[JSON.stringify([selectedExperiment.id,selectedRunId])]={analysisConfig,baselineSamples,excludedSamples,hitThreshold,statisticsMethod,assumptionsConfirmed}
    if (selectedExperiment) configureRun(selectedExperiment, runId, versions)
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    setUploadFile(event.target.files?.[0] ?? null)
  }

  const setupIssues: string[] = backendIssue ? [backendIssue] : []
  if(designDraft)setupIssues.push('Save or discard experimental-design edits before calculating.')
  if(mappingDirty)setupIssues.push('Save or discard sample-mapping edits before calculating.')
  if (!selectedRun) setupIssues.push('Select an instrument run.')
  if (!analyseAll && !analysisConfig.targetAssay) setupIssues.push('Select a target assay.')
  if (analyseAll && assayOptions.every(a => analysisConfig.referenceAssays.includes(a))) setupIssues.push('Leave at least one target assay outside the references.')
  if (!analysisConfig.referenceAssays.length) setupIssues.push('Check at least one reference assay.')
  if (!baselineSamples.length) setupIssues.push('Check at least one baseline biological sample.')
  if (baselineSamples.some(sample => technicalSamples.includes(sample))) setupIssues.push('Technical controls cannot be used as biological baseline samples.')
  if (baselineSamples.some(sample => Object.hasOwn(excludedSamples, sample))) setupIssues.push('A baseline sample is excluded: restore it or uncheck it as a baseline.')
  if (!analyseAll && analysisConfig.referenceAssays.includes(analysisConfig.targetAssay)) setupIssues.push('Target and reference assays must be different.')
  if (!Number.isFinite(hitThreshold) || hitThreshold <= 0) setupIssues.push('Enter a positive fold-change threshold.')
  if (statisticsMethod === 'welch' && (!selectedExperiment?.experiment_design?.confirmed||selectedExperiment.experiment_design.design_type!=='independent')) setupIssues.push('Confirm an independent-group experimental design before using Welch tests.')
  if (statisticsMethod === 'welch' && !assumptionsConfirmed) setupIssues.push('Confirm the independent-group test assumptions or use descriptive mode.')

  const savedSetup=versions.find(v=>v.result.run_id===selectedRunId)?.result
  const sorted=(values:string[])=>JSON.stringify([...values].sort())
  const groups=(value:Record<string,string>)=>JSON.stringify(Object.entries(value).filter(([name,label])=>label.trim()&&!technicalSamples.includes(name)&&!Object.hasOwn(excludedSamples,name)).sort(([a],[b])=>a.localeCompare(b)))
  const draftDirty=Boolean(designDraft||mappingDirty||setupEdited||(savedSetup&&savedSetup.context_revision===selectedExperiment?.context_revision&&(sorted(analysisConfig.referenceAssays)!==sorted(savedSetup.reference_assays)||sorted(baselineSamples)!==sorted(savedSetup.baseline_samples??[])||sorted(technicalSamples)!==sorted(savedSetup.technical_control_samples??[])||sorted(Object.keys(excludedSamples))!==sorted(savedSetup.excluded_samples??[])||hitThreshold!==(savedSetup.hit_threshold??1.5)||statisticsMethod!==(savedSetup.statistics?.method??'descriptive')||groups(sampleGroups)!==groups(savedSetup.sample_groups??{}))))
  const analysisResult = historicalResult ?? (
    selectedExperiment && selectedRun && Array.isArray(selectedExperiment.analysis_result?.samples) && selectedExperiment.analysis_result?.run_id === selectedRun.id
      ? selectedExperiment.analysis_result
      : null)
  const exportPath =
    selectedProjectId && activeExperimentId
      ? `/api/projects/${selectedProjectId}/experiments/${activeExperimentId}`
      : ''

  return (
    <div className="app-shell">
      <aside className={`sidebar ${showWorkspace?'workspace-open':''}`}>
        <div>
          <p className="eyebrow">Workbench</p>
          <h1>qPCR Analysis</h1><button className="workspace-toggle" aria-expanded={showWorkspace} onClick={()=>setShowWorkspace(v=>!v)}>{showWorkspace?'Close workspace':'Projects / upload'}</button>
        </div>
        <div className="panel">
          <label>
            <span>Project name</span>
            <input value={projectName} onChange={(event) => setProjectName(event.target.value)} />
          </label>
          <button onClick={createProject} disabled={importing}>Create project</button>
        </div>
        <div className="panel">
          <h3>Projects</h3>
          {projects.length === 0 && <p>No projects yet.</p>}
          <ul className="project-list">
            {projects.map((project) => (
              <li key={project.id}>
                <button
                  disabled={importing}
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
                disabled={importing}
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
          <p className="helper-text">Choose a Ct/Cq export or workbook. Multiple instrument runs are detected and kept separate.</p>
          <label>
            <span>Experiment label</span>
            <input value={uploadName} onChange={(event) => setUploadName(event.target.value)} />
          </label>
          <label>
            <span>File</span>
            <input ref={fileInput} type="file" accept=".csv,.xlsx,.xlsm" disabled={importing} onChange={handleFileChange} />
          </label>
          {!selectedProjectId && <p className="helper-text">Import will create a project using the name above. No separate setup step is needed.</p>}
          <button onClick={addExperiment} disabled={!uploadFile || importing}>
            {importing ? 'Importing…' : selectedProjectId ? 'Import raw results' : 'Create project and import'}
          </button>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div>
            <p className="eyebrow">Raw input → processed dashboard</p>
            <h2>{selectedExperiment?.name ?? 'Import your qPCR results'}</h2>
            <p className="helper-text">
              {selectedExperiment?.original_filename ?? 'Upload a qPCR instrument export to begin.'}
            </p>
          </div>
          {analysisResult && !historicalResult && (
            <div className="button-row">
              <a className="button-link" href={`${API_ROOT}${exportPath}/export.csv`}>Latest analysis CSV</a>
            </div>
          )}
        </header>
        <div className="status-bar" role="status" aria-live="polite">{status}</div>
        {backendIssue && <p className="analysis-error" role="alert">{backendIssue}</p>}

        {!selectedExperiment && activeTab === 'setup' && <section className="panel welcome-panel">
          <h3>Start with your instrument export</h3>
          <ol><li>Choose a CSV or Excel workbook in Raw data upload.</li><li>Click {selectedProjectId ? 'Import raw results' : 'Create project and import'}.</li><li>Review detected runs, sample groups, references and baseline samples.</li></ol>
          <p>A workbook can contain multiple runs. You can inspect each run before choosing how to analyse its samples.</p>
        </section>}
        <nav className="view-tabs" aria-label="Workbench views">
          {['setup', 'dashboard', 'statistics', 'history'].map(tab => <button key={tab} aria-pressed={activeTab === tab} onClick={() => setActiveTab(tab)}>
            {tab === 'setup' ? '1 · Import & setup' : tab === 'dashboard' ? '2 · Dashboard' : tab === 'statistics' ? 'Statistics · why & what it means' : 'Analysis history'}
          </button>)}
        </nav>
        {selectedExperiment && <div hidden={activeTab !== 'dashboard'}>
          <Dashboard key={selectedExperiment.id} experiment={selectedExperiment} versions={versions} currentResult={analysisResult}
            referenceAssays={analysisConfig.referenceAssays} annotations={sampleInstances} onSaveAnnotations={saveAnnotations} onQuality={saveQuality} onPreview={previewQuality} onMappingDirty={setMappingDirty} onRebuild={rebuildAnalyses} draftDirty={draftDirty}
            onSetup={() => setActiveTab('setup')} snapshot={historicalResult} onClearSnapshot={()=>setHistoricalResult(null)} onStatistics={result=>{setSelectedStatistics(result);setActiveTab('statistics')}} />
        </div>}
        {activeTab === 'statistics' && <><h3>Statistics · {(selectedStatistics??analysisResult)?.target_assay??'select an analysis'} · {runs.find(r=>r.id===(selectedStatistics??analysisResult)?.run_id)?.name??''}</h3><StatisticsResults result={(selectedStatistics??analysisResult)?.statistics} /><StatisticsExplanation /></>}
        {activeTab === 'history' && <section className="panel"><h3>Saved analysis versions</h3><p>Each calculation is retained. Open a snapshot to inspect its results; setup controls show the current configuration for that run. Recalculate to create a new version.</p>
          {versions.length === 0 && <p>No saved analyses yet.</p>}
          {versions.map(v => <div key={v.id}><button className="history-entry" onClick={() => { selectRun(v.result.run_id); setHistoricalResult(v.result); setActiveTab('dashboard') }}>
            {new Date(v.created_at).toLocaleString()} · {v.result.target_assay} · {v.result.run_id} · method {v.result.statistics?.method ?? 'legacy'}
          </button><a href={`${API_ROOT}${exportPath}/analyses/${v.id}/export.json`}>Download saved results and settings (JSON)</a></div>)}
        </section>}
        {selectedExperiment && activeTab === 'setup' && (
          <>
            <section className="panel run-overview">
              <div className="analysis-header"><h3>Detected instrument runs</h3><button className="quiet-button" onClick={()=>setActiveTab('dashboard')}>View all Ct plots →</button></div>
              <p>{selectedExperiment.parsed_summary?.record_count ?? 0} measurements across {runs.length} run(s). Select a run to inspect its raw data and setup. Run boundaries are preserved; sharing a workbook does not mean samples belong to one biological experiment.</p>
              <div className="condition-cards">{runs.map(run => <button key={run.id} aria-pressed={selectedRunId === run.id} className="run-card" onClick={() => selectRun(run.id)}>
                <strong>{run.name}</strong><span>{run.sheet} · header row {run.header_row}</span><span>{run.record_count} measurements · {run.plate_size ?? 'Unknown'}-well plate</span><span>{selectedRunId === run.id ? 'Currently viewing' : 'View this run'}</span>
              </button>)}</div>
            </section>
            <section className="panel analysis-panel">
              <div className="analysis-header">
                <h3>Set up processing</h3>
                <span>{selectedExperiment.parsed_summary?.record_count ?? 0} raw measurements imported</span>
              </div>
              <DesignPanel value={selectedExperiment.experiment_design} onSave={saveDesign} draft={designDraft} onDraftChange={setDesignDraft}/>
              <label className="confirmation"><input type="checkbox" checked={analyseAll} onChange={event => setAnalyseAll(event.target.checked)} />Analyse all target assays in this run</label>
              <div className="analysis-controls">
                <label>
                  <span>Instrument run</span>
                  <select aria-label="Instrument run" value={selectedRun?.id ?? ''} onChange={(event) => selectRun(event.target.value)}>
                    <option value="">Select a run</option>
                    {runs.map((run) => (
                      <option key={run.id} value={run.id}>
                        {run.name} · {run.record_count} measurements
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Target assay</span>
                  <select aria-label="Target assay" disabled={analyseAll}
                    value={analyseAll ? '' : analysisConfig.targetAssay}
                    onChange={event => {
                      const target = event.target.value
                      setSetupEdited(true)
                      setAnalysisConfig(current => ({ ...current, targetAssay: target, referenceAssays: current.referenceAssays.filter(a => a !== target) }))
                      setAnalysisError('')
                      setStatus('Setup updated. Review the selection summary below, then create the dashboard.')
                    }}
                  >
                    <option value="">{analyseAll ? 'All non-reference assays' : 'Select target'}</option>
                    {assayOptions.map((assay) => <option key={assay}>{assay}</option>)}
                  </select>
                </label>
                <fieldset className="selection-group">
                  <legend>Reference assays ({analysisConfig.referenceAssays.length} selected)</legend>
                  <p>Check the reference genes specified by your protocol.</p>
                  <div className="checkbox-options">{assayOptions.filter(assay => analyseAll || assay !== analysisConfig.targetAssay).map(assay => <label key={assay}>
                    <input type="checkbox" aria-label={`Use ${assay} as reference`} checked={analysisConfig.referenceAssays.includes(assay)} onChange={event => {
                      const checked = event.target.checked
                      setSetupEdited(true)
                      setAnalysisConfig(current => ({...current, referenceAssays: checked ? [...current.referenceAssays, assay] : current.referenceAssays.filter(a => a !== assay)}))
                      setAnalysisError('')
                      setStatus('Setup updated. Review the selection summary below, then create the dashboard.')
                    }} /><span>{assay}</span>
                  </label>)}</div>
                </fieldset>
                <fieldset className="selection-group">
                  <legend>Baseline biological samples ({baselineSamples.length} selected)</legend>
                  <p>Check the biological controls that define the baseline.</p>
                  <div className="checkbox-options">{sampleOptions.map(sample => <label key={sample}>
                    <input type="checkbox" aria-label={`Use ${sample} as baseline`} checked={baselineSamples.includes(sample)} disabled={(Object.hasOwn(excludedSamples, sample) || technicalSamples.includes(sample)) && !baselineSamples.includes(sample)} onChange={event => {
                      const checked = event.target.checked
                      setSetupEdited(true)
                      setBaselineSamples(current => checked ? [...current, sample] : current.filter(s => s !== sample))
                      setAnalysisError('')
                      setStatus('Setup updated. Review the selection summary below, then create the dashboard.')
                    }} /><span>{sample}{technicalSamples.includes(sample) ? ' (technical control)' : Object.hasOwn(excludedSamples, sample) ? ' (excluded)' : ''}</span>
                  </label>)}</div>
                </fieldset>
              </div>
              <p className="helper-text">
                Day-zero baselines and common reference names are suggestions: review them against your protocol. Results are calculated within the selected instrument run. Technical wells are averaged per
                sample and assay; separate runs are never combined automatically.
              </p>
              <div className={`setup-summary ${setupIssues.length ? 'needs-input' : 'ready'}`} aria-live="polite">
                <h4>{setupIssues.length ? 'Setup needs attention' : 'Ready to create dashboard'}</h4>
                {analysisError && <p className="analysis-error" role="alert">{analysisError}</p>}
                <p>Target: <strong>{analyseAll ? `All ${assayOptions.filter(a => !analysisConfig.referenceAssays.includes(a)).length} target assays` : analysisConfig.targetAssay || 'not selected'}</strong> · References: <strong>{analysisConfig.referenceAssays.join(', ') || 'none'}</strong> · Baseline: <strong>{baselineSamples.length} biological sample(s)</strong></p>
                {baselineSamples.length > 0 && <p>Baseline samples: {baselineSamples.join('; ')}</p>}
                {setupIssues.length > 0 && <ul>{setupIssues.map(issue => <li key={issue}>{issue}</li>)}</ul>}
                <button className="run-button" disabled={busy || setupIssues.length > 0} onClick={runAnalysis}>{busy ? 'Calculating…' : 'Create dashboard and save analysis'}</button>
              </div>
              {draftDirty&&<p><button className="quiet-button" onClick={()=>configureRun(selectedExperiment,selectedRunId,versions,true)}>Restore saved setup</button> Unsaved setup edits are not applied by Rebuild saved runs.</p>}
              <p className="technical-control-note">Technical controls: {technicalSamples.join(', ') || 'none detected'}. These remain in raw data and are excluded from expression calculations and statistics. Review or override roles below.</p>
              <details className="setup-details"><summary>Review suggested biological conditions and exclusions</summary>
                <p>Condition labels come from the saved run-specific mapping. <button className="text-button" onClick={()=>{setActiveTab('dashboard');setTimeout(()=>{const mapping=document.querySelector<HTMLDetailsElement>('.sample-mapping');if(mapping){mapping.open=true;mapping.scrollIntoView({behavior:'smooth'})}},0)}}>Edit sample and time mapping</button></p>
                <p>Suffixes such as .1 and .2 suggest biological samples within a condition. Review every label. This does not establish pairing. Leave controls such as H₂O ungrouped.</p>
                <div className="results-table-wrap"><table><thead><tr><th>Sample</th><th>Role</th><th>Condition</th><th>Exclude from this analysis</th></tr></thead><tbody>
                  {sampleOptions.map(sample => <tr key={sample}><td>{sample}</td><td><select aria-label={`Role for ${sample}`} value={technicalSamples.includes(sample) ? 'technical' : 'biological'} onChange={event => {
                    const technical = event.target.value === 'technical'
                    setTechnicalSamples(current => technical ? [...current, sample] : current.filter(s => s !== sample))
                    if (technical) { setBaselineSamples(current => current.filter(s => s !== sample)); setSampleGroups(current => ({...current, [sample]: ''})) }
                    setAnalysisError('')
                    void saveAnnotations({[sampleKey(selectedRunId,sample)]:{...sampleAnnotation(sampleInstances,selectedRunId,sample),role:technical?'technical_control':'biological'}}).catch(error=>setStatus(error instanceof Error?error.message:'Could not save role.'))
                  }}><option value="biological">Biological sample</option><option value="technical">Technical control</option></select></td><td><input disabled={technicalSamples.includes(sample)} aria-label={`Condition for ${sample}`} readOnly aria-readonly="true" value={sampleGroups[sample] ?? ''} /></td>
                    <td><input aria-label={`Exclusion reason for ${sample}`} placeholder="Reason (blank = include)" value={excludedSamples[sample] ?? ''} onChange={event => {
                      const reason = event.target.value
                      setSetupEdited(true)
                      setExcludedSamples(current => { const next = {...current}; if (reason.trim()) next[sample] = reason; else delete next[sample]; return next })
                    }} /></td></tr>)}
                </tbody></table></div>
              </details>
              <div className="analysis-controls">
                <label><span>Screening fold-change threshold</span><input type="number" min="0.01" step="0.1" value={hitThreshold} onChange={event => {setSetupEdited(true);setHitThreshold(Number(event.target.value))}} /></label>
                <label><span>Statistical approach</span><select value={statisticsMethod} onChange={event => {setSetupEdited(true);setStatisticsMethod(event.target.value); setAssumptionsConfirmed(false)}}>
                  <option value="descriptive">Descriptive + normality diagnostics</option><option disabled={!selectedExperiment.experiment_design?.confirmed||selectedExperiment.experiment_design.design_type!=='independent'} value="welch">Independent Welch comparisons + Holm</option>
                </select></label>
              </div>
              {statisticsMethod === 'welch' && <label className="confirmation"><input type="checkbox" checked={assumptionsConfirmed} onChange={event => {setSetupEdited(true);setAssumptionsConfirmed(event.target.checked)}} />
                I confirm these are independent biological groups (no pairing, repeated samples or unmodelled blocks), and a normal-population mean comparison is justified by the protocol or prior evidence. Small-n tests are exploratory.
              </label>}
              <p><button onClick={() => setActiveTab('statistics')}>Why these statistics? Read the explanation</button></p>
              <button className="run-button" disabled={busy || setupIssues.length > 0} onClick={runAnalysis}>{busy ? 'Calculating…' : 'Create dashboard and save analysis'}</button>
            </section>

            {selectedRun && <section className="panel">
              <h3>Imported raw data · {selectedRun.name}</h3>
              <p>{runRecords.length} measurements · {sampleOptions.length} sample labels · {assayOptions.length} assays. Choose a target and review the suggested setup before calculating.</p>
              <details><summary>Inspect raw measurements</summary><div className="results-table-wrap"><table><thead><tr><th>Well</th><th>Sample</th><th>Assay</th><th>Ct</th><th>Status</th><th>Instrument omitted</th><th>Source</th></tr></thead>
                <tbody>{runRecords.map((record, i) => <tr key={`${record.row_number}-${i}`}><td>{record.well}</td><td>{record.sample}</td><td>{record.assay}</td><td>{record.ct ?? '—'}</td><td>{record.status}</td><td>{record.omit ? 'Yes' : 'No'}</td><td>{record.sheet}, row {record.row_number}</td></tr>)}</tbody>
              </table></div></details>
            </section>}
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

export default App

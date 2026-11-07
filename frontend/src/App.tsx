import { useEffect, useRef, useState, useCallback } from 'react'
import './App.css'
import './workflow.css'
import './theme.css'
import { ExperimentSummary, ExperimentTitle } from './ExperimentHeader'
import { apiErrorMessage } from './apiErrors'

import type { AnalysisResult, AnalysisType, Experiment, LayoutChange, Project, RawRecord, Run, SampleMetadata, ExperimentDesign, QualityChange, ExclusionPreview } from './types'
import {ExperimentTypeChoice,ExperimentTypeQuestion} from './ExperimentType'
import {DesignPanel} from './DesignPanel'
import {sampleKey,sampleAnnotation,analysisGroup} from './plotData'
import { Dashboard } from './Dashboard'
import {ExperimentLibrary} from './ExperimentLibrary'
import {SampleMappingPanel} from './SampleMappingPanel'
import {GeneExplorer} from './GeneExplorer'
import {HistoryPanel} from './HistoryPanel'
import {NormalizationStep} from './NormalizationStep'
import {PlateCheck} from './PlateCheck'
import {PlateLayoutPanel} from './PlateLayoutPanel'
import {NumberSamplesStep,NumberedSamplesNotice} from './SampleNumbering'
import {suggestReferences} from './referenceGenes'
import {StatisticsView} from './StatisticsView'
import {UploadPanel} from './UploadPanel'
import {useWindowFileDrop} from './fileDrop'
import {addFiles,fileKey,importReport,uploadRequests,type ImportFailure,type UploadMode,type UploadOutcome,type UploadRequest} from './uploads'
import {AddPlatesPanel} from './AddPlatesPanel'
import {experimentFiles,withoutExtension} from './plates'

const API_ROOT = (import.meta.env.VITE_API_ROOT ?? '').replace(/\/$/, '')
// Plate & samples comes first: what the workbench read, well by well, before any result built on it.
const RESULT_TABS = [['plate', 'Plate & samples'], ['dashboard', 'Overview'], ['genes', 'All genes'], ['statistics', 'Statistics'], ['history', 'History']] as const
const SETUP_STEPS = [['layout', 'Plate layout'], ['samples', 'Samples & design'], ['setup', 'Normalization']] as const
const UNASSIGNED_SAMPLE = 'Unassigned sample'
/** Wells that can enter a normalization: named, measured and not a technical control. */
const analysable = (annotations: Record<string, SampleMetadata> | undefined) => (record: RawRecord) =>
  record.sample !== UNASSIGNED_SAMPLE && record.assay !== 'Unassigned assay' && sampleAnnotation(annotations, record.run_id, record.sample).role !== 'technical_control'
type Page = 'library' | 'genes' | 'experiment'

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
  const [page,setPage]=useState<Page>('library')
  const [libraryLoading,setLibraryLoading]=useState(true)
  const [libraryError,setLibraryError]=useState('')
  const [uploadOpen,setUploadOpen]=useState(false)
  const [uploadDestination,setUploadDestination]=useState('')
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [selectedExperimentId, setSelectedExperimentId] = useState('')
  const [detail, setDetail] = useState<Experiment | null>(null)
  const [selectedRunId, setSelectedRunId] = useState('')
  const [projectName, setProjectName] = useState('My qPCR project')
  const [uploadName, setUploadName] = useState('')
  const [uploadFiles, setUploadFiles] = useState<File[]>([])
  const [uploadMode, setUploadMode] = useState<UploadMode|null>(null)
  const [uploadFailures, setUploadFailures] = useState<ImportFailure[]>([])
  // What a batch import added, shown in the library (the status bar belongs to the experiment page).
  const [libraryNotice, setLibraryNotice] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState('')
  const [analysisConfig, setAnalysisConfig] = useState({
    targetAssay: '',
    referenceAssays: [] as string[],
    baselineSample: '',
  })
  const [activeTab, setActiveTab] = useState('dashboard')
  // The tab an experiment opens on once loaded: Overview, or Plate & samples right after an import.
  const landingTab = useRef<string | null>(null)
  const [baselineSamples, setBaselineSamples] = useState<string[]>([])
  const [technicalSamples, setTechnicalSamples] = useState<string[]>([])
  const [sampleMetadata, setSampleMetadata] = useState<Record<string, SampleMetadata>>({})
  const [sampleInstances, setSampleInstances] = useState<Record<string,SampleMetadata>>({})
  const [designDraft,setDesignDraft]=useState<ExperimentDesign|null>(null)
  const [mappingDirty,setMappingDirty]=useState(false)
  const [layoutDirty,setLayoutDirty]=useState(false)
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
  const [typeBusy, setTypeBusy] = useState(false)
  const [numberingBusy, setNumberingBusy] = useState(false)
  const [analysisError, setAnalysisError] = useState('')
  const [backendIssue, setBackendIssue] = useState('Checking backend compatibility…')
  const [importing, setImporting] = useState(false)
  const shouldScrollToResults = useRef(false)
  const openExperiment = useRef('')

  const configureRun=useCallback((experiment:Experiment,runId:string,history:{id:string;created_at:string;result:AnalysisResult}[]=[],restore=false)=>{
    setAnalysisError('')
    setSetupEdited(false)
    const draftKey=JSON.stringify([experiment.id,runId])
    if(restore)delete setupDrafts.current[draftKey]
    setSelectedRunId(runId)
    const saved = experiment.analysis_result?.run_id === runId ? experiment.analysis_result : history.find(v=>v.result.run_id===runId)?.result??null
    setHistoricalResult(null)
    const records = (experiment.raw_records ?? []).filter(r => r.run_id === runId)
    const samples = [...new Set(records.map(r => r.sample))].filter(name => name !== UNASSIGNED_SAMPLE)
    const controls = experiment.sample_instances ? samples.filter(name=>sampleAnnotation(experiment.sample_instances,runId,name).role==='technical_control') : saved?.technical_control_samples ?? samples.filter(name => sampleAnnotation(experiment.sample_instances,runId,name).role === 'technical_control' || (!experiment.sample_instances&&experiment.sample_roles?.[name] === 'technical_control'))
    setTechnicalSamples(controls)
    const present = <T,>(values: Record<string, T>) => Object.fromEntries(Object.entries(values).filter(([name]) => samples.includes(name)))
    const savedBaselines = (saved?.baseline_samples ?? (saved?.baseline_sample ? [saved.baseline_sample] : [])).filter(name => samples.includes(name))
    setBaselineSamples(savedBaselines.length ? savedBaselines : samples.filter(name => sampleAnnotation(experiment.sample_instances,runId,name).timepoint === 0 || /day 0\.\d+$/i.test(name)))
    const suggestedGroups = Object.fromEntries(samples.map(name => [name, controls.includes(name) ? '' : analysisGroup(sampleAnnotation(experiment.sample_instances,runId,name))]))
    // Samples added to the run after its last analysis (a later plate) start from their suggested condition.
    setSampleGroups(saved?.sample_groups ? {...suggestedGroups, ...present(saved.sample_groups)} : suggestedGroups)
    setExcludedSamples(present(saved?.exclusion_reasons ?? {}))
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
        : { targetAssay: '', referenceAssays: suggestReferences([...new Set(records.filter(analysable(experiment.sample_instances)).map(r => r.assay))].sort()), baselineSample: '' },
    )
    const draft=setupDrafts.current[draftKey]
    if(draft){setAnalysisConfig(draft.analysisConfig);setBaselineSamples(draft.baselineSamples);setExcludedSamples(draft.excludedSamples);setHitThreshold(draft.hitThreshold);setStatisticsMethod(draft.statisticsMethod);setAssumptionsConfirmed(draft.assumptionsConfirmed);setSetupEdited(true)}
  },[])

  useEffect(()=>{
    if(!uploadOpen)return
    const previous=document.activeElement as HTMLElement|null
    const overflow=document.body.style.overflow
    document.body.style.overflow='hidden'
    document.querySelector<HTMLButtonElement>('.upload-close')?.focus()
    function keys(event:KeyboardEvent){
      if(event.key==='Escape'&&!importing){setUploadOpen(false);return}
      if(event.key!=='Tab')return
      const nodes=Array.from(document.querySelectorAll<HTMLElement>('.sidebar button:not(:disabled), .sidebar input:not(:disabled), .sidebar select:not(:disabled), .sidebar a[href]')).filter(node=>node.getClientRects().length>0)
      const first=nodes[0],last=nodes[nodes.length-1]
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}
    }
    document.addEventListener('keydown',keys)
    return()=>{document.body.style.overflow=overflow;document.removeEventListener('keydown',keys);previous?.focus()}
  },[uploadOpen,importing])

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
  useEffect(() => { openExperiment.current = activeExperimentId }, [activeExperimentId])
  const runRecords = selectedRun
    ? (selectedExperiment?.raw_records ?? []).filter((record) => record.run_id === selectedRun.id)
    : []
  const assayOptions = [...new Set(runRecords.filter(analysable(sampleInstances)).map((record) => record.assay).filter(Boolean))].sort()
  const sampleOptions = [...new Set(runRecords.map((record) => record.sample).filter(sample => sample && sample !== UNASSIGNED_SAMPLE))].sort()
  const inSetup = activeTab === 'layout' || activeTab === 'samples' || activeTab === 'setup'
  const layoutChecks = selectedExperiment?.layout_checks ?? []
  // Nothing to normalize until the scientist says which sample is in which well.
  const layoutNeeded = layoutChecks.some(check => check.blocking) || (layoutChecks.length > 0 && !assayOptions.length)
  const layoutSuggestions = selectedExperiment?.layout_suggestions ?? []
  const analysisType = selectedExperiment?.analysis_type
  // A stability experiment compares raw Ct: there is no normalization step.
  const stability = analysisType?.type === 'reference_stability'
  const typeQuestion = Boolean(analysisType?.suggestion && !analysisType.confirmed)
  const setupSteps = stability ? SETUP_STEPS.filter(([step]) => step !== 'setup') : SETUP_STEPS

  useEffect(() => {
    void loadProjects()
    void checkBackend()
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
          setDesignDraft(null);setMappingDirty(false);setLayoutDirty(false)
          setActiveTab(landingTab.current ?? 'dashboard')
          landingTab.current = null
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

  async function checkBackend() {
    await apiFetch<{ paths?: Record<string, unknown>; components?: { schemas?: { AnalysisRequest?: { properties?: Record<string, unknown> } } } }>('/openapi.json')
      .then(schema => setBackendIssue(schema.components?.schemas?.AnalysisRequest?.properties?.baseline_samples && schema.paths?.['/api/projects/{project_id}/experiments/{experiment_id}/quality-review']
        ? ''
        : 'The running qPCR backend is outdated. Restart the backend with the current code, then refresh this page.'))
      .catch(() => setBackendIssue('Cannot check the backend connection. Start the qPCR backend, then refresh this page.'))
  }

  async function loadProjects() {
    setLibraryLoading(true);setLibraryError('')
    try {
      const data = await apiFetch<Project[]>('/api/projects')
      setProjects(data)
      setSelectedProjectId((current) =>
        data.some((project) => project.id === current) ? current : data[0]?.id ?? '',
      )
    } catch (error) {
      setLibraryError(error instanceof Error ? error.message : 'Could not load experiments.')
    } finally {setLibraryLoading(false)}
  }

  function showPage(next: Page) {
    setPage(next)
    if (next !== 'experiment') void loadProjects()
  }

  function openUpload() {
    setUploadDestination(selectedProjectId || projects[0]?.id || '')
    setUploadOpen(true)
  }

  function addUploadFiles(files: File[]) {
    setUploadFiles(current => addFiles(current, files))
    // New files may not belong together the way the earlier ones did: ask again.
    setUploadMode(null)
  }

  // Refused while importing (the list is being imported) and while a dialog such as plot settings is open.
  const fileDragOver = useWindowFileDrop(files => {
    addUploadFiles(files)
    if (!uploadOpen) openUpload()
  }, () => !importing && !document.querySelector<HTMLElement>('.app-shell')?.inert)

  function finishUpload(remaining: File[] = [], failures: ImportFailure[] = []) {
    setUploadFiles(remaining)
    setUploadFailures(failures)
    if (fileInput.current) fileInput.current.value = ''
    if (remaining.length) return
    setUploadMode(null)
    setUploadName('')
    setUploadOpen(false)
  }

  async function postUpload(projectId: string, request: UploadRequest<File>) {
    const form = new FormData()
    form.append('name', request.name)
    for (const file of request.files) form.append('files', file)
    form.append('combine', String(request.combine))
    const response = await fetch(`${API_ROOT}/api/projects/${projectId}/upload`, { method: 'POST', body: form })
    if (!response.ok) throw new Error(apiErrorMessage(await response.json().catch(() => null), response.status))
    return await response.json() as { id: string; record_count: number; warnings: string[]; runs: Run[]; files: string[]; numbering_problem?: string | null }
  }

  async function uploadProject() {
    if (uploadDestination) return uploadDestination
    const created = await apiFetch<{ id: string }>('/api/projects', {
      method: 'POST', body: JSON.stringify({ name: projectName.trim() || 'My qPCR project' }),
    })
    // Keep the created project as the destination if parsing fails, so retrying does not create duplicates.
    setUploadDestination(created.id)
    await loadProjects()
    return created.id
  }

  async function importOne(projectId: string, request: UploadRequest<File>) {
    const result = await postUpload(projectId, request)
    // From here the files are imported. loadProjects reports its own errors, so a failed refresh cannot leave
    // them in the panel to be imported twice.
    await loadProjects()
    setSelectedProjectId(projectId)
    setHistoricalResult(null)
    setVersions([])
    setSelectedExperimentId(result.id)
    // A new import starts where the scientist can check how the workbench read the plate.
    landingTab.current = 'plate'
    setActiveTab('plate')
    setPage('experiment')
    const plates = result.runs.reduce((count, run) => count + (run.plates?.length ?? 1), 0)
    setStatus(`Imported ${result.record_count} measurements from ${plates} plate(s) in ${result.runs.length} run(s).${result.numbering_problem ? ` ${result.numbering_problem}` : ''}`)
    finishUpload()
  }

  /** One experiment per file. A file that fails stays in the panel with its reason; the others are kept. */
  async function importSeparately(projectId: string, requests: UploadRequest<File>[]) {
    let outcomes: UploadOutcome<File>[] = []
    for (const [index, request] of requests.entries()) {
      setStatus(`Importing ${index + 1} of ${requests.length}: ${request.files[0].name}…`)
      const error = await postUpload(projectId, request).then(() => null, (reason: unknown) => reason instanceof Error ? reason.message : 'Upload failed')
      outcomes = [...outcomes, { request, error }]
    }
    const report = importReport(outcomes)
    await loadProjects()
    setSelectedProjectId(projectId)
    setPage('library')
    setLibraryNotice(report.imported.length ? `Imported ${report.imported.length} experiment${report.imported.length === 1 ? '' : 's'}: ${report.imported.join(', ')}. Open each one to set up its analysis.` : '')
    setStatus(report.failed.length ? report.message : '')
    finishUpload(outcomes.flatMap(outcome => outcome.error == null ? [] : outcome.request.files), report.failed)
  }

  async function addExperiment() {
    const requests = uploadRequests(uploadFiles, uploadMode, uploadName)
    if (!requests.length || importing) return
    setImporting(true)
    setUploadFailures([])
    setLibraryNotice('')
    setStatus('Importing workbook and detecting instrument runs…')
    try {
      const projectId = await uploadProject()
      if (requests.length === 1) await importOne(projectId, requests[0])
      else await importSeparately(projectId, requests)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Upload failed')
    } finally {
      setImporting(false)
    }
  }

  function applyExperiment(value:Experiment) {
    setDetail(value);setSampleInstances(value.sample_instances??{});setSampleMetadata(value.sample_metadata??{})
  }
  async function addPlates(files:File[],combineInto:string) {
    const experimentId=activeExperimentId
    const path=`/api/projects/${selectedProjectId}/experiments/${experimentId}`
    const form=new FormData()
    for(const file of files)form.append('files',file)
    form.append('combine_into',combineInto)
    const response=await fetch(`${API_ROOT}${path}/plates`,{method:'POST',body:form})
    if(!response.ok)throw new Error(apiErrorMessage(await response.json().catch(()=>null),response.status))
    const value=await response.json() as Experiment
    void loadProjects()
    // The scientist may have opened another experiment while the plates were uploading.
    if(openExperiment.current!==experimentId)return
    applyExperiment(value)
    // Keep unsaved setup edits, as switching runs does.
    if(selectedRunId&&setupEdited)setupDrafts.current[JSON.stringify([experimentId,selectedRunId])]={analysisConfig,baselineSamples,excludedSamples,hitThreshold,statisticsMethod,assumptionsConfirmed}
    configureRun(value,combineInto||selectedRunId||value.parsed_summary?.runs?.[0]?.id||'',versions)
    setStatus(`Added ${files.map(file=>file.name).join(', ')}${combineInto?' to the combined run':' as a separate run'}. ${versions.length?'Recalculate results to include the new plate.':'Set up the analysis when you are ready.'}`)
  }
  async function saveAnnotations(values:Record<string,SampleMetadata>) {
    const value=await apiFetch<Experiment>(`/api/projects/${selectedProjectId}/experiments/${activeExperimentId}/sample-instances`,{method:'PATCH',body:JSON.stringify(values)})
    applyExperiment(value);void loadProjects()
    const metadata=(sample:string)=>sampleAnnotation(value.sample_instances,selectedRunId,sample)
    setSampleGroups(Object.fromEntries(sampleOptions.map(sample=>[sample,metadata(sample).role==='technical_control'?'':analysisGroup(metadata(sample))])))
    setTechnicalSamples(sampleOptions.filter(sample=>metadata(sample).role==='technical_control'))
    setStatus('Sample mapping saved. Recalculate to apply it to expression results.')
  }
  async function saveLayout(change:LayoutChange) {
    const value=await apiFetch<Experiment>(`/api/projects/${selectedProjectId}/experiments/${activeExperimentId}/plate-layout`,{method:'PUT',body:JSON.stringify(change)})
    applyExperiment(value);void loadProjects()
    // Sample names changed: suggestions for groups, baselines and references start again from the new names.
    configureRun(value,selectedRunId||change.run_id,versions,true)
    setStatus(change.wells?'Plate layout saved. Check conditions and replicates under Samples & design, then recalculate.':'Replicates confirmed.')
  }
  /** Numbers the samples of plates whose export names none, as the workbench proposes; Undo gives the wells back their names. */
  async function changeNumbering(undo:boolean) {
    if(!selectedExperiment)return
    setNumberingBusy(true)
    try {
      const path=`/api/projects/${selectedProjectId}/experiments/${activeExperimentId}/number-samples`
      // The revision the suggestion was shown at: if the experiment changed since, the server asks to look again.
      const value=await apiFetch<Experiment>(path,undo?{method:'DELETE'}:{method:'POST',body:JSON.stringify({expected_revision:selectedExperiment.context_revision??0})})
      applyExperiment(value);void loadProjects();configureRun(value,selectedRunId,versions,true)
      setStatus(undo?'Numbering undone: these wells have no sample name again.':'Samples numbered. Give them their names under Plate layout to see your conditions.')
    } catch(error) {
      setStatus(error instanceof Error?error.message:'Could not change the sample numbering.')
    } finally {setNumberingBusy(false)}
  }
  /** The scientist's answer for wells with only a late Ct: no-template controls, or the sample whose place they hold. */
  function answerLate(change:LayoutChange,answer:string) {
    setNumberingBusy(true)
    saveLayout(change).then(()=>setStatus(`Saved: ${answer}.`)).catch(error=>setStatus(error instanceof Error?error.message:'Could not save the answer.')).finally(()=>setNumberingBusy(false))
  }
  /** Records the experiment type; genes are the stability comparison, undefined keeps the saved choice. */
  async function saveAnalysisType(type:AnalysisType,genes?:string[]|null) {
    setTypeBusy(true)
    try {
      const stability_genes=genes===undefined?selectedExperiment?.analysis_type?.stability_genes??null:genes
      const value=await apiFetch<Experiment>(`/api/projects/${selectedProjectId}/experiments/${activeExperimentId}/analysis-type`,{method:'PUT',body:JSON.stringify({type,stability_genes})})
      applyExperiment(value);void loadProjects()
      if(genes===undefined){
        if(type==='reference_stability'&&activeTab==='setup')setActiveTab('samples')
        setStatus(type==='reference_stability'?'Analysed as a reference-gene stability experiment: raw Ct per gene and condition, no fold change.':'Analysed as a gene expression experiment: set up normalization to calculate fold changes.')
      }
    } finally {setTypeBusy(false)}
  }
  const answerType=(type:AnalysisType)=>void saveAnalysisType(type).catch(error=>setStatus(error instanceof Error?error.message:'Could not save the experiment type.'))
  async function renameExperiment(name:string) {
    const value=await apiFetch<Experiment>(`/api/projects/${selectedProjectId}/experiments/${activeExperimentId}`,{method:'PATCH',body:JSON.stringify({name})})
    applyExperiment(value)
    setProjects(current=>current.map(project=>project.id!==selectedProjectId?project:{...project,experiments:project.experiments.map(experiment=>experiment.id===value.id?{...experiment,name:value.name}:experiment)}))
    setStatus('Experiment renamed. The uploaded file name is kept as provenance.')
  }
  async function saveDesign(design:ExperimentDesign) {
    applyExperiment(await apiFetch<Experiment>(`/api/projects/${selectedProjectId}/experiments/${activeExperimentId}/design`,{method:'PATCH',body:JSON.stringify(design)}));void loadProjects()
    setDesignDraft(null)
  }
  async function saveQuality(change:QualityChange) {
    applyExperiment(await apiFetch<Experiment>(`/api/projects/${selectedProjectId}/experiments/${activeExperimentId}/quality-review`,{method:'PATCH',body:JSON.stringify(change)}));void loadProjects()
  }
  async function previewQuality(run_id:string,target_assay:string,measurement_exclusions:Record<string,string>) {
    return apiFetch<ExclusionPreview>(`/api/projects/${selectedProjectId}/experiments/${activeExperimentId}/preview-well-exclusions`,{method:'POST',body:JSON.stringify({run_id,target_assay,measurement_exclusions})})
  }
  async function rebuildAnalyses() {
    const path=`/api/projects/${selectedProjectId}/experiments/${activeExperimentId}`
    const result=await apiFetch<{errors:{run_id?:string;target_assay?:string;reason:string}[];runs_rebuilt:number}>(`${path}/rebuild`,{method:'POST'})
    const value=await apiFetch<Experiment>(path)
    const history=await apiFetch<{id:string;created_at:string;result:AnalysisResult}[]>(`${path}/analyses`)
    applyExperiment(value);setHistoricalResult(null);setVersions(history);setSelectedStatistics(null);void loadProjects()
    if(!draftDirty){const saved=history.find(v=>v.result.run_id===selectedRunId)?.result;if(saved)setSampleGroups(saved.sample_groups??{})}
    setStatus(`Recalculated ${result.runs_rebuilt} run(s).`)
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
      setStatus(`Expression saved: ${completed} target assay(s) in ${selectedRun.name}.`)
      try {
        setVersions(await apiFetch(`/api/projects/${selectedProjectId}/experiments/${activeExperimentId}/analyses`))
        void loadProjects()
      } catch {
        setStatus('Expression saved. Analysis history could not refresh; reload to retry history.')
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

  function editSetup(change: () => void) {
    setSetupEdited(true)
    setAnalysisError('')
    change()
  }
  function changeRole(sample: string, technical: boolean) {
    setTechnicalSamples(current => technical ? [...current, sample] : current.filter(s => s !== sample))
    if (technical) { setBaselineSamples(current => current.filter(s => s !== sample)); setSampleGroups(current => ({...current, [sample]: ''})) }
    setAnalysisError('')
    void saveAnnotations({[sampleKey(selectedRunId,sample)]:{...sampleAnnotation(sampleInstances,selectedRunId,sample),role:technical?'technical_control':'biological'}}).catch(error=>setStatus(error instanceof Error?error.message:'Could not save role.'))
  }

  const setupIssues: string[] = backendIssue ? [backendIssue] : []
  const runLayoutBlock = layoutChecks.find(check => check.blocking && check.run_id === selectedRunId)
  if (runLayoutBlock) setupIssues.push(`Finish the plate layout first. ${runLayoutBlock.message}`)
  if (layoutDirty) setupIssues.push('Save or discard the plate layout changes.')
  if (selectedRun && !runLayoutBlock && !assayOptions.length) setupIssues.push('No gene has a named sample in this run yet. Name the samples under Plate layout.')
  if(designDraft)setupIssues.push('Save or discard experimental-design edits in Samples & design.')
  if(mappingDirty)setupIssues.push('Save or discard sample-mapping edits in Samples & design.')
  if (!selectedRun) setupIssues.push('Select an instrument run.')
  if (!analyseAll && !analysisConfig.targetAssay) setupIssues.push('Select a target gene.')
  if (analyseAll && assayOptions.every(a => analysisConfig.referenceAssays.includes(a))) setupIssues.push('Leave at least one gene outside the references.')
  if (!analysisConfig.referenceAssays.length) setupIssues.push('Choose at least one reference gene.')
  if (!baselineSamples.length) setupIssues.push('Choose at least one baseline sample.')
  if (baselineSamples.some(sample => technicalSamples.includes(sample))) setupIssues.push('Technical controls cannot be baseline samples.')
  if (baselineSamples.some(sample => Object.hasOwn(excludedSamples, sample))) setupIssues.push('A baseline sample is excluded: restore it or untick it as a baseline.')
  if (!analyseAll && analysisConfig.referenceAssays.includes(analysisConfig.targetAssay)) setupIssues.push('Target and reference genes must be different.')
  if (!Number.isFinite(hitThreshold) || hitThreshold <= 0) setupIssues.push('Enter a positive fold-change threshold.')
  if (statisticsMethod === 'welch' && (!selectedExperiment?.experiment_design?.confirmed||selectedExperiment.experiment_design.design_type!=='independent')) setupIssues.push('Confirm an independent-group design in Samples & design before using Welch tests.')
  if (statisticsMethod === 'welch' && !assumptionsConfirmed) setupIssues.push('Confirm the independent-group test assumptions or use descriptive mode.')

  const savedSetup=versions.find(v=>v.result.run_id===selectedRunId)?.result
  const sorted=(values:string[])=>JSON.stringify([...values].sort())
  const groups=(value:Record<string,string>)=>JSON.stringify(Object.entries(value).filter(([name,label])=>label.trim()&&!technicalSamples.includes(name)&&!Object.hasOwn(excludedSamples,name)).sort(([a],[b])=>a.localeCompare(b)))
  const draftDirty=Boolean(designDraft||mappingDirty||layoutDirty||setupEdited||(savedSetup&&savedSetup.context_revision===selectedExperiment?.context_revision&&(sorted(analysisConfig.referenceAssays)!==sorted(savedSetup.reference_assays)||sorted(baselineSamples)!==sorted(savedSetup.baseline_samples??[])||sorted(technicalSamples)!==sorted(savedSetup.technical_control_samples??[])||sorted(Object.keys(excludedSamples))!==sorted(savedSetup.excluded_samples??[])||hitThreshold!==(savedSetup.hit_threshold??1.5)||statisticsMethod!==(savedSetup.statistics?.method??'descriptive')||groups(sampleGroups)!==groups(savedSetup.sample_groups??{}))))
  const analysisResult = historicalResult ?? (
    selectedExperiment && selectedRun && Array.isArray(selectedExperiment.analysis_result?.samples) && selectedExperiment.analysis_result?.run_id === selectedRun.id
      ? selectedExperiment.analysis_result
      : null)
  const exportPath =
    selectedProjectId && activeExperimentId
      ? `/api/projects/${selectedProjectId}/experiments/${activeExperimentId}`
      : ''
  const loaded = Boolean(selectedExperiment && detail?.id === activeExperimentId)
  const hasResults = versions.length > 0 || Boolean(analysisResult)

  return (
    <div className={`app-shell ${uploadOpen?'upload-open':''}`}>
      <div className="workspace-rail" inert={uploadOpen}>
        <a className="workspace-brand" href="#experiments" onClick={event=>{event.preventDefault();showPage('library')}}>qPCR<span>Research workspace</span></a>
        <button className={page==='library'?'rail-link active':'rail-link'} onClick={()=>showPage('library')}>Experiments</button>
        <button className={page==='genes'?'rail-link active':'rail-link'} onClick={()=>showPage('genes')}>Gene explorer</button>
        <button className="rail-upload" onClick={openUpload}>+ Upload results</button>
      </div>
      {uploadOpen&&<div className="upload-backdrop" onClick={()=>{if(!importing)setUploadOpen(false)}}/>}
      <UploadPanel open={uploadOpen} importing={importing} dragging={fileDragOver} projects={projects} destination={uploadDestination} onDestination={setUploadDestination}
        projectName={projectName} onProjectName={setProjectName} label={uploadName} onLabel={setUploadName}
        files={uploadFiles} onFiles={addUploadFiles} onRemove={key=>setUploadFiles(current=>current.filter(file=>fileKey(file)!==key))}
        mode={uploadMode} onMode={setUploadMode} failures={uploadFailures}
        fileInput={fileInput} status={status} onClose={()=>setUploadOpen(false)} onImport={()=>void addExperiment()}/>
      {fileDragOver&&!uploadOpen&&<div className="file-drop-overlay" aria-hidden="true"><p><strong>Drop to upload results</strong><span>Several files at once are fine: you choose next whether they are separate experiments or plates of one.</span></p></div>}

      <main className="main-panel" inert={uploadOpen}>
        {page!=='experiment'&&backendIssue&&<p className="analysis-error" role="alert">{backendIssue}</p>}
        {/* Always mounted, so screen readers announce the notice when it appears. */}
        <div className="library-notice" role="status" aria-live="polite">{page==='library'&&libraryNotice&&<div className="status-bar"><span>{libraryNotice}</span><button className="icon-button" aria-label="Dismiss update" onClick={()=>setLibraryNotice('')}>×</button></div>}</div>
        {page==='library'&&<ExperimentLibrary projects={projects} loading={libraryLoading} error={libraryError} onRetry={()=>{void loadProjects();void checkBackend()}} onUpload={openUpload} onOpen={(project,experiment)=>{setStatus('');if(experiment!==activeExperimentId)setVersions([]);setSelectedProjectId(project);setSelectedExperimentId(experiment);setHistoricalResult(null);setPage('experiment');setActiveTab('dashboard')}}/>}
        {page==='genes'&&<GeneExplorer projects={projects} loading={libraryLoading} onOpen={(project,experiment)=>{setStatus('');if(experiment!==activeExperimentId)setVersions([]);setSelectedProjectId(project);setSelectedExperimentId(experiment);setHistoricalResult(null);setPage('experiment');setActiveTab('dashboard')}}/>}
        <div className="experiment-workspace" hidden={page!=='experiment'}>
        <button className="back-library" onClick={()=>showPage('library')}>← All experiments</button>
        <header className="topbar">
          <div>
            <p className="eyebrow">{selectedProject?.name ?? 'qPCR results'}</p>
            {selectedExperiment?<ExperimentTitle key={`title:${selectedExperiment.id}`} name={withoutExtension(selectedExperiment.name)} onRename={renameExperiment}/>:<h2>Import your qPCR results</h2>}
            {selectedExperiment&&<ExperimentSummary experiment={selectedExperiment}/>}
            <p className="helper-text">
              {selectedExperiment?.parsed_summary?.record_count ?? 0} measurements · {selectedExperiment&&experimentFiles(selectedExperiment).length>1?'files':'file'} <span title={selectedExperiment?experimentFiles(selectedExperiment).join('\n'):undefined}>{selectedExperiment?experimentFiles(selectedExperiment).join(', '):''}</span>
            </p>
            {selectedExperiment&&loaded&&<AddPlatesPanel key={`plates:${selectedExperiment.id}`} runs={runs} onAdd={addPlates}/>}
          </div>
          {selectedExperiment&&<button className={inSetup?'setup-toggle':'setup-toggle quiet-button'} aria-pressed={inSetup} onClick={()=>setActiveTab(layoutNeeded?'layout':hasResults&&!stability?'setup':'samples')}>Set up analysis</button>}
        </header>
        {status&&<div className="status-bar" role="status" aria-live="polite"><span>{status}</span><button className="icon-button" aria-label="Dismiss update" onClick={()=>setStatus('')}>×</button></div>}
        {backendIssue && <p className="analysis-error" role="alert">{backendIssue}</p>}
        {selectedExperiment&&!loaded&&<p role="status">Loading experiment…</p>}
        <nav className="view-tabs" aria-label="Result views">
          {RESULT_TABS.map(([tab,label]) => <button key={tab} aria-pressed={activeTab === tab} onClick={() => setActiveTab(tab)}>{label}</button>)}
        </nav>
        {loaded&&!inSetup&&<ExperimentTypeQuestion state={analysisType} busy={typeBusy} onAnswer={answerType}/>}
        {loaded&&!inSetup&&<NumberSamplesStep suggestions={layoutSuggestions} problem={selectedExperiment?.numbering_problem??null} busy={numberingBusy} onNumber={()=>void changeNumbering(false)} onLayout={()=>setActiveTab('layout')}/>}
        {loaded&&!inSetup&&<NumberedSamplesNotice layouts={selectedExperiment?.auto_layouts??[]} busy={numberingBusy} onRename={()=>setActiveTab('layout')} onUndo={()=>void changeNumbering(true)} onAnswer={answerLate}/>}
        {loaded&&!inSetup&&layoutNeeded&&!layoutSuggestions.length&&<section className="next-step"><div><p className="eyebrow">Next step</p><h3>Name the samples on the plate</h3><p>The instrument export does not say which sample is in which well: {layoutChecks.find(check=>check.blocking)?.message??layoutChecks[0]?.message} Fill the wells from a list, paste your plate layout from Excel, or name selected wells.</p></div><button onClick={()=>setActiveTab('layout')}>Set up plate layout</button></section>}
        {loaded&&!inSetup&&!hasResults&&!layoutNeeded&&!stability&&!typeQuestion&&<section className="next-step"><div><p className="eyebrow">Next step</p><h3>Set up normalized expression</h3><p>Raw Ct values are ready below. Two short steps turn them into fold changes: check each sample’s condition and time point, then choose reference genes and baseline samples.</p></div><button onClick={()=>setActiveTab('samples')}>Start setup</button></section>}
        {selectedExperiment && loaded && <div hidden={activeTab !== 'dashboard'&&activeTab !== 'genes'}>
          <Dashboard allGenes={activeTab==='genes'} key={selectedExperiment.id} experiment={selectedExperiment} versions={versions} currentResult={analysisResult}
            referenceAssays={analysisConfig.referenceAssays} annotations={sampleInstances} onQuality={saveQuality} onPreview={previewQuality} onRebuild={rebuildAnalyses} draftDirty={draftDirty}
            onSetup={() => setActiveTab(stability?'samples':'setup')} onSamples={()=>setActiveTab('samples')} onLayout={()=>setActiveTab('layout')} onStabilityGenes={genes=>saveAnalysisType('reference_stability',genes)} snapshot={historicalResult} onClearSnapshot={()=>setHistoricalResult(null)} onStatistics={result=>{setSelectedStatistics(result);setActiveTab('statistics')}} />
        </div>}
        {selectedExperiment&&loaded&&activeTab==='plate'&&<PlateCheck key={selectedExperiment.id} experiment={selectedExperiment} annotations={sampleInstances} initialRun={selectedRunId} onLayout={()=>setActiveTab('layout')} onSamples={()=>setActiveTab('samples')}/>}
        {activeTab === 'statistics' && <StatisticsView analyses={[...(analysisResult?[analysisResult]:[]),...versions.map(v=>v.result)]} runs={runs} selected={selectedStatistics??analysisResult} onSelect={setSelectedStatistics} currentRevision={selectedExperiment?.context_revision??0}/>}
        {activeTab === 'history' && <HistoryPanel versions={versions} runs={runs} exportPath={`${API_ROOT}${exportPath}`}
          latestCsv={analysisResult&&!historicalResult?{href:`${API_ROOT}${exportPath}/export.csv`,label:`Latest result CSV · ${analysisResult.target_assay}`}:undefined}
          onOpen={entry=>{selectRun(entry.result.run_id);setHistoricalResult(entry.result);setActiveTab('dashboard')}}/>}
        {selectedExperiment && loaded && inSetup && <section className="setup-flow" aria-label="Set up analysis">
          <ExperimentTypeChoice state={analysisType} busy={typeBusy} onChange={answerType}/>
          <ol className="stepper">{setupSteps.map(([step,label],index)=><li key={step}><button aria-label={label} aria-current={activeTab===step?'step':undefined} onClick={()=>setActiveTab(step)}><span aria-hidden="true">{index+1}</span>{label}</button></li>)}</ol>
          <div hidden={activeTab!=='layout'} className="setup-step">
            <PlateLayoutPanel key={selectedExperiment.id} experiment={selectedExperiment} annotations={sampleInstances} initialRun={selectedRunId} onSave={saveLayout} onDirty={setLayoutDirty}/>
            <div className="setup-nav"><button disabled={layoutDirty} title={layoutDirty?'Save or discard the plate layout changes first.':undefined} onClick={()=>setActiveTab('samples')}>Next: samples &amp; design →</button></div>
          </div>
          <div hidden={activeTab!=='samples'} className="samples-workspace setup-step">
            <p className="setup-intro">Check that each sample has the right condition, time point and role. Suggestions come from sample names; your protocol decides.</p>
            <DesignPanel value={selectedExperiment.experiment_design} onSave={saveDesign} draft={designDraft} onDraftChange={setDesignDraft}/>
            <SampleMappingPanel key={selectedExperiment.id} experiment={selectedExperiment} annotations={sampleInstances} onSave={saveAnnotations} onDirty={setMappingDirty}/>
            <div className="setup-nav">{stability?<button onClick={()=>setActiveTab('dashboard')}>Show stability results →</button>:<button onClick={()=>setActiveTab('setup')}>Next: normalization →</button>}</div>
          </div>
          {activeTab==='setup'&&!stability&&<NormalizationStep experiment={selectedExperiment} runs={runs} selectedRunId={selectedRunId} onSelectRun={selectRun}
            assayOptions={assayOptions} sampleOptions={sampleOptions} analyseAll={analyseAll} onAnalyseAll={setAnalyseAll} config={analysisConfig}
            onTarget={target=>editSetup(()=>setAnalysisConfig(current=>({...current,targetAssay:target,referenceAssays:current.referenceAssays.filter(a=>a!==target)})))}
            onReference={(assay,checked)=>editSetup(()=>setAnalysisConfig(current=>({...current,referenceAssays:checked?[...current.referenceAssays,assay]:current.referenceAssays.filter(a=>a!==assay)})))}
            baselineSamples={baselineSamples} onBaseline={(sample,checked)=>editSetup(()=>setBaselineSamples(current=>checked?[...current,sample]:current.filter(s=>s!==sample)))}
            technicalSamples={technicalSamples} onRole={changeRole} sampleGroups={sampleGroups} excludedSamples={excludedSamples}
            onExclusion={(sample,reason)=>editSetup(()=>setExcludedSamples(current=>{const {[sample]:_previous,...rest}=current;return reason.trim()?{...rest,[sample]:reason}:rest}))}
            hitThreshold={hitThreshold} onThreshold={value=>editSetup(()=>setHitThreshold(value))} statisticsMethod={statisticsMethod} onMethod={method=>editSetup(()=>{setStatisticsMethod(method);setAssumptionsConfirmed(false)})}
            assumptionsConfirmed={assumptionsConfirmed} onAssumptions={value=>editSetup(()=>setAssumptionsConfirmed(value))}
            issues={setupIssues} analysisError={analysisError} busy={busy} onCalculate={()=>void runAnalysis()} draftDirty={draftDirty}
            onRestore={()=>configureRun(selectedExperiment,selectedRunId,versions,true)} onExplainStatistics={()=>setActiveTab('statistics')}/>}
        </section>}
        </div>
      </main>
    </div>
  )
}

export default App

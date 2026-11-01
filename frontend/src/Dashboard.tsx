import {useState,type ReactNode} from 'react'
import type {AnalysisResult,Experiment,QualityChange,RawRecord,SampleMetadata,ExclusionPreview} from './types'
import {usePresentation} from './usePresentation'
import {orderedAssays,reorderAssays,applyPlotOptions,plotKey,seriesColor,effectivePlotOptions,setSharedY as shareY,type Presentation} from './presentation'
import {FigureAppearance} from './FigureAppearance'
import {resultEvidence} from './resultEvidence'
import {EvidenceSummary} from './EvidenceSummary'
import {DistributionDiagnostics} from './DistributionDiagnostics'
import {PublicationFigure} from './PublicationFigure'
import {QualityPanel} from './QualityPanel'
import {OverviewHeatmap,type Availability} from './OverviewHeatmap'
import {automaticYRange,colorGroups,type ColorBy,type ColorGroup,type PlotOptions} from './plotOptions'
import {StatisticsResults} from './StatisticsPanel'
import {coherentAnalyses,observation,categoryLabel,seriesLabel,sampleKey,sampleAnnotation,sampleFactors,type Observation} from './plotData'
import {StatusBanner,type StatusAction} from './StatusBanner'
import {dashboardStatus,type StatusItem} from './status'
import {groupQualityFlags} from './qcGroups'
import {FigureReadout,type ReadoutFact} from './FigureReadout'
import {FigureGridHeader} from './FigureGridHeader'
import {FIGURE_THEMES,figureTheme} from './figureTheme'
import {baselineNotes,detectionSummary,effectiveBaselines} from './resultNotes'
import {sharedPrefix,withoutPrefix} from './sampleNames'

type Props={allGenes?:boolean;experiment:Experiment;versions:{id:string;created_at:string;result:AnalysisResult}[];currentResult:AnalysisResult|null;referenceAssays:string[];annotations:Record<string,SampleMetadata>;
 onPreview:(run:string,assay:string,exclusions:Record<string,string>)=>Promise<ExclusionPreview>;onQuality:(change:QualityChange)=>Promise<void>;
 onRebuild:()=>Promise<{errors:{run_id?:string;target_assay?:string;reason:string}[];runs_rebuilt:number}>;draftDirty:boolean;onSetup:()=>void;onSamples:()=>void;snapshot?:AnalysisResult|null;onClearSnapshot:()=>void;onStatistics:(result:AnalysisResult)=>void}
const profile=(r:AnalysisResult)=>r.profile_id??JSON.stringify([r.reference_assays,r.baseline_samples??r.baseline_sample,r.sample_groups,r.excluded_samples,r.excluded_measurements])
export function Dashboard({allGenes=false,experiment,versions,currentResult,referenceAssays,annotations,onQuality,onPreview,onRebuild,draftDirty,onSetup,onSamples,snapshot,onClearSnapshot,onStatistics}:Props) {
 const {presentation,setPresentation,storageNotice,canUndoPresentation,undoPresentation}=usePresentation(experiment.id)
 const [previousOrder,setPreviousOrder]=useState<string[]|null>(null),[dragging,setDragging]=useState<string|null>(null),[dropTarget,setDropTarget]=useState<string|null>(null),[layoutStatus,setLayoutStatus]=useState(''),[geneSearch,setGeneSearch]=useState(''),[pinnedOnly,setPinnedOnly]=useState(false)
 const [runFilter,setRunFilter]=useState('all'),[seriesFilter,setSeriesFilter]=useState('all'),[timeFilter,setTimeFilter]=useState('all'),[chosenAssays,setChosenAssays]=useState<string[]|null>(null)
 const [confluencies,setConfluencies]=useState<string[]|null>(null),[cellLines,setCellLines]=useState<string[]|null>(null)
 const [geneKind,setGeneKind]=useState<'expression'|'ct'|null>(null),[geneColumns,setGeneColumns]=useState('3')
 const [filtersExpanded,setFiltersExpanded]=useState(false),[appearanceOpen,setAppearanceOpen]=useState(false)
 const [overviewKind,setOverviewKind]=useState<'raw'|'expression'|null>(null)
 const [cellContext,setCellContext]=useState('')
 const [conditionFocus,setConditionFocus]=useState<string|null>(null)
 const [focus,setFocus]=useState(currentResult?.target_assay??''),[tab,setTab]=useState(currentResult?'expression':'target'),[mode,setMode]=useState<'overview'|'report'>('overview')
 const [view,setView]=useState<'time'|'bars'>('time'),[showThreshold,setShowThreshold]=useState(false),[showExcluded,setShowExcluded]=useState(true)
 const [preset,setPreset]=useState<'single'|'double'>('double'),[reportKinds,setReportKinds]=useState(['expression']),[rebuilding,setRebuilding]=useState(false),[rebuildStatus,setRebuildStatus]=useState(''),[rebuildErrors,setRebuildErrors]=useState<{run_id?:string;target_assay?:string;reason:string}[]>([])
 const records=experiment.raw_records??[],runs=experiment.parsed_summary?.runs??[],revision=experiment.context_revision??0
 const assays=orderedAssays([...new Set(records.map(r=>r.assay))].sort(),presentation.order),selectedAssays=(chosenAssays??assays).filter(a=>assays.includes(a))
 const allResults=[...(currentResult?[currentResult]:[]),...versions.map(v=>v.result)].filter(r=>Array.isArray(r.samples)).sort((a,b)=>(b.created_at??'').localeCompare(a.created_at??''))
 const candidates=snapshot?[snapshot]:coherentAnalyses(allResults)
 const runSettings=new Map<string,AnalysisResult>();for(const r of candidates)if(!runSettings.has(r.run_id))runSettings.set(r.run_id,r)
 const metadata=(r:Pick<RawRecord,'run_id'|'sample'>)=>sampleAnnotation(annotations,r.run_id,r.sample)
 const isTechnical=(r:RawRecord)=>metadata(r).role==='technical_control'
 const selectedRuns=runs.filter(r=>runFilter==='all'||r.id===runFilter)
 const inRun=(r:RawRecord)=>runFilter==='all'||r.run_id===runFilter
 const biological=records.filter(r=>!isTechnical(r)),runBiological=biological.filter(inRun)
 const factorValue=(m:SampleMetadata,key:'cell_line'|'confluency')=>sampleFactors(m)[key].trim()||'Not annotated'
 const confluencyOptions=[...new Set(biological.map(r=>factorValue(metadata(r),'confluency')))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}))
 const cellLineOptions=[...new Set(biological.map(r=>factorValue(metadata(r),'cell_line')))].sort()
 const factorMatches=(m:SampleMetadata)=>(confluencies===null||confluencies.includes(factorValue(m,'confluency')))&&(cellLines===null||cellLines.includes(factorValue(m,'cell_line')))
 const allSeries=[...new Set(biological.map(r=>metadata(r).series))].sort(),availableSeries=new Set(runBiological.map(r=>metadata(r).series))
 const effectiveSeries=seriesFilter==='all'||availableSeries.has(seriesFilter)?seriesFilter:'all'
 const seriesRecords=runBiological.filter(r=>(effectiveSeries==='all'||metadata(r).series===effectiveSeries)&&factorMatches(metadata(r)))
 const times=[...new Map(seriesRecords.filter(r=>metadata(r).timepoint!=null).map(r=>{const m=metadata(r);return [`${m.time_unit}:${m.timepoint}`,m] as const})).entries()].sort((a,b)=>a[1].time_unit.localeCompare(b[1].time_unit)||a[1].timepoint!-b[1].timepoint!)
 const effectiveTime=times.some(([key])=>key===timeFilter)?timeFilter:'all'
 const matches=(run:string,m:SampleMetadata)=>(runFilter==='all'||run===runFilter)&&(effectiveSeries==='all'||m.series===effectiveSeries)&&(effectiveTime==='all'||`${m.time_unit}:${m.timepoint}`===effectiveTime)&&(conditionFocus==null||m.condition===conditionFocus)&&factorMatches(m)
 const scope=seriesRecords.filter(r=>matches(r.run_id,metadata(r))),visible=scope.filter(r=>selectedAssays.includes(r.assay))
 const savedRefs=[...new Set(selectedRuns.flatMap(r=>runSettings.get(r.id)?.reference_assays??referenceAssays))]
 const referencesFor=(run:string)=>runSettings.get(run)?.reference_assays??referenceAssays
 const onlyReference=(assay:string)=>selectedRuns.length>0&&selectedRuns.every(r=>referencesFor(r.id).includes(assay))
 const targets=selectedAssays.filter(a=>!onlyReference(a)),housekeeping=savedRefs.filter(a=>assays.includes(a))
 const mixedRoles=selectedAssays.filter(a=>savedRefs.includes(a)&&!onlyReference(a))
 const effectiveAssay=selectedAssays.includes(focus)?focus:selectedAssays.find(a=>!onlyReference(a))??selectedAssays[0]??''
 const displayLabel=(label:string)=>runs.reduce((value,run,index)=>/^[a-f0-9]{8}-[a-f0-9-]{27}$/i.test(run.name)?value.replaceAll(run.name,`Run ${index+1}`):value,label)
 const colorDomain=[...new Set(biological.map(r=>observation(r.sample,r.run_id,r.run_name,metadata(r),[],'').seriesLabel))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}))
 // An unconfirmed origin is disclosed in figure notes, not in the axis title of exported figures.
 const timeAxisLabel=experiment.experiment_design?.time_origin?.trim()?`Time from ${experiment.experiment_design.time_origin}`:'Time'
 const stale=(r:AnalysisResult)=>r.context_revision!==revision
 const staleCount=candidates.filter(stale).length
 const failures=new Map<string,string>()
 for(const r of allResults){if(runSettings.get(r.run_id)&&profile(runSettings.get(r.run_id)!)!==profile(r))continue;for(const error of r.batch_errors??[])if(!failures.has(`${r.run_id}:${error.target_assay}`))failures.set(`${r.run_id}:${error.target_assay}`,error.reason)}
 const availability:Availability[]=selectedRuns.flatMap(run=>targets.map(assay=>{const result=candidates.find(r=>r.run_id===run.id&&r.target_assay===assay);return {run:run.id,assay,result,reference:referencesFor(run.id).includes(assay),reason:referencesFor(run.id).includes(assay)?'Reference assay in this run.':result?'':failures.get(`${run.id}:${assay}`)??'Not calculated with the selected analysis settings. Configure or rebuild this run.',stale:!!result&&stale(result)}}))
 const qcFlags=(experiment.quality?.flags??[]).filter(f=>runFilter==='all'||f.run_id===runFilter),unresolved=qcFlags.filter(f=>f.status==='needs_review').length
 const provisional=!experiment.experiment_design?.confirmed||unresolved>0
 const runName=(id:string)=>runs.find(r=>r.id===id)?.name??id
 const shortRun=(id:string)=>runName(id).match(/_(\d+)$/)?.[1]?`Run ${runName(id).match(/_(\d+)$/)![1]}`:runName(id)
 const activeAnalyses=candidates.filter(r=>(runFilter==='all'||r.run_id===runFilter)&&r.target_assay===effectiveAssay)
 const refForFocus=[...new Set(activeAnalyses.flatMap(r=>r.reference_assays))];if(!refForFocus.length)refForFocus.push(...housekeeping)
 const filterContext={cell_lines:cellLines??'all',confluencies:confluencies??'all',run:runFilter,series:effectiveSeries,time:effectiveTime,assays:selectedAssays}
 const seriesRuns=new Map<string,Set<string>>();for(const r of biological){const s=metadata(r).series;if(!seriesRuns.has(s))seriesRuns.set(s,new Set());seriesRuns.get(s)!.add(r.run_id)}
 const confounded=seriesRuns.size>1&&[...seriesRuns.values()].every(set=>set.size===1)&&new Set([...seriesRuns.values()].flatMap(set=>[...set])).size>1
 function inspect(assay:string,next='expression'){if(next==='quality'&&!selectedAssays.length)setChosenAssays(null);setFocus(assay||assays[0]);setTab(onlyReference(assay)&&next==='expression'?'reference':next);setMode('overview');requestAnimationFrame(()=>document.getElementById('assay-inspector')?.scrollIntoView({behavior:'smooth',block:'start'}))}
 async function rebuild(){setRebuilding(true);try{const result=await onRebuild();setRebuildErrors(result.errors);setRebuildStatus(`Rebuilt ${result.runs_rebuilt} run(s). ${result.errors.length} unavailable assay/run outcome(s).`)}catch(e){setRebuildStatus(e instanceof Error?e.message:'Could not rebuild.')}finally{setRebuilding(false)}}
 function rawPoints(assay:string,technical=false){
  // QC never inherits a biological time or condition filter.
  const data=(technical?records.filter(r=>inRun(r)&&isTechnical(r)):scope).filter(r=>r.assay===assay)
  const groups=new Map<string,RawRecord[]>();for(const row of data){const key=sampleKey(row.run_id,row.sample);groups.set(key,[...(groups.get(key)??[]),row])}
  const points:Observation[]=[...groups.values()].map(rows=>{
   const first=rows[0],sampleExcluded=runSettings.get(first.run_id)?.excluded_samples?.includes(first.sample)??false
   const included=(r:RawRecord)=>!r.omit&&!experiment.measurement_exclusions?.[r.measurement_id!]&&!sampleExcluded&&r.ct!=null&&Number.isFinite(r.ct)&&r.status==='detected'
   const point=observation(first.sample,first.run_id,first.run_name,metadata(first),rows.filter(included).map(r=>r.ct!),`${first.run_name}; ${first.sheet}; wells ${rows.map(r=>r.well).join(', ')}`)
   if(showExcluded){const removed=rows.filter(r=>r.ct!=null&&(r.omit||experiment.measurement_exclusions?.[r.measurement_id!]||sampleExcluded));point.omitted=removed.map(r=>r.ct!);point.omittedDetails=removed.map(r=>({well:r.well,reason:r.omit?'Instrument omitted':experiment.measurement_exclusions?.[r.measurement_id!]??'Sample excluded in saved analysis'}))}
   point.data=rows.map(r=>({run:r.run_name,sample_instance_id:sampleKey(r.run_id,r.sample),sample:r.sample,well:r.well,assay:r.assay,ct:r.ct,status:r.status,instrument_omitted:r.omit,exclusion_reason:experiment.measurement_exclusions?.[r.measurement_id!]??(sampleExcluded?'Sample excluded in saved analysis':''),used_in_mean:included(r),plotted:included(r)||(showExcluded&&r.ct!=null&&(r.omit||!!experiment.measurement_exclusions?.[r.measurement_id!]||sampleExcluded)),cell_line:sampleFactors(metadata(r)).cell_line,confluency:sampleFactors(metadata(r)).confluency,condition:metadata(r).condition,series:metadata(r).series,time:metadata(r).timepoint,time_unit:metadata(r).time_unit,biological_replicate:metadata(r).replicate,biological_unit_id:metadata(r).biological_unit_id??'',source_sheet:r.sheet,source_row:r.row_number,measurement_id:r.measurement_id}))
   return point
  })
  return {points,data}
 }
 function saveOptions(kind:'ct'|'expression',assay:string,technical:boolean,options:PlotOptions,scope:'plot'|'axes'|'style'){
  setPresentation(current=>applyPlotOptions(current,plotKey(kind,assay,technical),kind,options,scope))
  setLayoutStatus(scope==='plot'?`${assay} figure settings saved.`:scope==='axes'?`Dashboard ${kind==='ct'?'Ct':'expression'} axes updated; individual axis overrides cleared.`:'Dashboard style updated; individual style overrides cleared.')
 }
 function inheritOptions(kind:'ct'|'expression',assay:string,technical=false){setPresentation(current=>{const overrides={...current.plotOverrides};delete overrides[plotKey(kind,assay,technical)];return {...current,plotOverrides:overrides}})}
 const panelMode=allGenes||mode==='report'
 function rawFigure(assay:string,technical=false,toolbar?:ReactNode){
  const {points,data}=rawPoints(assay,technical)
  const sourceIds=new Set(data.map(r=>r.measurement_id))
  const scopedExclusions=Object.fromEntries(Object.entries(experiment.measurement_exclusions??{}).filter(([id])=>sourceIds.has(id)))
  const scopedQuality={unresolved_in_experiment:experiment.quality?.unresolved_count,spread_threshold:experiment.quality?.spread_threshold,
    flags:(experiment.quality?.flags??[]).filter(f=>f.assay===assay&&data.some(r=>r.run_id===f.run_id&&r.sample===f.sample)).map(f=>({id:f.id,run_id:f.run_id,sample:f.sample,assay:f.assay,message:f.message,status:f.status,review:f.review}))}
  return <PublicationFigure key={`${technical?'qc':'ct'}:${assay}`} title={assay} subtitle={technical?'Technical control · raw Ct · QC only':savedRefs.includes(assay)?'Reference assay · raw Ct':'Target assay · raw Ct'} observations={points} kind="ct" technical={technical} colorDomain={colorDomain} labelFor={displayLabel} timeAxisLabel={timeAxisLabel} preset={allGenes?'single':preset} compactDisplay={panelMode} panelNotes={mode==='report'?'always':'print'} toolbar={toolbar} presentation={presentation} sharedRange={sharedRanges.ct} colorDomains={colorDomains} onOptionsChange={(options,scope)=>saveOptions('ct',assay,technical,options,scope)} onInherit={()=>inheritOptions('ct',assay,technical)} reviewNote={provisional?'Provisional · QC / experimental design requires review':'QC concerns reviewed; see recorded notes'} methods={{filters:technical?{run:runFilter,assay,qc:'Biological filters not applied'}:filterContext,design:experiment.experiment_design,context_revision:revision,exclusions:scopedExclusions,qc:scopedQuality}}
   missing={data.filter(r=>r.ct==null||r.status!=='detected').length} omitted={data.filter(r=>r.omit||experiment.measurement_exclusions?.[r.measurement_id!]).length}/>
 }
 function normalizedPoints(assay:string){
  const analyses=candidates.filter(r=>r.target_assay===assay&&(runFilter==='all'||r.run_id===runFilter)),entries=availability.filter(a=>a.assay===assay)
  const points=analyses.flatMap(result=>result.samples.flatMap(row=>{const m=sampleAnnotation(result.sample_instances??result.sample_metadata,result.run_id,row.sample);if(row.fold_change==null||!result.sample_groups?.[row.sample]||!matches(result.run_id,{...m,cell_line:sampleFactors(sampleAnnotation(annotations,result.run_id,row.sample)).cell_line,confluency:sampleFactors(sampleAnnotation(annotations,result.run_id,row.sample)).confluency}))return[]
   const point=observation(row.sample,result.run_id,runName(result.run_id),m,[row.fold_change],`analysis ${result.analysis_id??'legacy'}; baseline ${result.baseline_sample}; references ${result.reference_assays.join(', ')}`)
   point.data=[{run:runName(result.run_id),sample_instance_id:sampleKey(result.run_id,row.sample),sample:row.sample,assay,...sampleFactors(sampleAnnotation(annotations,result.run_id,row.sample)),condition:m.condition,series:m.series,time:m.timepoint,time_unit:m.time_unit,biological_unit_id:m.biological_unit_id??'',target_ct_values:row.target_ct_values,target_wells_detected:row.target_wells?.detected,target_wells_total:row.target_wells?.total,reference_ct_values:row.reference_ct_values,target_ct_mean:row.target_ct_mean,reference_ct_mean:row.reference_ct_mean,delta_ct:row.delta_ct,delta_delta_ct:row.delta_delta_ct,fold_change:row.fold_change,statistics_method:result.statistics?.method,holm_adjusted_p:result.statistics?.comparisons.find(c=>c.condition===result.sample_groups?.[row.sample])?.adjusted_p_value,comparison_status:result.statistics?.comparisons.find(c=>c.condition===result.sample_groups?.[row.sample])?.status,comparison_family:result.statistics?.family,baseline_samples:effectiveBaselines(result),baseline_note:result.baseline_note??'',references:result.reference_assays,analysis_id:result.analysis_id,analysis_revision:result.context_revision,current_revision:revision,stale:stale(result)}];return[point]}))
  return {analyses,entries,points}
 }
 const baselineLabels=(analyses:AnalysisResult[])=>[...new Set(analyses.flatMap(r=>effectiveBaselines(r).map(name=>categoryLabel(sampleAnnotation(r.sample_instances??r.sample_metadata,r.run_id,name)))))]
 const samplePrefix=sharedPrefix(biological.map(r=>r.sample))
 function normalizedFigure(assay:string,toolbar?:ReactNode){
  const {analyses,entries,points}=normalizedPoints(assay)
  const evidence=analyses.flatMap(result=>resultEvidence(result,points,revision))
  const refs=[...new Set(analyses.map(r=>r.reference_assays.join(' + ')))],baselines=baselineLabels(analyses)
  const missing=entries.filter(e=>!e.result&&!e.reference)
  const note=analyses.some(stale)?'STALE saved analysis · rebuild required':provisional?'Provisional · QC / design requires review':'Saved analysis · QC notes available'
  const threshold=[...new Set(analyses.map(r=>r.hit_threshold??1.5))]
  // Only exceptions are badged: unavailable runs, reference roles, and out-of-date runs when others are current.
 const mixedStale=entries.some(e=>e.result&&e.stale)&&entries.some(e=>e.result&&!e.stale)
 const badges=entries.filter(e=>e.reference||!e.result||(mixedStale&&e.stale))
 const coverage=badges.length?<div className="coverage-badges" aria-label={`${assay} run coverage`}>{badges.map(e=><span key={e.run} className={e.reference?'reference-badge':!e.result?'unavailable-badge':'stale-badge'} title={e.reason}>{shortRun(e.run)}: {e.reference?'reference assay':!e.result?'unavailable':'out of date'}</span>)}</div>:undefined
 return <div className="normalized-wrapper" key={assay}>
   <PublicationFigure title={assay} status={coverage} toolbar={toolbar} baselineLabel={baselines.length===1?baselines[0]:undefined} subtitle={analyses.length?`References: ${refs.join(' / ')} · baseline: ${baselines.join(' / ')}`:'Normalized expression not available'} observations={points} kind="expression" bars={view==='bars'} threshold={showThreshold&&threshold.length===1?threshold[0]:undefined} colorDomain={colorDomain} labelFor={displayLabel} timeAxisLabel={analyses[0]?.experiment_design?.time_origin?`Time from ${analyses[0].experiment_design.time_origin}`:'Time'} preset={allGenes?'single':preset} compactDisplay={panelMode} panelNotes={mode==='report'?'always':'print'} presentation={presentation} evidence={evidence} sharedRange={sharedRanges.expression} sharedLogRange={sharedRanges.expressionLog} colorDomains={colorDomains} onOptionsChange={(options,scope)=>saveOptions('expression',assay,false,options,scope)} onInherit={()=>inheritOptions('expression',assay)} reviewNote={note} methods={{filters:filterContext,current_quality:{unresolved_count:experiment.quality?.unresolved_count,reviewed_count:experiment.quality?.reviewed_count,spread_threshold:experiment.quality?.spread_threshold},analyses:analyses.map(r=>({id:r.analysis_id,settings:r.analysis_settings,revision:r.context_revision,stale:stale(r),statistics:r.statistics,design:r.experiment_design,qc:r.qc_summary,baseline_used:effectiveBaselines(r),baseline_note:r.baseline_note,detection_notes:r.detection_notes})),coverage:entries.map(e=>({run:e.run,state:e.result?e.stale?'stale':'available':'unavailable',reason:e.reason}))}} emptyMessage={missing.map(e=>`${shortRun(e.run)}: ${e.reason}`).join(' ')||'No complete biological samples match these filters.'}
    footer={allGenes?undefined:<>{baselineNotes(analyses).map(note=><p key={note} className="figure-coverage-note">{note}</p>)}{evidence.some(entry=>entry.p!=null)&&<EvidenceSummary evidence={evidence}/>}{showThreshold&&threshold.length>1&&<p className="figure-coverage-note">Saved effect thresholds differ between runs. Select one run to show its threshold line.</p>}{analyses.length>0&&<div className="figure-analysis-links"><button className="quiet-button" onClick={()=>{if(mode==='overview'){setTab('statistics')}else onStatistics(analyses[0])}}>Statistics &amp; assumptions</button></div>}{!panelMode&&missing.length>0&&points.length>0&&<p className="figure-coverage-note">{missing.map(e=>`${shortRun(e.run)} unavailable: ${e.reason}`).join(' ')}</p>}</>}/>
  </div>
 }
 const expressionPoints=targets.flatMap(assay=>normalizedPoints(assay).points)
 // A shown threshold line belongs inside the shared expression range, like it does in automatic ranges.
 const shownThresholds=showThreshold?[...new Set(candidates.map(r=>r.hit_threshold??1.5))]:[]
 const sharedRanges={ct:automaticYRange(selectedAssays.flatMap(assay=>[...rawPoints(assay).points,...rawPoints(assay,true).points]),'ct'),expression:automaticYRange(expressionPoints,'expression','linear',shownThresholds),expressionLog:automaticYRange(expressionPoints,'expression','log2',shownThresholds)}
 const colorSources=biological.map(record=>{const m=metadata(record),point=observation(record.sample,record.run_id,record.run_name,m,[],'');point.data=[{...sampleFactors(m),series:m.series,run:record.run_name}];return point})
 const colorDomains=Object.fromEntries((['series','condition','confluency','cell_line','run','sample'] as ColorBy[]).map(by=>[by,colorGroups(colorSources,by)])) as Record<ColorBy,ColorGroup[]>
 const geneView=geneKind??(candidates.length?'expression':'ct')
 const hasResult=(assay:string)=>availability.some(a=>a.assay===assay&&a.result)
 const searchedAssays=(geneView==='expression'?targets:selectedAssays).filter(assay=>assay.toLowerCase().includes(geneSearch.toLowerCase())&&(!pinnedOnly||presentation.favorites.includes(assay)))
 const panelAssays=geneView==='expression'?searchedAssays.filter(hasResult):searchedAssays
 const missingAssays=geneView==='expression'?searchedAssays.filter(assay=>!hasResult(assay)):[]
 const rawOverview=(overviewKind??(candidates.length?'expression':'raw'))==='raw'
 // Matches the figures: a dashboard-wide custom series color wins over the palette.
 const seriesColorOf=(label:string,kind:'ct'|'expression'='expression')=>presentation.plotDefaults[kind].style.groups[label]?.outline??seriesColor(label,Math.max(0,colorDomain.indexOf(label)),presentation)
 const gridSeries=[...new Set(scope.map(r=>observation(r.sample,r.run_id,r.run_name,metadata(r),[],'').seriesLabel))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}))
 const gridBaselines=baselineLabels(candidates.filter(r=>runFilter==='all'||r.run_id===runFilter))
 function gridHeader(kind:'ct'|'expression',children?:ReactNode){
  return <FigureGridHeader series={gridSeries} colorOf={label=>presentation.plotDefaults[kind].style.colorBy==='series'?seriesColorOf(label,kind):null} labelFor={displayLabel} kind={kind} scale={kind==='expression'?presentation.plotDefaults.expression.axes.yScale:'linear'} bars={kind==='expression'&&view==='bars'} significance={kind==='expression'&&presentation.showSignificance} baselineLabel={gridBaselines.length===1?gridBaselines[0]:undefined} timeUnit={times.length&&new Set(times.map(([,m])=>m.time_unit)).size===1?times[0][1].time_unit:undefined}>{children}</FigureGridHeader>
 }
 const missingNote=(assays:string[])=>assays.length>0&&<div className="unavailable-genes"><p>No expression result</p><ul>{assays.map(assay=><li key={assay}><strong>{assay}</strong> {availability.filter(a=>a.assay===assay&&!a.result&&!a.reference).map(a=>`${shortRun(a.run)}: ${a.reason}`).join(' ')}</li>)}</ul></div>
 const sharedKind=geneView==='expression'?'expression' as const:'ct' as const
 const setSharedY=(sharedY:boolean)=>{setPresentation(current=>shareY(current,sharedKind,sharedY));setLayoutStatus(sharedY?'All panels now share one y-axis range; per-plot axis settings are kept.':'Each panel uses its own y-axis range again.')}
 function readout(kind:'ct'|'expression',assay:string){
  const points=kind==='expression'?normalizedPoints(assay).points:rawPoints(assay).points
  const scale=kind==='expression'?effectivePlotOptions(presentation,plotKey('expression',assay,false),'expression').axes.yScale:'linear'
  const analyses=candidates.filter(r=>r.target_assay===assay&&(runFilter==='all'||r.run_id===runFilter))
  const openQc=groupQualityFlags(qcFlags.filter(f=>f.assay===assay)).filter(g=>g.unresolved>0).length
  const notes=baselineNotes(analyses),detection=kind==='expression'?detectionSummary(analyses,sample=>withoutPrefix(sample,samplePrefix)):null
  const baseline=<>{baselineLabels(analyses).join(' / ')||'—'}{notes.map(note=><small key={note} className="readout-note">{note}</small>)}</>
  const facts:ReadoutFact[]=kind==='expression'?[{label:'References',value:[...new Set(analyses.flatMap(r=>r.reference_assays))].join(' + ')||'—'},{label:'Baseline',value:baseline},
   ...(detection?[{label:'Wells',value:<details className="readout-detection"><summary>{detection.text}</summary><p>{detection.detail}. Their means use the detected wells only.</p></details>}]:[]),
   {label:'Results',value:!analyses.length?'Not calculated':analyses.some(stale)?'Out of date':provisional?'Provisional':'Current'}]:[{label:'Role',value:savedRefs.includes(assay)?'Reference assay':'Target assay'}]
  const quality={label:'Quality',value:openQc?<button className="text-button" onClick={()=>setTab('quality')}>{openQc} QC finding{openQc===1?'':'s'} to review</button>:'No open QC findings'}
  return <FigureReadout observations={points} kind={kind} scale={scale} colorOf={label=>seriesColorOf(label,kind)} labelFor={displayLabel} facts={[...facts,quality]}/>
 }
 function reorder(from:string,to:string) {
  if(from===to||!assays.includes(from)||!assays.includes(to))return
  setPreviousOrder(assays);setPresentation(current=>({...current,order:reorderAssays(assays,from,to)}));setLayoutStatus(`Moved ${from} to the position of ${to}.`)
 }
 function movePanel(assay:string,direction:number){const index=panelAssays.indexOf(assay),target=panelAssays[index+direction];if(target)reorder(assay,target)}
 function genePanel(assay:string,index:number) {
  const pinned=presentation.favorites.includes(assay)
  const toolbar=<div className="gene-panel-toolbar" role="group" aria-label={`${assay} plot controls`}><button className="plot-drag-handle figure-action" draggable title="Drag to reorder" aria-label={`Drag ${assay} plot; use left and right arrow keys to reorder`} onDragStart={event=>{setDragging(assay);event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',assay)}} onDragEnd={()=>{setDragging(null);setDropTarget(null)}} onKeyDown={event=>{if(event.key==='ArrowLeft'||event.key==='ArrowUp'){event.preventDefault();movePanel(assay,-1)}else if(event.key==='ArrowRight'||event.key==='ArrowDown'){event.preventDefault();movePanel(assay,1)}}}>⠿</button><button className="figure-action pin-toggle" title={pinned?'Pinned':'Pin'} aria-label={`Pin ${assay}`} aria-pressed={pinned} onClick={()=>setPresentation(current=>({...current,favorites:current.favorites.includes(assay)?current.favorites.filter(a=>a!==assay):[...current.favorites,assay]}))}>{pinned?'★':'☆'}</button><button className="figure-action" title="Move earlier" aria-label={`Move ${assay} earlier`} disabled={index===0} onClick={()=>movePanel(assay,-1)}>←</button><button className="figure-action" title="Move later" aria-label={`Move ${assay} later`} disabled={index===panelAssays.length-1} onClick={()=>movePanel(assay,1)}>→</button></div>
  return <div className="gene-panel" data-assay={assay} data-pinned={pinned} data-drop-target={dropTarget===assay} data-dragging={dragging===assay} key={assay} onDragOver={event=>{if(dragging){event.preventDefault();event.dataTransfer.dropEffect='move';setDropTarget(assay)}}} onDrop={event=>{event.preventDefault();if(dragging)reorder(dragging,assay);setDragging(null);setDropTarget(null)}}>
   {geneView==='expression'?normalizedFigure(assay,toolbar):rawFigure(assay,false,toolbar)}
  </div>
 }
 const pendingDesign=!experiment.experiment_design?.confirmed
 const qcGroups=groupQualityFlags(qcFlags)
 const status=dashboardStatus({staleCount,resultCount:candidates.length,qcFindings:qcGroups.filter(group=>group.unresolved>0).length,nameChecks:Object.keys(experiment.name_checks??{}).length,designConfirmed:!pendingDesign,draftDirty,confounded,mixedRoles})
 const reviewQc=()=>inspect(effectiveAssay,'quality')
 const statusActions:Partial<Record<StatusItem['id'],StatusAction>>={
  stale:{label:rebuilding?'Recalculating…':'Recalculate results',onClick:()=>void rebuild(),disabled:rebuilding||!allResults.length},
  qc:{label:'Review QC',onClick:reviewQc},names:{label:'Check sample names',onClick:onSamples},design:{label:'Confirm design',onClick:onSamples},draft:{label:'Open setup',onClick:onSetup},
 }
 const reviewedGroups=qcGroups.filter(group=>group.unresolved===0).length
 const statusNote=status.level==='ok'&&reviewedGroups?`${reviewedGroups} QC finding${reviewedGroups===1?'':'s'} reviewed`:undefined
 const secondaryActions:StatusAction[]=qcFlags.length&&status.leadId!=='qc'?[{label:'Review QC',onClick:reviewQc}]:[]
 const resetFilters=()=>{setRunFilter('all');setSeriesFilter('all');setTimeFilter('all');setChosenAssays(null);setCellContext('');setConditionFocus(null);setCellLines(null);setConfluencies(null)}
 const clearFocus=()=>{setConditionFocus(null);setCellContext('')}
 const factorGroups=[{label:'Cell line',options:cellLineOptions,value:cellLines,set:setCellLines},{label:'Confluency',options:confluencyOptions,value:confluencies,set:setConfluencies}].filter(group=>group.options.length>1)
 const sampleCount=new Set(visible.map(r=>sampleKey(r.run_id,r.sample))).size

 const filterBar=<>
  <button className="mobile-filter-toggle quiet-button" aria-expanded={filtersExpanded} onClick={()=>setFiltersExpanded(value=>!value)}>Filters · {selectedRuns.length} run(s), {selectedAssays.length} assays {filtersExpanded?'−':'+'}</button>
  <div className="filter-workspace" data-expanded={filtersExpanded}><section className="dashboard-filters filter-bar" aria-label="Dashboard filters">
   <label>Run<select aria-label="Dashboard run filter" value={runFilter} onChange={e=>{clearFocus();setRunFilter(e.target.value);setSeriesFilter('all');setTimeFilter('all')}}><option value="all">All runs</option>{runs.map(r=><option key={r.id} value={r.id}>{displayLabel(r.name)}</option>)}</select></label>
   <label>Condition<select aria-label="Condition series" value={effectiveSeries} onChange={e=>{clearFocus();setSeriesFilter(e.target.value);setTimeFilter('all')}}><option value="all">All conditions</option>{allSeries.map(s=><option key={s} value={s} disabled={!availableSeries.has(s)}>{seriesLabel(s)}{!availableSeries.has(s)?' · not in this run':''}</option>)}</select></label>
   <label>Time<select aria-label="Experimental time filter" value={effectiveTime} onChange={e=>{clearFocus();setTimeFilter(e.target.value)}}><option value="all">All times</option>{times.map(([key,m])=><option key={key} value={key}>{m.time_unit==='hour'?'Hour':'Day'} {m.timepoint}</option>)}</select></label>
   {factorGroups.map(group=><div className="factor-group" key={group.label}><span>{group.label}</span><div role="group" aria-label={`${group.label} filter buttons`}><button className="filter-chip" aria-pressed={group.value===null} onClick={()=>{group.set(null);clearFocus()}}>All</button>{group.options.map(value=><button className="filter-chip" key={value} aria-pressed={group.value===null||group.value.includes(value)} onClick={()=>{group.set(current=>current===null?[value]:current.includes(value)?current.filter(v=>v!==value):[...current,value]);clearFocus()}}>{value}</button>)}</div></div>)}
   <details className="assay-filter"><summary>Assays · {selectedAssays.length}/{assays.length}</summary><div><button className="quiet-button" onClick={()=>setChosenAssays(null)}>Select all</button><button className="quiet-button" onClick={()=>setChosenAssays([])}>Clear</button>{assays.map(a=><label key={a}><input type="checkbox" aria-label={`Show assay ${a}`} checked={selectedAssays.includes(a)} onChange={e=>{const checked=e.target.checked;setChosenAssays(current=>checked?[...(current??assays),a]:(current??assays).filter(v=>v!==a))}}/>{a}</label>)}</div></details>
   <p className="filter-meta"><span className="overview-summary"><strong>{sampleCount}</strong> biological samples · <strong>{selectedRuns.length}</strong> runs · <strong>{selectedAssays.length}</strong> assays</span><button className="text-button" onClick={resetFilters} title="Filters change what is displayed, never the saved normalization.">Reset filters</button><button className="text-button" onClick={onSamples}>Edit labels</button></p>
  </section></div>
 </>

 const appearance=<FigureAppearance open={appearanceOpen} onToggle={setAppearanceOpen} presentation={presentation} onChange={setPresentation} series={colorDomain} labelFor={displayLabel} storageNotice={storageNotice} onUndo={undoPresentation} canUndo={canUndoPresentation} onResetOrder={()=>{setPreviousOrder(assays);setPresentation(current=>({...current,order:[]}));setLayoutStatus('Alphabetical plot order restored.')}}/>
 const figureOptions=<details className="figure-options"><summary>Figure size, style &amp; export</summary><div className="figure-settings-grid"><label>Figure style<select aria-label="Figure style" value={presentation.figureTheme} onChange={e=>{const value=e.target.value as Presentation['figureTheme'];setPresentation(current=>({...current,figureTheme:value}))}}>{FIGURE_THEMES.map(name=><option key={name} value={name}>{figureTheme(name).label}{name==='journal'?' · Arial, closed axes, no gridlines':' · light gridlines, open axes'}</option>)}</select></label><label>Publication width<select aria-label="Publication width" value={preset} onChange={e=>setPreset(e.target.value as 'single'|'double')}><option value="single">Single column · 85 mm · ≥8 pt</option><option value="double">Double column · 180 mm · ≥8 pt</option></select></label><label className="inline-check"><input type="checkbox" checked={showExcluded} onChange={e=>setShowExcluded(e.target.checked)}/>Show omitted / excluded wells as crosses</label><button className="quiet-button" onClick={()=>window.print()}>Print current view / Save PDF</button></div><p>SVG, plotted-data CSV and methods JSON share the same filters and provenance, and disclose provisional or out-of-date status.</p></details>
 const modeToggle=<div className="segmented" role="group" aria-label="Dashboard mode"><button aria-pressed={mode==='overview'} onClick={()=>setMode('overview')}>Overview &amp; inspector</button><button aria-pressed={mode==='report'} onClick={()=>setMode('report')}>Figure builder / report</button></div>
 const viewToggle=<div className="segmented"><button aria-pressed={view==='time'} onClick={()=>setView('time')}>Time course</button><button aria-pressed={view==='bars'} onClick={()=>setView('bars')}>Bars from 1×</button></div>

 const allGenesView=<section className="all-genes-dashboard"><div className="all-genes-controls"><label>Find gene<input type="search" aria-label="Find gene in dashboard" placeholder="Assay name…" value={geneSearch} onChange={event=>setGeneSearch(event.target.value)}/></label><label className="inline-check"><input type="checkbox" checked={pinnedOnly} onChange={event=>setPinnedOnly(event.target.checked)}/>Pinned genes only</label>{previousOrder&&<button className="quiet-button" onClick={()=>{setPresentation(current=>({...current,order:previousOrder}));setPreviousOrder(null);setLayoutStatus('Previous plot order restored.')}}>Undo reorder</button>}<div className="segmented"><button aria-pressed={geneView==='expression'} onClick={()=>setGeneKind('expression')}>Expression</button><button aria-pressed={geneView==='ct'} onClick={()=>setGeneKind('ct')}>Raw Ct</button></div>{viewToggle}<label className="inline-check"><input type="checkbox" checked={presentation.plotDefaults[sharedKind].axes.sharedY} onChange={e=>setSharedY(e.target.checked)}/>Same y-axis for all genes</label><label>Columns<select aria-label="Gene dashboard columns" value={geneColumns} onChange={e=>setGeneColumns(e.target.value)}><option value="2">2</option><option value="3">3</option><option value="4">4</option></select></label><button className="quiet-button" onClick={()=>window.print()}>Export dashboard PDF</button></div>
  {appearance}
  {gridHeader(geneView,<p className="grid-note screen-only">{geneView==='expression'?'Target genes with saved results. Reference assays are under Raw Ct.':'All selected assays, including references.'} Hover a panel to reorder (⠿, arrows) or pin it (☆).</p>)}<p className="layout-status" role="status">{layoutStatus}</p>
  <div className="gene-panel-grid" style={{gridTemplateColumns:`repeat(${Math.max(1,Math.min(Number(geneColumns),panelAssays.length))},minmax(0,1fr))`}}>{panelAssays.length?panelAssays.map(genePanel):<div className="dashboard-empty"><p>No genes match this view. Check gene search, pins and assay selection.</p><button className="quiet-button" onClick={()=>{setGeneSearch('');setPinnedOnly(false);setChosenAssays(null)}}>Show all genes</button></div>}</div>{missingNote(missingAssays)}</section>

 const inspector=<section className="assay-inspector" id="assay-inspector"><div className="section-heading"><div><p className="eyebrow">Assay inspector</p><h3>{effectiveAssay}</h3></div><label>Inspect assay<select aria-label="Inspect assay" value={effectiveAssay} onChange={e=>inspect(e.target.value)}>{selectedAssays.map(a=><option key={a}>{a}</option>)}</select></label></div>
  {cellContext&&<p className="inspector-context">Selected cell: {cellContext} <button className="text-button" onClick={()=>{clearFocus();setRunFilter('all');setSeriesFilter('all');setTimeFilter('all')}}>Show all conditions</button></p>}
  <nav className="inspector-tabs" aria-label="Assay inspector views">{[['expression','Expression'],['target','Target Ct'],['reference','Reference Ct'],['quality','QC review'],['statistics','Statistics']].map(([id,label])=><button key={id} aria-pressed={tab===id} onClick={()=>setTab(id)}>{label}</button>)}</nav>
  {tab==='expression'&&<><div className="figure-controls">{viewToggle}<label className="inline-check"><input type="checkbox" checked={showThreshold} onChange={e=>setShowThreshold(e.target.checked)}/>Show effect threshold</label></div>{onlyReference(effectiveAssay)?<p>This assay is a reference in the selected settings. Inspect Reference Ct for its measurements.</p>:<div className="inspector-layout">{normalizedFigure(effectiveAssay)}{readout('expression',effectiveAssay)}</div>}</>}
  {tab==='target'&&<div className="inspector-layout">{rawFigure(effectiveAssay)}{readout('ct',effectiveAssay)}</div>}
  {tab==='reference'&&<><p className="dashboard-footnote">Reference assays used by this gene’s saved analysis (or setup suggestions before analysis). Raw Ct shifts alone do not establish reference stability.</p><div className="figure-grid">{refForFocus.map(a=>rawFigure(a))}</div></>}
  {tab==='quality'&&<><QualityPanel experiment={experiment} assay={effectiveAssay} run={runFilter} onChange={onQuality} onPreview={onPreview}/><h4>Technical controls · {effectiveAssay}</h4><p className="dashboard-footnote">Run selection applies; biological condition and time filters do not.</p>{rawFigure(effectiveAssay,true)}<DistributionDiagnostics analyses={activeAnalyses} currentRevision={revision} runName={runName}/></>}
  {tab==='statistics'&&<>{!activeAnalyses.length&&<p>No statistical result is available for this assay/run selection.</p>}{activeAnalyses.map(r=><section key={r.analysis_id??r.run_id}><h4>{effectiveAssay} · {shortRun(r.run_id)}</h4>{stale(r)&&<p className="stale-note">These statistics are out of date. Recalculate before interpreting them.</p>}<StatisticsResults result={r.statistics}/><DistributionDiagnostics analyses={[r]} currentRevision={revision} runName={runName}/></section>)}</>}
 </section>

 const overviewView=<>
  <div className="view-row overview-mode"><div className="view-row"><div className="segmented" role="group" aria-label="Heatmap values"><button aria-pressed={rawOverview} onClick={()=>setOverviewKind('raw')}>Raw Ct</button><button aria-pressed={!rawOverview} onClick={()=>setOverviewKind('expression')}>Normalized expression</button></div>{!candidates.length&&<button className="quiet-button" onClick={onSetup}>Set up expression →</button>}</div>{modeToggle}</div>
  <OverviewHeatmap records={scope} annotations={annotations} targets={rawOverview?selectedAssays:targets} availability={availability} raw={rawOverview} exclusions={experiment.measurement_exclusions} sampleExclusions={Object.fromEntries([...runSettings].map(([run,result])=>[run,result.excluded_samples??[]]))} onInspect={(assay,context)=>{if(context){setConditionFocus(context.condition);setRunFilter(context.run);setSeriesFilter(context.series);setTimeFilter(context.time);setCellContext(context.label)}else clearFocus();inspect(assay,rawOverview?'target':'expression')}}/>
  <div className="figure-option-row">{figureOptions}{appearance}</div>
  {inspector}
 </>

 const reportView=<section className="report-figures" data-preset={preset}><div className="view-row">{modeToggle}</div><div className="figure-option-row">{figureOptions}{appearance}</div><div className="section-heading"><div><h3>Figure builder</h3><p>Selected assays and filters define the report. Each figure includes its data, methods and quality status.</p></div><button onClick={()=>window.print()}>Print selected report / Save PDF</button></div><div className="report-controls">{[['expression','Expression'],['target','Target Ct'],['reference','Reference Ct']].map(([id,label])=><label className="inline-check" key={id}><input type="checkbox" checked={reportKinds.includes(id)} onChange={e=>setReportKinds(current=>e.target.checked?[...current,id]:current.filter(v=>v!==id))}/>{label}</label>)}{viewToggle}</div>
  {reportKinds.includes('expression')&&<><h4>Normalized expression</h4>{gridHeader('expression',<p className="grid-provenance">References: {[...new Set(candidates.flatMap(r=>r.reference_assays))].join(' + ')||'—'} · {staleCount?'Some saved results are out of date; recalculate before reporting.':provisional?'Provisional: QC findings or the study design still need review.':'Saved analyses with reviewed QC.'}</p>)}<div className="figure-grid normalized-report">{targets.filter(hasResult).map(a=>normalizedFigure(a))}</div>{missingNote(targets.filter(a=>!hasResult(a)))}</>}
  {reportKinds.includes('target')&&<><h4>Target Ct</h4>{gridHeader('ct',<p className="grid-provenance">Raw Ct as measured; no normalization. {provisional?'Provisional: QC findings or the study design still need review.':'QC findings reviewed.'} Each panel lists its own missing and excluded wells.</p>)}<div className="figure-grid target-ct-grid">{targets.map(a=>rawFigure(a))}</div></>}
  {reportKinds.includes('reference')&&<><h4>Reference Ct</h4>{gridHeader('ct',<p className="grid-provenance">Raw Ct as measured; no normalization. {provisional?'Provisional: QC findings or the study design still need review.':'QC findings reviewed.'} Each panel lists its own missing and excluded wells.</p>)}<div className="figure-grid housekeeping-ct-grid">{housekeeping.map(a=>rawFigure(a))}</div></>}
 </section>

 return <div className="research-dashboard" id="analysis-results" data-mode={allGenes?'genes':mode} data-preset={allGenes?'single':preset}>
  {snapshot&&<div className="snapshot-banner">Historical snapshot · {snapshot.target_assay}. Current raw data is shown alongside saved expression settings.<button className="quiet-button" onClick={onClearSnapshot}>Return to current analysis set</button></div>}
  <StatusBanner status={status} actions={statusActions} note={statusNote} secondary={secondaryActions}/>
  {rebuildStatus&&<div className="rebuild-status" role="status">{rebuildStatus}{rebuildErrors.length>0&&<details><summary>View unavailable outcomes</summary><ul>{rebuildErrors.map((e,i)=><li key={i}>{e.target_assay??shortRun(e.run_id??'')}: {e.reason}</li>)}</ul></details>}</div>}
  {filterBar}
  {!selectedAssays.length?<div className="dashboard-empty">No assays selected. Select assays or reset filters.</div>:allGenes?allGenesView:mode==='overview'?overviewView:reportView}
  <details className="study-details"><summary>Experimental design &amp; time origin</summary><p>Time origin: {experiment.experiment_design?.time_origin||'not recorded'}. Experimental unit: {experiment.experiment_design?.experimental_unit||'not recorded'}. Design: {experiment.experiment_design?.design_type??'unknown'}. {experiment.experiment_design?.confirmed?'Recorded as confirmed.':'Not confirmed yet, so results are provisional.'}</p><p>Reference evidence: {experiment.experiment_design?.reference_validation_note||'not recorded'}. Efficiency evidence: {experiment.experiment_design?.efficiency_note||'not recorded'}.</p><button className="quiet-button" onClick={onSamples}>Edit samples &amp; design</button></details>
  <details className="dashboard-analysis-register"><summary>Saved analysis set &amp; provenance</summary><p>One settings profile per run is shown. Older profiles remain in History.</p><div className="results-table-wrap"><table><thead><tr><th>Assay</th><th>Run</th><th>State</th><th>References</th><th>Baseline</th><th>Saved / analysis ID</th></tr></thead><tbody>{availability.map(a=><tr key={`${a.run}:${a.assay}`}><td>{a.assay}</td><td>{shortRun(a.run)}</td><td>{a.result?a.stale?'Out of date':'Current':a.reason}</td><td>{a.result?.reference_assays.join(', ')}</td><td>{a.result?.baseline_samples?.join('; ')}</td><td>{a.result?.created_at}<small>{a.result?.analysis_id}</small></td></tr>)}</tbody></table></div></details>
 </div>
}

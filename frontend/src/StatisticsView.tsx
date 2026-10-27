import type {AnalysisResult,Run} from './types'
import {coherentAnalyses} from './plotData'
import {StatisticsExplanation,StatisticsResults} from './StatisticsPanel'
import {DistributionDiagnostics} from './DistributionDiagnostics'

/** Statistics for one saved gene/run analysis, chosen here rather than inherited from elsewhere. */
export function StatisticsView({analyses,runs,selected,onSelect,currentRevision}:{analyses:AnalysisResult[];runs:Run[];selected:AnalysisResult|null;onSelect:(result:AnalysisResult)=>void;currentRevision:number}) {
 const available=coherentAnalyses(analyses.filter(result=>Array.isArray(result.samples)))
 const runName=(id:string)=>runs.find(run=>run.id===id)?.name??id
 const runIds=[...new Set([...available.map(result=>result.run_id),...(selected?[selected.run_id]:[])])]
 // An opened History snapshot is shown as is (with its out-of-date note), not swapped for the latest version.
 const current=selected??available[0]??null
 const genes=[...new Set([...available.filter(result=>result.run_id===current?.run_id).map(result=>result.target_assay),...(current?[current.target_assay]:[])])].sort((a,b)=>a.localeCompare(b))
 const pick=(run:string,gene:string)=>{const match=available.find(result=>result.run_id===run&&result.target_assay===gene)??available.find(result=>result.run_id===run);if(match)onSelect(match)}
 return <section className="statistics-view">
  <div className="statistics-picker"><label>Run<select aria-label="Statistics run" value={current?.run_id??''} onChange={e=>pick(e.target.value,current?.target_assay??'')} disabled={!available.length}>{runIds.map(id=><option key={id} value={id}>{runName(id)}</option>)}</select></label>
   <label>Gene<select aria-label="Statistics gene" value={current?.target_assay??''} onChange={e=>pick(current!.run_id,e.target.value)} disabled={!available.length}>{genes.map(gene=><option key={gene}>{gene}</option>)}</select></label>
   {current&&current.context_revision!==currentRevision&&<p className="stale-note">These statistics are out of date. Recalculate before interpreting them.</p>}</div>
  {!current?<p>Calculate expression to see statistics.</p>:<><StatisticsResults result={current.statistics}/><DistributionDiagnostics analyses={[current]} currentRevision={currentRevision} runName={runName}/></>}
  <StatisticsExplanation/>
 </section>
}

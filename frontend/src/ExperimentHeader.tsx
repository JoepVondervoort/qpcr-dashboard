import {useState} from 'react'
import type {Experiment} from './types'
import {extremeChanges} from './libraryResults'
import {foldLabel} from './heatmapLayout'
import {groupQualityFlags} from './qcGroups'

const count=(n:number,word:string)=>`${n} ${word}${n===1?'':'s'}`

/** Editable display name; the source file names remain available in Details. */
export function ExperimentTitle({name,onRename}:{name:string;onRename:(name:string)=>Promise<void>}) {
 const [draft,setDraft]=useState<string|null>(null),[error,setError]=useState(''),[saving,setSaving]=useState(false)
 async function save(){
  if(draft==null)return
  setSaving(true);setError('')
  try{await onRename(draft);setDraft(null)}catch(e){setError(e instanceof Error?e.message:'Could not rename this experiment.')}finally{setSaving(false)}
 }
 if(draft==null)return <div className="experiment-title"><h2>{name}</h2><button className="text-button rename-button" onClick={()=>setDraft(name)}>Rename</button></div>
 return <form className="experiment-title editing" onSubmit={event=>{event.preventDefault();void save()}}>
  <input aria-label="Experiment name" value={draft} maxLength={140} autoFocus onChange={event=>setDraft(event.target.value)} onKeyDown={event=>{if(event.key==='Escape')setDraft(null)}}/>
  <button type="submit" disabled={saving||!draft.trim()}>{saving?'Saving…':'Save name'}</button><button type="button" className="text-button" onClick={()=>setDraft(null)}>Cancel</button>
  {error&&<p role="alert">{error}</p>}
 </form>
}

/** The experiment's contents; result highlights live in its details. */
export function ExperimentSummary({experiment}:{experiment:Experiment}) {
 const summary=experiment.library_summary
 const runs=experiment.parsed_summary?.runs?.length??0
 return <p className="experiment-summary">
  {summary&&<span>{count(summary.assay_count,'assay')}</span>}<span>{count(runs,'run')}</span>{summary&&<span>{count(summary.biological_sample_count,'biological sample')}</span>}
 </p>
}

export function ExperimentHighlights({experiment}:{experiment:Experiment}) {
 const summary=experiment.library_summary
 const {up,down}=extremeChanges(summary?.gene_results??[])
 // Live quality state when the experiment is loaded; the library summary otherwise.
 const findings=experiment.quality?groupQualityFlags(experiment.quality.flags).filter(group=>group.unresolved>0).length:summary?.unresolved_findings??summary?.unresolved_count??0
 const outdated=Boolean(up?.out_of_date||down?.out_of_date)
 return <div className="experiment-highlights">
  {up&&<span title={`${up.condition} · ${up.run_name}`}>largest ↑ <i>{up.assay}</i> <strong className="change-up">{foldLabel(up.fold_change)}</strong>{up.out_of_date&&'†'}</span>}
  {down&&<span title={`${down.condition} · ${down.run_name}`}>largest ↓ <i>{down.assay}</i> <strong className="change-down">{foldLabel(down.fold_change)}</strong>{down.out_of_date&&'†'}</span>}
  {findings>0&&<span>{findings} QC finding{findings===1?'':'s'} to review</span>}
  {outdated&&<span className="muted-text">† from out-of-date results</span>}
 </div>
}

import {useState} from 'react'
import type {Experiment,QualityChange,ExclusionPreview} from './types'
import {flagGroupTitle,groupQualityFlags,type FlagGroup} from './qcGroups'

/** measurement_id is JSON [run, sheet, row, well, assay]; show it as "well assay". */
function wellLabel(measurementId:string):string {
 try{const parts=JSON.parse(measurementId) as unknown[];return `${String(parts[3]??'')} ${String(parts[4]??'')}`.trim()||measurementId}catch{return measurementId}
}
const groupStatus=(group:FlagGroup)=>group.status==='reviewed'?'Reviewed':group.status==='mixed'?`${group.flags.length-group.unresolved} of ${group.flags.length} reviewed`:'Needs review'

export function QualityPanel({experiment,assay,run,onChange,onPreview}:{experiment:Experiment;assay:string;run:string;onChange:(change:QualityChange)=>Promise<void>;onPreview:(run:string,assay:string,exclusions:Record<string,string>)=>Promise<ExclusionPreview>}) {
 const [allAssays,setAllAssays]=useState(true),[activeGroup,setActiveGroup]=useState<string|null>(null),[activeFlag,setActiveFlag]=useState<string|null>(null)
 const [reasons,setReasons]=useState<Record<string,string>|null>(null),[restoreReason,setRestoreReason]=useState(''),[status,setStatus]=useState(''),[busy,setBusy]=useState(false),[threshold,setThreshold]=useState<number|null>(null)
 // A typed note belongs to the finding it was written for; it never carries over to another finding.
 const [note,setNote]=useState({group:'',text:''})
 const [preview,setPreview]=useState<ExclusionPreview|null>(null)
 const [statusFilter,setStatusFilter]=useState('unresolved'),[kindFilter,setKindFilter]=useState('all'),[sampleSearch,setSampleSearch]=useState('')
 const flags=(experiment.quality?.flags??[]).filter(f=>(run==='all'||f.run_id===run)&&(allAssays||f.assay===assay)&&(statusFilter==='all'||(statusFilter==='reviewed'?f.status==='reviewed':f.status==='needs_review'))&&(kindFilter==='all'||f.kind===kindFilter)&&`${f.sample} ${f.assay}`.toLowerCase().includes(sampleSearch.toLowerCase()))
 const groups=groupQualityFlags(flags)
 const group=groups.find(g=>g.id===activeGroup)??groups[0]
 const flag=group?.flags.find(f=>f.id===activeFlag)??group?.flags[0]
 const saved=experiment.measurement_exclusions??{}
 const exclusions=reasons??saved
 const added=Object.entries(exclusions).filter(([id,reason])=>saved[id]!==reason)
 const restored=Object.keys(saved).filter(id=>!Object.hasOwn(exclusions,id))
 const runName=(id:string)=>experiment.parsed_summary?.runs?.find(r=>r.id===id)?.name??id
 const review=note.group===group?.id?note.text:''

 async function save(change:QualityChange,message:string){setBusy(true);try{await onChange(change);setReasons(null);setRestoreReason('');setNote({group:'',text:''});setPreview(null);setStatus(message)}catch(e){setStatus(e instanceof Error?e.message:'Could not save review.')}finally{setBusy(false)}}
 function saveExclusions(){
  const note=[...added.map(([id,reason])=>`Excluded ${wellLabel(id)}: ${reason}`),...(restored.length?[`Restored ${restored.map(wellLabel).join(', ')}: ${restoreReason.trim()}`]:[])].join(' ')
  void save({measurement_exclusions:exclusions,note},'Exclusions saved. Raw measurements are preserved; recalculate to apply them to results.')
 }
 function markReviewed(target:FlagGroup){
  const decisions=Object.fromEntries((target.unresolved?target.flags.filter(f=>f.status==='needs_review'):target.flags).map(f=>[f.id,{reason:review}]))
  void save({decisions},`${Object.keys(decisions).length} QC flag(s) marked as reviewed.`)
 }
 async function runPreview(){
  if(!flag)return
  setBusy(true)
  try{setPreview(await onPreview(flag.run_id,flag.assay,exclusions));setStatus('Preview ready. Nothing was saved.')}catch(e){setStatus(e instanceof Error?e.message:'Could not preview.')}finally{setBusy(false)}
 }

 return <section className="quality-panel"><h4>Quality review</h4><p>Findings ask for a look at the instrument output; they do not diagnose a cause or remove data. Related flags from the same sample are grouped.</p>
 <div className="quality-triage"><label>Review status<select aria-label="Review status" value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option value="unresolved">Needs review</option><option value="reviewed">Reviewed</option><option value="all">All findings</option></select></label><label>Concern type<select aria-label="Concern type" value={kindFilter} onChange={e=>setKindFilter(e.target.value)}><option value="all">All types</option><option value="control_signal">Control signals</option><option value="technical_spread">Replicate spread</option></select></label><label>Find assay or sample<input type="search" value={sampleSearch} onChange={e=>setSampleSearch(e.target.value)}/></label><label className="inline-check"><input type="checkbox" checked={allAssays} onChange={e=>setAllAssays(e.target.checked)}/>All assays</label></div>
 <details className="qc-policy"><summary>Replicate-spread threshold · {experiment.quality?.spread_threshold??1} Ct</summary><div className="quality-controls"><label>Flag technical replicates whose Ct range exceeds<input type="number" step="0.1" min="0.01" value={threshold??experiment.quality?.spread_threshold??1} onChange={e=>setThreshold(Number(e.target.value))}/></label><button className="quiet-button" disabled={busy||threshold==null||!Number.isFinite(threshold)||threshold<=0} onClick={()=>void save({spread_threshold:threshold!},'Threshold saved.')}>Apply threshold</button></div><p>This is an editable review policy, not a universal acceptance criterion.</p></details>
 {!groups.length?<p>No findings match these filters.</p>:<div className="quality-workspace"><div className="quality-list">{groups.map(g=><button key={g.id} aria-pressed={group?.id===g.id} onClick={()=>{setActiveGroup(g.id);setActiveFlag(null);setPreview(null)}}><strong>{flagGroupTitle(g)}</strong><small>{runName(g.run_id)}{g.plate&&g.kind!=='control_signal'?` · ${g.plate}`:''} · {groupStatus(g)}</small></button>)}</div>
 {group&&flag&&<div className="quality-detail"><h4>{flagGroupTitle(group)}</h4><p>{flag.message}</p>
  {group.flags.length>1&&<div className="qc-assays" role="group" aria-label="Assays in this finding">{group.flags.map(f=><button key={f.id} className="filter-chip" aria-pressed={f.id===flag.id} onClick={()=>{setActiveFlag(f.id);setPreview(null)}}>{f.assay}</button>)}</div>}
  {flag.review&&<p className="review-note">Review note: {flag.review.reason}</p>}
  <div className="results-table-wrap"><table><thead><tr><th>Well / source</th><th>Ct</th><th>Status</th><th>Exclude (reason)</th></tr></thead><tbody>{flag.measurements.map(r=><tr key={r.measurement_id}><td>{r.well}<small>{r.sheet} · row {r.row_number}</small></td><td>{r.ct??'—'}</td><td>{r.status}{r.omit?' · instrument omitted':''}</td><td><input aria-label={`Exclusion reason for ${r.run_id} ${r.well} ${r.assay}`} disabled={r.omit} value={exclusions[r.measurement_id!]??''} placeholder="Leave blank to keep" onChange={e=>{const reason=e.target.value;setPreview(null);setReasons(current=>{const base=current??saved;const {[r.measurement_id!]:_previous,...rest}=base;return reason.trim()?{...rest,[r.measurement_id!]:reason}:rest})}}/></td></tr>)}</tbody></table></div>
  <div className="qc-action"><h5>Exclude wells</h5>
   {restored.length>0&&<label>Why restore {restored.map(wellLabel).join(', ')}?<input value={restoreReason} onChange={e=>setRestoreReason(e.target.value)}/></label>}
   <div className="qc-buttons"><button className="quiet-button" disabled={busy||!reasons} onClick={()=>void runPreview()}>Preview exclusion effect</button><button disabled={busy||!reasons||(!added.length&&!restored.length)||(restored.length>0&&!restoreReason.trim())} onClick={saveExclusions}>Save exclusions</button>{reasons&&<button className="text-button" onClick={()=>{setReasons(null);setPreview(null);setRestoreReason('');setStatus('Proposed changes discarded.')}}>Discard</button>}</div>
   {preview&&<div className="exclusion-preview"><p>{preview.note}</p><div className="results-table-wrap"><table><thead><tr><th>Sample</th><th>Target Ct mean: now → preview</th><th>Fold change: now → preview</th></tr></thead><tbody>{preview.preview.samples.map(row=>{const old=preview.current.find(r=>r.sample===row.sample);return <tr key={row.sample}><td>{row.sample}</td><td>{old?.target_ct_mean?.toFixed(3)??'—'} → {row.target_ct_mean?.toFixed(3)??'—'}</td><td>{old?.fold_change?.toPrecision(4)??'—'} → {row.fold_change?.toPrecision(4)??'—'}</td></tr>})}</tbody></table></div></div>}
  </div>
  <div className="qc-action"><h5>Mark as reviewed</h5><label>Review note<textarea value={review} onChange={e=>setNote({group:group.id,text:e.target.value})} placeholder="What you checked and what follows, e.g. amplification curve inspected; primer-dimer melt peak; repeat planned."/></label>
   <button disabled={busy||!review.trim()} onClick={()=>markReviewed(group)}>{group.unresolved>1?`Mark ${group.unresolved} flags as reviewed`:group.unresolved===1?'Mark as reviewed':'Replace review note (previous note stays in the audit trail)'}</button></div>
 </div>}</div>}
 <details className="qc-audit"><summary>Review and exclusion audit trail ({experiment.audit_events?.length??0})</summary><ul>{[...(experiment.audit_events??[])].reverse().map((event,i)=><li key={i}><strong>{String(event.action).replaceAll('_',' ')}</strong> · {String(event.at)}{event.reason?` · ${String(event.reason)}`:''}</li>)}</ul></details><p role="status">{status}</p></section>
}

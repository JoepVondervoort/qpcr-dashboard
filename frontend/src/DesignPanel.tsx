import {useState} from 'react'
import type {ExperimentDesign} from './types'
const defaultDesign:ExperimentDesign={time_origin:'',design_type:'unknown',experimental_unit:'',confirmed:false,reference_validation_note:'',efficiency_note:''}
export function DesignPanel({value,onSave,draft:externalDraft,onDraftChange}:{value?:ExperimentDesign;onSave:(d:ExperimentDesign)=>Promise<void>;draft?:ExperimentDesign|null;onDraftChange?:(d:ExperimentDesign|null)=>void}) {
 const [localDraft,setLocalDraft]=useState<ExperimentDesign|null>(null),[status,setStatus]=useState(''),[busy,setBusy]=useState(false)
 const draft=externalDraft===undefined?localDraft:externalDraft
 const setDraft=onDraftChange??setLocalDraft
 const design=draft??value??defaultDesign
 const incomplete=design.confirmed&&(!design.time_origin.trim()||!design.experimental_unit.trim()||design.design_type==='unknown')
 async function save(){setBusy(true);try{await onSave(design);setDraft(null);setStatus('Design saved. Existing expression analyses require recalculation.')}catch(e){setStatus(e instanceof Error?e.message:'Could not save design.')}finally{setBusy(false)}}
 return <section className="design-panel"><h4>Experimental design &amp; time origin</h4><p>These fields describe the experiment; they cannot be established from sample names or Ct values.</p><div className="design-grid">
 <label>Time measured from<input value={design.time_origin} placeholder="Transfection, differentiation, seeding…" onChange={e=>setDraft({...design,time_origin:e.target.value,confirmed:false})}/></label>
 <label>Experimental unit<input value={design.experimental_unit} placeholder="Separately transfected culture well, donor…" onChange={e=>setDraft({...design,experimental_unit:e.target.value,confirmed:false})}/></label>
 <label>Study design<select value={design.design_type} onChange={e=>setDraft({...design,design_type:e.target.value as ExperimentDesign['design_type'],confirmed:false})}><option value="unknown">Not confirmed</option><option value="independent">Independent groups</option><option value="paired">Paired samples</option><option value="blocked">Blocked / nested</option><option value="repeated">Repeated measurements</option></select></label></div>
 {design.design_type!=='independent'&&<p className="method-note">Descriptive results are available. Paired, blocked and repeated-measure inference requires a different model; this app will not run independent-group tests for those designs.</p>}
 <details><summary>Reference and amplification-efficiency evidence</summary><label>Reference-gene validation note<textarea value={design.reference_validation_note} onChange={e=>setDraft({...design,reference_validation_note:e.target.value})}/></label><label>Assay-efficiency evidence / assumptions<textarea value={design.efficiency_note} onChange={e=>setDraft({...design,efficiency_note:e.target.value})}/></label><p>Ct exports alone do not validate reference stability or amplification efficiency. These notes travel with the analysis.</p></details>
 <label className="inline-check"><input type="checkbox" checked={design.confirmed} onChange={e=>setDraft({...design,confirmed:e.target.checked})}/>I have reviewed the time origin, experimental unit and design.</label>
 {incomplete&&<p role="alert">Complete the time origin, experimental unit and study design before confirming.</p>}
 <button className="quiet-button" disabled={busy||incomplete} onClick={save}>{busy?'Saving…':'Save experimental design'}</button><>{draft&&<button className="quiet-button" onClick={()=>setDraft(null)}>Discard design edits</button>}</><p role="status">{draft?'Unsaved design edits. Save to apply them to the experiment.':status}</p></section>
}

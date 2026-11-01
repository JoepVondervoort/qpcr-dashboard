import {useState} from 'react'
import type {Run} from './types'
import {FILE_ACCEPT,isAcceptedFile} from './plates'

/** Plates that arrive later join this experiment: as new runs, or into a run whose baseline they share. */
export function AddPlatesPanel({runs,onAdd}:{runs:Run[];onAdd:(files:File[],combineInto:string)=>Promise<void>}) {
 const [files,setFiles]=useState<File[]>([]),[target,setTarget]=useState(''),[busy,setBusy]=useState(false),[status,setStatus]=useState('')
 const rejected=files.filter(file=>!isAcceptedFile(file.name))
 async function add(){
  setBusy(true);setStatus('')
  try{await onAdd(files,target);setFiles([]);setStatus('')}catch(e){setStatus(e instanceof Error?e.message:'Could not add these plates.')}finally{setBusy(false)}
 }
 return <details className="add-plates"><summary>Add plates</summary>
  <p className="setup-hint">For plates of this experiment that were run or exported later. Saved results become out of date until you recalculate.</p>
  <label>Results files<input aria-label="Plate files" type="file" multiple accept={FILE_ACCEPT} disabled={busy} onChange={e=>setFiles([...(e.target.files??[])])}/></label>
  <label>Analyse with<select aria-label="Add plates to" value={target} disabled={busy} onChange={e=>setTarget(e.target.value)}>
   <option value="">Separate run (own baseline)</option>
   {runs.map(run=><option key={run.id} value={run.id}>Combined with {run.name} (shared baseline)</option>)}
  </select></label>
  {rejected.length>0&&<p className="analysis-error" role="alert">Not supported: {rejected.map(file=>file.name).join(', ')}.</p>}
  {status&&<p className="analysis-error" role="alert">{status}</p>}
  <button disabled={busy||!files.length||rejected.length>0} onClick={()=>void add()}>{busy?'Adding…':files.length?`Add ${files.length} plate file${files.length===1?'':'s'}`:'Add plate files'}</button>
 </details>
}

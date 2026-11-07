import {useRef,useState} from 'react'
import type {Run} from './types'
import {FILE_ACCEPT,isAcceptedFile} from './plates'
import {useDropTarget} from './fileDrop'
import {addFiles,fileKey} from './uploads'

/** Plates that arrive later join this experiment: as new runs, or into a run whose baseline they share. */
export function AddPlatesPanel({runs,onAdd}:{runs:Run[];onAdd:(files:File[],combineInto:string)=>Promise<void>}) {
 const [files,setFiles]=useState<File[]>([]),[target,setTarget]=useState(''),[busy,setBusy]=useState(false),[status,setStatus]=useState('')
 const details=useRef<HTMLDetailsElement>(null)
 // Files dropped here join this experiment; dropped anywhere else they start the upload of a new one.
 const drop=useDropTarget(dropped=>{setFiles(current=>addFiles(current,dropped));if(details.current)details.current.open=true},busy)
 const rejected=files.filter(file=>!isAcceptedFile(file.name))
 async function add(){
  setBusy(true);setStatus('')
  try{await onAdd(files,target);setFiles([]);setStatus('')}catch(e){setStatus(e instanceof Error?e.message:'Could not add these plates.')}finally{setBusy(false)}
 }
 return <details ref={details} className={`add-plates${drop.active?' is-dropping':''}`} {...drop.props}><summary>Add plates</summary>
  <p className="setup-hint">For plates of this experiment that were run or exported later. Drop the files here or choose them. Saved results become out of date until you recalculate.</p>
  <label>Results files<input aria-label="Plate files" type="file" multiple accept={FILE_ACCEPT} disabled={busy} onChange={e=>{setFiles(current=>addFiles(current,[...(e.target.files??[])]));e.target.value=''}}/></label>
  {files.length>0&&<ul className="add-plates-files" aria-label="Plate files to add">{files.map(file=><li key={fileKey(file)}><span>{file.name}</span>
   <button type="button" className="icon-button" aria-label={`Remove ${file.name}`} disabled={busy} onClick={()=>setFiles(current=>current.filter(kept=>fileKey(kept)!==fileKey(file)))}>×</button></li>)}</ul>}
  <label>Analyse with<select aria-label="Add plates to" value={target} disabled={busy} onChange={e=>setTarget(e.target.value)}>
   <option value="">Separate run (own baseline)</option>
   {runs.map(run=><option key={run.id} value={run.id}>Combined with {run.name} (shared baseline)</option>)}
  </select></label>
  {rejected.length>0&&<p className="analysis-error" role="alert">Not supported: {rejected.map(file=>file.name).join(', ')}. Remove {rejected.length===1?'it':'them'} to add the rest.</p>}
  {status&&<p className="analysis-error" role="alert">{status}</p>}
  <button disabled={busy||!files.length||rejected.length>0} onClick={()=>void add()}>{busy?'Adding…':files.length?`Add ${files.length} plate file${files.length===1?'':'s'}`:'Add plate files'}</button>
 </details>
}

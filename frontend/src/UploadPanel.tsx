import {useState,type RefObject} from 'react'
import type {Project} from './types'
import {FILE_ACCEPT,defaultLabel,isAcceptedFile} from './plates'
import {PlateChoice} from './PlateChoice'

const NEW_PROJECT='__new__'

export type UploadPanelProps={open:boolean;importing:boolean;projects:Project[];destination:string;onDestination:(id:string)=>void
 projectName:string;onProjectName:(name:string)=>void;label:string;onLabel:(label:string)=>void
 files:File[];onFiles:(files:File[])=>void;combine:boolean;onCombine:(combine:boolean)=>void
 fileInput:RefObject<HTMLInputElement|null>;status:string;onClose:()=>void;onImport:()=>void}

const size=(files:File[])=>`${(files.reduce((total,file)=>total+file.size,0)/1024).toFixed(0)} kB`

/** Files first, then where they go: one primary action that creates the project when needed. */
export function UploadPanel({fileInput,...p}:UploadPanelProps) {
 const [dragging,setDragging]=useState(false)
 const creating=!p.destination
 const target=p.projects.find(project=>project.id===p.destination)
 const known=new Set(target?.experiments.flatMap(e=>e.parsed_summary?.files??(e.original_filename?[e.original_filename]:[]))??[])
 const duplicates=p.files.filter(file=>known.has(file.name))
 const rejected=p.files.filter(file=>!isAcceptedFile(file.name))
 const several=p.files.length>1
 return <aside className="sidebar" hidden={!p.open} role="dialog" aria-modal="true" aria-label="Upload results">
  <button className="upload-close quiet-button" disabled={p.importing} onClick={p.onClose}>Close upload ×</button>
  <div><p className="eyebrow">New experiment</p><h1>Upload results</h1></div>
  <div className="panel">
   <label className={`drop-zone${dragging?' is-dragging':''}`} onDragOver={e=>{e.preventDefault();setDragging(true)}} onDragLeave={()=>setDragging(false)} onDrop={e=>{e.preventDefault();setDragging(false);const dropped=[...(e.dataTransfer.files??[])];if(dropped.length)p.onFiles(dropped)}}>
    <strong>{p.files.length===1?p.files[0].name:several?`${p.files.length} files`:'Drop Ct/Cq exports here'}</strong>
    <span>{p.files.length?`${size(p.files)} · choose again to replace`:'CSV, XLSX, XLSM or XLS. Choose several files for an experiment spread over several plates.'}</span>
    <input ref={fileInput} aria-label="File" type="file" multiple accept={FILE_ACCEPT} disabled={p.importing} onChange={e=>p.onFiles([...(e.target.files??[])])}/></label>
   {several&&<ul className="upload-files">{p.files.map(file=><li key={`${file.name}-${file.size}`}>{file.name}</li>)}</ul>}
   {rejected.length>0&&<p className="upload-duplicate" role="alert">Not supported: {rejected.map(file=>file.name).join(', ')}. Choose CSV, XLSX, XLSM or XLS exports.</p>}
   {duplicates.length>0&&<p className="upload-duplicate" role="status">{duplicates.length===1?'A file named':'Files named'} {duplicates.map(file=>file.name).join(', ')} {duplicates.length===1?'is':'are'} already in this project. Importing again creates a separate experiment.</p>}
   {several&&<PlateChoice combine={p.combine} onChange={p.onCombine} disabled={p.importing}/>}
   <label><span>Experiment label</span><input value={p.label} placeholder={p.files.length?defaultLabel(p.files.map(file=>file.name)):'Defaults to the file name'} onChange={e=>p.onLabel(e.target.value)}/></label>
  </div>
  <div className="panel">
   {p.projects.length>0&&<label><span>Project</span><select aria-label="Destination project" value={p.destination||NEW_PROJECT} disabled={p.importing} onChange={e=>p.onDestination(e.target.value===NEW_PROJECT?'':e.target.value)}>{p.projects.map(project=><option key={project.id} value={project.id}>{project.name}</option>)}<option value={NEW_PROJECT}>New project…</option></select></label>}
   {creating&&<label><span>Project name</span><input value={p.projectName} onChange={e=>p.onProjectName(e.target.value)}/></label>}
  </div>
  <p className="upload-status" role="status">{p.status}</p>
  <button className="upload-submit" onClick={p.onImport} disabled={!p.files.length||rejected.length>0||p.importing}>{p.importing?'Importing…':creating?'Create project and import':'Import raw results'}</button>
 </aside>
}

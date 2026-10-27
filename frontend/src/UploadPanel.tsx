import {useState,type RefObject} from 'react'
import type {Project} from './types'

const NEW_PROJECT='__new__'
const ACCEPTED=/\.(csv|xlsx|xlsm)$/i

export type UploadPanelProps={open:boolean;importing:boolean;projects:Project[];destination:string;onDestination:(id:string)=>void
 projectName:string;onProjectName:(name:string)=>void;label:string;onLabel:(label:string)=>void
 file:File|null;onFile:(file:File|null)=>void;fileInput:RefObject<HTMLInputElement|null>;status:string;onClose:()=>void;onImport:()=>void}

/** File first, then where it goes: one primary action that creates the project when needed. */
export function UploadPanel({fileInput,...p}:UploadPanelProps) {
 const [dragging,setDragging]=useState(false)
 const creating=!p.destination
 const target=p.projects.find(project=>project.id===p.destination)
 const duplicate=p.file&&target?.experiments.some(e=>e.original_filename===p.file!.name)
 const rejected=p.file&&!ACCEPTED.test(p.file.name)
 return <aside className="sidebar" hidden={!p.open} role="dialog" aria-modal="true" aria-label="Upload results">
  <button className="upload-close quiet-button" disabled={p.importing} onClick={p.onClose}>Close upload ×</button>
  <div><p className="eyebrow">New experiment</p><h1>Upload results</h1></div>
  <div className="panel">
   <label className={`drop-zone${dragging?' is-dragging':''}`} onDragOver={e=>{e.preventDefault();setDragging(true)}} onDragLeave={()=>setDragging(false)} onDrop={e=>{e.preventDefault();setDragging(false);const dropped=e.dataTransfer.files?.[0];if(dropped)p.onFile(dropped)}}>
    <strong>{p.file?p.file.name:'Drop a Ct/Cq export here'}</strong><span>{p.file?`${(p.file.size/1024).toFixed(0)} kB · choose another file to replace it`:'CSV, XLSX or XLSM. Each instrument run in the file is detected and kept separate.'}</span>
    <input ref={fileInput} aria-label="File" type="file" accept=".csv,.xlsx,.xlsm" disabled={p.importing} onChange={e=>p.onFile(e.target.files?.[0]??null)}/></label>
   {rejected&&<p className="upload-duplicate" role="alert">This file type is not supported. Choose a CSV, XLSX or XLSM export.</p>}
   {duplicate&&<p className="upload-duplicate" role="status">A file named {p.file!.name} is already in this project. Importing again creates a separate experiment.</p>}
   <label><span>Experiment label</span><input value={p.label} placeholder={p.file?p.file.name.replace(ACCEPTED,''):'Defaults to the file name'} onChange={e=>p.onLabel(e.target.value)}/></label>
  </div>
  <div className="panel">
   {p.projects.length>0&&<label><span>Project</span><select aria-label="Destination project" value={p.destination||NEW_PROJECT} disabled={p.importing} onChange={e=>p.onDestination(e.target.value===NEW_PROJECT?'':e.target.value)}>{p.projects.map(project=><option key={project.id} value={project.id}>{project.name}</option>)}<option value={NEW_PROJECT}>New project…</option></select></label>}
   {creating&&<label><span>Project name</span><input value={p.projectName} onChange={e=>p.onProjectName(e.target.value)}/></label>}
  </div>
  <p className="upload-status" role="status">{p.status}</p>
  <button className="upload-submit" onClick={p.onImport} disabled={!p.file||Boolean(rejected)||p.importing}>{p.importing?'Importing…':creating?'Create project and import':'Import raw results'}</button>
 </aside>
}

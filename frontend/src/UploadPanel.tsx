import type {RefObject} from 'react'
import type {Project} from './types'
import {FILE_ACCEPT,defaultLabel,isAcceptedFile} from './plates'
import {UploadChoice} from './UploadChoice'
import {fileKey,type ImportFailure,type UploadMode} from './uploads'

const NEW_PROJECT='__new__'

export type UploadPanelProps={open:boolean;importing:boolean;dragging:boolean;projects:Project[];destination:string;onDestination:(id:string)=>void
 projectName:string;onProjectName:(name:string)=>void;label:string;onLabel:(label:string)=>void
 files:File[];onFiles:(files:File[])=>void;onRemove:(key:string)=>void;mode:UploadMode|null;onMode:(mode:UploadMode)=>void
 failures:ImportFailure[];fileInput:RefObject<HTMLInputElement|null>;status:string;onClose:()=>void;onImport:()=>void}

function size(files:File[]):string {
 const kilobytes=files.reduce((total,file)=>total+file.size,0)/1024
 return kilobytes<1024?`${kilobytes.toFixed(0)} kB`:`${(kilobytes/1024).toFixed(1)} MB`
}

function importLabel(p:Omit<UploadPanelProps,'fileInput'>,undecided:boolean,separate:boolean):string {
 if(p.importing)return 'Importing…'
 if(undecided)return 'Choose how these files belong together'
 const start=p.destination?'Import':'Create project and import'
 return separate?`${start} ${p.files.length} experiments`:p.destination?'Import raw results':start
}

/** Files first, then where they go: one primary action that creates the project when needed. */
export function UploadPanel({fileInput,...p}:UploadPanelProps) {
 const target=p.projects.find(project=>project.id===p.destination)
 const known=new Set(target?.experiments.flatMap(e=>e.parsed_summary?.files??(e.original_filename?[e.original_filename]:[]))??[])
 const duplicates=p.files.filter(file=>known.has(file.name))
 const rejected=p.files.filter(file=>!isAcceptedFile(file.name))
 const failures=p.failures.filter(failure=>p.files.some(file=>fileKey(file)===failure.key))
 const several=p.files.length>1,separate=several&&p.mode==='experiments',undecided=several&&!p.mode
 return <aside className="sidebar" hidden={!p.open} role="dialog" aria-modal="true" aria-label="Upload results">
  <button className="upload-close quiet-button" disabled={p.importing} onClick={p.onClose}>Close upload ×</button>
  <div><p className="eyebrow">New experiment</p><h1>Upload results</h1></div>
  <div className="panel">
   <label className={`drop-zone${p.dragging?' is-dragging':''}`}>
    <strong>{p.dragging?'Drop to add these files':p.files.length?'Add more files':'Drop Ct/Cq exports here'}</strong>
    <span>{p.files.length?`${p.files.length} file${several?'s':''} · ${size(p.files)}. Drop or choose more to add them.`:'Or anywhere in this window. CSV, XLSX, XLSM or XLS; several files at once are fine.'}</span>
    <input ref={fileInput} aria-label="File" type="file" multiple accept={FILE_ACCEPT} disabled={p.importing} onChange={e=>{p.onFiles([...(e.target.files??[])]);e.target.value=''}}/></label>
   {p.files.length>0&&<ul className="upload-files" aria-label="Files to import">{p.files.map(file=><li key={fileKey(file)}>
    <span>{file.name}</span><button type="button" className="upload-remove" aria-label={`Remove ${file.name}`} disabled={p.importing} onClick={()=>p.onRemove(fileKey(file))}>×</button>
   </li>)}</ul>}
   {rejected.length>0&&<p className="upload-duplicate" role="alert">Not supported: {rejected.map(file=>file.name).join(', ')}. Remove {rejected.length===1?'it':'them'} to import the rest: the workbench reads CSV, XLSX, XLSM and XLS exports.</p>}
   {duplicates.length>0&&<p className="upload-duplicate" role="status">{duplicates.length===1?'A file named':'Files named'} {duplicates.map(file=>file.name).join(', ')} {duplicates.length===1?'is':'are'} already in this project. Importing again creates a separate experiment.</p>}
   {several&&<UploadChoice count={p.files.length} mode={p.mode} onChange={p.onMode} disabled={p.importing}/>}
   {!separate&&!undecided&&<label><span>Experiment label</span><input value={p.label} placeholder={p.files.length?defaultLabel(p.files.map(file=>file.name)):'Defaults to the file name'} onChange={e=>p.onLabel(e.target.value)}/></label>}
  </div>
  <div className="panel">
   {p.projects.length>0&&<label><span>Project</span><select aria-label="Destination project" value={p.destination||NEW_PROJECT} disabled={p.importing} onChange={e=>p.onDestination(e.target.value===NEW_PROJECT?'':e.target.value)}>{p.projects.map(project=><option key={project.id} value={project.id}>{project.name}</option>)}<option value={NEW_PROJECT}>New project…</option></select></label>}
   {!p.destination&&<label><span>Project name</span><input value={p.projectName} onChange={e=>p.onProjectName(e.target.value)}/></label>}
  </div>
  <p className="upload-status" role="status">{p.status}</p>
  {failures.length>0&&<ul className="upload-failures" aria-label="Files not imported">{failures.map(failure=><li key={failure.key}><strong>{failure.name}</strong> {failure.error}</li>)}</ul>}
  <button className="upload-submit" onClick={p.onImport} disabled={!p.files.length||rejected.length>0||p.importing||undecided}>{importLabel(p,undecided,separate)}</button>
 </aside>
}

/** Turning chosen or dropped files into imports: one experiment per file, or one experiment with every file as a plate. */
import {defaultLabel,withoutExtension} from './plates'

/** How several files belong together. The app cannot tell, so the scientist chooses before importing. */
export type UploadMode='experiments'|'runs'|'combined'
type FileLike={name:string;size:number;lastModified:number}
export type UploadRequest<T extends FileLike>={name:string;files:T[];combine:boolean}
export type UploadOutcome<T extends FileLike>={request:UploadRequest<T>;error:string|null}
export type ImportFailure={key:string;name:string;error:string}
export type ImportReport={imported:string[];failed:ImportFailure[];message:string}

export const fileKey=(file:FileLike)=>[file.name,file.size,file.lastModified].join('\u0000')

/** Chosen and dropped files join the list; the same file added twice is kept once. */
export function addFiles<T extends FileLike>(current:T[],added:T[]):T[] {
 return added.reduce((files,file)=>files.some(kept=>fileKey(kept)===fileKey(file))?files:[...files,file],current)
}

/** What one import sends. Several files send nothing until the scientist says how they belong together. */
export function uploadRequests<T extends FileLike>(files:T[],mode:UploadMode|null,label:string):UploadRequest<T>[] {
 const named=(group:T[])=>label.trim()||defaultLabel(group.map(file=>file.name)).trim()
 if(files.length===1)return [{name:named(files),files,combine:false}]
 if(files.length===0||!mode)return []
 if(mode==='experiments')return files.map(file=>({name:withoutExtension(file.name).trim(),files:[file],combine:false}))
 return [{name:named(files),files,combine:mode==='combined'}]
}

export function importReport<T extends FileLike>(outcomes:UploadOutcome<T>[]):ImportReport {
 const reason=(name:string,error:string)=>error.startsWith(`${name}: `)?error.slice(name.length+2):error
 const failed=outcomes.flatMap(({request,error})=>error==null?[]:request.files.map(file=>({key:fileKey(file),name:file.name,error:reason(file.name,error)})))
 const imported=outcomes.flatMap(({request,error})=>error==null?[request.name]:[])
 const message=!failed.length?`Imported ${imported.length} experiment${imported.length===1?'':'s'}. Open each one to set up its analysis.`
  :imported.length?`Imported ${imported.length} of ${outcomes.length} files. ${failed.length===1?'The file below was':'The files below were'} not imported; remove ${failed.length===1?'it':'them'} or try again.`
  :`None of the ${outcomes.length} files was imported. Check the reasons below.`
 return {imported,failed,message}
}

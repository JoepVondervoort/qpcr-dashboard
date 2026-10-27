import type {AnalysisResult} from './types'

export type VersionEntry={id:string;created_at:string;result:AnalysisResult}
export type VersionGroup={key:string;created_at:string;run_id:string;method:string;references:string[];baselineCount:number;entries:VersionEntry[]}

/** One calculation (a batch over several target assays) becomes one history row. */
export function groupAnalysisVersions(versions:VersionEntry[]):VersionGroup[] {
 const keyOf=(entry:VersionEntry)=>entry.result.batch_id??entry.id
 const keys=[...new Set(versions.map(keyOf))]
 return keys.map(key=>{
  const entries=versions.filter(entry=>keyOf(entry)===key).sort((a,b)=>a.result.target_assay.localeCompare(b.result.target_assay))
  const first=entries[0].result
  return {key,created_at:entries.map(entry=>entry.created_at).sort().at(-1)!,run_id:first.run_id,method:first.statistics?.method??'legacy',
   references:first.reference_assays,baselineCount:(first.baseline_samples??(first.baseline_sample?[first.baseline_sample]:[])).length,entries}
 }).sort((a,b)=>b.created_at.localeCompare(a.created_at))
}

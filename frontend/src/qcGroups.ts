import type {QualityFlag} from './types'

export type FlagGroup={id:string;kind:QualityFlag['kind'];run_id:string;sample:string;flags:QualityFlag[];assays:string[];unresolved:number;status:'needs_review'|'reviewed'|'mixed'}

/** Flags with one likely cause (same run, sample and kind of concern) are reviewed together. */
export function groupQualityFlags(flags:QualityFlag[]):FlagGroup[] {
 const keyOf=(flag:QualityFlag)=>JSON.stringify([flag.kind,flag.run_id,flag.sample])
 const keys=[...new Set(flags.map(keyOf))]
 return keys.map(id=>{
  const members=flags.filter(flag=>keyOf(flag)===id),unresolved=members.filter(flag=>flag.status==='needs_review').length
  return {id,kind:members[0].kind,run_id:members[0].run_id,sample:members[0].sample,flags:members,
   assays:[...new Set(members.map(flag=>flag.assay))].sort((a,b)=>a.localeCompare(b)),unresolved,
   status:unresolved===members.length?'needs_review':unresolved===0?'reviewed':'mixed'}
 })
}

export function flagGroupTitle(group:FlagGroup):string {
 const what=group.kind==='control_signal'?'signal in':'wide technical range in'
 return `${group.sample} · ${what} ${group.assays.length===1?group.assays[0]:`${group.assays.length} assays`}`
}

/** Samples the workbench numbered because the export named none: giving them their real names. */
export const UNASSIGNED='Unassigned sample'
const NO_TEMPLATE='NTC'
export type PlateSample={name:string;wells:string[]}
export type RenameResult={assignments:Record<string,string>;pairs:[string,string|null][];renamed:number;unused:number;pooled:{name:string;count:number}[]}

const byNumber=(a:string,b:string)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'})

/** Named biological samples in the order a scientist lists them: Sample 1, Sample 2 … Sample 10. */
export function samplesInOrder<T extends PlateSample>(samples:T[],isControl:(name:string)=>boolean):T[] {
 return samples.filter(s=>s.name!==UNASSIGNED&&!isControl(s.name)).sort((a,b)=>byNumber(a.name,b.name))
}

/** The n-th pasted name replaces the n-th sample in every one of its wells; samples past the end of the list keep their names. */
export function renameFromList(samples:PlateSample[],names:string[]):RenameResult {
 const pairs=samples.map((sample,index):[string,string|null]=>[sample.name,names[index]??null])
 const assignments=Object.fromEntries(samples.flatMap((sample,index)=>names[index]===undefined?[]:sample.wells.map(well=>[well,names[index]])))
 const counts=names.slice(0,samples.length).reduce((found,name)=>({...found,[name]:(found[name]??0)+1}),{} as Record<string,number>)
 return {assignments,pairs,renamed:Math.min(samples.length,names.length),unused:Math.max(0,names.length-samples.length),
  pooled:Object.entries(counts).filter(([,count])=>count>1).map(([name,count])=>({name,count}))}
}

/**
 * The samples to rename, in list order. While the workbench's numbers are on the plate, they keep number order and
 * are found by their wells, so a name given earlier (saved) stays in its place and renaming twice gives the same
 * result. Otherwise the saved sample names in order.
 */
export function renameList(numbered:{wells:Record<string,string>}|undefined,saved:PlateSample[],savedName:(well:string)=>string):PlateSample[] {
 if(!numbered)return saved
 const groups=Object.entries(numbered.wells).filter(([,name])=>name!==NO_TEMPLATE)
  .reduce((found,[well,name])=>({...found,[name]:[...(found[name]??[]),well]}),{} as Record<string,string[]>)
 return Object.entries(groups).sort(([a],[b])=>byNumber(a,b)).map(([,wells])=>({name:savedName(wells[0]),wells}))
}

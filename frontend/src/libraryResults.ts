import type {GeneResult,Project} from './types'

export type GeneChange={assay:string;fold_change:number;condition:string;run_name:string;out_of_date:boolean}
export type GeneRow=GeneResult&{project_id:string;project_name:string;experiment_id:string;experiment_name:string}
export type GeneEntry={assay:string;experiments:number;rows:GeneRow[]}
export type GeneColumn={key:string;label:string}
export type GeneLine={key:string;experiment_id:string;project_id:string;experiment_name:string;run_name:string;series:string;out_of_date:boolean;cells:Record<string,GeneRow>}

const effect=(fold:number)=>Math.abs(Math.log2(fold))
const byName=(a:string,b:string)=>a.localeCompare(b,undefined,{sensitivity:'base',numeric:true})||(a<b?-1:a>b?1:0)

/** The strongest non-baseline change per gene, largest first (up- and down-regulation alike). */
export function topChanges(results:GeneResult[],count=3):GeneChange[] {
 const best=new Map<string,GeneResult>()
 for(const row of results){
  if(row.is_baseline||row.fold_change==null||!(row.fold_change>0))continue
  const current=best.get(row.assay)
  if(!current||effect(row.fold_change)>effect(current.fold_change!))best.set(row.assay,row)
 }
 return [...best.values()].sort((a,b)=>effect(b.fold_change!)-effect(a.fold_change!)).slice(0,count)
  .map(row=>({assay:row.assay,fold_change:row.fold_change!,condition:row.condition,run_name:row.run_name,out_of_date:row.out_of_date}))
}

/** Every gene with saved expression results, across all experiments in the workspace. */
export function geneCatalog(projects:Project[]):GeneEntry[] {
 const rows:GeneRow[]=projects.flatMap(project=>project.experiments.flatMap(experiment=>(experiment.library_summary?.gene_results??[]).map(row=>({...row,project_id:project.id,project_name:project.name,experiment_id:experiment.id,experiment_name:experiment.name}))))
 const assays=[...new Set(rows.map(row=>row.assay))].sort(byName)
 return assays.map(assay=>{const members=rows.filter(row=>row.assay===assay);return {assay,experiments:new Set(members.map(row=>row.experiment_id)).size,rows:members}})
}

const columnKey=(row:GeneResult)=>row.timepoint==null?`condition:${row.condition}`:`${row.time_unit}:${row.timepoint}`
const columnLabel=(row:GeneResult)=>row.timepoint==null?row.condition:`${row.time_unit==='hour'?'Hour':'Day'} ${row.timepoint}`

/** One line per experiment/run/series, with conditions aligned into shared time columns. */
export function geneMatrix(rows:GeneRow[]):{columns:GeneColumn[];lines:GeneLine[]} {
 const timed=rows.filter(row=>row.timepoint!=null).sort((a,b)=>a.time_unit.localeCompare(b.time_unit)||a.timepoint!-b.timepoint!)
 const untimed=rows.filter(row=>row.timepoint==null).sort((a,b)=>byName(a.condition,b.condition))
 const columns=[...new Map([...timed,...untimed].map(row=>[columnKey(row),{key:columnKey(row),label:columnLabel(row)}])).values()]
 const lineKey=(row:GeneRow)=>JSON.stringify([row.experiment_id,row.run_id,row.timepoint==null?'':row.series])
 // A second condition at an occupied time in the same series gets its own line rather than overwriting the cell.
 const slotted=rows.reduce<{key:string;slot:number;row:GeneRow}[]>((placed,row)=>{
  const key=lineKey(row),taken=placed.filter(p=>p.key===key&&columnKey(p.row)===columnKey(row)).length
  return [...placed,{key,slot:taken,row}]
 },[])
 const lines=[...new Set(slotted.map(p=>JSON.stringify([p.key,p.slot])))].map(id=>{
  const members=slotted.filter(p=>JSON.stringify([p.key,p.slot])===id).map(p=>p.row),first=members[0],slot=slotted.find(p=>p.row===first)!.slot
  const series=first.timepoint==null?'':first.series
  return {key:id,experiment_id:first.experiment_id,project_id:first.project_id,experiment_name:first.experiment_name,run_name:first.run_name,series:slot?`${series} · ${first.condition}`:series,
   out_of_date:members.some(row=>row.out_of_date),cells:Object.fromEntries(members.map(row=>[columnKey(row),row]))}
 }).sort((a,b)=>byName(a.experiment_name,b.experiment_name)||byName(a.run_name,b.run_name)||byName(a.series,b.series))
 return {columns,lines}
}

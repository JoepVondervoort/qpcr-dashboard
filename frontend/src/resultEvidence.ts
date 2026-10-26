import type {AnalysisResult} from './types'
import type {Observation} from './plotData'
export type Evidence={condition:string;run:string;n:number;controlN:number;p:number|null;status:'significant'|'not_significant'|'not_tested'|'historical';reason:string;partial:boolean;series?:string;category?:string;mark?:string}
export function resultEvidence(result:AnalysisResult,points:Observation[],revision:number):Evidence[] {
 const stats=result.statistics
 if(!stats)return[]
 return stats.comparisons.flatMap(comparison=>{
  const complete=result.samples.filter(row=>row.delta_ct!=null&&row.fold_change!=null&&result.sample_groups?.[row.sample]===comparison.condition)
  const shown=points.filter(point=>point.run===result.run_id&&complete.some(row=>row.sample===point.sample))
  if(!shown.length)return[]
  const partial=new Set(shown.map(point=>point.sample)).size!==complete.length||complete.length!==comparison.n
  const historical=result.context_revision!==revision
  const eligible=stats.method==='welch'&&stats.design_confirmed&&result.experiment_design?.confirmed&&result.experiment_design.design_type==='independent'&&comparison.status==='tested'&&comparison.adjusted_p_value!=null&&Number.isFinite(comparison.adjusted_p_value)
  const p=eligible?comparison.adjusted_p_value:null
  const significant=p!=null&&p<stats.alpha
  const locations=[...new Set(shown.map(point=>JSON.stringify([point.series,point.category])))]
  const marker=eligible&&significant&&!historical&&!partial&&locations.length===1
  return [{condition:comparison.condition,run:result.run_id,n:comparison.n,controlN:comparison.control_n,p,status:historical?'historical':!eligible?'not_tested':significant?'significant':'not_significant',reason:comparison.reason,partial,series:marker?shown[0].series:undefined,category:marker?shown[0].category:undefined,mark:marker?'*':undefined}]
 })
}

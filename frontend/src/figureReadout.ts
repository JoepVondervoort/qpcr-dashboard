import {mean,sampleSD,type Observation} from './plotData'
import {foldSummary,type YScale} from './logScale'

/** spread is the ×/÷ factor (2^SD of log2 values) on a log axis, otherwise the sample SD. */
export type ReadoutRow={series:string;seriesLabel:string;category:string;categoryLabel:string;center:number;spread:number|null;n:number}

const byLabel=(a:string,b:string)=>a.localeCompare(b,undefined,{numeric:true})

/** One summary per series and time point, in the same order as the figure legend and axis. */
export function readoutRows(observations:Observation[],kind:'ct'|'expression',scale:YScale):ReadoutRow[] {
 const series=[...new Map(observations.map(o=>[o.series,o.seriesLabel])).entries()].sort((a,b)=>byLabel(a[1],b[1]))
 const categories=[...new Map(observations.map(o=>[o.category,o])).values()]
  .sort((a,b)=>a.time!=null&&b.time!=null?a.unit.localeCompare(b.unit)||a.time-b.time:byLabel(a.categoryLabel,b.categoryLabel))
 return series.flatMap(([key,label])=>categories.flatMap(category=>{
  const values=observations.filter(o=>o.series===key&&o.category===category.category).map(o=>mean(o.values)).filter((v):v is number=>v!=null)
  if(!values.length)return []
  const base={series:key,seriesLabel:label,category:category.category,categoryLabel:category.categoryLabel,n:values.length}
  if(kind==='expression'&&scale==='log2'){const summary=foldSummary(values,'log2');return summary?[{...base,center:summary.center,spread:summary.sd==null?null:2**summary.sd,n:values.filter(v=>v>0).length}]:[]}
  return [{...base,center:mean(values)!,spread:sampleSD(values)}]
 }))
}

import {useState} from 'react'
import type {AnalysisResult,RawRecord,SampleMetadata} from './types'
import {sampleAnnotation,sampleKey,mean,categoryLabel,seriesLabel} from './plotData'
import {foldColor,groupColumns,legendTicks,sortRows,type GeneOrder} from './heatmapLayout'
export type Availability={run:string;assay:string;result?:AnalysisResult;reason:string;stale:boolean;reference?:boolean}
export type CellContext={run:string;series:string;time:string;label:string;condition:string|null}
type Column={key:string;run:string;runName:string;runLabel:string;series:string;time:number|null;unit:'day'|'hour';condition:string;label:string;groupLabel:string;baseline:boolean}
type Cell={column:Column;value:number|null;n:number;item?:Availability;label:string}

const CT_LIGHT=10,CT_DARK=35
const ctColor=(ct:number|null)=>ct==null?'var(--heat-empty)':`rgba(22,123,128,${(.08+.6*Math.min(1,Math.max(0,(ct-CT_LIGHT)/(CT_DARK-CT_LIGHT)))).toFixed(3)})`
const runLabel=(name:string)=>name.match(/_(\d+)$/)?.[1]?`Run ${name.match(/_(\d+)$/)![1]}`:name

export function OverviewHeatmap({records,annotations,targets,availability,onInspect,raw=false,exclusions={},sampleExclusions={}}:{records:RawRecord[];annotations:Record<string,SampleMetadata>;targets:string[];availability:Availability[];raw?:boolean;exclusions?:Record<string,string>;sampleExclusions?:Record<string,string[]>;onInspect:(assay:string,context?:CellContext)=>void}) {
 const [order,setOrder]=useState<GeneOrder>('assay')
 const meta=(r:Pick<RawRecord,'run_id'|'sample'>)=>sampleAnnotation(annotations,r.run_id,r.sample)
 const includedSamples=new Set(records.map(r=>sampleKey(r.run_id,r.sample)))
 const baselineFor=(run:string)=>new Set(availability.find(a=>a.run===run&&a.result)?.result?.baseline_samples??[])
 const inColumn=(r:RawRecord,c:Pick<Column,'run'|'series'|'time'|'unit'|'condition'>)=>{const m=meta(r);return r.run_id===c.run&&m.series===c.series&&m.timepoint===c.time&&m.time_unit===c.unit&&(c.time!=null||m.condition===c.condition)}
 const columns:Column[]=[...new Map(records.map(r=>{
  const m=meta(r),key=JSON.stringify([r.run_id,m.series,m.time_unit,m.timepoint??m.condition])
  return [key,{key,run:r.run_id,runName:r.run_name,runLabel:runLabel(r.run_name),series:m.series,time:m.timepoint,unit:m.time_unit,condition:m.condition,label:categoryLabel(m),groupLabel:`${seriesLabel(m.series)} · ${runLabel(r.run_name)}`,baseline:false}]
 })).values()].sort((a,b)=>a.series.localeCompare(b.series)||a.run.localeCompare(b.run)||(a.time??0)-(b.time??0))
  .map(column=>{const samples=new Set(records.filter(r=>inColumn(r,column)).map(r=>r.sample)),baseline=baselineFor(column.run);return {...column,baseline:!raw&&samples.size>0&&[...samples].every(sample=>baseline.has(sample))}})

 function cell(assay:string,column:Column):Cell {
  const item=availability.find(v=>v.run===column.run&&v.assay===assay),result=item?.result
  if(raw){
   const rows=records.filter(r=>r.assay===assay&&inColumn(r,column)&&r.ct!=null&&r.status==='detected'&&!r.omit&&!exclusions[r.measurement_id!]&&!sampleExclusions[r.run_id]?.includes(r.sample))
   const means=[...new Set(rows.map(r=>r.sample))].flatMap(sample=>{const avg=mean(rows.filter(r=>r.sample===sample).map(r=>r.ct!));return avg==null?[]:[avg]})
   const value=mean(means)
   return {column,value,n:means.length,item,label:value==null?'No detected Ct':`${value.toFixed(1)} Ct`}
  }
  const values=result?.samples.flatMap(row=>{
   const m=sampleAnnotation(result.sample_instances??result.sample_metadata,column.run,row.sample)
   const match=m.series===column.series&&m.timepoint===column.time&&m.time_unit===column.unit&&(m.timepoint!=null||m.condition===column.condition)
   return includedSamples.has(sampleKey(column.run,row.sample))&&match&&row.fold_change!=null&&row.fold_change>0&&result.sample_groups?.[row.sample]?[row.fold_change]:[]
  })??[]
  // Geometric mean, 2^(mean log2 FC): matches the log2 figures, and a baseline reads exactly 1×.
  const logMean=mean(values.map(Math.log2)),value=logMean==null?null:2**logMean
  const label=item?.reference?'Reference':value!=null?`${Number(value.toPrecision(3))}×`:item?.result?'Missing samples':item?.reason?.startsWith('Not calculated')?'Not calculated':'Unavailable'
  return {column,value,n:values.length,item,label}
 }

 const matrix=targets.map(assay=>{const cells=columns.map(column=>cell(assay,column));const effects=cells.filter(c=>!c.column.baseline&&c.value!=null&&c.value>0).map(c=>Math.abs(Math.log2(c.value!)));return {assay,cells,effect:effects.length?Math.max(...effects):null,empty:!raw&&cells.every(c=>c.value==null&&!c.item?.reference)}})
 const rows=sortRows(matrix.filter(row=>!row.empty),order),unavailable=matrix.filter(row=>row.empty)
 const calculated=availability.filter(a=>a.result)
 const markStale=!raw&&calculated.some(a=>a.stale)&&!calculated.every(a=>a.stale)
 const context=(c:Column):CellContext=>({run:c.run,series:c.series,time:c.time==null?'all':`${c.unit}:${c.time}`,condition:c.time==null?c.condition:null,label:`${c.runName} · ${seriesLabel(c.series)} · ${c.label}`})

 function renderCell(assay:string,c:Cell) {
  const stale=!raw&&Boolean(c.item?.stale)
  const classes=['heat-cell',c.value==null?'empty-cell':'',c.label==='Not calculated'?'uncalculated-cell':'',c.item?.reference&&!raw?'reference-cell':'',c.column.baseline?'baseline-cell':''].filter(Boolean).join(' ')
  const detail=c.value==null?(raw?'No included detected Ct values':c.item?.reason??'No complete sample results'):`${raw?'Mean Ct':'Geometric mean fold change'} ${Number(c.value.toPrecision(4))}; biological n=${c.n}${raw?'':`; log2 = ${Math.log2(c.value).toFixed(2)}`}`
  return <td key={c.column.key}><button className={classes} style={{background:raw?ctColor(c.value):foldColor(c.item?.reference?null:c.value),color:'#15343d'}} onClick={()=>onInspect(assay,context(c.column))}
   aria-label={`${assay} · ${c.column.runName} · ${seriesLabel(c.column.series)} · ${c.column.label}: ${c.label}`}
   title={`${assay} · ${seriesLabel(c.column.series)} · ${c.column.runName} · ${c.column.label}\n${stale?'Out of date: recalculate to update.\n':''}${detail}\nClick to inspect source measurements.`}>
   <strong>{c.label}{stale&&markStale?<sup aria-hidden="true">†</sup>:null}</strong><small>{c.value==null?'':`n=${c.n}`}</small></button></td>
 }

 return <section className="overview-heatmap">
  <div className="section-heading"><div><h3>{raw?'Raw Ct across conditions and time':'Expression across conditions and time'}</h3>
   <p className="dashboard-footnote">{raw?'Mean sample Ct (technical wells averaged first). Gray: no included detected values.':'Geometric mean fold change versus each run’s baseline. Gray: unavailable, not zero.'} Select a cell to inspect it.</p></div>
   <div className="heat-tools">{!raw&&<label className="inline-select">Order<select aria-label="Gene order" value={order} onChange={e=>setOrder(e.target.value as GeneOrder)}><option value="assay">Assay order</option><option value="effect">Largest change first</option></select></label>}
    {raw?<p className="heat-scale" aria-label="Ct color scale"><span>{CT_LIGHT} Ct</span><i style={{background:`linear-gradient(90deg,${ctColor(CT_LIGHT)},${ctColor(CT_DARK)})`}}/><span>{CT_DARK} Ct</span></p>
     :<ol className="heat-scale" aria-label="Fold-change color scale, log2, saturating at 8× either way">{legendTicks().map(tick=><li key={tick.log2}><i style={{background:tick.color}}/>{tick.label}</li>)}</ol>}</div></div>
  {!targets.length||!columns.length?<div className="dashboard-empty">No target assays or biological conditions match these filters. Adjust filters or select assays.</div>:<div className="heatmap-scroll"><table>
   <thead><tr><th rowSpan={2} className="heat-corner">Assay</th>{groupColumns(columns).map((group,i)=><th key={i} colSpan={group.span} className="heat-group">{group.label}</th>)}</tr>
    <tr>{columns.map(c=><th key={c.key} className={c.baseline?'baseline-col':''}><strong>{c.label}</strong>{c.baseline&&<small>baseline</small>}</th>)}</tr></thead>
   <tbody>{rows.map(row=><tr key={row.assay}><th><button className="heat-gene" onClick={()=>onInspect(row.assay)} aria-label={`Inspect ${row.assay}`}>{row.assay}</button></th>{row.cells.map(c=>renderCell(row.assay,c))}</tr>)}</tbody></table></div>}
  {(unavailable.length>0||markStale)&&<p className="heat-footnote">{markStale&&<span>† Out of date: recalculate to update. </span>}{unavailable.length>0&&<>No expression result for {unavailable.map((row,i)=><span key={row.assay}>{i?', ':''}<button className="text-button" aria-label={`Inspect ${row.assay}`} title={row.cells.find(c=>c.item?.reason)?.item?.reason} onClick={()=>onInspect(row.assay)}>{row.assay}</button></span>)}. Select one to see why.</>}</p>}
 </section>
}

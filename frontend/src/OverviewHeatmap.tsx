import {useState} from 'react'
import type {AnalysisResult,RawRecord,SampleMetadata} from './types'
import {sampleAnnotation,sampleKey,mean,categoryLabel,seriesLabel} from './plotData'
import {ctColor,ctDomain,foldColor,foldLabel,groupColumns,legendGradient,legendTicks,sortRows,textOn,typicalN,type GeneOrder} from './heatmapLayout'
export type Availability={run:string;assay:string;result?:AnalysisResult;reason:string;stale:boolean;reference?:boolean}
export type CellContext={run:string;series:string;time:string;label:string;condition:string|null}
type Column={key:string;run:string;runName:string;runLabel:string;series:string;time:number|null;unit:'day'|'hour';condition:string;label:string;groupLabel:string;baseline:boolean}
type Cell={column:Column;value:number|null;n:number;item?:Availability;label:string;display:string}

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
   return {column,value,n:means.length,item,label:value==null?'No detected Ct':`${value.toFixed(1)} Ct`,display:value==null?'—':value.toFixed(1)}
  }
  const values=result?.samples.flatMap(row=>{
   const m=sampleAnnotation(result.sample_instances??result.sample_metadata,column.run,row.sample)
   const match=m.series===column.series&&m.timepoint===column.time&&m.time_unit===column.unit&&(m.timepoint!=null||m.condition===column.condition)
   return includedSamples.has(sampleKey(column.run,row.sample))&&match&&row.fold_change!=null&&row.fold_change>0&&result.sample_groups?.[row.sample]?[row.fold_change]:[]
  })??[]
  // Geometric mean, 2^(mean log2 FC): matches the log2 figures, and a baseline reads exactly 1×.
  const logMean=mean(values.map(Math.log2)),value=logMean==null?null:2**logMean
  const label=item?.reference?'Reference':value!=null?foldLabel(value):item?.result?'Missing samples':item?.reason?.startsWith('Not calculated')?'Not calculated':'Unavailable'
  return {column,value,n:values.length,item,label,display:item?.reference?'ref':value!=null?foldLabel(value):'—'}
 }

 const matrix=targets.map(assay=>{const cells=columns.map(column=>cell(assay,column));const effects=cells.filter(c=>!c.column.baseline&&c.value!=null&&c.value>0).map(c=>Math.abs(Math.log2(c.value!)));return {assay,cells,effect:effects.length?Math.max(...effects):null,empty:!raw&&cells.every(c=>c.value==null&&!c.item?.reference)}})
 const rows=sortRows(matrix.filter(row=>!row.empty),order),unavailable=matrix.filter(row=>row.empty)
 const domain=ctDomain(rows.flatMap(row=>row.cells.flatMap(c=>c.value==null?[]:[c.value])))
 // n is shown once per column (its usual value); cells only flag genes with a different n.
 const columnN=new Map(columns.map(column=>[column.key,typicalN(rows.flatMap(row=>row.cells.filter(c=>c.column.key===column.key&&c.value!=null).map(c=>c.n)))]))
 const calculated=availability.filter(a=>a.result)
 const markStale=!raw&&calculated.some(a=>a.stale)&&!calculated.every(a=>a.stale)
 const context=(c:Column):CellContext=>({run:c.run,series:c.series,time:c.time==null?'all':`${c.unit}:${c.time}`,condition:c.time==null?c.condition:null,label:`${c.runName} · ${seriesLabel(c.series)} · ${c.label}`})

 function renderCell(assay:string,c:Cell) {
  const stale=!raw&&Boolean(c.item?.stale)
  const classes=['heat-cell',c.value==null?'empty-cell':'',c.label==='Not calculated'?'uncalculated-cell':'',c.item?.reference&&!raw?'reference-cell':'',c.column.baseline?'baseline-cell':''].filter(Boolean).join(' ')
  const background=raw?ctColor(c.value,domain):foldColor(c.item?.reference?null:c.value)
  const exceptionalN=c.value!=null&&columnN.get(c.column.key)!==c.n
  const detail=c.value==null?(raw?'No included detected Ct values':c.item?.reason??'No complete sample results'):`${raw?'Mean Ct':'Geometric mean fold change'} ${Number(c.value.toPrecision(4))}; biological n=${c.n}${raw?'':`; log2 = ${Math.log2(c.value).toFixed(2)}`}`
  return <td key={c.column.key}><button className={classes} style={{background,color:textOn(background)}} onClick={()=>onInspect(assay,context(c.column))}
   aria-label={`${assay} · ${c.column.runName} · ${seriesLabel(c.column.series)} · ${c.column.label}: ${c.label}`}
   title={`${assay} · ${seriesLabel(c.column.series)} · ${c.column.runName} · ${c.column.label}\n${stale?'Out of date: recalculate to update.\n':''}${detail}\nClick to inspect source measurements.`}>
   <span className="heat-value">{c.display}{stale&&markStale?<sup aria-hidden="true">†</sup>:null}</span>{exceptionalN&&<small className="heat-n">n={c.n}</small>}</button></td>
 }

 return <section className="overview-heatmap">
  <div className="section-heading"><div><h3>{raw?'Raw Ct across conditions and time':'Expression across conditions and time'}</h3>
   <p className="dashboard-footnote">{raw?'Mean sample Ct, technical wells averaged first. Darker means lower Ct (more template), as on the plate map; — means no included detected value.':'Geometric mean fold change versus each run’s baseline; — means unavailable, not zero.'} Select a cell to inspect it.</p></div>
   <div className="heat-tools">{!raw&&<label className="inline-select">Order<select aria-label="Gene order" value={order} onChange={e=>setOrder(e.target.value as GeneOrder)}><option value="assay">Assay order</option><option value="effect">Largest change first</option></select></label>}
    {raw?<figure className="heat-legend" aria-label={`Ct color scale from ${domain[0]} (dark) to ${domain[1]} (light)`}><figcaption>Mean Ct</figcaption><i style={{background:`linear-gradient(90deg,${ctColor(domain[0],domain)},${ctColor(domain[1],domain)})`}}/><span><span>{domain[0]}</span><span>{domain[1]}</span></span></figure>
     :<figure className="heat-legend fold-legend" aria-label="Fold-change color scale, log2, saturating at 8× either way"><figcaption>Fold change vs baseline</figcaption><i style={{background:legendGradient()}}/><span>{legendTicks().map(tick=><span key={tick.log2}>{tick.label}</span>)}</span></figure>}</div></div>
  {!targets.length||!columns.length?<div className="dashboard-empty">No target assays or biological conditions match these filters. Adjust filters or select assays.</div>:<div className="heatmap-scroll"><table className="heat-table" data-raw={raw}>
   <colgroup><col className="heat-gene-col"/>{columns.map(c=><col key={c.key} className={c.baseline?'heat-baseline-col':undefined}/>)}</colgroup>
   <thead><tr><th rowSpan={2} className="heat-corner">Gene</th>{groupColumns(columns).map((group,i)=><th key={i} colSpan={group.span} className="heat-group">{group.label}</th>)}</tr>
    <tr>{columns.map(c=><th key={c.key} className={c.baseline?'baseline-col':''}><strong>{c.label}</strong><small>{c.baseline?'baseline':columnN.get(c.key)!=null?`n = ${columnN.get(c.key)}`:''}</small></th>)}</tr></thead>
   <tbody>{rows.map(row=><tr key={row.assay}><th><button className="heat-gene" onClick={()=>onInspect(row.assay)} aria-label={`Inspect ${row.assay}`}>{row.assay}</button></th>{row.cells.map(c=>renderCell(row.assay,c))}</tr>)}</tbody></table></div>}
  {(unavailable.length>0||markStale)&&<p className="heat-footnote">{markStale&&<span>† Out of date: recalculate to update. </span>}{unavailable.length>0&&<>No expression result for {unavailable.map((row,i)=><span key={row.assay}>{i?', ':''}<button className="text-button" aria-label={`Inspect ${row.assay}`} title={row.cells.find(c=>c.item?.reason)?.item?.reason} onClick={()=>onInspect(row.assay)}>{row.assay}</button></span>)}. Select one to see why.</>}</p>}
 </section>
}

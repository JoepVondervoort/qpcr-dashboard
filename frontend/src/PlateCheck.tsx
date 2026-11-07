import {usePresentation} from './usePresentation'
import {sampleAnnotation} from './plotData'
import {useMemo,useState} from 'react'
import type {Experiment,SampleMetadata} from './types'
import {sampleCards,summaryCounts,wellRows} from './plateCheck'
import {categoryFills,fillsFor} from './plateColors'
import {PlateCheckPlate} from './PlateCheckPlate'
import {PlateCheckTable} from './PlateCheckTable'
import {PlateCheckCulture} from './PlateCheckCulture'
import './plateCheck.css'

type View='plate'|'table'|'culture'
const VIEWS:[View,string][]=[['plate','Plate'],['table','Table'],['culture','Cell culture']]
const plural=(count:number,word:string)=>`${count} ${word}${count===1?'':'s'}`

/** "Results row 49: missing sample …" for 384 rows reads as one line with a count. */
function groupedWarnings(warnings:string[]):string[] {
 const counts=warnings.reduce((found,warning)=>{const text=warning.replace(/^.*?row \d+:\s*/i,'');return {...found,[text]:(found[text]??0)+1}},{} as Record<string,number>)
 return Object.entries(counts).map(([text,count])=>count>1?`${count} rows: ${text}`:warnings.find(w=>w.endsWith(text))??text)
}

type Props={experiment:Experiment;annotations:Record<string,SampleMetadata>;initialRun:string;onLayout:()=>void;onSamples:()=>void}

/** The start of an experiment: every well's Ct with the sample and condition the workbench gives it, three ways. */
export function PlateCheck({experiment,annotations,initialRun,onLayout,onSamples}:Props) {
 const {presentation}=usePresentation(experiment.id)
 const runs=experiment.parsed_summary?.runs??[]
 const [view,setView]=useState<View>('plate'),[runId,setRunId]=useState(initialRun||runs[0]?.id||'')
 const run=runs.find(r=>r.id===runId)??runs[0]
 const rows=useMemo(()=>wellRows((experiment.raw_records??[]).filter(r=>r.run_id===run?.id),annotations,experiment.measurement_exclusions??{}),[experiment,annotations,run?.id])
 const cards=useMemo(()=>sampleCards(rows),[rows]),counts=useMemo(()=>summaryCounts(rows),[rows])
 const fills=useMemo(()=>{
  const allRows=wellRows(experiment.raw_records??[],annotations,{})
  const conditions=allRows.filter(row=>row.role==='sample').map(row=>({group:row.group,series:sampleAnnotation(annotations,row.run,row.sample).series}))
  return {...categoryFills(conditions,allRows.map(row=>row.assay),presentation),sample:fillsFor(cards.map(card=>card.sample))}
 },[experiment.raw_records,annotations,presentation,cards])
 const numbered=(experiment.auto_layouts??[]).some(auto=>auto.run_id===run?.id)
 const flagged=new Set((experiment.quality?.flags??[]).filter(flag=>flag.status==='needs_review').flatMap(flag=>flag.measurements.map(m=>m.measurement_id??'')))
 const warnings=groupedWarnings(experiment.parsed_summary?.warnings??[])
 const parts=[plural(counts.wells,'well'),plural(counts.genes,'gene'),`${plural(counts.samples,'sample')} in ${plural(counts.conditions,'condition')}`,
  ...(counts.controls?[plural(counts.controls,'control well')]:[]),...(counts.unnamed?[`${plural(counts.unnamed,'well')} without a sample name`]:[])]
 return <section className="plate-check" aria-labelledby="plate-check-heading">
  <div className="plate-check-head">
   <div><p className="eyebrow">Start here</p><h3 id="plate-check-heading">What the workbench read from your plate</h3>
    <p className="check-counts">{parts.join(' · ')}</p>
    <p>Check that every well has the sample and condition you expect.{numbered?' The sample numbers come from the workbench: give the samples their names under Plate layout.':''}{counts.unnamed?' Wells without a sample name are left out of the analysis.':''}</p></div>
   <div className="question-actions"><button className="quiet-button" onClick={onLayout}>Change samples (Plate layout)</button><button className="quiet-button" onClick={onSamples}>Change conditions (Samples &amp; design)</button></div>
  </div>
  <div className="plate-toolbar">
   {runs.length>1&&<div className="segmented" role="group" aria-label="Run">{runs.map(r=><button key={r.id} aria-pressed={r.id===run?.id} onClick={()=>setRunId(r.id)}>{r.name}</button>)}</div>}
   <div className="segmented" role="tablist" aria-label="Plate check view">{VIEWS.map(([value,label])=><button key={value} role="tab" aria-selected={view===value} onClick={()=>setView(value)}>{label}</button>)}</div>
  </div>
  <div role="tabpanel" aria-label={VIEWS.find(([value])=>value===view)?.[1]}>
   {view==='plate'&&<PlateCheckPlate key={run?.id} run={run} rows={rows} fills={fills} flagged={flagged}/>}
   {view==='table'&&<PlateCheckTable key={run?.id} rows={rows} name={experiment.name} fills={fills}/>}
   {view==='culture'&&<PlateCheckCulture cards={cards} rows={rows} fills={fills.group}/>}
  </div>
  {warnings.length>0&&<details className="warnings-panel check-warnings"><summary>Import notes ({warnings.length})</summary><ul>{warnings.map(warning=><li key={warning}>{warning}</li>)}</ul></details>}
 </section>
}

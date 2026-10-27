import {useState} from 'react'
import type {Experiment,RawRecord,SampleMetadata} from './types'
import {sampleAnnotation} from './plotData'

const CT_LOW=15,CT_HIGH=38
/** Lower Ct (more template) is darker, matching how plate maps are usually read. */
const ctShade=(ct:number)=>`rgba(22,95,110,${(.92-.8*Math.min(1,Math.max(0,(ct-CT_LOW)/(CT_HIGH-CT_LOW)))).toFixed(3)})`
type WellState={records:RawRecord[];shown:RawRecord[];ct:number|null;control:boolean;flagged:boolean;omitted:boolean;undetermined:boolean}

export function PlateView({experiment,annotations,initialRun}:{experiment:Experiment;annotations:Record<string,SampleMetadata>;initialRun:string}) {
 const runs=experiment.parsed_summary?.runs??[]
 const [runId,setRunId]=useState(initialRun||runs[0]?.id||''),[assay,setAssay]=useState('all'),[selectedWell,setSelectedWell]=useState<string|null>(null)
 const run=runs.find(r=>r.id===runId)??runs[0]
 const records=(experiment.raw_records??[]).filter(r=>r.run_id===run?.id)
 const assays=[...new Set(records.map(r=>r.assay))].sort((a,b)=>a.localeCompare(b,undefined,{sensitivity:'base'}))
 const flagged=new Set((experiment.quality?.flags??[]).filter(f=>f.status==='needs_review'&&f.run_id===run?.id).flatMap(f=>f.measurements.map(m=>m.measurement_id)))
 const rows=Array.from({length:run?.plate_size===384?16:8},(_,i)=>String.fromCharCode(65+i)),cols=Array.from({length:run?.plate_size===384?24:12},(_,i)=>i+1)
 const byWell=new Map<string,RawRecord[]>();for(const r of records){const key=String(r.well||'').toUpperCase();byWell.set(key,[...(byWell.get(key)??[]),r])}
 function wellState(key:string):WellState {
  const all=byWell.get(key)??[],shown=assay==='all'?all:all.filter(r=>r.assay===assay)
  const detected=shown.filter(r=>r.ct!=null&&r.status==='detected'&&!r.omit)
  return {records:all,shown,ct:detected.length?Math.min(...detected.map(r=>r.ct!)):null,
   control:shown.some(r=>sampleAnnotation(annotations,r.run_id,r.sample).role==='technical_control')&&detected.length>0,
   flagged:shown.some(r=>flagged.has(r.measurement_id)),omitted:shown.some(r=>r.omit||Boolean(experiment.measurement_exclusions?.[r.measurement_id!])),undetermined:shown.length>0&&!detected.length}
 }
 const active=selectedWell?wellState(selectedWell):null
 const warnings=experiment.parsed_summary?.warnings??[]
 return <section className="plate-view">
  <div className="plate-toolbar">{runs.length>1&&<div className="segmented" role="group" aria-label="Plate run">{runs.map(r=><button key={r.id} aria-pressed={r.id===run?.id} onClick={()=>{setRunId(r.id);setSelectedWell(null)}}>{r.name}</button>)}</div>}
   <label className="inline-select">Color by Ct of<select aria-label="Plate assay" value={assay} onChange={e=>setAssay(e.target.value)}><option value="all">Any assay (lowest Ct)</option>{assays.map(a=><option key={a}>{a}</option>)}</select></label>
   <p className="plate-meta">{run?.plate_size??'Unknown'}-well plate · {records.length} measurements · {run?.sheet}, header row {run?.header_row}</p></div>
  <div className="plate-layout"><div className="plate-map" style={{gridTemplateColumns:`1.5em repeat(${cols.length},minmax(0,1fr))`}} data-size={run?.plate_size??96} role="group" aria-label={`Plate map, ${run?.name??''}`}>
   <span/>{cols.map(c=><span key={c} className="plate-axis">{c}</span>)}
   {rows.flatMap(row=>[<span key={row} className="plate-axis">{row}</span>,...cols.map(col=>{const key=`${row}${col}`,state=wellState(key)
    const label=state.shown.length?`${key}: ${state.shown.map(r=>`${r.assay} · ${r.sample} · ${r.ct==null?'undetermined':`Ct ${r.ct.toFixed(2)}`}`).join('; ')}`:`${key}: empty`
    return <button key={key} className="plate-cell" data-empty={!state.shown.length} data-control={state.control} data-flagged={state.flagged} data-omitted={state.omitted} data-undetermined={state.undetermined} aria-pressed={selectedWell===key} title={label} aria-label={label} style={state.ct!=null?{background:ctShade(state.ct)}:undefined} onClick={()=>setSelectedWell(key)}>{run?.plate_size!==384&&state.ct!=null?state.ct.toFixed(1):''}</button>})])}
  </div>
  <aside className="plate-detail">{active&&selectedWell?<><h4>Well {selectedWell}</h4>{active.records.length?<ul>{active.records.map((r,i)=><li key={i}><strong>{r.assay}</strong> · {r.sample}<br/>{r.ct==null?'Undetermined':`Ct ${r.ct.toFixed(3)}`}{r.omit?' · omitted by instrument':''}{experiment.measurement_exclusions?.[r.measurement_id!]?` · excluded: ${experiment.measurement_exclusions[r.measurement_id!]}`:''}{r.reporter?` · ${r.reporter}`:''}</li>)}</ul>:<p>No measurements in this well.</p>}</>:<p>Select a well to see its measurements.</p>}
   <ul className="plate-legend"><li><i className="swatch-ct"/>Detected (darker = lower Ct, {CT_LOW}–{CT_HIGH})</li><li><i className="swatch-control"/>Signal in a technical control</li><li><i className="swatch-flagged"/>Part of an open QC finding</li><li><i className="swatch-undetermined"/>Undetermined</li><li><i className="swatch-omitted"/>Omitted or excluded</li></ul></aside></div>
  <details className="raw-table"><summary>All raw measurements ({records.length})</summary><div className="results-table-wrap"><table><thead><tr><th>Well</th><th>Sample</th><th>Assay</th><th>Ct</th><th>Status</th><th>Instrument omitted</th><th>Source</th></tr></thead>
   <tbody>{records.map((r,i)=><tr key={`${r.row_number}-${i}`}><td>{r.well}</td><td>{r.sample}</td><td>{r.assay}</td><td>{r.ct??'—'}</td><td>{r.status}</td><td>{r.omit?'Yes':'No'}</td><td>{r.sheet}, row {r.row_number}</td></tr>)}</tbody></table></div></details>
  {warnings.length>0&&<section className="warnings-panel"><h4>Import warnings</h4><ul>{warnings.map((warning,i)=><li key={`${warning}-${i}`}>{warning}</li>)}</ul></section>}
 </section>
}

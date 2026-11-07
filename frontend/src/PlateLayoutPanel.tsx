import {useEffect,useState} from 'react'
import type {Experiment,LayoutChange,LayoutCheck,RawRecord,SampleMetadata} from './types'
import {sampleAnnotation} from './plotData'
import {plateNames} from './plates'
import {ROW_LETTERS,looksLikeControl,plateDimensions,wellName,wellsInRectangle} from './plateLayout'
import {PlateLayoutTools} from './PlateLayoutTools'
import {fillsFor as palette} from './plateColors'
import {UNASSIGNED,renameList,samplesInOrder} from './sampleNumbering'
import './plateLayout.css'

const MAX_TECHNICAL_WELLS=4
const plural=(count:number,word:string)=>`${count} ${word}${count===1?'':'s'}`
// Keep both ends: names often differ only in their replicate suffix ("SCN1A sa.1" vs "SCN1A sa.2").
const shortLabel=(name:string)=>name.length<=7?name:`${name.slice(0,3)}…${name.slice(-3)}`

type Props={experiment:Experiment;annotations:Record<string,SampleMetadata>;initialRun:string;onSave:(change:LayoutChange)=>Promise<void>;onDirty?:(dirty:boolean)=>void}
type Sample={name:string;wells:string[];perGene:number;control:boolean}

export function PlateLayoutPanel({experiment,annotations,initialRun,onSave,onDirty}:Props) {
 const runs=experiment.parsed_summary?.runs??[]
 const [runId,setRunId]=useState(initialRun||runs[0]?.id||''),[plateName,setPlateName]=useState('')
 const [selection,setSelection]=useState<string[]>([]),[anchor,setAnchor]=useState(''),[dragging,setDragging]=useState(false)
 const [draft,setDraft]=useState<Record<string,string>>({}),[colorBy,setColorBy]=useState<'sample'|'gene'>('sample'),[status,setStatus]=useState(''),[busy,setBusy]=useState(false)
 const run=runs.find(r=>r.id===runId)??runs[0]
 const plate=(run?.plates??[]).find(p=>p.name===plateName)??run?.plates?.[0]
 const plateKey=plate?.name??null
 const {rows,cols}=plateDimensions(plate?plate.plate_size:run?.plate_size)
 const byWell=new Map<string,RawRecord[]>()
 for(const r of experiment.raw_records??[])if(r.run_id===run?.id&&(r.plate??null)===plateKey)byWell.set(r.well,[...(byWell.get(r.well)??[]),r])
 const saved=(well:string)=>byWell.get(well)?.[0]?.sample??''
 const instrument=(well:string)=>byWell.get(well)?.[0]?.instrument_sample??saved(well)
 const current=(well:string)=>Object.hasOwn(draft,well)?draft[well]||instrument(well):saved(well)
 const isControl=(name:string)=>looksLikeControl(name)||(Boolean(run)&&sampleAnnotation(annotations,run!.id,name).role==='technical_control')
 const changes=Object.fromEntries(Object.entries(draft).filter(([well,name])=>byWell.has(well)&&(name||instrument(well))!==saved(well)))
 const changeCount=Object.keys(changes).length
 const checks=(experiment.layout_checks??[]).filter(c=>c.run_id===run?.id&&(c.plate===plateKey||c.kind==='split_across_plates'))
 const questioned=new Set(checks.map(c=>c.sample))
 // Confirmations that still match their wells; a lapsed one shows as an open question instead.
 // Numbers from the workbench are still on this plate: renaming them is the likely next step.
 const numbering=(experiment.auto_layouts??[]).find(auto=>auto.run_id===run?.id&&auto.plate===plateKey)
 const confirmed=new Set((experiment.layout_confirmations??[]).filter(c=>c.run_id===run?.id&&c.plate===plateKey&&!questioned.has(c.sample)).map(c=>c.sample))
 useEffect(()=>{onDirty?.(changeCount>0)},[changeCount,onDirty])
 // An unsaved draft disappears with the panel, so it must not keep blocking the rest of the setup.
 useEffect(()=>()=>onDirty?.(false),[onDirty])
 useEffect(()=>{const stop=()=>setDragging(false);window.addEventListener('pointerup',stop);return()=>window.removeEventListener('pointerup',stop)},[])

 const samples=summarize(byWell,current,isControl)
 const inOrder=Array.from({length:rows*cols},(_,index)=>wellName(Math.floor(index/cols),index%cols)).filter(well=>byWell.has(well))
 const genesOf=(well:string)=>(byWell.get(well)??[]).map(r=>r.assay).join(', ')
 const fills=palette(inOrder.map(well=>colorBy==='sample'?current(well):genesOf(well)))
 const sampleFills=colorBy==='sample'?fills:palette(inOrder.map(current))
 const measured=(wells:string[])=>wells.filter(well=>byWell.has(well))
 const targets=(selection.length?measured(selection):[...byWell.keys()]).filter(well=>!isControl(current(well))).flatMap(well=>(byWell.get(well)??[]).map(r=>({well,assay:r.assay})))

 function assign(assignments:Record<string,string>,message:string){
  const known=Object.entries(assignments).filter(([well])=>byWell.has(well))
  setDraft(value=>({...value,...Object.fromEntries(known)}))
  const ignored=Object.keys(assignments).length-known.length
  setStatus(`${message}${ignored?` ${plural(ignored,'name')} for empty wells ${ignored===1?'was':'were'} ignored.`:''}`)
 }
 async function save(change:Omit<LayoutChange,'run_id'|'plate'>,done:string){
  if(!run)return
  setBusy(true)
  try{await onSave({run_id:run.id,plate:plateKey,...change});if(change.wells)setDraft({});setStatus(done)}
  catch(error){setStatus(error instanceof Error?error.message:'Could not save the plate layout.')}
  finally{setBusy(false)}
 }
 function pick(well:string,event:{shiftKey:boolean;ctrlKey:boolean;metaKey:boolean}){
  if(event.shiftKey&&anchor)setSelection(wellsInRectangle(anchor,well))
  else if(event.ctrlKey||event.metaKey)setSelection(value=>value.includes(well)?value.filter(w=>w!==well):[...value,well])
  else{setAnchor(well);setSelection([well]);setDragging(true)}
 }
 const extend=(wells:string[],event:{shiftKey:boolean;ctrlKey:boolean;metaKey:boolean})=>setSelection(value=>event.shiftKey||event.ctrlKey||event.metaKey?[...new Set([...value,...wells])]:wells)
 const switching=changeCount>0?'Save or discard the layout changes first.':undefined

 return <section className="plate-layout-panel" aria-label="Plate layout">
  <p className="setup-intro">Tell the workbench which sample is in which well. Fill the wells from a list in pipetting order, paste your plate layout from Excel, or select wells and name them. Changes show on the plate until you save; the instrument’s own names are kept.</p>
  <LayoutChecks checks={checks} busy={busy} onSelect={wells=>setSelection(wells)} onConfirm={sample=>void save({confirm_replicates:[sample]},`“${sample}” recorded as technical replicates of one sample.`)}/>
  <div className="plate-toolbar">
   {runs.length>1&&<div className="segmented" role="group" aria-label="Layout run">{runs.map(r=><button key={r.id} disabled={Boolean(switching)} title={switching} aria-pressed={r.id===run?.id} onClick={()=>{setRunId(r.id);setPlateName('');setSelection([]);setDraft({})}}>{r.name}</button>)}</div>}
   {(run?.plates?.length??0)>1&&<div className="segmented" role="group" aria-label="Layout plate">{plateNames(run!).map(name=><button key={name} disabled={Boolean(switching)} title={switching} aria-pressed={name===plateKey} onClick={()=>{setPlateName(name);setSelection([]);setDraft({})}}>{name}</button>)}</div>}
   <div className="segmented" role="group" aria-label="Color wells by">{(['sample','gene'] as const).map(value=><button key={value} aria-pressed={colorBy===value} onClick={()=>setColorBy(value)}>Color by {value}</button>)}</div>
   <p className="plate-meta">{plural(selection.length,'well')} selected{selection.length>0&&<> · <button className="text-button" onClick={()=>setSelection([])}>Clear</button></>}</p>
  </div>
  <div className="plate-layout">
   <div className="plate-map layout-map" data-size={rows===16?384:96} style={{gridTemplateColumns:`1.6em repeat(${cols},minmax(0,1fr))`}} role="group" aria-label={`Plate layout, ${plateKey??run?.name??''}`} onPointerLeave={()=>setDragging(false)}>
    <button className="plate-axis axis-button" aria-label="Select every well" onClick={()=>setSelection([...byWell.keys()])}>✓</button>
    {Array.from({length:cols},(_,col)=><button key={col} className="plate-axis axis-button" aria-label={`Select column ${col+1}`} onClick={e=>extend(Array.from({length:rows},(_,row)=>wellName(row,col)),e)}>{col+1}</button>)}
    {Array.from({length:rows},(_,row)=>[<button key={row} className="plate-axis axis-button" aria-label={`Select row ${ROW_LETTERS[row]}`} onClick={e=>extend(Array.from({length:cols},(_,col)=>wellName(row,col)),e)}>{ROW_LETTERS[row]}</button>,
     ...Array.from({length:cols},(_,col)=>{const well=wellName(row,col),records=byWell.get(well)??[],name=records.length?current(well):'',genes=genesOf(well)
      const label=records.length?`${well}: ${name===UNASSIGNED?'no sample name':name} · ${genes}${instrument(well)!==name?` (instrument: ${instrument(well)})`:''}`:`${well}: empty`
      const fill=!records.length||name===UNASSIGNED?undefined:fills.get(colorBy==='sample'?name:genes)
      return <button key={well} className="plate-cell layout-cell" data-empty={!records.length} data-unnamed={name===UNASSIGNED} data-draft={Object.hasOwn(changes,well)} data-control={records.length>0&&isControl(name)}
       aria-pressed={selection.includes(well)} aria-label={label} title={label} style={fill?{background:fill}:undefined}
       onPointerDown={e=>{e.preventDefault();pick(well,e)}} onPointerEnter={()=>{if(dragging)setSelection(wellsInRectangle(anchor,well))}} onClick={e=>{if(e.detail===0)pick(well,e)}}>{rows===8&&name&&name!==UNASSIGNED?shortLabel(name):''}</button>})])}
   </div>
   <aside className="plate-detail layout-side">
    <PlateLayoutTools key={numbering?'rename':'fill'} initialTool={numbering?'rename':'list'} samples={renameList(numbering,samplesInOrder(summarize(byWell,saved,isControl),isControl),saved)}
     pending={(numbering?.late??[]).flatMap(group=>group.wells)}
     targets={targets} selectedCount={measured(selection).length} plateSize={plate?plate.plate_size:run?.plate_size} onAssign={assign}
     onName={name=>assign(Object.fromEntries(measured(selection).map(well=>[well,name.trim()])),`Named ${plural(measured(selection).length,'well')} “${name.trim()}”. Save to keep it.`)}
     onRestore={()=>assign(Object.fromEntries(measured(selection).map(well=>[well,''])),'The selected wells will use the instrument’s names again. Save to keep it.')}/>
    <div className="mapping-actions" data-dirty={changeCount>0}>
     <button disabled={busy||!changeCount} onClick={()=>void save({wells:changes},`Plate layout saved: ${plural(changeCount,'well')} renamed. Check conditions and replicates under Samples & design.`)}>{busy?'Saving…':`Save layout${changeCount?` (${plural(changeCount,'well')})`:''}`}</button>
     {changeCount>0&&<button className="quiet-button" onClick={()=>{setDraft({});setStatus('Layout changes discarded.')}}>Discard</button>}
     <p role="status">{status}</p>
    </div>
   </aside>
  </div>
  <SampleSummary samples={samples} fills={sampleFills} confirmed={confirmed} busy={busy} onSelect={setSelection} onRevoke={sample=>void save({revoke_replicates:[sample]},`“${sample}” is no longer recorded as replicates of one sample.`)}/>
 </section>
}

function summarize(byWell:Map<string,RawRecord[]>,current:(well:string)=>string,isControl:(name:string)=>boolean):Sample[] {
 const wells=new Map<string,string[]>(),perGene=new Map<string,number>()
 for(const [well,records] of byWell){
  const name=current(well)
  wells.set(name,[...(wells.get(name)??[]),well])
  for(const r of records)perGene.set(JSON.stringify([name,r.assay]),(perGene.get(JSON.stringify([name,r.assay]))??0)+1)
 }
 const most=(name:string)=>Math.max(...[...perGene].filter(([key])=>JSON.parse(key)[0]===name).map(([,count])=>count))
 return [...wells].map(([name,found])=>({name,wells:found,perGene:most(name),control:isControl(name)}))
}

function LayoutChecks({checks,busy,onSelect,onConfirm}:{checks:LayoutCheck[];busy:boolean;onSelect:(wells:string[])=>void;onConfirm:(sample:string)=>void}) {
 if(!checks.length)return null
 return <ul className="layout-checks">{checks.map(check=><li key={check.id} data-blocking={check.blocking}>
  <span>{check.message}</span>
  {check.wells.length>0&&<button className="text-button" onClick={()=>onSelect(check.wells)}>Select these wells</button>}
  {check.kind==='shared_name'&&check.sample&&<button className="quiet-button" disabled={busy} onClick={()=>onConfirm(check.sample!)}>They are replicates of one sample</button>}
 </li>)}</ul>
}

function SampleSummary({samples,fills,confirmed,busy,onSelect,onRevoke}:{samples:Sample[];fills:Map<string,string>;confirmed:Set<string>;busy:boolean;onSelect:(wells:string[])=>void;onRevoke:(sample:string)=>void}) {
 const named=samples.filter(s=>s.name!==UNASSIGNED)
 const unnamed=samples.find(s=>s.name===UNASSIGNED)
 return <details className="layout-summary" open={named.length>0&&named.length<=48}><summary>Samples on this plate ({named.length}){unnamed?` · ${plural(unnamed.wells.length,'well')} without a name`:''}</summary>
  <ul>{named.map(s=><li key={s.name}><button className="text-button" onClick={()=>onSelect(s.wells)} title="Select its wells"><i style={{background:fills.get(s.name)}}/>{s.name}</button>
   <small>{plural(s.wells.length,'well')}, up to {s.perGene} per gene{s.control?' · control':''}</small>{!s.control&&s.perGene>MAX_TECHNICAL_WELLS&&(confirmed.has(s.name)?<small>confirmed as replicates of one sample · <button className="text-button" disabled={busy} onClick={()=>onRevoke(s.name)}>Undo</button></small>:<small className="layout-warning">more wells than one sample’s replicates</small>)}</li>)}</ul>
 </details>
}

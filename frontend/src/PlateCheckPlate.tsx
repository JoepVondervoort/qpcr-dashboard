import {useState} from 'react'
import type {Run} from './types'
import {ROW_LETTERS,plateDimensions,wellName} from './plateLayout'
import {plateNames} from './plates'
import type {WellRow} from './plateCheck'

export type ColorBy='group'|'sample'|'assay'|'ct'
export type Fills=Record<'group'|'sample'|'assay',Map<string,string>>
const COLOR_BY:[ColorBy,string][]=[['group','Condition'],['sample','Sample'],['assay','Gene'],['ct','Ct']]
const CT_LOW=15,CT_HIGH=38
/** Lower Ct (more template) is darker, as plate maps are usually read. */
const ctAlpha=(ct:number)=>.92-.8*Math.min(1,Math.max(0,(ct-CT_LOW)/(CT_HIGH-CT_LOW)))
const ctShade=(ct:number)=>`rgba(22,95,110,${ctAlpha(ct).toFixed(3)})`
// White text only where the shade is dark enough to read it; late Cts get dark text on a light shade.
const DARK_ALPHA=.55
const lowestCt=(rows:WellRow[])=>[...rows].sort((a,b)=>(a.detected?a.ct!:Infinity)-(b.detected?b.ct!:Infinity))[0]
const ctText=(row:WellRow|undefined)=>!row?'':row.ct==null?'—':row.ct.toFixed(1)
const natural=(a:string,b:string)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'})

function describe(well:string,rows:WellRow[]):string {
 if(!rows.length)return `${well}: empty`
 const who=rows[0].role==='unnamed'?'no sample name':rows[0].role==='control'?`${rows[0].sample} (control)`:`${rows[0].sample} · ${rows[0].group}`
 return `${well}: ${rows.map(r=>`${r.assay} ${r.ct==null?'undetermined':`Ct ${r.ct.toFixed(2)}`}`).join(', ')} · ${who}`
}

/** The plate as the workbench reads it: every well's Ct, coloured by the condition (or sample, gene, Ct) it belongs to. */
export function PlateCheckPlate({run,rows,fills,flagged}:{run:Run|undefined;rows:WellRow[];fills:Fills;flagged:Set<string>}) {
 const plates=run?.plates??[]
 const [plateName,setPlateName]=useState(''),[gene,setGene]=useState('all'),[colorBy,setColorBy]=useState<ColorBy>('group'),[selected,setSelected]=useState<string|null>(null),[showValues,setShowValues]=useState(false)
 const plate=plates.find(p=>p.name===plateName)??plates[0]
 const onPlate=rows.filter(r=>!plate||r.plate===plate.name)
 const {rows:height,cols:width}=plateDimensions(plate?plate.plate_size:run?.plate_size)
 const wells=onPlate.reduce((found,row)=>found.set(row.well,[...(found.get(row.well)??[]),row]),new Map<string,WellRow[]>())
 const genes=[...new Set(onPlate.map(r=>r.assay))].sort(natural)
 const shown=(well:string)=>(wells.get(well)??[]).filter(r=>gene==='all'||r.assay===gene)
 const valueOf=(row:WellRow)=>colorBy==='group'?row.group:colorBy==='sample'?row.sample:row.assay
 const fillOf=(row:WellRow|undefined)=>!row?undefined:colorBy==='ct'?(row.detected&&row.ct!=null?ctShade(row.ct):undefined):colorBy!=='assay'&&row.role!=='sample'?undefined:fills[colorBy].get(valueOf(row))
 const chosen=selected?wells.get(selected)??[]:[]
 const sample=chosen.find(r=>r.role==='sample')
 const related=new Set(sample?onPlate.filter(r=>r.role==='sample'&&r.sample===sample.sample).map(r=>r.well):[])
 const legend=colorBy==='ct'?[]:[...new Set(onPlate.filter(r=>colorBy==='assay'||r.role==='sample').map(valueOf))].sort(natural)
 return <div className="plate-check-plate">
  <div className="plate-toolbar">
   {plates.length>1&&<div className="segmented" role="group" aria-label="Plate in combined run">{plateNames(run!).map(name=><button key={name} aria-pressed={name===plate?.name} onClick={()=>{setPlateName(name);setSelected(null);setGene('all')}}>{name}</button>)}</div>}
   <div className="segmented" role="group" aria-label="Color wells by">{COLOR_BY.map(([value,label])=><button key={value} aria-pressed={colorBy===value} onClick={()=>setColorBy(value)}>{label}</button>)}</div>
   <label className="inline-select">Gene<select aria-label="Gene on the plate" value={gene} onChange={e=>setGene(e.target.value)}><option value="all">All genes</option>{genes.map(g=><option key={g}>{g}</option>)}</select></label>
   <label className="inline-check plate-values-toggle"><input type="checkbox" checked={showValues} onChange={e=>setShowValues(e.target.checked)}/>Show Ct values</label>
  </div>
  <div className="plate-layout">
   <div className="plate-map check-map" data-size={height===16?384:96} data-color={colorBy} style={{gridTemplateColumns:`1.5em repeat(${width},minmax(0,1fr))`}} role="group" aria-label={`Plate check, ${plate?.name??run?.name??''}`}>
    <span/>{Array.from({length:width},(_,col)=><span key={col} className="plate-axis">{col+1}</span>)}
    {Array.from({length:height},(_,row)=>[<span key={row} className="plate-axis">{ROW_LETTERS[row]}</span>,...Array.from({length:width},(_,col)=>{
     const well=wellName(row,col),here=shown(well),first=lowestCt(here),hidden=!here.length&&(wells.get(well)??[]).length>0
     const label=hidden?`${well}: ${gene} not measured in this well`:describe(well,here)
     return <button key={well} className="plate-cell check-cell" data-empty={!here.length&&!hidden} data-filtered={hidden} data-role={first?.role} data-excluded={here.some(r=>Boolean(r.excluded))} data-flagged={here.some(r=>flagged.has(r.id))} data-related={related.has(well)&&well!==selected} data-dark={colorBy==='ct'&&Boolean(first?.detected)&&ctAlpha(first!.ct!)>=DARK_ALPHA}
      aria-pressed={selected===well} aria-label={label} title={label} style={{background:fillOf(first)}} onClick={()=>setSelected(well)}>{showValues||colorBy==='ct'?ctText(first):first?<span className="well-presence" aria-hidden="true"/>:null}</button>})])}
   </div>
   <aside className="plate-detail">
    {selected?<WellDetail well={selected} rows={chosen} sampleRows={sample?onPlate.filter(r=>r.role==='sample'&&r.sample===sample.sample):[]}/>:<p>Select a well to see its Ct, its sample and that sample's condition. The sample's other wells are outlined.</p>}
    <ul className="plate-legend check-legend">{legend.map(value=><li key={value}><i style={{background:fills[colorBy as Exclude<ColorBy,'ct'>].get(value)}}/>{value}</li>)}
     {colorBy==='ct'&&<li><i className="swatch-ct"/>Darker is a lower Ct (more template), {CT_LOW}–{CT_HIGH}</li>}
     {gene==='all'&&[...wells.values()].some(found=>new Set(found.map(r=>r.assay)).size>1)&&<li>Wells with several genes show the lowest Ct; select one for all.</li>}
     <li><i className="swatch-check-control"/>Control</li><li><i className="swatch-flagged"/>Part of an open QC finding</li><li><i className="swatch-unnamed"/>No sample name: left out</li><li><i className="swatch-omitted"/>Omitted or excluded</li></ul>
   </aside>
  </div>
 </div>
}

function WellDetail({well,rows,sampleRows}:{well:string;rows:WellRow[];sampleRows:WellRow[]}) {
 if(!rows.length)return <><h4>Well {well}</h4><p>No measurements in this well.</p></>
 const first=rows[0]
 const facts:[string,string][]=first.role==='sample'?[['Sample',first.sample],['Condition',first.group],['Replicate',first.replicate],['Cell line',first.cellLine],['Confluency',first.confluency],['Name in the export',first.instrument??'']]:
  [['Sample',first.role==='control'?`${first.sample} (control)`:'No sample name: left out of the analysis'],['Name in the export',first.instrument??'']]
 const others=[...new Set(sampleRows.map(r=>r.assay))].sort(natural).map(assay=>[assay,sampleRows.filter(r=>r.assay===assay).map(r=>`${r.well} ${r.ct==null?'—':r.ct.toFixed(1)}`).join(', ')])
 return <>
  <h4>Well {well}</h4>
  <ul>{rows.map(r=><li key={r.id}><strong>{r.assay}</strong> · {r.ct==null?'undetermined':`Ct ${r.ct.toFixed(2)}`}{r.excluded?` · ${r.excluded}`:''}</li>)}</ul>
  <dl className="check-facts">{facts.filter(([,value])=>value).map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
  {others.length>0&&<><p className="check-subhead">All wells of {first.sample}</p><ul>{others.map(([assay,list])=><li key={assay}><strong>{assay}</strong> {list}</li>)}</ul></>}
 </>
}

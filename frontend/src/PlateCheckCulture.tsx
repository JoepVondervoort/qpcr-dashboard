import {useState,type CSSProperties} from 'react'
import {CULTURE_VESSELS,CULTURE_DEFAULT_KEY,cultureVessel,culturePages,type CultureVesselId} from './cultureVessels'
import {byCondition,type SampleCard,type WellRow} from './plateCheck'

const natural=(a:string,b:string)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'})
const plural=(count:number,word:string)=>`${count} ${word}${count===1?'':word==='dish'?'es':'s'}`

/** Wells grouped by name and gene, for controls and wells without a sample name. */
function wellList(rows:WellRow[]):string[] {
 const groups=rows.reduce((found,row)=>{const key=`${row.role==='unnamed'?'':`${row.sample} · `}${row.assay}`;return {...found,[key]:[...(found[key]??[]),row]}},{} as Record<string,WellRow[]>)
 return Object.entries(groups).sort(([a],[b])=>natural(a,b)).map(([key,found])=>
  `${key}: ${found.map(r=>`${r.well}${r.ct==null?'':` (Ct ${r.ct.toFixed(1)})`}`).join(', ')}`)
}

function Card({card,fill}:{card:SampleCard;fill:string|undefined}) {
 const plates=new Set(card.genes.map(gene=>gene.plate)).size>1
 const facts:[string,string][]=[['Condition',card.group],['Replicate',card.replicate],['Cell line',card.cellLine],['Confluency',card.confluency],['Time',card.time],['In the export',card.instrument??'']]
 return <article className="culture-card" style={{borderTopColor:fill}} aria-label={`${card.sample}, ${card.group}`}>
  <h5>{card.sample}</h5>
  <dl className="check-facts">{facts.filter(([,value])=>value).map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
  <table className="culture-wells"><thead><tr><th scope="col">Gene</th><th scope="col">qPCR wells (Ct)</th><th scope="col">Mean</th></tr></thead>
   <tbody>{card.genes.map(gene=><tr key={`${gene.assay}:${gene.plate??''}`}><th scope="row">{gene.assay}{plates&&gene.plate?<small> · {gene.plate}</small>:null}</th>
    <td>{gene.wells.map((w,index)=><span key={`${w.plate??''}:${w.well}`}>{index>0?', ':''}<span data-used={w.used}>{w.well} {w.ct==null?'—':w.ct.toFixed(1)}</span></span>)}</td>
    <td className="numeric">{gene.mean==null?'—':gene.mean.toFixed(2)}</td></tr>)}</tbody></table>
 </article>
}

/** Culture positions illustrate the samples in display order; qPCR addresses remain in the detail card. */
function CultureSamples({cards,fills,vesselId}:{cards:SampleCard[];fills:Map<string,string>;vesselId:CultureVesselId}) {
 const vessel=cultureVessel(vesselId),capacity=vessel.rows*vessel.columns,isDish=capacity===1
 const [selectedKey,setSelectedKey]=useState(cards[0]?.key??'')
 const selected=cards.find(card=>card.key===selectedKey)??cards[0]
 const pages=culturePages(byCondition(cards).flatMap(group=>group.cards),capacity)
 return <section className="culture-group" aria-label="Biological samples in culture vessels">
  <h4>Culture overview<small>{plural(cards.length,'sample')} · {plural(pages.length,isDish?'dish':'plate')} · {vessel.label}</small></h4>
  <div className="culture-condition-legend" aria-label="Condition colors">{byCondition(cards).map(group=><span key={group.group}><i style={{background:fills.get(group.group)}}/>{group.group} <small>{plural(group.cards.length,'sample')}</small></span>)}</div>
  <div className="culture-vessel-layout">
   <div className="culture-vessels" data-dishes={isDish}>
    {pages.map((page,pageIndex)=><div className="culture-vessel-unit" key={pageIndex}>
     <div className="culture-vessel-label"><span>Culture {isDish?'dish':'plate'} {pageIndex+1}</span><small>{page.length} / {capacity} {isDish?'sample':'wells assigned'}</small></div>
     <div className="culture-vessel-scroll"><div className="culture-vessel" data-dish={isDish} style={{'--culture-columns':vessel.columns} as CSSProperties}>
      {Array.from({length:capacity},(_,index)=>{
       const card=page[index],position=`${String.fromCharCode(65+Math.floor(index/vessel.columns))}${index%vessel.columns+1}`
       return <button type="button" className="culture-well" key={position} style={{'--culture-fill':card?fills.get(card.group)??'#d6e9e4':undefined} as CSSProperties} disabled={!card} aria-pressed={Boolean(card&&card.key===selected?.key)}
        aria-label={card?`${isDish?'Dish':position}: ${card.sample}, ${card.group}, ${card.cellLine||'cell line unspecified'}${card.time?`, ${card.time}`:''}`:`${position}: unassigned display position`}
        onClick={()=>card&&setSelectedKey(card.key)}>
        <span className="culture-well-position">{isDish?'Culture':position}</span>
        <span className="culture-well-liquid" aria-hidden="true"><i/><i/><i/><i/><i/></span>
        <span className="culture-well-name">{card?.sample??'—'}</span>
        {card&&<span className="culture-well-condition">{card.group}</span>}
        {card?.cellLine&&<span className="culture-well-line">{card.cellLine}</span>}
       </button>
      })}
     </div></div>
    </div>)}
   </div>
   {selected&&<div className="culture-selected"><p className="eyebrow">Selected sample</p><Card card={selected} fill={fills.get(selected.group)}/></div>}
  </div>
 </section>
}

/** Biological samples shown in a selectable culture vessel, with their measured qPCR wells alongside. */
export function PlateCheckCulture({cards,rows,fills}:{cards:SampleCard[];rows:WellRow[];fills:Map<string,string>}) {
 const [savedDefault,setSavedDefault]=useState<CultureVesselId>(()=>{try{return cultureVessel(localStorage.getItem(CULTURE_DEFAULT_KEY)).id}catch{return '12'}})
 const [vesselId,setVesselId]=useState<CultureVesselId>(savedDefault),[notice,setNotice]=useState('')
 const controls=rows.filter(row=>row.role==='control'),unnamed=rows.filter(row=>row.role==='unnamed')
 function saveDefault() {
  try{localStorage.setItem(CULTURE_DEFAULT_KEY,vesselId);setSavedDefault(vesselId);setNotice(`${cultureVessel(vesselId).label} saved as your default in this browser.`)}
  catch{setNotice('Browser storage is unavailable. You can still change the vessel for this view.')}
 }
 return <div className="culture-view">
  <div className="culture-view-tools">
   <label>Culture vessel<select aria-label="Culture vessel" value={vesselId} onChange={event=>{setVesselId(cultureVessel(event.target.value).id);setNotice('')}}>{CULTURE_VESSELS.map(vessel=><option key={vessel.id} value={vessel.id}>{vessel.label}</option>)}</select></label>
   <button type="button" className="quiet-button" disabled={vesselId===savedDefault} onClick={saveDefault}>Use as my default</button>
   <span className="helper-text">Default: {cultureVessel(savedDefault).label}</span>
  </div>
  {notice&&<p className="helper-text" role="status">{notice}</p>}
  <p className="helper-text">Each filled well or dish represents one biological sample. Select a sample to inspect its cell line, time point and qPCR measurements. Conditions share the same culture plate, distinguished by color and label. This is a sample overview, separate from the qPCR instrument plates; culture positions are illustrative because the original positions are not recorded. Cell drawings are decorative. Struck-through measurements are left out of the mean.</p>
  {cards.length>0&&<CultureSamples cards={cards} fills={fills} vesselId={vesselId}/>}
  {!cards.length&&<p>No well has a sample name yet. Name the samples under Plate layout.</p>}
  {controls.length>0&&<section className="culture-group culture-controls" aria-label="Controls"><h4>Controls<small>{plural(new Set(controls.map(r=>r.well)).size,'well')}</small></h4>
   <ul>{wellList(controls).map(line=><li key={line}>{line}</li>)}</ul></section>}
  {unnamed.length>0&&<section className="culture-group culture-unnamed" aria-label="Wells without a sample name"><h4>Without a sample name<small>left out of the analysis</small></h4>
   <ul>{wellList(unnamed).map(line=><li key={line}>{line}</li>)}</ul></section>}
 </div>
}

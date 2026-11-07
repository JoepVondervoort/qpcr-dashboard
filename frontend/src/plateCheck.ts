/**
 * What the workbench read from the export, well by well: the Ct, the sample the well belongs to and that sample's
 * condition, so the scientist can see at a glance whether the workbench reads the plate as they meant it.
 */
import type {RawRecord,SampleMetadata} from './types'
import {analysisGroup,mean,sampleAnnotation,sampleFactors,sampleKey} from './plotData'
import {UNASSIGNED} from './sampleNumbering'

export type WellRole='sample'|'control'|'unnamed'
export const NO_NAME='no name'
export type WellRow={id:string;run:string;runName:string;plate:string|null;well:string;assay:string;ct:number|null;detected:boolean;excluded:string
 sample:string;instrument:string|null;group:string;condition:string;time:string;replicate:string;cellLine:string;confluency:string;role:WellRole}
export type SampleWell={well:string;plate:string|null;ct:number|null;used:boolean}
/** A sample's wells for one gene on one plate: wells on different plates are never pooled. */
export type SampleGene={assay:string;plate:string|null;wells:SampleWell[];mean:number|null}
export type SampleCard={key:string;run:string;runName:string;sample:string;instrument:string|null;group:string;condition:string;time:string
 replicate:string;cellLine:string;confluency:string;genes:SampleGene[]}

const natural=(a:string,b:string)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'})
const wellOrder=(well:string)=>{const match=/^([A-Z])(\d+)$/i.exec(well);return match?[match[1].toUpperCase().charCodeAt(0),Number(match[2])]:[999,0]}
const byWell=(a:string,b:string)=>{const [ra,ca]=wellOrder(a),[rb,cb]=wellOrder(b);return ra-rb||ca-cb}
export const usable=(row:WellRow)=>row.detected&&!row.excluded

function roleOf(record:RawRecord,metadata:SampleMetadata):WellRole {
 if(record.sample===UNASSIGNED)return 'unnamed'
 return metadata.role==='technical_control'?'control':'sample'
}

/** One row per well and gene, in plate order. */
export function wellRows(records:RawRecord[],annotations:Record<string,SampleMetadata>,exclusions:Record<string,string>):WellRow[] {
 return records.map(record=>{
  const metadata=sampleAnnotation(annotations,record.run_id,record.sample),role=roleOf(record,metadata),factors=sampleFactors(metadata)
  return {id:record.measurement_id??`${record.run_id}:${record.plate??''}:${record.well}:${record.assay}`,run:record.run_id,runName:record.run_name,plate:record.plate??null,
   well:record.well,assay:record.assay,ct:record.ct,detected:record.status==='detected'&&record.ct!=null,
   excluded:record.omit?'Omitted by the instrument':exclusions[record.measurement_id??'']??'',
   // A well the workbench or the scientist named had no name in the export at all: say so in words.
   sample:record.sample,instrument:record.instrument_sample===UNASSIGNED?NO_NAME:record.instrument_sample??null,group:role==='sample'?analysisGroup(metadata):role==='control'?'Control':'',
   condition:role==='sample'?metadata.condition:'',time:role==='sample'&&metadata.timepoint!=null?`${metadata.time_unit==='hour'?'Hour':'Day'} ${metadata.timepoint}`:'',
   replicate:role==='sample'?metadata.replicate:'',cellLine:role==='sample'?factors.cell_line:'',confluency:role==='sample'?factors.confluency:'',role}
 }).sort((a,b)=>natural(a.runName,b.runName)||natural(a.plate??'',b.plate??'')||byWell(a.well,b.well)||natural(a.assay,b.assay))
}

/** Each biological sample with its wells per gene; the mean leaves out excluded and undetermined wells. */
export function sampleCards(rows:WellRow[]):SampleCard[] {
 const samples=rows.filter(row=>row.role==='sample').reduce((found,row)=>{const key=sampleKey(row.run,row.sample);return {...found,[key]:[...(found[key]??[]),row]}},{} as Record<string,WellRow[]>)
 return Object.entries(samples).map(([key,wells]):SampleCard=>{
  const first=wells[0]
  const pairs=[...new Map(wells.map(w=>[JSON.stringify([w.assay,w.plate]),{assay:w.assay,plate:w.plate}])).values()].sort((a,b)=>natural(a.assay,b.assay)||natural(a.plate??'',b.plate??''))
  const genes=pairs.map(({assay,plate})=>{const found=wells.filter(w=>w.assay===assay&&w.plate===plate)
   return {assay,plate,wells:found.map(w=>({well:w.well,plate:w.plate,ct:w.ct,used:usable(w)})),mean:mean(found.filter(usable).map(w=>w.ct!))}})
  return {key,run:first.run,runName:first.runName,sample:first.sample,instrument:first.instrument,group:first.group,condition:first.condition,time:first.time,
   replicate:first.replicate,cellLine:first.cellLine,confluency:first.confluency,genes}
 }).sort((a,b)=>natural(a.group,b.group)||natural(a.replicate,b.replicate)||natural(a.sample,b.sample))
}

export function byCondition(cards:SampleCard[]):{group:string;cards:SampleCard[]}[] {
 return [...new Set(cards.map(card=>card.group))].sort(natural).map(group=>({group,cards:cards.filter(card=>card.group===group)}))
}

/** Free-text filter over the columns a scientist searches by. */
export function matchesFilter(row:WellRow,text:string):boolean {
 const needle=text.trim().toLowerCase()
 return !needle||[row.well,row.sample,row.instrument??'',row.assay,row.group,row.cellLine,row.runName,row.plate??''].some(value=>value.toLowerCase().includes(needle))
}

export function summaryCounts(rows:WellRow[]) {
 const wells=(role?:WellRole)=>new Set(rows.filter(row=>!role||row.role===role).map(row=>`${row.run}:${row.plate??''}:${row.well}`)).size
 const samples=rows.filter(row=>row.role==='sample')
 return {wells:wells(),genes:new Set(rows.map(row=>row.assay)).size,samples:new Set(samples.map(row=>sampleKey(row.run,row.sample))).size,
  conditions:new Set(samples.map(row=>row.group)).size,controls:wells('control'),unnamed:wells('unnamed')}
}

// Text starting with = + - @ would run as a formula in a spreadsheet: an apostrophe keeps it text.
const text=(value:unknown)=>value==null?'':typeof value==='number'?String(Number(value.toFixed(4))):String(value).replace(/^[=+\-@\t\r]/,match=>`'${match}`)
const cell=(value:unknown)=>`"${text(value).replace(/"/g,'""')}"`

export function rowsCsv(rows:WellRow[]):string {
 const header=['Run','Plate','Well','Gene','Ct','Sample','Name in export','Condition','Time','Replicate','Cell line','Confluency','Role','Excluded']
 const role={sample:'Sample',control:'Control',unnamed:'No sample name'}
 return [header,...rows.map(row=>[row.runName,row.plate,row.well,row.assay,row.ct,row.role==='unnamed'?'':row.sample,row.instrument??row.sample,row.group,row.time,row.replicate,row.cellLine,row.confluency,role[row.role],row.excluded])]
  .map(cells=>cells.map(cell).join(',')).join('\r\n')
}

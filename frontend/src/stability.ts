/**
 * Reference-gene stability from raw Ct: which candidate genes stay put across samples and conditions.
 *
 * Ct differences are read as log2 ratios (100% efficiency). geNorm M (Vandesompele et al. 2002) is the mean
 * SD of a gene's pairwise Ct differences with every other candidate; the least stable gene is dropped and M
 * recomputed until a pair remains. Pairwise variation V n/n+1 is the SD of the change in the normalization
 * factor when the next most stable gene is added; below 0.15 the extra gene adds little.
 */
import type {RawRecord} from './types'
import {mean,sampleSD} from './plotData'
import {isReferenceGene} from './referenceGenes'

/** M below 0.5 is typical of stable genes in similar samples, below 1 in mixed tissues or cell types (Hellemans et al. 2007). */
export const GENORM_HOMOGENEOUS=0.5
export const GENORM_HETEROGENEOUS=1
export const PAIRWISE_CUTOFF=0.15
/** A raw-Ct SD above one cycle is inconsistent in BestKeeper (Pfaffl et al. 2004). */
export const SD_CUTOFF=1
const MIN_SAMPLES=3

export type StabilitySample={key:string;run:string;sample:string;group:string;ct:Record<string,number>;wells:Record<string,{used:number;total:number}>}
export type ConditionMean={group:string;n:number;mean:number}
export type GeneStability={assay:string;n:number;mean:number|null;sd:number|null;min:number|null;max:number|null;conditions:ConditionMean[];
 /** Highest minus lowest condition mean, in cycles. */
 shift:number|null
 /**
  * The same after subtracting each sample's mean Ct of the most stable pair (for a gene of that pair, the other
  * one): the part RNA input does not explain. Comparing with the most stable genes, not all the others, keeps
  * one moving gene from making the stable ones look unstable.
  */
 relativeShift:number|null
 m:number|null;rank:number|null}
export type PairwiseVariation={n:number;v:number}
export type StabilityResult={genes:GeneStability[];order:string[];pairwise:PairwiseVariation[];recommended:number|null;complete:StabilitySample[];incomplete:StabilitySample[]}
type Row=Record<string,number>

const byName=(a:string,b:string)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'})

/** One entry per sample: the mean Ct of its usable wells for each gene, and how many wells that was. */
export function sampleCts(records:RawRecord[],{included,groupOf}:{included:(record:RawRecord)=>boolean;groupOf:(record:RawRecord)=>string}):StabilitySample[] {
 const bySample=new Map<string,RawRecord[]>()
 for(const record of records){const key=JSON.stringify([record.run_id,record.sample]);bySample.set(key,[...(bySample.get(key)??[]),record])}
 return [...bySample.entries()].map(([key,wells])=>{
  const assays=[...new Set(wells.map(well=>well.assay))]
  const usable=(assay:string)=>wells.filter(well=>well.assay===assay&&included(well)&&well.ct!=null&&Number.isFinite(well.ct)).map(well=>well.ct!)
  const ct=Object.fromEntries(assays.flatMap(assay=>{const values=usable(assay);return values.length?[[assay,mean(values)!]]:[]}))
  return {key,run:wells[0].run_id,sample:wells[0].sample,group:groupOf(wells[0]),ct,
   wells:Object.fromEntries(assays.map(assay=>[assay,{used:usable(assay).length,total:wells.filter(well=>well.assay===assay).length}]))}
 })
}

const pairSpread=(rows:Row[],a:string,b:string)=>sampleSD(rows.map(row=>row[a]-row[b]))??0

export function genormM(rows:Row[],genes:string[]):Row {
 return Object.fromEntries(genes.map(gene=>[gene,mean(genes.filter(other=>other!==gene).map(other=>pairSpread(rows,gene,other)))??0]))
}

/** Drop the least stable gene until two remain. Returns genes most stable first, with M when each was ranked. */
export function genormRanking(rows:Row[],genes:string[]):{order:string[];m:Row} {
 const full=genormM(rows,genes)
 function step(remaining:string[],dropped:{gene:string;m:number}[]):{order:string[];m:Row} {
  if(remaining.length<=2){
   const pair=genormM(rows,remaining)
   const best=[...remaining].sort((a,b)=>full[a]-full[b]||byName(a,b))
   return {order:[...best,...dropped.map(entry=>entry.gene).reverse()],m:{...pair,...Object.fromEntries(dropped.map(entry=>[entry.gene,entry.m]))}}
  }
  const m=genormM(rows,remaining)
  const worst=[...remaining].sort((a,b)=>m[b]-m[a]||byName(a,b))[0]
  return step(remaining.filter(gene=>gene!==worst),[...dropped,{gene:worst,m:m[worst]}])
 }
 return step(genes,[])
}

/** V n/n+1 for n = 2 … genes − 1, along the stability order. */
export function pairwiseVariation(rows:Row[],order:string[]):PairwiseVariation[] {
 const factor=(row:Row,n:number)=>mean(order.slice(0,n).map(gene=>row[gene]))!
 return order.slice(2).map((_,index)=>{const n=index+2;return {n,v:sampleSD(rows.map(row=>factor(row,n)-factor(row,n+1)))??0}})
}

function conditionMeans(samples:{group:string;value:number}[]):ConditionMean[] {
 const groups=[...new Set(samples.map(sample=>sample.group))].sort(byName)
 return groups.map(group=>{const values=samples.filter(sample=>sample.group===group).map(sample=>sample.value);return {group,n:values.length,mean:mean(values)!}})
}
const range=(conditions:ConditionMean[])=>conditions.length>1?Math.max(...conditions.map(c=>c.mean))-Math.min(...conditions.map(c=>c.mean)):null

export function stabilityAnalysis(samples:StabilitySample[],genes:string[]):StabilityResult {
 const complete=samples.filter(sample=>genes.every(gene=>sample.ct[gene]!=null))
 const incomplete=samples.filter(sample=>!complete.includes(sample)&&genes.some(gene=>sample.ct[gene]!=null))
 const rows=complete.map(sample=>sample.ct)
 const rankable=genes.length>=2&&complete.length>=MIN_SAMPLES
 const ranking=rankable?genormRanking(rows,genes):{order:[...genes],m:{} as Row}
 const pairwise=rankable?pairwiseVariation(rows,ranking.order):[]
 const recommended=pairwise.find(entry=>entry.v<PAIRWISE_CUTOFF)?.n??null
 const describe=(gene:string,position:number):GeneStability=>{
  const measured=samples.filter(sample=>sample.ct[gene]!=null),values=measured.map(sample=>sample.ct[gene])
  const conditions=conditionMeans(measured.map(sample=>({group:sample.group,value:sample.ct[gene]})))
  const anchors=rankable?ranking.order.slice(0,2).filter(other=>other!==gene):[]
  const relative=anchors.length?conditionMeans(complete.map(sample=>({group:sample.group,value:sample.ct[gene]-mean(anchors.map(other=>sample.ct[other]))!}))):[]
  return {assay:gene,n:values.length,mean:mean(values),sd:sampleSD(values),min:values.length?Math.min(...values):null,max:values.length?Math.max(...values):null,
   conditions,shift:range(conditions),relativeShift:range(relative),m:ranking.m[gene]??null,
   // geNorm cannot order the final pair: both share rank 1.
   rank:rankable?(position<2?1:position+1):null}
 }
 return {genes:ranking.order.map(describe),order:ranking.order,pairwise,recommended,complete,incomplete}
}

const fixed=(value:number,digits=2)=>value.toFixed(digits)
const fold=(cycles:number)=>`${Number((2**cycles).toPrecision(2))}-fold`

/** A few plain sentences: the best pair, how many genes are enough, and genes that move with the condition. */
export function stabilitySummary(result:StabilityResult):string[] {
 if(result.order.length<2)return ['Choose at least two genes to compare their stability.']
 if(result.complete.length<MIN_SAMPLES){
  const runs=new Set([...result.complete,...result.incomplete].map(sample=>sample.run)).size
  return [`geNorm needs at least three samples measured for every compared gene; ${result.complete.length} ${result.complete.length===1?'is':'are'}.`,
   ...(runs>1?['Samples on separate runs are separate samples: if the genes were measured on different plates of the same samples, combine the plates into one run (Add plates).']:[])]
 }
 const [first,second]=result.genes,last=result.genes[result.genes.length-1]
 const sentences=[`Most stable: ${first.assay} and ${second.assay} (geNorm M ${fixed(first.m!)}).`]
 if(result.genes.length>2)sentences.push(`Least stable: ${last.assay} (M ${fixed(last.m!)}).`)
 else sentences.push('With two genes, geNorm cannot rank them against each other: add a third candidate.')
 const [v23]=result.pairwise
 if(result.recommended===2)sentences.push(`Adding a third gene changes the normalization factor by V2/3 = ${fixed(v23.v,3)}, below ${PAIRWISE_CUTOFF}: two reference genes are enough.`)
 else if(result.recommended)sentences.push(`Use the ${result.recommended} most stable genes: V${result.recommended}/${result.recommended+1} is the first pairwise variation below ${PAIRWISE_CUTOFF}.`)
 else if(result.pairwise.length){const lowest=[...result.pairwise].sort((a,b)=>a.v-b.v)[0];sentences.push(`No pairwise variation is below ${PAIRWISE_CUTOFF} (lowest V${lowest.n}/${lowest.n+1} = ${fixed(lowest.v,3)}). The cut-off is a guide: normalize to at least the ${lowest.n} most stable genes and report V.`)}
 const scattered=result.genes.filter(gene=>gene.rank===1&&(gene.sd??0)>SD_CUTOFF)
 if(scattered.length)sentences.push(`The raw Ct of ${scattered.map(gene=>gene.assay).join(' and ')} varies by more than ${SD_CUTOFF} cycle (SD) because samples differ in RNA input; geNorm compares genes within each sample, so input differences cancel.`)
 // With two genes a shift cannot be attributed to either of them.
 const moving=result.genes.length>2?result.genes.filter(gene=>(gene.relativeShift??0)>SD_CUTOFF):[]
 if(moving.length)sentences.push(`${moving.map(gene=>`${gene.assay} shifts ${fixed(gene.relativeShift!,1)} cycles between conditions relative to the most stable genes (${fold(gene.relativeShift!)})`).join('; ')}: avoid ${moving.length===1?'it':'them'} as ${moving.length===1?'a reference':'references'} for these conditions.`)
 return sentences
}

/** The genes a stability experiment compares unless the scientist chooses: recognized reference genes, or all of them. */
export function defaultStabilityGenes(assays:string[]):string[] {
 const references=assays.filter(isReferenceGene)
 return references.length>=2?references:[...assays]
}

// Text starting with = + - @ would run as a formula in a spreadsheet: an apostrophe keeps it text.
const text=(value:unknown)=>value==null?'':typeof value==='number'?String(Number(value.toFixed(4))):String(value).replace(/^[=+\-@\t\r]/,match=>`'${match}`)
const cell=(value:unknown)=>`"${text(value).replace(/"/g,'""')}"`
const csv=(rows:unknown[][])=>rows.map(row=>row.map(cell).join(',')).join('\r\n')

/** Plain tables for spreadsheets: Ct per sample and gene, and the stability ranking. */
export function stabilityCsv(result:StabilityResult):{samples:string;ranking:string} {
 const samples=[...result.complete,...result.incomplete]
 return {
  samples:csv([['Run','Sample','Condition',...result.order.map(gene=>`${gene} Ct`)],...samples.map(sample=>[sample.run,sample.sample,sample.group,...result.order.map(gene=>sample.ct[gene])])]),
  ranking:csv([['Rank','Gene','Samples','Mean Ct','SD Ct','Condition shift (cycles)','Shift relative to the most stable genes (cycles)','geNorm M'],
   ...result.genes.map(gene=>[gene.rank,gene.assay,gene.n,gene.mean,gene.sd,gene.shift,gene.relativeShift,gene.m])]),
 }
}

import {useRef,useState,type ReactNode} from 'react'
import './stability.css'
import type {RawRecord} from './types'
import {figureTheme} from './figureTheme'
import {palettes,seriesColor,type Presentation} from './presentation'
import {useElementWidth} from './useElementWidth'
import {fileStem,saveFile,svgMarkup} from './download'
import {BarFigure,CtSpreadFigure} from './StabilityFigures'
import {GENORM_HETEROGENEOUS,GENORM_HOMOGENEOUS,PAIRWISE_CUTOFF,SD_CUTOFF,sampleCts,stabilityAnalysis,stabilityCsv,stabilitySummary,type GeneStability} from './stability'

type Props={title:string;records:RawRecord[];measured:string[];genes:string[];included:(record:RawRecord)=>boolean;groupOf:(record:RawRecord)=>string
 presentation:Presentation;onGenes:(genes:string[])=>Promise<void>;renderCt:(assay:string)=>ReactNode}

const UNASSIGNED=['Unassigned sample','Unassigned assay']
const cycles=(value:number|null,digits=2)=>value==null?'—':value.toFixed(digits)
const byName=(a:string,b:string)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'})

function GeneNotes({gene}:{gene:GeneStability}) {
 const notes=[(gene.sd??0)>SD_CUTOFF&&`SD above ${SD_CUTOFF} cycle`,(gene.relativeShift??0)>SD_CUTOFF&&'moves with the condition']
  .filter((note):note is string=>Boolean(note))
 return notes.length?<span className="stability-note">{notes.join(' · ')}</span>:null
}

/** A reference-gene stability experiment: raw Ct per gene and condition, a geNorm ranking and how many genes to use. */
export function StabilityView({title,records,measured,genes,included,groupOf,presentation,onGenes,renderCt}:Props) {
 const [pending,setPending]=useState<string[]|null>(null),[status,setStatus]=useState('')
 const [frameRef,frameWidth]=useElementWidth<HTMLDivElement>()
 const spreadRef=useRef<SVGSVGElement>(null),rankingRef=useRef<SVGSVGElement>(null),pairwiseRef=useRef<SVGSVGElement>(null)
 const theme=figureTheme(presentation.figureTheme)
 // The new choice shows at once; it is replaced by the saved one, or rolled back if saving fails.
 const compared=(pending??genes).filter(gene=>measured.includes(gene))
 const samples=sampleCts(records.filter(record=>!UNASSIGNED.includes(record.sample)&&!UNASSIGNED.includes(record.assay)),{included,groupOf})
  .filter(sample=>compared.some(gene=>sample.ct[gene]!=null))
 const result=stabilityAnalysis(samples,compared)
 const groups=[...new Set(samples.map(sample=>sample.group))].sort(byName)
 // More conditions than palette colors would repeat hues: points stay neutral and the tooltip names the condition.
 const colored=groups.length<=palettes[presentation.palette].colors.length
 const colorOf=(group:string)=>colored?seriesColor(group,groups.indexOf(group),presentation):null
 const others=measured.filter(gene=>!compared.includes(gene))
 const ranked=result.genes.filter(gene=>gene.m!=null)
 const stem=fileStem(title)

 async function toggle(gene:string,on:boolean) {
  // One change at a time; inputs stay enabled so keyboard focus is not lost while saving.
  if(pending)return
  const next=on?[...compared,gene].sort((a,b)=>measured.indexOf(a)-measured.indexOf(b)):compared.filter(value=>value!==gene)
  setPending(next);setStatus('')
  try{await onGenes(next);setStatus(`${on?'Added':'Removed'} ${gene}. The ranking now compares ${next.length} gene${next.length===1?'':'s'}.`)}
  catch(error){setStatus(error instanceof Error?error.message:'Could not save the gene choice.')}
  finally{setPending(null)}
 }
 const download=(svg:SVGSVGElement|null,name:string)=>{if(svg)saveFile(svgMarkup(svg),'image/svg+xml;charset=utf-8',`${stem}-${name}.svg`)}
 const saveTable=(kind:'samples'|'ranking',name:string)=>saveFile(stabilityCsv(result)[kind],'text/csv;charset=utf-8',`${stem}-${name}.csv`)
 const listed=[...result.complete,...result.incomplete].sort((a,b)=>byName(a.group,b.group)||byName(a.sample,b.sample))

 return <section className="stability-view" aria-labelledby="stability-heading">
  <div className="section-heading"><div><p className="eyebrow">Reference-gene stability</p><h3 id="stability-heading">Which genes stay stable across your samples?</h3>
   <p className="stability-lede">Raw Ct only: no target, baseline or fold change. Each point is one sample, the mean of its technical replicates.</p></div></div>

  <fieldset className="stability-genes" aria-busy={pending!==null}><legend>Genes compared</legend>
   {measured.map(gene=><label key={gene} className="filter-chip stability-chip"><input type="checkbox" checked={compared.includes(gene)} onChange={event=>void toggle(gene,event.target.checked)}/>{gene}</label>)}
   <p className="helper-text">Recognized reference genes are compared by default. Add a target gene to see how it behaves, or leave out a gene that was not measured in every sample.</p>
   <p role="status" className="helper-text">{status}</p>
  </fieldset>

  <div className="stability-summary" role="note">{stabilitySummary(result).map(sentence=><p key={sentence}>{sentence}</p>)}
   {result.incomplete.length>0&&<p className="helper-text">{result.incomplete.length} sample{result.incomplete.length===1?' lacks':'s lack'} a compared gene and {result.incomplete.length===1?'is':'are'} left out of geNorm: {result.incomplete.slice(0,6).map(sample=>sample.sample).join(', ')}{result.incomplete.length>6?' …':''}.</p>}
  </div>

  {compared.length>0&&samples.length>0&&<figure className="stability-card" ref={frameRef}>
   <figcaption><strong>Ct of each gene across samples</strong><span>Box: middle half of the samples; line: median; whiskers: lowest to highest sample. Hover a point to follow that sample through every gene: a sample that is high everywhere had less RNA, not unstable genes.</span></figcaption>
   {!colored&&<p className="helper-text">{groups.length} conditions are more than the palette has colors, so points are not colored. Hover a point to see its condition.</p>}
   <CtSpreadFigure samples={samples} genes={result.order} groups={groups} colorOf={colorOf} theme={theme} width={(frameWidth??720)-2} svgRef={spreadRef}/>
   <div className="stability-actions"><button className="quiet-button" onClick={()=>download(spreadRef.current,'ct-spread')}>Download SVG</button><button className="quiet-button" onClick={()=>saveTable('samples','ct-per-sample')}>Ct per sample (CSV)</button></div>
   <details className="stability-samples"><summary>Ct per sample (table)</summary><div className="results-table-wrap"><table>
    <caption>Mean Ct of each sample's technical replicates, by condition</caption>
    <thead><tr><th scope="col">Condition</th><th scope="col">Sample</th>{result.order.map(gene=><th scope="col" key={gene}>{gene}</th>)}</tr></thead>
    <tbody>{listed.map(sample=><tr key={sample.key}><td>{sample.group}</td><th scope="row">{sample.sample}</th>{result.order.map(gene=><td key={gene}>{sample.ct[gene]==null?'—':sample.ct[gene].toFixed(2)}{sample.wells[gene]&&sample.wells[gene].used!==sample.wells[gene].total?<small> ({sample.wells[gene].used}/{sample.wells[gene].total} wells)</small>:null}</td>)}</tr>)}</tbody>
   </table></div></details>
  </figure>}

  {ranked.length>0&&<div className="stability-pair">
   <figure className="stability-card">
    <figcaption><strong>geNorm stability (M)</strong><span>Lower is more stable. The two best genes share the last step.</span></figcaption>
    <BarFigure rows={ranked.map(gene=>({label:gene.assay,value:gene.m!,note:gene.rank===1?'best pair':`rank ${gene.rank}`}))} guides={[{value:GENORM_HOMOGENEOUS,label:String(GENORM_HOMOGENEOUS)},{value:GENORM_HETEROGENEOUS,label:String(GENORM_HETEROGENEOUS)}]}
     title="geNorm M" axisTitle="geNorm M" color={palettes[presentation.palette].colors[0]} theme={theme} svgRef={rankingRef}/>
    <div className="stability-actions"><button className="quiet-button" onClick={()=>download(rankingRef.current,'genorm-m')}>Download SVG</button></div>
   </figure>
   {result.pairwise.length>0&&<figure className="stability-card">
    <figcaption><strong>How many reference genes?</strong><span>Pairwise variation when the next gene is added; below {PAIRWISE_CUTOFF} the extra gene adds little.</span></figcaption>
    <BarFigure rows={result.pairwise.map(entry=>({label:`V${entry.n}/${entry.n+1}`,value:entry.v}))} guides={[{value:PAIRWISE_CUTOFF,label:String(PAIRWISE_CUTOFF)}]}
     title="Pairwise variation" axisTitle="Pairwise variation V" color={theme.muted} theme={theme} svgRef={pairwiseRef} digits={3}/>
    <div className="stability-actions"><button className="quiet-button" onClick={()=>download(pairwiseRef.current,'pairwise-variation')}>Download SVG</button></div>
   </figure>}
  </div>}

  {result.genes.length>0&&<div className="results-table-wrap"><table className="stability-table">
   <caption>Stability of the compared genes, most stable first</caption>
   <thead><tr><th scope="col">Rank</th><th scope="col">Gene</th><th scope="col">Samples</th><th scope="col">Mean Ct</th><th scope="col">SD Ct</th><th scope="col" title="Highest minus lowest condition mean">Shift between conditions</th><th scope="col" title="The same after subtracting each sample's mean Ct of the two most stable genes (for those two, the other one): the part RNA input does not explain">Shift vs most stable genes</th><th scope="col">geNorm M</th><th scope="col">Notes</th></tr></thead>
   <tbody>{result.genes.map(gene=><tr key={gene.assay}><td>{gene.rank??'—'}</td><th scope="row">{gene.assay}</th><td>{gene.n}</td><td>{cycles(gene.mean)}</td><td>{cycles(gene.sd)}</td><td>{gene.shift==null?'—':`${cycles(gene.shift)} cycles`}</td><td>{gene.relativeShift==null?'—':`${cycles(gene.relativeShift)} cycles`}</td><td>{cycles(gene.m)}</td><td><GeneNotes gene={gene}/></td></tr>)}</tbody>
  </table><div className="stability-actions"><button className="quiet-button" onClick={()=>saveTable('ranking','stability-ranking')}>Download table (CSV)</button></div></div>}

  <details className="stability-methods"><summary>How these numbers are calculated</summary>
   <p>Each sample is the mean Ct of its technical replicates; omitted, excluded and undetermined wells are left out. SD and the shift between conditions use every sample measured for that gene. geNorm M and pairwise variation use the {result.complete.length} samples measured for every compared gene.</p>
   <p>Ct differences are read as log2 ratios, assuming 100% amplification efficiency. geNorm M is a gene's mean SD of Ct differences with every other compared gene; the least stable gene is dropped and M recalculated until two remain (Vandesompele et al., 2002). M below {GENORM_HOMOGENEOUS} is typical of stable genes in similar samples, below {GENORM_HETEROGENEOUS} in mixed samples (Hellemans et al., 2007). A raw-Ct SD above {SD_CUTOFF} cycle is inconsistent in BestKeeper (Pfaffl et al., 2004).</p>
   <p>A shift that every gene shares is usually RNA input, not instability. The “shift vs most stable genes” column removes it by subtracting each sample's mean Ct of the two most stable genes (for those two, the other one), which is closer to what a reference gene must not do.</p>
  </details>

  <h4 className="stability-subheading">Ct per condition</h4>
  <div className="figure-grid stability-ct-grid">{compared.map(gene=><div key={gene}>{renderCt(gene)}</div>)}</div>
  {others.length>0&&<details className="stability-others"><summary>Other genes on the plate · {others.join(', ')}</summary><div className="figure-grid stability-ct-grid">{others.map(gene=><div key={gene}>{renderCt(gene)}</div>)}</div></details>}
 </section>
}

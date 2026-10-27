import {useState} from 'react'
import type {Project} from './types'
import {geneCatalog,geneMatrix} from './libraryResults'
import {foldColor,foldLabel,legendGradient,legendTicks,textOn} from './heatmapLayout'
import {seriesLabel} from './plotData'

/** One gene across every experiment and run: the cross-experiment question scientists ask first. */
export function GeneExplorer({projects,loading,onOpen}:{projects:Project[];loading:boolean;onOpen:(project:string,experiment:string)=>void}) {
 const catalog=geneCatalog(projects)
 const [search,setSearch]=useState(''),[chosen,setChosen]=useState<string|null>(null)
 const listed=catalog.filter(entry=>entry.assay.toLowerCase().includes(search.toLowerCase()))
 const entry=catalog.find(item=>item.assay===chosen)??listed[0]
 const matrix=entry?geneMatrix(entry.rows):null
 return <section className="gene-explorer">
  <header className="library-heading"><div><p className="eyebrow">Across experiments</p><h2>Genes</h2><p>Saved expression for one gene in every experiment and run. Runs and experiments are shown side by side, never pooled.</p></div></header>
  {loading?<p role="status">Loading results…</p>:!catalog.length?<div className="library-empty"><h3>No expression results yet</h3><p>Open an experiment and calculate expression; its genes will appear here.</p></div>:
  <div className="gene-explorer-layout">
   <nav className="gene-list" aria-label="Genes"><label>Find gene<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Gene name…"/></label>
    <ul>{listed.map(item=><li key={item.assay}><button aria-pressed={item.assay===entry?.assay} onClick={()=>setChosen(item.assay)}><strong className="gene-symbol">{item.assay}</strong><small>{item.experiments} experiment{item.experiments===1?'':'s'}</small></button></li>)}</ul>
    {!listed.length&&<p>No gene matches “{search}”.</p>}</nav>
   {entry&&matrix&&<div className="gene-detail"><div className="section-heading"><h3 className="gene-symbol">{entry.assay}</h3><figure className="heat-legend fold-legend" aria-label="Fold-change color scale, log2, saturating at 8× either way"><figcaption>Fold change vs baseline</figcaption><i style={{background:legendGradient()}}/><span>{legendTicks().map(tick=><span key={tick.log2}>{tick.label}</span>)}</span></figure></div>
    <div className="heatmap-scroll"><table className="gene-matrix"><thead><tr><th>Experiment · run · condition</th>{matrix.columns.map(column=><th key={column.key}>{column.label}</th>)}<th aria-label="Open experiment"/></tr></thead><tbody>
     {matrix.lines.map(line=><tr key={line.key}><th><span>{line.experiment_name.replace(/\.(xlsx|xlsm|csv)$/i,'')}</span><small>{line.run_name}{line.series?` · ${seriesLabel(line.series)}`:''}{line.out_of_date?' · out of date':''}</small></th>
      {matrix.columns.map(column=>{const cell=line.cells[column.key];return <td key={column.key}>{cell?<span className={`heat-cell${cell.is_baseline?' baseline-cell':''}`} style={{background:foldColor(cell.fold_change),color:textOn(foldColor(cell.fold_change))}} title={`${cell.condition}: ${cell.fold_change==null?'no result':`${Number(cell.fold_change.toPrecision(4))}× geometric mean`} · n = ${cell.n}${cell.is_baseline?' · baseline':''}`}><span className="heat-value">{cell.fold_change==null?'—':foldLabel(cell.fold_change)}</span><small className="heat-n">{cell.is_baseline?'baseline':`n = ${cell.n}`}</small></span>:null}</td>})}
      <td><button className="quiet-button" onClick={()=>onOpen(line.project_id,line.experiment_id)}>Open</button></td></tr>)}
    </tbody></table></div>
    <p className="dashboard-footnote">Geometric mean fold change of biological samples versus each run’s own baseline. Values from different runs or experiments share a scale but are not normalized to each other.</p></div>}
  </div>}
 </section>
}

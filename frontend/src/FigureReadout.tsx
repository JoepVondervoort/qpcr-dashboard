import type {ReactNode} from 'react'
import type {Observation} from './plotData'
import type {YScale} from './logScale'
import {readoutRows,type ReadoutRow} from './figureReadout'

export type ReadoutFact={label:string;value:ReactNode}
const fold=(value:number)=>`${Number(value.toPrecision(3))}×`

/** The numbers behind the inspected figure, next to it: per series and time point, plus provenance. */
export function FigureReadout({observations,kind,scale,colorOf,labelFor,facts}:{observations:Observation[];kind:'ct'|'expression';scale:YScale;colorOf:(series:string)=>string;labelFor:(label:string)=>string;facts:ReadoutFact[]}) {
 const rows=readoutRows(observations,kind,scale)
 const series=[...new Map(rows.map(row=>[row.series,row.seriesLabel])).entries()]
 const log=kind==='expression'&&scale==='log2'
 const value=(row:ReadoutRow)=>kind==='ct'?row.center.toFixed(2):fold(row.center)
 const spread=(row:ReadoutRow)=>row.spread==null?'':kind==='ct'?`± ${row.spread.toFixed(2)}`:log?`×/÷ ${row.spread.toFixed(2)}`:`± ${Number(row.spread.toPrecision(2))}`
 return <aside className="figure-readout" aria-label="Values in this figure">
  <header><h5>{kind==='ct'?'Mean Ct':'Fold change'}</h5><small>{kind==='ct'?'mean ± SD of biological samples':log?'geometric mean ×/÷ SD':'mean ± SD'}</small></header>
  {!rows.length&&<p className="muted-text">No values in this selection.</p>}
  {series.map(([key,label])=><section key={key}><h6><i style={{background:colorOf(label)}} aria-hidden="true"/>{labelFor(label)}</h6>
   <table><tbody>{rows.filter(row=>row.series===key).map(row=><tr key={row.category}><th scope="row">{row.categoryLabel}</th><td className="readout-value">{value(row)}</td><td className="readout-spread">{spread(row)}</td><td className="readout-n">n = {row.n}</td></tr>)}</tbody></table>
  </section>)}
  <dl>{facts.map(fact=><div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>
 </aside>
}

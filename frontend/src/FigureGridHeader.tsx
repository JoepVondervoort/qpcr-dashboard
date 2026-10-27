import type {ReactNode} from 'react'
import type {YScale} from './logScale'

/** One legend and one key for a grid of figure panels, so each panel can show data only. */
export function FigureGridHeader({series,colorOf,labelFor,kind,scale,bars,significance=false,baselineLabel,timeUnit,children}:{series:string[];colorOf:(series:string)=>string|null;labelFor:(label:string)=>string;kind:'ct'|'expression';scale:YScale;bars:boolean;significance?:boolean;baselineLabel?:string;timeUnit?:'day'|'hour';children?:ReactNode}) {
 const log=kind==='expression'&&scale==='log2'
 const axis=kind==='ct'?'Y: Ct (cycles)':`Y: fold change vs ${baselineLabel||'baseline'}${log?' (log₂ scale)':''}`
 const marker=kind==='ct'?'filled marker: mean ± SD':log?'filled marker: geometric mean ×/÷ SD':'filled marker: mean ± SD'
 return <div className="figure-grid-header">
  {series.length>0&&<ul className="grid-legend" aria-label="Series in these figures">{series.map(label=>{const color=colorOf(label);return <li key={label}>{color&&<i style={{background:color}} aria-hidden="true"/>}{labelFor(label)}</li>})}</ul>}
  <p className="grid-key">{axis}{timeUnit?` · X: time (${timeUnit==='hour'?'hours':'days'})`:''} · {marker} · light circles: biological samples{kind==='ct'?' · faint dots: technical wells':''}{kind==='expression'?' · dashed line: 1×':''}{bars?' · bars start at 1×':''}{significance?' · *: Holm-adjusted difference from baseline (p in each panel’s notes)':''} · export a panel for its full legend and notes</p>
  {children}
 </div>
}

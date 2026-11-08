import {useEffect,useRef,type Dispatch,type ReactNode,type SetStateAction} from 'react'
import {palettes,seriesColor,resetPlotColors,applyPlotOptions,plotKey,type Presentation} from './presentation'

type Props={presentation:Presentation;onChange:Dispatch<SetStateAction<Presentation>>;series:string[];storageNotice:string;onResetOrder:()=>void;onUndo:()=>void;canUndo:boolean;labelFor:(label:string)=>string;open:boolean;onToggle:(open:boolean)=>void;children?:ReactNode}

/** One disclosure for display, layout and export settings. */
export function FigureAppearance({presentation,onChange,series,storageNotice,onResetOrder,onUndo,canUndo,labelFor,open,onToggle,children}:Props) {
 const ref=useRef<HTMLDetailsElement>(null)
 useEffect(()=>{
  if(!open)return
  const outside=(event:PointerEvent)=>{if(!ref.current?.contains(event.target as Node))onToggle(false)}
  const keys=(event:KeyboardEvent)=>{if(event.key==='Escape'){onToggle(false);ref.current?.querySelector('summary')?.focus()}}
  document.addEventListener('pointerdown',outside)
  document.addEventListener('keydown',keys)
  return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',keys)}
 },[open,onToggle])
 return <details ref={ref} className="figure-appearance" open={open} onToggle={event=>onToggle(event.currentTarget.open)}>
  <summary>View options</summary>
  <div className="appearance-panel">
   <header><div><h3>View options</h3><p>Presentation settings for this experiment.</p></div><button className="icon-button" aria-label="Close view options" onClick={()=>{onToggle(false);ref.current?.querySelector('summary')?.focus()}}>×</button></header>
   <h4>Axes &amp; colors</h4>
   <div className="appearance-options">
    {(['expression','ct'] as const).map(kind=><label key={kind}>{kind==='ct'?'Ct':'Expression'} Y scale<select aria-label={`Dashboard ${kind} scale`} value={presentation.plotDefaults[kind].axes.sharedY?'shared':'individual'} onChange={event=>{const sharedY=event.target.value==='shared';onChange(current=>applyPlotOptions(current,plotKey(kind,'dashboard'),kind,{...current.plotDefaults[kind],axes:{...current.plotDefaults[kind].axes,sharedY,yMin:null,yMax:null}},'axes'))}}><option value="individual">Individual automatic axes</option><option value="shared">Shared within this quantity</option></select></label>)}
    <label>Expression axis<select aria-label="Dashboard expression axis" value={presentation.plotDefaults.expression.axes.yScale} onChange={event=>{const yScale=event.target.value==='linear'?'linear' as const:'log2' as const;onChange(current=>applyPlotOptions(current,plotKey('expression','dashboard'),'expression',{...current.plotDefaults.expression,axes:{...current.plotDefaults.expression.axes,yScale,yMin:null,yMax:null,yTick:null}},'axes'))}}><option value="log2">Log₂ fold change</option><option value="linear">Linear fold change</option></select></label>
    <label>Color palette<select aria-label="Figure color palette" value={presentation.palette} onChange={event=>{const palette=event.target.value as Presentation['palette'];onChange(current=>({...current,palette,colors:{}}))}}>{Object.entries(palettes).map(([key,value])=><option key={key} value={key}>{value.label}</option>)}</select></label>
    <label className="inline-check"><input type="checkbox" checked={presentation.showSignificance} onChange={event=>{const showSignificance=event.target.checked;onChange(current=>({...current,showSignificance}))}}/>Show significance markers</label>
   </div>
   {children}
   <details className="series-color-disclosure"><summary>Individual series colors</summary><div className="series-color-options">{series.map((label,index)=><label key={label}><input type="color" aria-label={`Color for ${labelFor(label)}`} value={seriesColor(label,index,presentation)} onChange={event=>{const color=event.target.value;onChange(current=>({...current,colors:{...current.colors,[label]:color}}))}}/><span>{labelFor(label)}</span></label>)}</div></details>
   <div className="appearance-reset"><button className="quiet-button" onClick={()=>onChange(resetPlotColors)}>Reset colors</button><button className="quiet-button" disabled={!canUndo} onClick={onUndo}>Undo appearance change</button><button className="quiet-button" onClick={onResetOrder}>Reset plot order</button></div>
   <p className="appearance-note">Shared scales clear individual axis overrides. Colors, order and pins are remembered in this browser and used in exports.</p>
   {storageNotice&&<p role="status">{storageNotice}</p>}
  </div>
 </details>
}

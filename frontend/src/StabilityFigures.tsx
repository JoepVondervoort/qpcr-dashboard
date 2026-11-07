import {useState,type Ref} from 'react'
import {useElementWidth} from './useElementWidth'
import type {FigureTheme} from './figureTheme'
import {flowLegend} from './figureLayout'
import type {StabilitySample} from './stability'

const textWidth=(text:string,size:number)=>text.length*size*.56
const MARGIN={left:56,right:12}
const PLOT_HEIGHT=300
const POINT=4

function niceStep(span:number,target:number):number {
 const base=10**Math.floor(Math.log10(Math.max(span,1e-9)/target))
 return [1,2,5,10].map(factor=>factor*base).find(step=>span/step<=target)??10*base
}
function ticks(low:number,high:number,target=6):number[] {
 const step=niceStep(high-low,target),start=Math.ceil(low/step-1e-9)*step
 return Array.from({length:Math.floor((high-start)/step+1e-9)+1},(_,i)=>Number((start+i*step).toFixed(6)))
}
function quantile(sorted:number[],q:number):number {
 const position=(sorted.length-1)*q,low=Math.floor(position),high=Math.ceil(position)
 return sorted[low]+(sorted[high]-sorted[low])*(position-low)
}
/** The same horizontal offset for a sample in every gene, so one sample can be followed across the figure. */
function jitter(text:string):number {let hash=0;for(const c of text)hash=(hash*31+c.charCodeAt(0))|0;return ((hash>>>0)%101)/100-.5}
function clip(text:string,width:number,size:number):string {
 if(textWidth(text,size)<=width)return text
 const keep=Math.max(1,Math.floor(width/(size*.56))-1)
 return `${text.slice(0,keep)}…`
}

type Hover={key:string;gene:string;x:number;y:number}

/** Every sample's mean Ct for each compared gene, over a box of the middle half: spread and shared shifts at a glance. */
export function CtSpreadFigure({samples,genes,groups,colorOf,theme,width,svgRef}:{samples:StabilitySample[];genes:string[];groups:string[];colorOf:(group:string)=>string|null;theme:FigureTheme;width:number;svgRef?:Ref<SVGSVGElement>}) {
 const [hover,setHover]=useState<Hover|null>(null)
 const T=theme.text,W=Math.max(320,Math.round(width))
 const plotWidth=W-MARGIN.left-MARGIN.right,band=plotWidth/Math.max(1,genes.length)
 const legendItems=groups.filter(group=>colorOf(group)!=null)
 const legend=flowLegend(legendItems.map(group=>18+textWidth(group,T.legend)),plotWidth,16)
 const top=12+(legend.rows?legend.rows*18+8:0),height=top+PLOT_HEIGHT+40
 const values=samples.flatMap(sample=>genes.flatMap(gene=>sample.ct[gene]==null?[]:[sample.ct[gene]]))
 const low=Math.floor((Math.min(...values,40))-.5),high=Math.ceil((Math.max(...values,0))+.5)
 // Higher Ct up, as in the per-gene Ct figures.
 const y=(ct:number)=>top+(high-ct)/(high-low||1)*PLOT_HEIGHT
 const center=(index:number)=>MARGIN.left+band*(index+.5)
 const pointX=(index:number,key:string)=>center(index)+jitter(key)*Math.min(band*.62,96)
 const hovered=hover?samples.find(sample=>sample.key===hover.key):null
 const neutral=theme.muted
 return <div className="stability-figure-frame" onMouseLeave={()=>setHover(null)}>
  <svg ref={svgRef} viewBox={`0 0 ${W} ${height}`} width="100%" role="img" fontFamily={theme.font}
   aria-label={`Ct of ${genes.length} genes in ${samples.length} samples. Each point is one sample; boxes span the middle half of the samples.`}>
   <rect width={W} height={height} fill="#fff"/>
   {legendItems.map((group,index)=>{const item=legend.items[index],x=MARGIN.left+item.x,ly=12+item.row*18
    return <g key={group}><circle cx={x+5} cy={ly+6} r={5} fill={colorOf(group)!}/><text x={x+14} y={ly+10} fontSize={T.legend} fill={theme.ink}>{group}</text></g>})}
   {ticks(low,high).map(tick=><g key={tick}>
    {theme.grid&&<line x1={MARGIN.left} x2={W-MARGIN.right} y1={y(tick)} y2={y(tick)} stroke={theme.gridColor}/>}
    <text x={MARGIN.left-8} y={y(tick)+4} textAnchor="end" fontSize={T.tick} fill={theme.muted}>{tick}</text>
   </g>)}
   {theme.yAxisLine&&<line x1={MARGIN.left} x2={MARGIN.left} y1={top} y2={top+PLOT_HEIGHT} stroke={theme.axis} strokeWidth={theme.axisWidth}/>}
   <text transform={`translate(14 ${top+PLOT_HEIGHT/2}) rotate(-90)`} textAnchor="middle" fontSize={T.axisTitle} fill={theme.ink}>Ct (cycles) · lower = more transcript</text>
   {genes.map((gene,index)=>{
    const sorted=samples.flatMap(sample=>sample.ct[gene]==null?[]:[sample.ct[gene]]).sort((a,b)=>a-b)
    const x=center(index),half=Math.min(band*.32,44)
    return <g key={gene} aria-hidden="true">
     {sorted.length>0&&<>
      <line x1={x} x2={x} y1={y(sorted[0])} y2={y(sorted[sorted.length-1])} stroke={theme.axis} strokeWidth={1}/>
      <rect x={x-half} width={half*2} y={y(quantile(sorted,.25))} height={Math.max(1,y(quantile(sorted,.75))-y(quantile(sorted,.25)))} fill="#eef2f1" stroke={theme.axis} strokeWidth={1} rx={2}/>
      <line x1={x-half} x2={x+half} y1={y(quantile(sorted,.5))} y2={y(quantile(sorted,.5))} stroke={theme.ink} strokeWidth={2}/>
     </>}
     <text x={x} y={top+PLOT_HEIGHT+20} textAnchor="middle" fontSize={T.tick} fill={theme.ink}>{clip(gene,band-6,T.tick)}<title>{gene}</title></text>
    </g>})}
   <line x1={MARGIN.left} x2={W-MARGIN.right} y1={top+PLOT_HEIGHT} y2={top+PLOT_HEIGHT} stroke={theme.axis} strokeWidth={theme.axisWidth}/>
   {hovered&&<polyline aria-hidden="true" fill="none" stroke={theme.ink} strokeWidth={1.25} strokeDasharray="3 3"
    points={genes.flatMap((gene,index)=>hovered.ct[gene]==null?[]:[`${pointX(index,hovered.key)},${y(hovered.ct[gene])}`]).join(' ')}/>}
   {genes.map((gene,index)=>samples.map(sample=>{
    const ct=sample.ct[gene]
    if(ct==null)return null
    const active=hover?.key===sample.key,x=pointX(index,sample.key),py=y(ct)
    return <circle key={`${gene}:${sample.key}`} cx={x} cy={py} r={active?POINT+1.5:POINT} fill={colorOf(sample.group)??neutral}
     stroke={active?theme.ink:'#fff'} strokeWidth={1.5} opacity={hover&&!active?.28:.92}
     onMouseEnter={()=>setHover({key:sample.key,gene,x,y:py})}/>
   }))}
  </svg>
  {hover&&hovered&&<div className="stability-tooltip" aria-hidden="true" style={{left:`${hover.x/W*100}%`,top:`${hover.y/height*100}%`}}>
   <strong>{hovered.sample}</strong><span>{hovered.group}</span>
   {genes.map(gene=><span key={gene} data-active={gene===hover.gene}>{gene}: {hovered.ct[gene]==null?'not measured':`Ct ${hovered.ct[gene].toFixed(2)}`}{hovered.wells[gene]&&hovered.wells[gene].used!==hovered.wells[gene].total?` (${hovered.wells[gene].used}/${hovered.wells[gene].total} wells)`:''}</span>)}
  </div>}
 </div>
}

type Bar={label:string;value:number;note?:string}
type Guide={value:number;label:string}

/** Horizontal bars on one zero-based axis, with dashed guide lines at the published cut-offs. */
export function BarFigure({rows,guides,title,axisTitle,color,theme,svgRef,digits=2}:{rows:Bar[];guides:Guide[];title:string;axisTitle:string;color:string;theme:FigureTheme;svgRef?:Ref<SVGSVGElement>;digits?:number}) {
 const [frameRef,frameWidth]=useElementWidth<HTMLDivElement>()
 // Drawn at the card's own width (text stays at its set size), but never wider than a readable bar chart.
 const T=theme.text,W=Math.max(280,Math.min(560,frameWidth??360)),rowHeight=26,barHeight=14
 const left=Math.min(170,24+Math.max(40,...rows.map(row=>textWidth(row.label,T.tick)*1.1))),right=52,top=24
 const height=top+rows.length*rowHeight+42
 const max=Math.max(...rows.map(row=>row.value),...guides.map(guide=>guide.value),1e-9)*1.08
 const x=(value:number)=>left+value/max*(W-left-right)
 const axisY=top+rows.length*rowHeight+4
 const bar=(value:number,yTop:number)=>{const x0=x(0),x1=Math.max(x(value),x0+1),r=Math.min(4,(x1-x0)/2)
  return `M${x0},${yTop}H${x1-r}Q${x1},${yTop} ${x1},${yTop+r}V${yTop+barHeight-r}Q${x1},${yTop+barHeight} ${x1-r},${yTop+barHeight}H${x0}Z`}
 return <div ref={frameRef}><svg ref={svgRef} viewBox={`0 0 ${W} ${height}`} width={W} height={height} style={{maxWidth:'100%',height:'auto'}} role="img" fontFamily={theme.font}
  aria-label={`${title}: ${rows.map(row=>`${row.label} ${row.value.toFixed(digits)}`).join(', ')}`}>
  <rect width={W} height={height} fill="#fff"/>
  {ticks(0,max,4).map(tick=><g key={tick}>
   {theme.grid&&<line x1={x(tick)} x2={x(tick)} y1={top-4} y2={axisY} stroke={theme.gridColor}/>}
   <text x={x(tick)} y={axisY+16} textAnchor="middle" fontSize={T.tick} fill={theme.muted}>{tick}</text>
  </g>)}
  {guides.map(guide=><g key={guide.label}>
   <line x1={x(guide.value)} x2={x(guide.value)} y1={top-6} y2={axisY} stroke={theme.baseline.color} strokeWidth={theme.baseline.width} strokeDasharray={theme.baseline.dash}/>
   <text x={x(guide.value)} y={top-10} textAnchor="middle" fontSize={T.tick} fill={theme.muted}>{guide.label}</text>
  </g>)}
  {rows.map((row,index)=>{const yTop=top+index*rowHeight+(rowHeight-barHeight)/2
   return <g key={row.label}>
    <text x={left-8} y={yTop+barHeight-3} textAnchor="end" fontSize={T.tick} fill={theme.ink}>{clip(row.label,left-12,T.tick*1.1)}<title>{row.label}</title></text>
    <path d={bar(row.value,yTop)} fill={color}><title>{`${row.label}: ${row.value.toFixed(digits)}${row.note?` · ${row.note}`:''}`}</title></path>
    <text x={Math.max(x(row.value),x(0)+1)+5} y={yTop+barHeight-3} fontSize={T.tick} fill={theme.muted}>{row.value.toFixed(digits)}</text>
   </g>})}
  <line x1={x(0)} x2={x(0)} y1={top-4} y2={axisY} stroke={theme.axis} strokeWidth={theme.axisWidth}/>
  <text x={(left+W-right)/2} y={axisY+34} textAnchor="middle" fontSize={T.axisTitle} fill={theme.ink}>{axisTitle}</text>
 </svg></div>
}

import { type ReactNode, type Ref, useId, useRef, useState } from 'react'
import { mean, type Observation } from './plotData'
import {flowLegend,pngWithDpi,resolveTimeSpacing,seriesDodge,spreadLabels, type TimeSpacing} from './figureLayout'
import {defaultPresentation,seriesColor,effectivePlotOptions,plotKey,type Presentation} from './presentation'
import {PlotSettings} from './PlotSettings'
import {axisErrors,barKey,colorGroup,colorGroups,sampleColorKey,type ColorBy,type ColorGroup,type PlotOptions} from './plotOptions'
import {foldSummary,foldTickLabel,log2AxisTicks,log2Domain} from './logScale'
import {EXPORT_FONT,figureTheme} from './figureTheme'
import {useElementWidth} from './useElementWidth'
import {usePrinting} from './usePrinting'
import {formatP} from './statisticsText'
import type {Evidence} from './resultEvidence'
const compact = (v: number) => Number(v.toPrecision(3)).toString()
/** Approximate rendered width of sans-serif text in SVG user units. */
const textWidth = (text: string, size: number) => text.length*size*.56
function wrap(text: string, length: number): string[] {
  const words = text.split(/\s+/).flatMap(word=>word.length<=length?[word]:Array.from({length:Math.ceil(word.length/length)},(_,i)=>word.slice(i*length,(i+1)*length))), lines: string[] = []
  let line = ''
  for (const word of words) { if (line && (line+' '+word).length>length) {lines.push(line); line=word} else line = line ? line+' '+word : word }
  if (line) lines.push(line)
  return lines
}
function stableJitter(text: string) { let hash=0; for (const c of text) hash=(hash*31+c.charCodeAt(0))|0; return ((hash>>>0)%101/100-.5) }
/** full: titles, legend, axis titles and notes (inspector and every export). panel: axes only, for grids with a shared legend. */
type Chrome = 'full'|'panel'

export function PublicationFigure({title, subtitle, observations, kind, bars=false, threshold, technical=false, missing=0, omitted=0,emptyMessage,footer,timeAxisLabel='Time after transfection',colorDomain=[],preset='double',fixedDomain,reviewNote='',methods={},timeSpacing='auto',compactDisplay=false,presentation=defaultPresentation(),evidence=[],sharedRange,sharedLogRange,colorDomains,onOptionsChange,onInherit,labelFor=label=>label,baselineLabel,toolbar,status,panelNotes='print'}: {
  title: string; subtitle: string; observations: Observation[]; kind: 'ct'|'expression'; bars?: boolean; threshold?: number; technical?: boolean; missing?: number; omitted?: number; emptyMessage?: string; footer?: ReactNode; timeAxisLabel?: string; colorDomain?: string[]; preset?: 'single'|'double'; fixedDomain?: [number,number]; reviewNote?: string; methods?:Record<string,unknown>;timeSpacing?:TimeSpacing;compactDisplay?:boolean;presentation?:Presentation;evidence?:Evidence[];sharedRange?:[number,number];sharedLogRange?:[number,number];colorDomains?:Partial<Record<ColorBy,ColorGroup[]>>;onOptionsChange?:(options:PlotOptions,scope:'plot'|'axes'|'style')=>void;onInherit?:()=>void;labelFor?:(label:string)=>string
  baselineLabel?: string; toolbar?: ReactNode; status?: ReactNode
  /** Grid panels: provenance notes under the panel always, or only when printed. */
  panelNotes?: 'always'|'print'
}) {
  const [exportStatus,setExportStatus]=useState(''),[exportBusy,setExportBusy]=useState(false),[exportOpen,setExportOpen]=useState(false)
  const id=useId(),key=plotKey(kind,title,technical)
  const storedOptions=effectivePlotOptions(presentation,key,kind)
  const [draft,setDraft]=useState<PlotOptions|null>(null)
  const options=draft??storedOptions
  const axes=options.axes,style=options.style
  const theme=figureTheme(presentation.figureTheme),T=theme.text
  const custom=presentation.plotOverrides[key]
  const svg = useRef<SVGSVGElement>(null)
  const [viewportRef,viewportWidth]=useElementWidth<HTMLDivElement>()
  const printing=usePrinting()
  const categories = [...new Map(observations.map(o => [o.category,{key:o.category,label:o.categoryLabel,time:o.time,unit:o.unit}])).values()]
    .sort((a,b) => a.time != null && b.time != null ? a.unit.localeCompare(b.unit) || a.time-b.time : a.label.localeCompare(b.label,undefined,{numeric:true}))
  const series = [...new Map(observations.map(o => [o.series,{key:o.series,label:o.seriesLabel}])).values()].sort((a,b)=>a.label.localeCompare(b.label,undefined,{numeric:true}))
  const color=(index:number)=>{const domainIndex=colorDomain.indexOf(series[index].label);return seriesColor(series[index].label,domainIndex<0?index:domainIndex,presentation)}
  const groupsFor=(by:ColorBy)=>[...new Map([...(colorDomains?.[by]??[]),...colorGroups(observations,by)].map(group=>[group.key,group])).values()].sort((a,b)=>a.label.localeCompare(b.label,undefined,{numeric:true}))
  const colorFor=(groupKey:string,by:ColorBy)=>{
    if(by==='series'){const index=colorDomain.indexOf(groupKey);return seriesColor(groupKey,index<0?0:index,presentation)}
    const domain=groupsFor(by),index=domain.findIndex(group=>group.key===groupKey)
    return seriesColor(`${by}:${groupKey}`,Math.max(0,index),presentation)
  }
  const pointPaint=(point:Observation)=>{const group=colorGroup(point,style.colorBy);return style.sampleColors[sampleColorKey(point)]??style.groups[group.key]?.point??colorFor(group.key,style.colorBy)}
  const meanPaint=(members:Observation[],seriesIndex:number,category:string)=>{
    const keys=[...new Set(members.map(point=>colorGroup(point,style.colorBy).key))],group=keys.length===1?keys[0]:null
    const base=group?colorFor(group,style.colorBy):color(seriesIndex)
    return {bar:style.barColors[barKey(series[seriesIndex].key,category)]??(group?style.groups[group]?.bar:undefined)??base,outline:(group?style.groups[group]?.outline:undefined)??base}
  }
  const markers=presentation.showSignificance?evidence.filter(entry=>entry.mark&&entry.series&&entry.category):[]
  // Expression may use a log2 axis: values are transformed before positioning, labels stay in fold change.
  const logY=kind==='expression'&&axes.yScale==='log2'
  const toAxis=(value:number)=>logY?Math.log2(Math.max(value,1e-12)):value
  const summaries = series.flatMap(s => categories.map(category => {
    const members = observations.filter(o => o.series===s.key && o.category===category.key)
    const biologicalMeans = members.map(m => mean(m.values)).filter((v):v is number => v!=null)
    const summary=foldSummary(biologicalMeans,logY?'log2':'linear')
    return {series:s.key,category:category.key,members,mean:summary?.center??null,sd:summary?.sd??null,upper:summary?.upper??null,lower:summary?.lower??null,n:biologicalMeans.length}
  }))
  const finite = observations.flatMap(o => [...o.values,...(o.omitted ?? [])]).filter(Number.isFinite)
  const temporal = categories.length>0 && categories.every(c=>c.time!=null) && new Set(categories.map(c=>c.unit)).size===1
  const compatibleX=temporal&&(!axes.xUnit||axes.xUnit===categories[0].unit)
  const unitNote=axes.xUnit&&(!temporal||axes.xUnit!==categories[0].unit)&&(axes.xMin!=null||axes.xMax!=null||axes.xTick!=null||axes.xLabel)?`Saved X settings use ${axes.xUnit}s. This view uses an automatic X axis for its own time units.`:''
  const resolvedSpacing=resolveTimeSpacing(categories.flatMap(c=>c.time==null?[]:[c.time]),bars,axes.spacing==='auto'?timeSpacing:axes.spacing)
  const proportional=temporal&&resolvedSpacing==='proportional'
  const width = preset==='single'?360:720
  const paperWidth=preset==='single'?85:180
  const yTitle=axes.yLabel||(kind==='ct'?'Ct (cycles)':`Fold change vs ${baselineLabel||'baseline'}`)
  const extrema = [...finite,...summaries.flatMap(s=>s.upper==null||s.lower==null?[]:[s.upper,s.lower])]
  const shared=logY?sharedLogRange??sharedRange:sharedRange
  const domain=axes.sharedY&&shared?shared:fixedDomain
  function linearAxis() {
    const rawLow = domain?domain[0]:kind==='expression' ? 0 : Math.max(0,Math.min(...extrema,40)-.6)
    const rawHigh = domain?domain[1]:kind==='expression' ? Math.max(2,(threshold??0)*1.06,...extrema.map(v=>v*(markers.length?1.24:1.08))) : Math.max(rawLow+2,Math.max(...extrema,0)+.6)
    const rough=Math.max(.000001,(rawHigh-rawLow)/4), power=10**Math.floor(Math.log10(rough)), fraction=rough/power
    const automaticStep=(fraction<=1?1:fraction<=2?2:fraction<=2.5?2.5:fraction<=5?5:10)*power
    const requestedStep=axes.yTick!=null&&axes.yTick>0&&Number.isFinite(axes.yTick)?axes.yTick:automaticStep
    const requestedLow=Number.isFinite(axes.yMin)?axes.yMin:null,requestedHigh=Number.isFinite(axes.yMax)?axes.yMax:null
    const low=requestedLow??Math.floor(Math.min(rawLow,requestedHigh!=null?requestedHigh-automaticStep:rawLow)/automaticStep)*automaticStep
    const high=Math.max(low+1e-8,requestedHigh??Math.ceil(Math.max(rawHigh,low+automaticStep)/automaticStep)*automaticStep)
    const step=(high-low)/requestedStep>40?automaticStep:requestedStep
    const firstTick=Math.ceil((low-1e-10)/step)*step
    return {low,high,dataLow:low,dataHigh:high,step,tooMany:axes.yTick!=null&&(high-low)/requestedStep>40,ticks:Array.from({length:Math.min(41,Math.max(0,Math.floor((high-firstTick)/step+1e-8)+1))},(_,i)=>firstTick+i*step)}
  }
  function logAxis() {
    const usableDomain=domain&&domain[0]>0&&domain[1]>domain[0]?domain:undefined
    // Marker headroom only on an automatic range; a shared range must stay identical across panels.
    const [autoLow,autoHigh]=usableDomain?[Math.log2(usableDomain[0]),Math.log2(usableDomain[1])]:log2Domain([...extrema,...(threshold!=null?[threshold]:[])],markers.length?.5:0)
    const requestedLow=axes.yMin!=null&&axes.yMin>0?Math.log2(axes.yMin):null,requestedHigh=axes.yMax!=null&&axes.yMax>0?Math.log2(axes.yMax):null
    const low=requestedLow??Math.min(autoLow,requestedHigh!=null?requestedHigh-1:autoLow)
    const high=Math.max(low+1e-8,requestedHigh??Math.max(autoHigh,low+1))
    const ticks=log2AxisTicks(low,high,axes.yTick)
    // Report requested limits exactly, not as 2^log2(limit), which can differ in the last digit.
    return {low,high,dataLow:requestedLow!=null?axes.yMin!:2**low,dataHigh:requestedHigh!=null&&high===requestedHigh?axes.yMax!:2**high,step:ticks.length>1?ticks[1]-ticks[0]:1,tooMany:false,ticks}
  }
  const axis=logY?logAxis():linearAxis()
  const {low,high,step,ticks}=axis
  const tickLabel=(tick:number)=>logY?foldTickLabel(tick):compact(tick)
  const outside=(value:number)=>toAxis(value)<low||toAxis(value)>high
  const actualMinTime=Math.min(...categories.map(c=>c.time??0)),actualMaxTime=Math.max(...categories.map(c=>c.time??0))
  const singleTimePadding=temporal&&actualMinTime===actualMaxTime&&axes.xMin==null&&axes.xMax==null?.5:0
  const minTime=compatibleX&&Number.isFinite(axes.xMin)?axes.xMin!:Math.min(actualMinTime-singleTimePadding,compatibleX&&axes.xMax!=null?axes.xMax-1:actualMinTime)
  const maxTime=Math.max(minTime+1e-8,compatibleX&&Number.isFinite(axes.xMax)?axes.xMax!:Math.max(actualMaxTime+singleTimePadding,minTime+1))
  const inX=(category:string)=>{const point=categories.find(c=>c.key===category);return !temporal||(point?.time!=null&&point.time>=minTime&&point.time<=maxTime)}
  const visibleCategories=categories.filter(category=>inX(category.key))
  const requestedXStep=compatibleX&&axes.xTick!=null&&axes.xTick>0&&Number.isFinite(axes.xTick)?axes.xTick:null
  const customXStep=requestedXStep&&(maxTime-minTime)/requestedXStep<=40?requestedXStep:null
  const errors=axisErrors(axes,temporal,temporal?categories[0].unit:undefined,kind)
  if(axis.tooMany)errors.push('Y tick spacing would create more than 40 ticks for these data.')
  if(temporal&&requestedXStep&&(maxTime-minTime)/requestedXStep>40)errors.push('X tick spacing would create more than 40 ticks for these data.')
  const manualLimits=axes.xMin!=null||axes.xMax!=null||axes.yMin!=null||axes.yMax!=null
  const clippedMeasurements=manualLimits?observations.reduce((n,point)=>n+[...point.values,...(point.omitted??[])].filter(value=>!inX(point.category)||outside(value)).length,0):0
  const clippedIntervals=manualLimits?summaries.filter(summary=>summary.lower!=null&&summary.upper!=null&&summary.sd!=null&&(!inX(summary.category)||outside(summary.lower)||outside(summary.upper))).length:0
  const baselineClipped=kind==='expression'&&outside(1)
  const clippingNote=clippedMeasurements||clippedIntervals||baselineClipped?`Display limits: ${clippedMeasurements} measurements and ${clippedIntervals} uncertainty intervals extend outside the visible axes.${baselineClipped?' The 1× baseline is outside the visible Y range.':''} Data and analyses are unchanged.`:''
  const visibleMarkers=markers.filter(entry=>{const summary=summaries.find(summary=>summary.series===entry.series&&summary.category===entry.category);return summary&&inX(summary.category)&&summary.lower!=null&&summary.upper!=null&&!outside(summary.lower)&&!outside(Math.max(summary.upper,...summary.members.flatMap(member=>member.values)))})
  // Biological n: one value per figure when constant, otherwise per series and visible time point.
  const visibleCounts=summaries.filter(s=>inX(s.category)&&s.n>0).map(s=>s.n)
  const uniformN=visibleCounts.length&&new Set(visibleCounts).size===1?visibleCounts[0]:null
  // Only the categories a series was measured at: a series absent at a time point has no point there, not n = 0.
  const countsFor=(seriesKey:string)=>visibleCategories.flatMap(c=>{const n=summaries.find(v=>v.series===seriesKey&&v.category===c.key)?.n;return n?[{label:c.label,n}]:[]})
  const nLabel=(seriesKey:string)=>{const counts=countsFor(seriesKey).map(c=>c.n),low=Math.min(...counts,Infinity),high=Math.max(...counts,0);return low===high||!counts.length?`n = ${counts[0]??0}`:`n = ${low}–${high}`}
  const nDetails=series.flatMap(s=>{const counts=countsFor(s.key);return new Set(counts.map(c=>c.n)).size>1?[`n per time point · ${labelFor(s.label)}: ${counts.map(c=>`${c.label} ${c.n}`).join(', ')}.`]:[]})
  const lastMean=(seriesKey:string)=>summaries.filter(s=>s.series===seriesKey&&inX(s.category)&&s.mean!=null&&!outside(s.mean)).at(-1)
  // Up to four time-course lines are labelled at their ends; otherwise a legend sits above the plot.
  const directLabels=temporal&&!bars&&!technical&&preset==='double'&&series.length>0&&series.length<=4&&uniformN!=null&&series.every(s=>labelFor(s.label).length<=26&&lastMean(s.key))
  const primaryLegend=series.map((s,index)=>({key:s.key,label:labelFor(s.label)+(technical||directLabels?'':` · ${nLabel(s.key)}`),color:meanPaint(observations.filter(point=>point.series===s.key),index,'').outline}))
  const extraLegend:{key:string;label:string;color:string}[]=[]
  if(style.colorBy!=='series')for(const group of colorGroups(observations,style.colorBy))extraLegend.push({key:`points:${group.key}`,label:`Points · ${labelFor(group.label)}`,color:style.groups[group.key]?.point??colorFor(group.key,style.colorBy)})
  for(const point of observations)if(style.sampleColors[sampleColorKey(point)]&&!extraLegend.some(item=>item.key===`sample:${sampleColorKey(point)}`))extraLegend.push({key:`sample:${sampleColorKey(point)}`,label:`Point · ${point.sample} · ${labelFor(String(point.data?.[0]?.run??point.run))}`,color:pointPaint(point)})
  const unitWord=categories[0]?.unit==='hour'?'hours':'days'
  const summaryNote=kind==='ct'?'Filled marker: mean of biological samples; whiskers: sample SD.':logY?'Filled marker: geometric mean; whiskers: ×/÷ geometric SD (log₂ scale).':'Filled marker: mean; whiskers: ± sample SD.'
  const thresholdShown=kind==='expression'&&threshold!=null&&threshold!==1
  const thresholdNote=thresholdShown?outside(threshold!)?`The ${threshold}× effect threshold is outside the visible Y range.`:`Dotted line: ${threshold}× effect threshold.`:''
  const markerNotes=visibleMarkers.map(entry=>`* ${entry.condition}: Holm-adjusted p = ${formatP(entry.p)} versus saved baseline (n = ${entry.controlN}). ${entry.reason}`)
  const spacingNote=temporal&&!proportional?'Measured times are equally spaced; horizontal distances do not represent elapsed time.':''
  const countNote=kind==='ct'?`Missing / undetermined: ${missing}; omitted / excluded: ${omitted}.`:''
  // Grid panels carry what the shared legend cannot: anything specific to this figure.
  const specificNotes=[unitNote,clippingNote,...markerNotes,thresholdNote,...nDetails,spacingNote,countNote,reviewNote].filter(Boolean)
  const footerNotes=[unitNote,clippingNote,...markerNotes,kind==='expression'?'Dashed line: 1× baseline.':'',thresholdNote,
    technical?'Technical controls: QC only; excluded from expression and statistics.':kind==='ct'?`Small dots: technical wells. Light circles: biological sample means. ${summaryNote}`:`Light circles: biological samples. ${summaryNote}${bars?' Bars originate at 1×.':''}`,
    technical?'':directLabels?`n = ${uniformN} biological samples per point.`:'n: biological samples.',...nDetails,
    temporal&&categories.length>1&&!bars?'Lines connect condition means; pairing is not inferred.':'Pairing is not inferred.',
    spacingNote,countNote,reviewNote].filter(Boolean)

  function layout(chrome:Chrome,responsive=false) {
    const full=chrome==='full'
    // Screen text stays at its intended pixel size. Exports retain their publication dimensions.
    const W=full&&!responsive?width:printing?360:Math.max(260,Math.min(900,viewportWidth??(full?width:360)))
    const yTitleLines=full?wrap(yTitle,36):[]
    const tickSpace=Math.max(14,...ticks.map(tick=>textWidth(tickLabel(tick),T.tick)))+(theme.tickDirection==='out'?11:8)
    const left=Math.round(Math.max(full?(preset==='single'?54:64):34,tickSpace+(full?yTitleLines.length*(T.axisTitle+3)+12:4)))
    const labels=full&&directLabels&&(!responsive||W>=560)?series.map(s=>labelFor(s.label)):[]
    const right=W-(full?14:10)-(labels.length?Math.min(200,Math.max(...labels.map(label=>textWidth(label,T.legend)*1.1))+14):0)
    const subtitleLines=full?wrap(subtitle,Math.floor((W-left-14)/(T.subtitle*.56))):[]
    const legendTop=full?18+T.title+subtitleLines.length*(T.subtitle+4)+12:0
    const legend=(full&&!labels.length?primaryLegend:[]).map(item=>({...item,lines:wrap(item.label,Math.max(12,Math.floor((right-left-24)/(T.legend*.56))))}))
    const legendFlow=flowLegend(legend.map(item=>24+Math.max(...item.lines.map(line=>textWidth(line,T.legend)))),right-left,18)
    const rowLines=Array.from({length:legendFlow.rows},(_,row)=>Math.max(1,...legend.filter((_,i)=>legendFlow.items[i].row===row).map(item=>item.lines.length)))
    const rowTops=rowLines.map((_,row)=>rowLines.slice(0,row).reduce((sum,lines)=>sum+lines*16+2,0))
    const legendHeight=rowLines.reduce((sum,lines)=>sum+lines*16+2,0)
    const top=legendTop+legendHeight+(full?(legendFlow.rows?16:10):12)
    const bottom=top+(full?(preset==='single'?210:240):180)
    const inset=proportional?(full?30:20):0
    const slot=(right-left)/Math.max(1,categories.length)
    const timeX=(time:number)=>left+inset+(time-minTime)/(maxTime-minTime)*(right-left-2*inset)
    const x=(categoryKey:string)=>{const index=categories.findIndex(c=>c.key===categoryKey),category=categories[index];return proportional?timeX(category.time!):left+slot*(index+.5)}
    const spacing=proportional&&categories.length>1?Math.min(...categories.slice(1).map((category,i)=>x(category.key)-x(categories[i].key))):slot
    const dodge=seriesDodge(series.length,Math.min(spacing,proportional?96:spacing),bars)
    const tickText=(c:typeof categories[number])=>proportional&&c.time!=null?compact(c.time):c.label
    const denseTime=proportional&&(customXStep!=null||visibleCategories.slice(1).some((c,i)=>x(c.key)-x(visibleCategories[i].key)<(textWidth(tickText(c),T.tick)+textWidth(tickText(visibleCategories[i]),T.tick))/2+8))
    const xTickStart=customXStep?Math.ceil(minTime/customXStep)*customXStep:minTime
    const xTicks:{position:number;label:string;key?:string}[]=denseTime?Array.from({length:customXStep?Math.min(41,Math.max(0,Math.floor((maxTime-xTickStart)/customXStep)+1)):5},(_,i)=>{const value=customXStep?xTickStart+i*customXStep:minTime+(maxTime-minTime)*i/4;return {position:timeX(value),label:compact(value)}}):visibleCategories.map(c=>({position:x(c.key),label:tickText(c),key:c.key}))
    const tickLines=xTicks.map(tick=>wrap(tick.label,Math.max(6,Math.floor(slot/(T.tick*.56)))))
    const xLabelY=bottom+10+T.tick
    const xLabelBottom=xLabelY+(Math.max(1,...tickLines.map(lines=>lines.length))-1)*15
    const numericTime=proportional||denseTime
    const xTitle=full?((!unitNote&&axes.xLabel)||(temporal?(numericTime?`${timeAxisLabel} (${unitWord})`:timeAxisLabel!=='Time'?timeAxisLabel:''):'')):''
    const xTitleLines=xTitle?wrap(xTitle,Math.max(12,Math.floor((right-left)/(T.axisTitle*.56)))):[]
    const xTitleY=xLabelBottom+12+T.axisTitle
    const axisBottom=xTitleLines.length?xTitleY+(xTitleLines.length-1)*16:xLabelBottom
    const extras=full?extraLegend.map(item=>wrap(item.label,Math.floor((W-left-40)/(T.legend*.56)))):[]
    const extraTop=axisBottom+26
    const extraRows=extras.reduce((n,lines)=>n+Math.max(1,lines.length),0)
    const footerStart=extraTop+extraRows*19+(extraRows?10:0)+T.footer
    const footerLines=full?footerNotes.flatMap(note=>wrap(note,Math.floor((W-left-14)/(T.footer*.56)))):[]
    const height=full?footerStart+footerLines.length*16+12:axisBottom+12
    const visible=lastMeanPositions()
    function lastMeanPositions(){
      if(!labels.length)return []
      const ys=series.map(s=>{const point=lastMean(s.key)!;return bottom-(toAxis(point.mean!)-low)/(high-low)*(bottom-top)})
      return spreadLabels(ys,T.legend+4,top+T.legend/2,bottom)
    }
    return {full,width:W,left,right,top,bottom,height,x,spacing,dodge,xTicks,tickLines,xLabelY,xTitleLines,xTitleY,yTitleLines,subtitleLines,legend,legendFlow,legendTop,rowTops,labels,labelYs:visible,extras,extraTop,footerStart,footerLines,
      viewTop:full?(legendFlow.rows?legendTop-6:top-14):0,viewBottom:full?axisBottom+14:height}
  }
  const fullFrame=layout('full')
  const screenFrame=printing&&!compactDisplay?fullFrame:layout(compactDisplay?'panel':'full',true)
  const exportName=`${title.replace(/[^a-z0-9]+/gi,'-')}-${kind}`
  const dataRows:Record<string,unknown>[]=observations.flatMap(o=>(o.data??o.values.map(value=>({sample:o.sample,run:o.run,condition:o.categoryLabel,value,source:o.source}))).map(row=>{const data=row as Record<string,unknown>,value=kind==='ct'?data.ct??data.value:data.fold_change??data.value;return {...data,visible_under_axis_limits:data.plotted!==false&&typeof value==='number'&&inX(o.category)&&!outside(value)}}))
  const yLimits=[axis.dataLow,axis.dataHigh]
  const summaryStatistic=kind==='ct'?'mean ± sample SD':logY?'geometric mean ×/÷ geometric SD (mean ± SD of log2 fold change)':'arithmetic mean ± sample SD'
  function fileDownload(content:string,type:string,name:string){const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
  function downloadData(){const headers=[...new Set(dataRows.flatMap(row=>Object.keys(row)))];const cell=(value:unknown)=>{const text=value==null?'':typeof value==='object'?JSON.stringify(value):String(value);return '"'+text.replace(/"/g,'""')+'"'};fileDownload([headers.map(cell).join(','),...dataRows.map(row=>headers.map(h=>cell(row[h])).join(','))].join('\r\n'),'text/csv;charset=utf-8',exportName+'-data.csv')}
  function downloadMethods(){fileDownload(JSON.stringify({title,kind,subtitle,figure:{width_mm:paperWidth,min_font_pt:8,theme:theme.name,view:bars?'bars from 1x':'condition means',settings:options,x_unit_note:unitNote,limits:{x:[minTime,maxTime],y:yLimits,...(logY?{y_tick_doublings:step}:{y_tick:step})},y_scale:logY?'log2':'linear',summary_statistic:summaryStatistic,clipping:{measurements:clippedMeasurements,uncertainty_intervals:clippedIntervals,baseline:baselineClipped,note:clippingNote},axis_title:axes.xLabel||timeAxisLabel,y_axis_title:yTitle,time_spacing:temporal?resolvedSpacing:'categorical',legend_labels:Object.fromEntries(series.map(s=>[s.label,labelFor(s.label)])),color_assignment:style.colorBy,group_colors:style.groups,bar_colors:style.barColors,sample_colors:style.sampleColors,series_colors:Object.fromEntries(series.map((s,i)=>[s.label,color(i)])),significance_markers:visibleMarkers,measured_times:categories.map(c=>({label:c.label,time:c.time,unit:c.unit}))},review_status:reviewNote,missing,omitted,methods},null,2),'application/json',exportName+'-methods.json')}

  function serializedSvg() {
    if (!svg.current) return ''
    const copy = svg.current.cloneNode(true) as SVGSVGElement
    // Exports name fonts every recipient has; web fonts are not embedded and are unavailable to PNG rendering.
    copy.setAttribute('xmlns','http://www.w3.org/2000/svg');copy.style.transform='none';copy.style.fontFamily=EXPORT_FONT
    copy.setAttribute('width',`${paperWidth}mm`)
    copy.setAttribute('height',`${fullFrame.height/width*paperWidth}mm`)
    const metadata=document.createElementNS('http://www.w3.org/2000/svg','metadata');metadata.textContent=JSON.stringify({methods,figure_settings:options,figure_theme:theme.name,x_unit_note:unitNote,limits:{x:[minTime,maxTime],y:yLimits},y_scale:logY?'log2':'linear',summary_statistic:summaryStatistic,clipping_note:clippingNote,legend_labels:Object.fromEntries(series.map(s=>[s.label,labelFor(s.label)])),color_assignment:style.colorBy,group_colors:style.groups,bar_colors:style.barColors,sample_colors:style.sampleColors,series_colors:Object.fromEntries(series.map((s,i)=>[s.label,color(i)])),significance_markers:visibleMarkers,review_status:reviewNote,min_font_pt:8,time_spacing:temporal?resolvedSpacing:'categorical'});copy.prepend(metadata)
    return new XMLSerializer().serializeToString(copy)
  }
  function download() {fileDownload(serializedSvg(),'image/svg+xml;charset=utf-8',exportName+'.svg')}
  async function downloadPng() {
    setExportBusy(true);setExportStatus('')
    const url=URL.createObjectURL(new Blob([serializedSvg()],{type:'image/svg+xml;charset=utf-8'}))
    try {
      const picture=new Image()
      await new Promise<void>((resolve,reject)=>{picture.onload=()=>resolve();picture.onerror=()=>reject(new Error('Could not render this figure.'));picture.src=url})
      const canvas=document.createElement('canvas')
      canvas.width=Math.round(paperWidth/25.4*600);canvas.height=Math.round(canvas.width*fullFrame.height/width)
      const context=canvas.getContext('2d');if(!context)throw new Error('Image export is unavailable in this browser.')
      context.fillStyle='white';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(picture,0,0,canvas.width,canvas.height)
      const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('Could not export PNG.')),'image/png'))
      const png=pngWithDpi(new Uint8Array(await blob.arrayBuffer()),600)
      const downloadUrl=URL.createObjectURL(new Blob([png.buffer as ArrayBuffer],{type:'image/png'})),link=document.createElement('a');link.href=downloadUrl;link.download=`${exportName}-600dpi-${paperWidth}mm.png`;link.click();setTimeout(()=>URL.revokeObjectURL(downloadUrl),1000)
      setExportStatus(`PNG exported: ${canvas.width} × ${canvas.height} pixels (600 dpi at ${paperWidth} mm).`)
    } catch(error) {setExportStatus(error instanceof Error?error.message:'PNG export failed.')} finally {URL.revokeObjectURL(url);setExportBusy(false)}
  }

  function renderSvg(f:ReturnType<typeof layout>,ref?:Ref<SVGSVGElement>,crop=false) {
    const yAxis=(axisValue:number)=>f.bottom-(axisValue-low)/(high-low)*(f.bottom-f.top)
    const y=(value:number)=>yAxis(toAxis(value))
    const center=(category:string,seriesIndex:number)=>f.x(category)+f.dodge.offsets[seriesIndex]
    const spread=Math.min(9,f.spacing*.3/Math.max(1,series.length))
    const clip=`${id}-${f.full?'full':'panel'}`
    const tickOut=theme.tickDirection==='out'
    const extraOffsets=f.extras.map((_,i)=>f.extras.slice(0,i).reduce((total,lines)=>total+Math.max(1,lines.length),0))
    return <svg ref={ref} data-time-spacing={temporal?resolvedSpacing:'categorical'} data-y-min={yLimits[0]} data-y-max={yLimits[1]} data-y-scale={logY?'log2':'linear'} data-x-min={minTime} data-x-max={maxTime} data-color-by={style.colorBy} data-theme={theme.name} role="img" aria-label={`${title} · ${kind==='ct'?'raw Ct values':'normalized expression'}`} viewBox={`0 0 ${f.width} ${f.height}`} width={`${paperWidth}mm`} height={`${f.height/f.width*paperWidth}mm`} style={{fontFamily:theme.font,background:'#fff',color:theme.ink,...(crop?{transform:`translateY(-${f.viewTop/f.height*100}%)`}:{})}}>
      <title>{title} — {subtitle}</title><desc>{observations.map(o=>`${o.sample}; ${o.source}; values: ${o.values.join(', ')}`).join('\n')}. Lines connect condition means, not paired samples.</desc>
      <defs><clipPath id={clip}><rect x={f.left} y={f.top-2} width={f.right-f.left} height={f.bottom-f.top+4}/></clipPath></defs><rect width={f.width} height={f.height} fill="white"/>
      {f.full&&<><text x={f.left} y={14+T.title} fontSize={T.title} fontWeight="600" fontStyle="italic" fill={theme.ink}>{title}</text>
        <text x={f.left} y={14+T.title+T.subtitle+6} fontSize={T.subtitle} fill={theme.muted}>{f.subtitleLines.map((line,i)=><tspan key={i} x={f.left} dy={i?T.subtitle+4:0}>{line}</tspan>)}</text></>}
      {ticks.map((tick,i)=><g key={i}>{style.grid&&theme.grid&&<line x1={f.left} x2={f.right} y1={yAxis(tick)} y2={yAxis(tick)} stroke={theme.gridColor} strokeWidth="1"/>}{tickOut&&<line x1={f.left-4} x2={f.left} y1={yAxis(tick)} y2={yAxis(tick)} stroke={theme.axis} strokeWidth={theme.axisWidth}/>}<text x={f.left-(tickOut?8:7)} y={yAxis(tick)+T.tick*.35} textAnchor="end" fontSize={T.tick} fill={theme.muted}>{tickLabel(tick)}</text></g>)}
      {theme.yAxisLine&&<line x1={f.left} x2={f.left} y1={f.top} y2={f.bottom} stroke={theme.axis} strokeWidth={theme.axisWidth}/>}
      <line x1={f.left} x2={f.right} y1={f.bottom} y2={f.bottom} stroke={theme.axis} strokeWidth={theme.axisWidth}/>
      {f.full&&<text transform={`translate(${6+T.axisTitle} ${(f.top+f.bottom)/2}) rotate(-90)`} textAnchor="middle" fontSize={T.axisTitle} fill={theme.ink}>{f.yTitleLines.map((line,index)=><tspan key={index} x="0" dy={index?T.axisTitle+3:0}>{line}</tspan>)}</text>}
      <g clipPath={`url(#${clip})`}>{kind==='expression' && <><line data-baseline="1" x1={f.left} x2={f.right} y1={y(1)} y2={y(1)} stroke={theme.baseline.color} strokeWidth={theme.baseline.width} strokeDasharray={theme.baseline.dash}/>
        {threshold!=null && threshold!==1 && <line x1={f.left} x2={f.right} y1={y(threshold)} y2={y(threshold)} stroke="#bc9367" strokeDasharray="2 4"/>}</>}
      {series.map((s,si)=>{
        const summary=summaries.filter(v=>v.series===s.key),seriesPaint=meanPaint(summary.flatMap(value=>value.members),si,'').outline
        // Draw only adjacent measured time points: missing time points leave a gap.
        const segments = temporal && !bars && !technical ? summary.slice(1).flatMap((v,i)=>inX(v.category)&&inX(summary[i].category)&&v.mean!=null && summary[i].mean!=null ? [<line data-line-meaning="condition-means" key={v.category} x1={center(summary[i].category,si)} y1={y(summary[i].mean!)} x2={center(v.category,si)} y2={y(v.mean)} stroke={seriesPaint} strokeWidth={style.lineWidth} strokeLinecap="round" opacity=".85"/>] : []) : []
        return <g key={s.key}>{segments}{summary.map(v=>{
          if(!inX(v.category))return null
          const cx=center(v.category,si),paint=meanPaint(v.members,si,v.category)
          return <g key={v.category}>
            {kind==='expression' && bars && v.mean!=null && <rect data-mean={v.mean} data-baseline-y={y(1)} x={cx-f.dodge.barWidth/2} y={Math.min(y(1),y(v.mean))} width={f.dodge.barWidth} height={Math.abs(y(1)-y(v.mean))} data-bar-key={barKey(s.key,v.category)} fill={paint.bar} fillOpacity={style.barOpacity} stroke={paint.outline} strokeWidth={style.outlineWidth}/>}
            {v.members.map(member=> <g key={member.sample}>
              {kind==='ct' && member.values.map((value,i)=><circle key={i} cx={cx+stableJitter(member.sample+':'+i)*spread*2} cy={y(value)} data-sample={member.sample} r={Math.max(1.6,style.pointSize*.45)} fill={pointPaint(member)} fillOpacity=".3"><title>{member.sample} · {member.categoryLabel} · Ct {value.toFixed(3)} · {member.source} · technical measurement {i+1}</title></circle>)}
              {(member.omitted??[]).map((value,i)=>{const px=cx+stableJitter(member.sample+':omit'+i)*spread*2; return <path key={`o${i}`} d={`M${px-3},${y(value)-3}l6,6m0,-6l-6,6`} stroke="#b65a57" strokeWidth="1.3"><title>{member.sample} · {member.categoryLabel} · {member.omittedDetails?.[i]?.well??''} · Ct {value} · {member.omittedDetails?.[i]?.reason??'Omitted / excluded'} (not used in mean)</title></path>})}
              {!technical && mean(member.values)!=null && <circle cx={cx+stableJitter(member.sample)*spread*1.6} cy={y(mean(member.values)!)} data-sample={member.sample} r={style.pointSize*.8} fill={pointPaint(member)} fillOpacity={style.pointFilled?.9:.22} stroke={pointPaint(member)} strokeWidth={style.pointFilled?.8:1}><title>{member.sample} · {member.categoryLabel} · {kind==='ct'?'biological sample Ct mean':'fold change'} {mean(member.values)!.toFixed(3)} · {member.source}</title></circle>}
            </g>)}
            {!technical && v.mean!=null && <>
              {/* A white halo keeps the SD readable on top of many sample points in the same color; bars need none. */}
              {v.sd!=null && v.upper!=null && v.lower!=null && [...(bars?[]:[{halo:true,stroke:'#fff',width:Math.max(1,style.outlineWidth)+3}]),{halo:false,stroke:paint.outline,width:Math.max(1,style.outlineWidth)}].map(layer=>
                <g key={String(layer.halo)} data-sd-halo={layer.halo||undefined} stroke={layer.stroke} strokeWidth={layer.width} strokeLinecap="round"><line x1={cx} x2={cx} y1={y(v.upper!)} y2={y(v.lower!)}/><line x1={cx-5} x2={cx+5} y1={y(v.upper!)} y2={y(v.upper!)}/><line x1={cx-5} x2={cx+5} y1={y(v.lower!)} y2={y(v.lower!)}/></g>)}
              {!bars&&<circle data-mean-marker="true" cx={cx} cy={y(v.mean)} r={style.pointSize+.8} fill={paint.outline} stroke="#fff" strokeWidth="1.5"><title>{labelFor(s.label)} · {categories.find(c=>c.key===v.category)?.label}: {logY?'geometric mean':'mean'} {compact(v.mean)}{kind==='expression'?'×':''} · n = {v.n}</title></circle>}
            </>}
          </g>
        })}</g>
      })}
      {visibleMarkers.map(entry=>{const si=series.findIndex(s=>s.key===entry.series),summary=summaries.find(s=>s.series===entry.series&&s.category===entry.category);if(si<0||!summary||summary.upper==null)return null;const highest=Math.max(summary.upper,...summary.members.flatMap(member=>member.values));return <text data-significance-p={entry.p} data-comparison={entry.condition} key={`${entry.run}:${entry.condition}`} x={center(entry.category!,si)} y={Math.max(f.top+12,y(highest)-12)} textAnchor="middle" fontSize="18" fontWeight="600" fill={theme.ink}>{entry.mark}<title>{entry.condition} versus saved baseline · Holm-adjusted p = {entry.p}; biological n = {entry.n}, baseline n = {entry.controlN}. {entry.reason}</title></text>})}
      </g>{f.xTicks.map((tick,i)=><g data-axis-tick="x" key={i}><line x1={tick.position} x2={tick.position} y1={f.bottom} y2={f.bottom+4} stroke={theme.axis} strokeWidth={theme.axisWidth}/><text x={tick.position} y={f.xLabelY} textAnchor="middle" fontSize={T.tick} fill={theme.muted}>{f.tickLines[i].map((line,j)=><tspan key={j} x={tick.position} dy={j?15:0}>{line}</tspan>)}</text></g>)}
      {f.xTitleLines.length>0&&<text x={(f.left+f.right)/2} y={f.xTitleY} textAnchor="middle" fontSize={T.axisTitle} fill={theme.ink}>{f.xTitleLines.map((line,index)=><tspan key={index} x={(f.left+f.right)/2} dy={index?16:0}>{line}</tspan>)}</text>}
      {f.legend.map((item,i)=>{const place=f.legendFlow.items[i];return <g key={item.key} data-legend-item="true" transform={`translate(${f.left+place.x},${f.legendTop+f.rowTops[place.row]+6})`}>{bars?<rect x="0" y="-5" width="14" height="10" fill={item.color} fillOpacity={style.barOpacity} stroke={item.color} strokeWidth={style.outlineWidth}/>:<><line x1="0" x2="16" y1="0" y2="0" stroke={item.color} strokeWidth={Math.max(1.5,style.lineWidth)} strokeLinecap="round"/><circle cx="8" cy="0" r="3.4" fill={item.color} stroke="#fff" strokeWidth="1"/></>}<text x="22" y={T.legend*.35} fontSize={T.legend} fill={theme.ink}>{item.lines.map((line,j)=><tspan key={j} x="22" dy={j?16:0}>{line}</tspan>)}</text></g>})}
      {f.labels.map((label,i)=><text key={series[i].key} data-direct-label="true" x={f.right+10} y={f.labelYs[i]+T.legend*.35} fontSize={T.legend} fontWeight="600" fill={primaryLegend[i].color}>{label}</text>)}
      {extraLegend.map((item,i)=>f.extras[i]&&<g key={item.key} transform={`translate(${f.left},${f.extraTop+extraOffsets[i]*19})`}><circle cx="6" cy="0" r="4" fill={item.color}/><text x="18" y="4" fontSize={T.legend} fill={theme.ink}>{f.extras[i].map((line,j)=><tspan key={j} x="18" dy={j?19:0}>{line}</tspan>)}</text></g>)}
      {f.footerLines.map((line,i)=><text data-baseline-label={line.startsWith('Dashed line:')?'true':undefined} key={i} x={f.left} y={f.footerStart+i*16} fontSize={T.footer} fill={reviewNote&&line.includes('STALE')?'#9e4e35':theme.muted}>{line}</text>)}
    </svg>
  }

  const headingTags=[compactDisplay?'':kind==='ct'?technical?'Technical controls · raw Ct':'Raw Ct':'Expression',custom?.axes&&'custom axes',custom?.style&&'custom style',draft&&'preview'].filter(Boolean).join(' · ')
  return <article className="figure-card" data-size={preset} data-compact={compactDisplay} data-theme={theme.name}>
    <div className="figure-heading"><div className="figure-identity"><h4>{title}</h4>{headingTags&&<span>{headingTags}</span>}{status}</div><div className="figure-actions">{toolbar}{onOptionsChange&&<button className="figure-action plot-settings-button" aria-label={`Settings for ${title} ${kind}`} onClick={()=>setDraft(storedOptions)}>Settings</button>}<details className="figure-export-menu" onToggle={event=>setExportOpen(event.currentTarget.open)}><summary className="figure-action" aria-label={`Export ${title} ${kind}`}>Export</summary><div className="figure-downloads"><button className="quiet-button figure-export" disabled={!finite.length} onClick={download} aria-label={`Download ${title} ${kind} SVG`}>Vector SVG</button><button className="quiet-button figure-export" disabled={!finite.length||exportBusy} onClick={()=>void downloadPng()} aria-label={`Download ${title} ${kind} PNG 600 dpi`}>{exportBusy?'Exporting…':'PNG · 600 dpi'}</button><button className="quiet-button figure-export" disabled={!dataRows.length} onClick={downloadData} aria-label={`Download ${title} ${kind} plotted data`}>Data CSV</button><button className="quiet-button figure-export" onClick={downloadMethods} aria-label={`Download ${title} ${kind} methods`}>Methods JSON</button></div></details></div></div>
    {draft&&onOptionsChange&&<PlotSettings title={title} kind={kind} options={draft} onChange={setDraft} onApply={scope=>{onOptionsChange(draft,scope);setDraft(null)}} onClose={()=>setDraft(null)} onInherit={()=>{onInherit?.();setDraft(null)}} errors={errors} temporal={temporal} groupsFor={groupsFor} labelFor={labelFor} colorFor={colorFor} observations={observations} bars={bars} barColorFor={bar=>{const value=summaries.find(summary=>barKey(summary.series,summary.category)===bar);if(!value)return '#167b80';const index=series.findIndex(series=>series.key===value.series);return meanPaint(value.members,index,value.category).bar}} pointColorFor={pointPaint} custom={Boolean(custom)}/>}
    {unitNote&&<p className="figure-clipping-note" role="status">{unitNote}</p>}
    {clippingNote&&<p className="figure-clipping-note" role="status">{clippingNote}</p>}
    {exportStatus&&<p className="figure-export-status" role="status">{exportStatus}</p>}
    {!finite.length ? <p className="figure-empty">{emptyMessage ?? `No numeric ${kind==='ct'?'Ct values':'normalized results'} in this selection. Missing / undetermined: ${missing}.`}</p>
     : compactDisplay ? <div className="figure-scroll plot-viewport" ref={viewportRef}>{renderSvg(screenFrame)}</div>
     : <div className="figure-scroll plot-viewport" ref={viewportRef} style={{aspectRatio:`${screenFrame.width}/${screenFrame.viewBottom-screenFrame.viewTop}`,overflow:'hidden',padding:0}}>{renderSvg(screenFrame,undefined,true)}</div>}
    {exportOpen&&finite.length>0&&<div className="figure-export-source" hidden>{renderSvg(fullFrame,svg)}</div>}
    {extraLegend.length>0&&<details className="figure-color-key screen-only"><summary>Point color key · {extraLegend.length} labels</summary><div>{extraLegend.map(item=><p key={item.key}><span style={{background:item.color}}/>{item.label}</p>)}</div></details>}
    {!compactDisplay&&<div className="figure-foot screen-only">
      {finite.length>0&&<p className="compact-figure-key">{logY?'Geometric mean ×/÷ SD · log₂ scale':'Mean ± SD'} · {directLabels?`n = ${uniformN} biological samples per point`:'n = biological samples'}{kind==='expression'?' · dashed line = 1×':''}{temporal?proportional?' · time to scale':' · times equally spaced':''}</p>}
      <details className="figure-notes"><summary>Notes</summary><p className="figure-caption">{technical?'Technical controls shown for QC only.':kind==='ct'?'Every eligible technical Ct is shown. Light circles summarize each biological sample; the filled marker and sample SD weight biological samples equally.':logY?'Biological replicate points with the geometric mean ×/÷ geometric SD (the mean ± SD of log₂ fold change, i.e. of −ΔΔCt). Fold changes remain relative to each analysis’s saved baseline.':'Biological replicate points with mean ± sample SD. Fold changes remain relative to each analysis’s saved baseline. SD below zero is clipped at zero.'} {kind==='ct'&&`${missing} missing/undetermined; ${omitted} instrument-omitted or researcher-excluded measurements.`}</p><p>{reviewNote}</p></details>
    </div>}
    {compactDisplay&&finite.length>0&&specificNotes.length>0&&<p className={`panel-notes${panelNotes==='print'?' print-only':''}`}>{specificNotes.join(' ')}</p>}
    {footer}
  </article>
}

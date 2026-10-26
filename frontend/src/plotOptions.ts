import type {Observation} from './plotData'
import {mean,sampleSD} from './plotData'
import type {TimeSpacing} from './figureLayout'

export type ColorBy='series'|'condition'|'confluency'|'cell_line'|'run'|'sample'
export type AxesOptions={xMin:number|null;xMax:number|null;yMin:number|null;yMax:number|null;xTick:number|null;yTick:number|null;xLabel:string;yLabel:string;spacing:TimeSpacing;xUnit:'day'|'hour'|null;sharedY:boolean}
export type MarkColors={bar?:string;point?:string;outline?:string}
export type StyleOptions={colorBy:ColorBy;groups:Record<string,MarkColors>;barColors:Record<string,string>;sampleColors:Record<string,string>;barOpacity:number;pointSize:number;pointFilled:boolean;lineWidth:number;outlineWidth:number;grid:boolean}
export type PlotOptions={axes:AxesOptions;style:StyleOptions}
export type PlotOverride={axes?:AxesOptions;style?:StyleOptions}
export type ColorGroup={key:string;label:string}
export const defaultAxes=():AxesOptions=>({xMin:null,xMax:null,yMin:null,yMax:null,xTick:null,yTick:null,xLabel:'',yLabel:'',spacing:'auto',xUnit:null,sharedY:false})
export const defaultStyle=():StyleOptions=>({colorBy:'series',groups:{},barColors:{},sampleColors:{},barOpacity:.22,pointSize:4.2,pointFilled:false,lineWidth:1.8,outlineWidth:1.2,grid:true})
export const defaultPlotOptions=():PlotOptions=>({axes:defaultAxes(),style:defaultStyle()})
const isColor=(value:unknown):value is string=>typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value)
const colorMap=(value:unknown):Record<string,string>=>value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter((entry):entry is [string,string]=>isColor(entry[1]))):{}
export function cleanAxes(value:unknown):AxesOptions {
 const result=defaultAxes();if(!value||typeof value!=='object')return result
 const input=value as Partial<AxesOptions>
 for(const key of ['xMin','xMax','yMin','yMax','xTick','yTick'] as const)if(typeof input[key]==='number'&&Number.isFinite(input[key]))result[key]=input[key]!
 if(typeof input.xLabel==='string')result.xLabel=input.xLabel.slice(0,140)
 if(typeof input.yLabel==='string')result.yLabel=input.yLabel.slice(0,140)
 if(['auto','measured','proportional'].includes(input.spacing??''))result.spacing=input.spacing!
 if(input.xUnit==='day'||input.xUnit==='hour')result.xUnit=input.xUnit
 result.sharedY=input.sharedY===true
 if(result.xTick!=null&&result.xTick<=0)result.xTick=null
 if(result.yTick!=null&&result.yTick<=0)result.yTick=null
 if(result.xMin!=null&&result.xMax!=null&&result.xMin>=result.xMax){result.xMin=null;result.xMax=null}
 if(result.yMin!=null&&result.yMax!=null&&result.yMin>=result.yMax){result.yMin=null;result.yMax=null}
 return result
}
export function cleanStyle(value:unknown):StyleOptions {
 const result=defaultStyle();if(!value||typeof value!=='object')return result
 const input=value as Partial<StyleOptions>
 if(['series','condition','confluency','cell_line','run','sample'].includes(input.colorBy??''))result.colorBy=input.colorBy!
 for(const [key,low,high] of [['barOpacity',.05,1],['pointSize',2,8],['lineWidth',.5,4],['outlineWidth',.5,3]] as const)if(typeof input[key]==='number'&&Number.isFinite(input[key]))result[key]=Math.max(low,Math.min(high,input[key]!))
 if(typeof input.pointFilled==='boolean')result.pointFilled=input.pointFilled
 if(typeof input.grid==='boolean')result.grid=input.grid
 result.barColors=colorMap(input.barColors);result.sampleColors=colorMap(input.sampleColors)
 if(input.groups&&typeof input.groups==='object')result.groups=Object.fromEntries(Object.entries(input.groups).filter(([,v])=>v&&typeof v==='object').map(([key,v])=>[key,Object.fromEntries(Object.entries(v).filter(([channel,color])=>['bar','point','outline'].includes(channel)&&isColor(color)))]))
 return result
}
export function colorGroup(point:Observation,by:ColorBy):ColorGroup {
 const row=point.data?.[0]??{}
 if(by==='sample')return {key:JSON.stringify([point.run,point.sample]),label:`${point.sample} · ${String(row.run??point.run)}`}
 const value=by==='series'?point.seriesLabel:by==='condition'?row.series??point.seriesLabel:by==='run'?row.run??point.run:row[by]||'Not annotated'
 return {key:String(value),label:String(value).replaceAll('_',' ')}
}
export function colorGroups(points:Observation[],by:ColorBy):ColorGroup[] {return [...new Map(points.map(point=>{const group=colorGroup(point,by);return [group.key,group]})).values()].sort((a,b)=>a.label.localeCompare(b.label,undefined,{numeric:true}))}
export const barKey=(series:string,category:string)=>JSON.stringify([series,category])
export const sampleColorKey=(point:Observation)=>JSON.stringify([point.run,point.sample])
export function automaticYRange(points:Observation[],kind:'ct'|'expression'):[number,number] {
 const groups=new Map<string,number[]>();const values:number[]=[]
 for(const point of points){values.push(...point.values,...(point.omitted??[]));const avg=mean(point.values);if(avg!=null){const key=JSON.stringify([point.data?.[0]?.assay,point.series,point.category]);groups.set(key,[...(groups.get(key)??[]),avg])}}
 for(const group of groups.values()){const avg=mean(group)!;const sd=sampleSD(group)??0;values.push(avg-sd,avg+sd)}
 const finite=values.filter(Number.isFinite)
 if(kind==='expression')return [0,Math.max(2,...finite.map(value=>value*1.24))]
 return [Math.max(0,Math.min(...finite,40)-.6),Math.max(2,...finite.map(value=>value+.6))]
}
export function axisErrors(axes:AxesOptions,temporal:boolean,unit?:string):string[] {
 const errors:string[]=[]
 for(const [name,min,max,tick] of [['X',axes.xMin,axes.xMax,axes.xTick],['Y',axes.yMin,axes.yMax,axes.yTick]] as const){
  if(min!=null&&!Number.isFinite(min)||max!=null&&!Number.isFinite(max)||tick!=null&&!Number.isFinite(tick))errors.push(`${name} values must be finite numbers.`)
  if(min!=null&&max!=null&&min>=max)errors.push(`${name} minimum must be smaller than its maximum.`)
  if(tick!=null&&tick<=0)errors.push(`${name} tick spacing must be positive.`)
  if(tick!=null&&min!=null&&max!=null&&(max-min)/tick>40)errors.push(`${name} tick spacing would create more than 40 ticks.`)
 }
 if(unit&&axes.xUnit&&unit!==axes.xUnit&&(axes.xMin!=null||axes.xMax!=null||axes.xTick!=null||axes.xLabel))errors.push(`Saved X settings use ${axes.xUnit}s; reset X settings before applying them to ${unit}s.`)
 if(!temporal&&(axes.xMin!=null||axes.xMax!=null||axes.xTick!=null))errors.push('Numeric X settings require time points in one unit.')
 if(temporal&&(axes.xMin!=null||axes.xMax!=null||axes.xTick!=null)&&axes.spacing!=='proportional')errors.push('Numeric X limits and tick spacing require proportional time.')
 return errors
}

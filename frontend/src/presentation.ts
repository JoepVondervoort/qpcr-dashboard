import {cleanAxes,cleanStyle,defaultPlotOptions,type PlotOptions,type PlotOverride} from './plotOptions'
import {FIGURE_THEMES,type FigureThemeName} from './figureTheme'
export const palettes = {
 classic: {label:'Teal & rust',colors:['#167b80','#b56445','#5065a2','#946eab','#7c833a','#be748c','#426b7a','#ab8a38']},
 accessible: {label:'Blue & vermilion',colors:['#0072b2','#d55e00','#009e73','#8b5196','#795b00','#326c86','#333333']},
 cool: {label:'Cool tones',colors:['#2456a6','#6f48a0','#167b80','#98604c','#446b40','#914c72']},
} as const
export type Presentation={figureTheme:FigureThemeName;palette:keyof typeof palettes;colors:Record<string,string>;order:string[];favorites:string[];showSignificance:boolean;plotDefaults:{ct:PlotOptions;expression:PlotOptions};plotOverrides:Record<string,PlotOverride>}
export const defaultPresentation=():Presentation=>({figureTheme:'screen',palette:'classic',colors:{},order:[],favorites:[],showSignificance:true,plotDefaults:{ct:defaultPlotOptions(),expression:defaultPlotOptions()},plotOverrides:{}})
export function readPresentation(value:unknown):Presentation {
 const base=defaultPresentation()
 if(!value||typeof value!=='object')return base
 const input=value as Partial<Presentation>
 if(input.palette&&Object.hasOwn(palettes,input.palette))base.palette=input.palette
 if((FIGURE_THEMES as readonly unknown[]).includes(input.figureTheme))base.figureTheme=input.figureTheme!
 if(input.colors&&typeof input.colors==='object')base.colors=Object.fromEntries(Object.entries(input.colors).filter(([key,color])=>key&&typeof color==='string'&&/^#[0-9a-f]{6}$/i.test(color)))
 const names=(value:unknown)=>Array.isArray(value)?[...new Set(value.filter((v):v is string=>typeof v==='string'))]:[]
 base.order=names(input.order);base.favorites=names(input.favorites)
 if(typeof input.showSignificance==='boolean')base.showSignificance=input.showSignificance
 if(input.plotDefaults)for(const kind of ['ct','expression'] as const){const value=input.plotDefaults[kind];if(value)base.plotDefaults[kind]={axes:cleanAxes(value.axes),style:cleanStyle(value.style)}}
 if(input.plotOverrides&&typeof input.plotOverrides==='object')base.plotOverrides=Object.fromEntries(Object.entries(input.plotOverrides).filter(([,v])=>v&&typeof v==='object').map(([key,v])=>[key,{...(v.axes?{axes:cleanAxes(v.axes)}:{}),...(v.style?{style:cleanStyle(v.style)}:{})}]))
 return base
}
export function orderedAssays(assays:string[],order:string[]):string[] {return [...order.filter(a=>assays.includes(a)),...assays.filter(a=>!order.includes(a))]}
export function reorderAssays(order:string[],from:string,to:string):string[] {
 const next=[...order],start=next.indexOf(from),end=next.indexOf(to)
 if(start<0||end<0||start===end)return next
 next.splice(start,1);next.splice(end,0,from);return next
}
export function seriesColor(label:string,index:number,presentation:Presentation):string {
 return presentation.colors[label]??palettes[presentation.palette].colors[index%palettes[presentation.palette].colors.length]
}

export const plotKey=(kind:'ct'|'expression',assay:string,technical=false)=>JSON.stringify([kind,assay,technical])
export function effectivePlotOptions(presentation:Presentation,key:string,kind:'ct'|'expression'):PlotOptions {return {...presentation.plotDefaults[kind],...presentation.plotOverrides[key]}}
export function applyPlotOptions(presentation:Presentation,key:string,kind:'ct'|'expression',options:PlotOptions,scope:'plot'|'axes'|'style'):Presentation {
 if(scope==='plot'){const override:PlotOverride={};if(JSON.stringify(options.axes)!==JSON.stringify(presentation.plotDefaults[kind].axes))override.axes=options.axes;if(JSON.stringify(options.style)!==JSON.stringify(presentation.plotDefaults[kind].style))override.style=options.style;const overrides={...presentation.plotOverrides};if(override.axes||override.style)overrides[key]=override;else delete overrides[key];return {...presentation,plotOverrides:overrides}}
 const next={...presentation,plotDefaults:{...presentation.plotDefaults},plotOverrides:{...presentation.plotOverrides}}
 if(scope==='axes')next.plotDefaults[kind]={...next.plotDefaults[kind],axes:options.axes}
 else for(const k of ['ct','expression'] as const)next.plotDefaults[k]={...next.plotDefaults[k],style:options.style}
 for(const [id,value] of Object.entries(next.plotOverrides)){
  if(scope==='axes'&&!id.startsWith(`["${kind}",`))continue
  const updated={...value};delete updated[scope==='axes'?'axes':'style']
  if(updated.axes||updated.style)next.plotOverrides[id]=updated;else delete next.plotOverrides[id]
 }
 return next
}

/** Share (or stop sharing) the y-range for one quantity while keeping every per-plot axis choice. */
export function setSharedY(presentation:Presentation,kind:'ct'|'expression',sharedY:boolean):Presentation {
 const prefix=`["${kind}",`
 return {...presentation,
  plotDefaults:{...presentation.plotDefaults,[kind]:{...presentation.plotDefaults[kind],axes:{...presentation.plotDefaults[kind].axes,sharedY}}},
  plotOverrides:Object.fromEntries(Object.entries(presentation.plotOverrides).map(([key,value])=>[key,key.startsWith(prefix)&&value.axes?{...value,axes:{...value.axes,sharedY}}:value]))}
}

export function resetPlotColors(presentation:Presentation):Presentation {
 const clear=(style:PlotOptions['style'])=>({...style,groups:{},barColors:{},sampleColors:{}})
 return {...presentation,palette:'classic',colors:{},plotDefaults:{ct:{...presentation.plotDefaults.ct,style:clear(presentation.plotDefaults.ct.style)},expression:{...presentation.plotDefaults.expression,style:clear(presentation.plotDefaults.expression.style)}},plotOverrides:Object.fromEntries(Object.entries(presentation.plotOverrides).map(([key,value])=>[key,{...value,...(value.style?{style:clear(value.style)}:{})}]))}
}

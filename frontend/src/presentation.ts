export const palettes = {
 classic: {label:'Teal & rust',colors:['#167b80','#b56445','#5065a2','#946eab','#7c833a','#be748c','#426b7a','#ab8a38']},
 accessible: {label:'Blue & vermilion',colors:['#0072b2','#d55e00','#009e73','#8b5196','#795b00','#326c86','#333333']},
 cool: {label:'Cool tones',colors:['#2456a6','#6f48a0','#167b80','#98604c','#446b40','#914c72']},
} as const
export type Presentation={palette:keyof typeof palettes;colors:Record<string,string>;order:string[];favorites:string[];showSignificance:boolean}
export const defaultPresentation=():Presentation=>({palette:'classic',colors:{},order:[],favorites:[],showSignificance:true})
export function readPresentation(value:unknown):Presentation {
 const base=defaultPresentation()
 if(!value||typeof value!=='object')return base
 const input=value as Partial<Presentation>
 if(input.palette&&Object.hasOwn(palettes,input.palette))base.palette=input.palette
 if(input.colors&&typeof input.colors==='object')base.colors=Object.fromEntries(Object.entries(input.colors).filter(([key,color])=>key&&typeof color==='string'&&/^#[0-9a-f]{6}$/i.test(color)))
 const names=(value:unknown)=>Array.isArray(value)?[...new Set(value.filter((v):v is string=>typeof v==='string'))]:[]
 base.order=names(input.order);base.favorites=names(input.favorites)
 if(typeof input.showSignificance==='boolean')base.showSignificance=input.showSignificance
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

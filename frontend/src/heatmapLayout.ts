export type GeneOrder='assay'|'effect'
type Rgb=[number,number,number]
const SATURATION=3
const NEUTRAL:Rgb=[247,249,248],UP:Rgb=[22,112,118],DOWN:Rgb=[176,88,56]
const CT_LIGHT:Rgb=[238,245,244],CT_DARK:Rgb=[16,78,88]
const mix=(from:Rgb,to:Rgb,amount:number)=>`rgb(${from.map((c,i)=>Math.round(c+(to[i]-c)*amount)).join(',')})`

/** Spanning header cells for consecutive columns that share a condition series and run. */
export function groupColumns(columns:{series:string;run:string;groupLabel:string}[]):{label:string;span:number}[] {
 return columns.reduce<{key:string;label:string;span:number}[]>((groups,column)=>{
  const key=JSON.stringify([column.series,column.run]),last=groups.at(-1)
  return last?.key===key?[...groups.slice(0,-1),{...last,span:last.span+1}]:[...groups,{key,label:column.groupLabel,span:1}]
 },[]).map(({label,span})=>({label,span}))
}

/** Diverging teal (higher) / rust (lower) on log2 fold change from a near-white 1×, saturating at 8× either way. */
export function foldColor(fold:number|null):string {
 if(fold==null||!(fold>0))return 'var(--heat-empty)'
 const log=Math.log2(fold)
 return mix(NEUTRAL,log>=0?UP:DOWN,Math.min(1,Math.abs(log)/SATURATION))
}

/** Whole-cycle Ct limits around the visible values, at least three cycles wide. */
export function ctDomain(values:number[]):[number,number] {
 const finite=values.filter(Number.isFinite)
 if(!finite.length)return [15,35]
 const low=Math.floor(Math.min(...finite)),high=Math.ceil(Math.max(...finite))
 return high-low<3?[low-1,low+2]:[low,high]
}

/** Lower Ct (more template) is darker, as on the plate map. */
export function ctColor(ct:number|null,[low,high]:[number,number]):string {
 if(ct==null)return 'var(--heat-empty)'
 return mix(CT_LIGHT,CT_DARK,1-Math.min(1,Math.max(0,(ct-low)/Math.max(1e-9,high-low))))
}

const channel=(value:number)=>{const v=value/255;return v<=.03928?v/12.92:((v+.055)/1.055)**2.4}
const contrast=(a:number,b:number)=>(Math.max(a,b)+.05)/(Math.min(a,b)+.05)
// --heat-ink is black: with white as the alternative, every fill then reaches at least 4.5:1.
const INK_LUMINANCE=0
/** Whichever of white or the heat ink contrasts more with the fill (ink for CSS-variable fills). */
export function textOn(color:string):string {
 const rgb=color.match(/^rgb\((\d+),(\d+),(\d+)\)$/)
 if(!rgb)return 'var(--heat-ink)'
 const [r,g,b]=rgb.slice(1).map(Number).map(channel),fill=.2126*r+.7152*g+.0722*b
 return contrast(1,fill)>contrast(fill,INK_LUMINANCE)?'#fff':'var(--heat-ink)'
}

/** Two significant figures: a heatmap is for comparison; exact values are in the tooltip. */
export const foldLabel=(fold:number)=>`${Number(fold.toPrecision(2))}×`

const fractions:Record<number,string>={[-3]:'⅛',[-2]:'¼',[-1]:'½'}
export function legendTicks():{log2:number;label:string;color:string}[] {
 return Array.from({length:SATURATION*2+1},(_,i)=>i-SATURATION).map(log2=>({log2,label:`${fractions[log2]??2**log2}×`,color:foldColor(2**log2)}))
}

export function legendGradient():string {
 const ticks=legendTicks()
 return `linear-gradient(90deg,${ticks.map((tick,i)=>`${tick.color} ${(i/(ticks.length-1)*100).toFixed(1)}%`).join(',')})`
}

/** The most frequent biological n in a column (the larger on a tie), so only exceptions need a label. */
export function typicalN(counts:number[]):number|null {
 const frequency=counts.reduce((map,n)=>map.set(n,(map.get(n)??0)+1),new Map<number,number>())
 return [...frequency.entries()].sort((a,b)=>b[1]-a[1]||b[0]-a[0])[0]?.[0]??null
}

export function sortRows<T extends {assay:string;effect:number|null}>(rows:T[],order:GeneOrder):T[] {
 if(order==='assay')return rows
 return [...rows].sort((a,b)=>(b.effect??-1)-(a.effect??-1))
}

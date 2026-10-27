export type GeneOrder='assay'|'effect'
const SATURATION=3
const UP='22,123,128',DOWN='181,100,69'

/** Spanning header cells for consecutive columns that share a condition series and run. */
export function groupColumns(columns:{series:string;run:string;groupLabel:string}[]):{label:string;span:number}[] {
 return columns.reduce<{key:string;label:string;span:number}[]>((groups,column)=>{
  const key=JSON.stringify([column.series,column.run]),last=groups.at(-1)
  return last?.key===key?[...groups.slice(0,-1),{...last,span:last.span+1}]:[...groups,{key,label:column.groupLabel,span:1}]
 },[]).map(({label,span})=>({label,span}))
}

/** Diverging teal (higher) / rust (lower) on log2 fold change, saturating at 8× either way. */
export function foldColor(fold:number|null):string {
 if(fold==null||!(fold>0))return 'var(--heat-empty)'
 const log=Math.log2(fold),amount=Math.min(1,Math.abs(log)/SATURATION)
 return `rgba(${log>=0?UP:DOWN},${(.08+.68*amount).toFixed(3)})`
}

const fractions:Record<number,string>={[-3]:'⅛',[-2]:'¼',[-1]:'½'}
export function legendTicks():{log2:number;label:string;color:string}[] {
 return Array.from({length:SATURATION*2+1},(_,i)=>i-SATURATION).map(log2=>({log2,label:`${fractions[log2]??2**log2}×`,color:foldColor(2**log2)}))
}

export function sortRows<T extends {assay:string;effect:number|null}>(rows:T[],order:GeneOrder):T[] {
 if(order==='assay')return rows
 return [...rows].sort((a,b)=>(b.effect??-1)-(a.effect??-1))
}

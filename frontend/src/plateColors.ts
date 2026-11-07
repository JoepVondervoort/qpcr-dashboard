import {seriesColor,type Presentation} from './presentation'
/**
 * Muted fills, so each sample's or condition's wells read as one patch and a Ct printed on them stays legible.
 * Colors follow the order of the values given; with 13 of them, a block and the block below it (12 or 6 samples
 * later in common layouts) never share a color.
 */
export const FILLS=['#d6e9e4','#f3dfc4','#dcdcf0','#f0d5d5','#d9e8c9','#e8d9ec','#cfe3f0','#efe7c2','#e2d6cc','#cfe8dc','#f2d9e6','#d8dde3','#e6ecd3']

export function fillsFor(values:string[]):Map<string,string> {
 const distinct=[...new Set(values)]
 return new Map(distinct.map((value,index)=>[value,FILLS[index%FILLS.length]]))
}

/** Fixed Ct scale so filtering the table never changes a measurement's color. */
export function ctFill(ct:number|null):string|undefined {
 if(ct==null||!Number.isFinite(ct))return undefined
 const fraction=Math.min(1,Math.max(0,(ct-15)/(38-15)))
 return `hsl(${(120*(1-fraction)).toFixed(1)} 60% 85%)`
}

/** Use the figure palette and condition overrides, with a pale fill for readable labels. */
export function categoryFills(conditions:{group:string;series:string}[],assays:string[],presentation:Presentation) {
 const domain=[...new Set(conditions.map(item=>item.series))].sort((a,b)=>a.replaceAll('_',' ').localeCompare(b.replaceAll('_',' '),undefined,{numeric:true}))
 const style=presentation.plotDefaults.ct.style
 const group=new Map(conditions.map(item=>{
  const custom=style.colorBy==='condition'?style.groups[item.series]:undefined
  const color=custom?.outline??custom?.point??custom?.bar??seriesColor(`condition:${item.series}`,domain.indexOf(item.series),presentation)
  return [item.group,`${color}26`]
 }))
 const genes=[...new Set(assays)].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'}))
 const assay=new Map(genes.map((gene,index)=>[gene,`${seriesColor(`gene:${gene}`,index,presentation)}26`]))
 return {group,assay}
}

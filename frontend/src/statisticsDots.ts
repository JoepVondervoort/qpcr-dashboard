import {mean} from './plotData'

type GroupDeltas={condition:string;is_baseline:boolean;delta_ct_values?:number[]}

/**
 * Per-sample log2 fold changes for small dot plots: log2 FC = mean baseline ΔCt − sample ΔCt,
 * the same −ΔΔCt the analysis uses. Null when no baseline ΔCt values were saved.
 */
export function conditionDots(groups:GroupDeltas[]):{values:Record<string,number[]>;domain:[number,number]}|null {
 const reference=mean(groups.filter(group=>group.is_baseline).flatMap(group=>group.delta_ct_values??[]))
 if(reference==null)return null
 const values=Object.fromEntries(groups.map(group=>[group.condition,(group.delta_ct_values??[]).map(delta=>reference-delta)]))
 const all=[0,...Object.values(values).flat()],low=Math.min(...all),high=Math.max(...all),pad=Math.max(.25,.08*(high-low))
 return {values,domain:[low-pad,high+pad]}
}

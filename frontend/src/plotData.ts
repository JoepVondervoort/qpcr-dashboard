import type { SampleMetadata, AnalysisResult } from './types'

export const mean = (values: number[]) => values.length ? values.reduce((a,b) => a+b,0)/values.length : null
export const sampleSD = (values: number[]) => values.length > 1 ? Math.sqrt(values.reduce((sum,x) => sum + (x-mean(values)!)**2,0)/(values.length-1)) : null
export function suggestedMetadata(sample: string): SampleMetadata {
  const replicate = sample.match(/\.(\d+)$/)
  const condition = replicate ? sample.slice(0,replicate.index) : sample
  const time = condition.match(/\b(days?|dpt|d|hours?|hrs?|h)\s*(-?\d+(?:\.\d+)?)\b/i)
  return {condition, replicate: replicate?.[1] ?? '', series: time ? condition.replace(time[0],'').replace(/[ _-]+$/,'').trim() : condition,
    timepoint: time ? Number(time[2]) : null, time_unit: time?.[1].toLowerCase().startsWith('h') ? 'hour' : 'day'}
}
export function seriesLabel(series: string) {
  const confluency = series.match(/confluency[_\s]*(\d+)%/i)
  return confluency ? `${confluency[1]}% confluency` : series.replace(/_/g,' ')
}
export function categoryLabel(metadata: SampleMetadata) {
  return metadata.timepoint == null ? metadata.condition.replace(/_/g,' ') : `${metadata.time_unit === 'hour' ? 'Hour' : 'Day'} ${metadata.timepoint}`
}
export type Observation = {sample: string; run: string; series: string; seriesLabel: string; category: string; categoryLabel: string; time: number | null; unit: string; values: number[]; omitted?: number[]; omittedDetails?: {well:string;reason:string}[]; source: string; replicate: string; data?: Record<string,unknown>[]; methods?:Record<string,unknown>}
export function observation(sample: string, run: string, runName: string, metadata: SampleMetadata, values: number[], source: string): Observation {
  const shortRun = runName.match(/_(\d+)$/)?.[1]
  return {sample, run, series: `${run}:${metadata.timepoint == null ? '' : metadata.series}`,
    seriesLabel: metadata.timepoint == null ? (shortRun ? `Run ${shortRun}` : runName) : `${seriesLabel(metadata.series)} · ${shortRun ? `Run ${shortRun}` : runName}`,
    category: metadata.timepoint == null ? metadata.condition : `${metadata.time_unit}:${metadata.timepoint}`,
    categoryLabel: categoryLabel(metadata), time: metadata.timepoint, unit: metadata.time_unit, values, source, replicate: metadata.replicate}
}
export function latestAnalyses<T extends {run_id: string; target_assay: string}>(results: T[]): T[] {
  const seen = new Set<string>()
  return results.filter(result => { const key = `${result.run_id}\u0000${result.target_assay}`; if (seen.has(key)) return false; seen.add(key); return true })
}

export const sampleKey=(run:string,sample:string)=>JSON.stringify([run,sample])
export function sampleAnnotation(mapping:Record<string,SampleMetadata>|undefined, run:string, sample:string):SampleMetadata {return mapping?.[sampleKey(run,sample)]??mapping?.[sample]??suggestedMetadata(sample)}
export function coherentAnalyses(results:AnalysisResult[]):AnalysisResult[] {
 const sorted=[...results].sort((a,b)=>(b.created_at??'').localeCompare(a.created_at??''))
 const profile=(r:AnalysisResult)=>r.profile_id??JSON.stringify([r.reference_assays,r.baseline_samples??r.baseline_sample,r.sample_groups,r.excluded_samples,r.excluded_measurements])
 const selected=new Map<string,string>()
 for(const r of sorted)if(!selected.has(r.run_id))selected.set(r.run_id,profile(r))
 return latestAnalyses(sorted.filter(r=>selected.get(r.run_id)===profile(r)))
}

export function analysisGroup(m:SampleMetadata):string {
 if(m.timepoint==null)return m.condition.trim()
 const base=m.condition.replace(/\b(days?|dpt|d|hours?|hrs?|h)\s*-?\d+(?:\.\d+)?\b/ig,'').replace(/^[ _·-]+|[ _·-]+$/g,'')
 return `${base||m.series} · ${m.time_unit==='hour'?'Hour':'Day'} ${m.timepoint}`
}

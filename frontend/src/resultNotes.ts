import type {AnalysisResult} from './types'

type Notes=Pick<AnalysisResult,'run_id'|'baseline_samples'|'baseline_sample'|'effective_baseline_samples'|'baseline_note'|'detection_notes'>

/** The samples that define 1×: a later time point when the target was not detected at the chosen baseline. */
export const effectiveBaselines=(result:Partial<Notes>)=>result.effective_baseline_samples??result.baseline_samples??(result.baseline_sample?[result.baseline_sample]:[])

export const baselineNotes=(results:Partial<Notes>[])=>[...new Set(results.flatMap(result=>result.baseline_note?[result.baseline_note]:[]))]

/** Samples whose mean uses only the detected technical wells, for a quiet note beside the figure. */
export function detectionSummary(results:Partial<Notes>[],label:(sample:string)=>string):{text:string;detail:string}|null {
 // The same sample name may appear on two runs; each run's note is kept.
 const notes=[...new Map(results.flatMap(result=>(result.detection_notes??[]).map(note=>[JSON.stringify([result.run_id??'',note.sample,note.assay]),note] as const))).values()]
 if(!notes.length)return null
 const samples=new Set(notes.map(note=>note.sample)).size
 return {text:`Undetermined wells in ${samples} sample${samples===1?'':'s'}`,
  detail:notes.map(note=>`${label(note.sample)}: ${note.assay} ${note.detected} of ${note.total} wells`).join('; ')}
}

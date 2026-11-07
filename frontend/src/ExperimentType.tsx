import type {AnalysisType,AnalysisTypeState} from './types'

const CHOICES:{type:AnalysisType;label:string}[]=[
 {type:'expression',label:'Gene expression · fold change'},
 {type:'reference_stability',label:'Reference-gene stability · Ct per condition'},
]

/** Asked once when names or genes suggest a stability experiment; nothing changes until the scientist answers. */
export function ExperimentTypeQuestion({state,busy,onAnswer}:{state:AnalysisTypeState|undefined;busy:boolean;onAnswer:(type:AnalysisType)=>void}) {
 if(!state?.suggestion||state.confirmed)return null
 return <section className="next-step experiment-type-question" aria-labelledby="experiment-type-question">
  <div><p className="eyebrow">Experiment type</p><h3 id="experiment-type-question">Is this a reference-gene stability experiment?</h3>
   <p>A stability experiment compares the raw Ct of candidate reference genes across conditions, with no target gene, baseline or fold change. This one looks like it because:</p>
   <ul>{state.suggestion.reasons.map(reason=><li key={reason}>{reason}</li>)}</ul></div>
  <div className="question-actions"><button disabled={busy} onClick={()=>onAnswer('reference_stability')}>Yes, compare reference genes</button><button className="quiet-button" disabled={busy} onClick={()=>onAnswer('expression')}>No, it measures gene expression</button></div>
 </section>
}

/** Always available in setup: the type decides the last setup step and what the dashboard shows. */
export function ExperimentTypeChoice({state,busy,onChange}:{state:AnalysisTypeState|undefined;busy:boolean;onChange:(type:AnalysisType)=>void}) {
 const current=state?.type??'expression'
 return <div className="experiment-type-choice" role="group" aria-label="Experiment type"><span>Experiment type</span>
  <div className="segmented">{CHOICES.map(choice=><button key={choice.type} aria-pressed={current===choice.type} disabled={busy} onClick={()=>{if(current!==choice.type||!state?.confirmed)onChange(choice.type)}}>{choice.label}</button>)}</div>
 </div>
}

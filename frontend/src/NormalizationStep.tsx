import type {Experiment,Run} from './types'
import {sharedPrefix,withoutPrefix} from './sampleNames'

type Config={targetAssay:string;referenceAssays:string[];baselineSample:string}
export type NormalizationProps={
 experiment:Experiment;runs:Run[];selectedRunId:string;onSelectRun:(id:string)=>void
 assayOptions:string[];sampleOptions:string[];analyseAll:boolean;onAnalyseAll:(value:boolean)=>void
 config:Config;onTarget:(assay:string)=>void;onReference:(assay:string,checked:boolean)=>void
 baselineSamples:string[];onBaseline:(sample:string,checked:boolean)=>void
 technicalSamples:string[];onRole:(sample:string,technical:boolean)=>void
 sampleGroups:Record<string,string>;excludedSamples:Record<string,string>;onExclusion:(sample:string,reason:string)=>void
 hitThreshold:number;onThreshold:(value:number)=>void;statisticsMethod:string;onMethod:(method:string)=>void
 assumptionsConfirmed:boolean;onAssumptions:(value:boolean)=>void
 issues:string[];analysisError:string;busy:boolean;onCalculate:()=>void
 draftDirty:boolean;onRestore:()=>void;onExplainStatistics:()=>void
}
const caseless=(a:string,b:string)=>a.localeCompare(b,undefined,{sensitivity:'base',numeric:true})

export function NormalizationStep(p:NormalizationProps) {
 const design=p.experiment.experiment_design
 const welchAllowed=Boolean(design?.confirmed&&design.design_type==='independent')
 const biological=p.sampleOptions.filter(sample=>!p.technicalSamples.includes(sample))
 const prefix=sharedPrefix(biological)
 const short=(sample:string)=>withoutPrefix(sample,prefix)
 const targets=p.assayOptions.filter(assay=>!p.config.referenceAssays.includes(assay))
 return <section className="setup-step normalization-step">
  <div className="setup-block"><h4>Instrument run</h4><p className="setup-hint">Each run is normalized on its own; runs are never pooled. Plates combined into one run share its baseline.</p>
   <div className="run-cards">{p.runs.map(run=><button key={run.id} aria-pressed={p.selectedRunId===run.id} className="run-card" onClick={()=>p.onSelectRun(run.id)}><strong>{run.name}</strong><span>{run.record_count} measurements · {run.plates?.length?`${run.plates.length} plates combined`:`${run.plate_size??'Unknown'}-well`}</span></button>)}</div></div>

  <div className="setup-block setup-columns">
   <fieldset className="selection-group"><legend>Reference genes <small>{p.config.referenceAssays.length} selected</small></legend><p className="setup-hint">Choose the references your protocol specifies.</p>
    <div className="chip-options">{[...p.assayOptions].sort(caseless).filter(assay=>p.analyseAll||assay!==p.config.targetAssay).map(assay=><label key={assay} className="chip-option"><input type="checkbox" aria-label={`Use ${assay} as reference`} checked={p.config.referenceAssays.includes(assay)} onChange={e=>p.onReference(assay,e.target.checked)}/><span>{assay}</span></label>)}</div></fieldset>
   <fieldset className="selection-group"><legend>Baseline samples <small>{p.baselineSamples.length} selected</small></legend><p className="setup-hint">The biological controls that define 1×.{prefix&&<> Names shown without <code>{prefix}</code>.</>}</p>
    <div className="chip-options">{[...p.sampleOptions].sort(caseless).map(sample=>{const technical=p.technicalSamples.includes(sample),excluded=Object.hasOwn(p.excludedSamples,sample);return <label key={sample} className="chip-option" title={sample}><input type="checkbox" aria-label={`Use ${sample} as baseline`} checked={p.baselineSamples.includes(sample)} disabled={(excluded||technical)&&!p.baselineSamples.includes(sample)} onChange={e=>p.onBaseline(sample,e.target.checked)}/><span>{technical?sample:short(sample)}{technical?' · control':excluded?' · excluded':''}</span></label>})}</div></fieldset>
  </div>

  <div className="setup-block"><label className="inline-check"><input type="checkbox" checked={p.analyseAll} onChange={e=>p.onAnalyseAll(e.target.checked)}/>Calculate every non-reference gene in this run ({targets.length})</label>
   {!p.analyseAll&&<label className="target-select">Target gene<select aria-label="Target assay" value={p.config.targetAssay} onChange={e=>p.onTarget(e.target.value)}><option value="">Select a target</option>{[...p.assayOptions].sort(caseless).map(assay=><option key={assay}>{assay}</option>)}</select></label>}</div>

  <details className="setup-details setup-block"><summary>Conditions, roles and sample exclusions</summary>
   <p className="setup-hint">Condition labels come from Samples &amp; design. Technical controls stay in the raw data but are left out of expression and statistics.</p>
   <div className="results-table-wrap"><table><thead><tr><th>Sample</th><th>Role</th><th>Condition</th><th>Exclude from this analysis</th></tr></thead><tbody>
    {p.sampleOptions.map(sample=><tr key={sample}><td title={sample}>{short(sample)}</td><td><select aria-label={`Role for ${sample}`} value={p.technicalSamples.includes(sample)?'technical':'biological'} onChange={e=>p.onRole(sample,e.target.value==='technical')}><option value="biological">Biological sample</option><option value="technical">Technical control</option></select></td><td>{p.technicalSamples.includes(sample)?'—':withoutPrefix(p.sampleGroups[sample]??'',prefix)||'—'}</td>
     <td><input aria-label={`Exclusion reason for ${sample}`} placeholder="Reason (blank = include)" value={p.excludedSamples[sample]??''} onChange={e=>p.onExclusion(sample,e.target.value)}/></td></tr>)}
   </tbody></table></div></details>

  <div className="setup-block setup-columns">
   <label>Screening fold-change threshold<input type="number" min="0.01" step="0.1" value={p.hitThreshold} onChange={e=>p.onThreshold(Number(e.target.value))}/></label>
   <div className="setup-field"><label>Statistical approach<select value={p.statisticsMethod} onChange={e=>p.onMethod(e.target.value)}><option value="descriptive">Descriptive + normality diagnostics</option><option disabled={!welchAllowed} value="welch">Independent Welch comparisons + Holm</option></select></label>
    <button className="text-button" onClick={p.onExplainStatistics}>Why these statistics?</button>{!welchAllowed&&<p className="setup-hint">Welch tests need a confirmed independent-group design (step 1).</p>}</div>
  </div>
  {p.statisticsMethod==='welch'&&<label className="confirmation"><input type="checkbox" checked={p.assumptionsConfirmed} onChange={e=>p.onAssumptions(e.target.checked)}/>I confirm these are independent biological groups (no pairing, repeated samples or unmodelled blocks), and a normal-population mean comparison is justified by the protocol or prior evidence. Small-n tests are exploratory.</label>}

  <div className={`setup-summary ${p.issues.length?'needs-input':'ready'}`} aria-live="polite">
   <h4>{p.issues.length?'Before you calculate':'Ready to calculate'}</h4>
   {p.analysisError&&<p className="analysis-error" role="alert">{p.analysisError}</p>}
   <p>{p.analyseAll?`${targets.length} genes`:p.config.targetAssay||'No target'} · normalized to {p.config.referenceAssays.join(' + ')||'—'} · baseline of {p.baselineSamples.length} sample{p.baselineSamples.length===1?'':'s'}</p>
   {p.issues.length>0&&<ul>{p.issues.map(issue=><li key={issue}>{issue}</li>)}</ul>}
   <div className="qc-buttons"><button className="run-button" disabled={p.busy||p.issues.length>0} onClick={p.onCalculate}>{p.busy?'Calculating…':'Calculate expression'}</button>{p.draftDirty&&<button className="quiet-button" onClick={p.onRestore}>Restore saved setup</button>}</div>
  </div>
 </section>
}

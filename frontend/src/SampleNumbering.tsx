import type {AutoLayout,LateWells,LayoutChange,LayoutSuggestion} from './types'
import './plateLayout.css'

type Placed={run_id:string;plate:string|null;summary:string;doubts:string[]}
const key=(entry:Placed)=>`${entry.run_id}:${entry.plate??''}`
const doubtsOf=(entries:Placed[])=>[...new Set(entries.flatMap(entry=>entry.doubts))]
const NO_TEMPLATE='NTC'

function Summaries({entries}:{entries:Placed[]}) {
 const several=entries.length>1
 return <ul>{entries.map(entry=><li key={key(entry)}>{several&&entry.plate?<strong>{entry.plate}: </strong>:null}{entry.summary}</li>)}</ul>
}

/** The export names no samples: the workbench offers its reading of the plate, or the layout tools. */
export function NumberSamplesStep({suggestions,problem,busy,onNumber,onLayout}:{suggestions:LayoutSuggestion[];problem:string|null;busy:boolean;onNumber:()=>void;onLayout:()=>void}) {
 if(!suggestions.length)return null
 const doubts=doubtsOf(suggestions)
 const unnamed=suggestions.some(suggestion=>suggestion.kind==='unnamed')
 return <section className="next-step sample-numbering" aria-labelledby="number-samples-heading">
  <div><p className="eyebrow">Next step</p><h3 id="number-samples-heading">{doubts.length?'Which wells belong to one sample?':'Number the samples from the plate'}</h3>
   {problem&&<p className="numbering-doubt" role="alert">{problem}</p>}
   <p>{unnamed?'The export does not say which sample is in which well.':'The export gives every well the same name.'} The workbench read the pattern from the plate and its Ct values:</p>
   <Summaries entries={suggestions}/>
   {doubts.length>0&&<><p>It is not sure, because:</p><ul className="numbering-doubts">{doubts.map(doubt=><li key={doubt}>{doubt}</li>)}</ul></>}
   <p>Numbered samples are one group, “All samples”, until you give them their names. You can rename them or undo the numbering at any time.</p></div>
  <div className="question-actions"><button disabled={busy} onClick={onNumber}>{busy?'Numbering…':doubts.length?'Use this guess':'Number the samples'}</button>
   <button className="quiet-button" onClick={onLayout}>Set up the layout myself</button></div>
 </section>
}

/** Wells with only a late Ct: a control with a primer dimer, or a sample with little template. Only the scientist knows. */
function LateQuestion({layout,group,busy,onAnswer,onLayout}:{layout:AutoLayout;group:LateWells;busy:boolean;onAnswer:(change:LayoutChange,answer:string)=>void;onLayout:()=>void}) {
 const answer=(name:string,label:string)=>onAnswer({run_id:layout.run_id,plate:layout.plate,wells:Object.fromEntries(group.wells.map(well=>[well,name]))},`${group.wells.join(', ')} ${label}`)
 return <li className="late-question">
  <span>{layout.plate?`${layout.plate}: w`:'W'}ells {group.wells.join(', ')} {group.reason==='late'?`have only a late Ct (${group.cts})`:'have no Ct in any gene, between samples'}. Are they no-template controls{group.sample?`, or ${group.sample}${group.reason==='none'?' (a failed sample)':''}`:', or samples'}?</span>
  <span className="question-actions">
   <button className="quiet-button" disabled={busy} onClick={()=>answer(NO_TEMPLATE,'named NTC')}>No-template controls</button>
   {group.sample?<button className="quiet-button" disabled={busy} onClick={()=>answer(group.sample!,`named ${group.sample}`)}>{group.sample}</button>
    :<button className="quiet-button" onClick={onLayout}>Samples: name them in Plate layout</button>}
  </span>
 </li>
}

type NoticeProps={layouts:AutoLayout[];busy:boolean;onRename:()=>void;onUndo:()=>void;onAnswer:(change:LayoutChange,answer:string)=>void}

/** After numbering: what was assumed, the questions left for the scientist, and the ways forward (names, or undo). */
export function NumberedSamplesNotice({layouts,busy,onRename,onUndo,onAnswer}:NoticeProps) {
 if(!layouts.length)return null
 const doubts=doubtsOf(layouts)
 const questions=layouts.flatMap(layout=>(layout.late??[]).map(group=>({layout,group})))
 return <section className="next-step numbered-notice" aria-labelledby="numbered-samples-heading">
  <div><p className="eyebrow">Sample names</p><h3 id="numbered-samples-heading">The workbench numbered the samples</h3>
   <Summaries entries={layouts}/>
   {doubts.length>0&&<p className="numbering-doubt">Check the plate layout: {doubts.join(' ')}</p>}
   {questions.length>0&&<ul className="late-questions" aria-label="Wells for you to decide">{questions.map(({layout,group})=><LateQuestion key={`${key(layout)}:${group.wells[0]}`} layout={layout} group={group} busy={busy} onAnswer={onAnswer} onLayout={onRename}/>)}</ul>}
   <p>The export has no conditions, so the numbered samples are one group, “All samples”. Paste your sample names to see your conditions; <strong>Plate &amp; samples</strong> shows every well with its sample and condition.</p></div>
  <div className="question-actions"><button onClick={onRename}>Give the samples their names</button>
   <button className="quiet-button" disabled={busy} onClick={onUndo}>{busy?'Working…':'Undo numbering'}</button></div>
 </section>
}

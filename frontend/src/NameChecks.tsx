import {useState} from 'react'

export type ReplicateGroup={condition:string;names:string[];note:string|null}

/**
 * Asks the scientist about sample names: which groups of names ending in a number are replicates of one condition
 * (nothing is grouped unless ticked), and to confirm other suggestions that were read with a guess.
 */
export function NameChecks({checks,busy,onConfirm,replicates=[],onReplicates}:{checks:Record<string,string>;busy:boolean;onConfirm:()=>void;replicates?:ReplicateGroup[];onReplicates?:(grouped:string[])=>void}) {
 const [ticked,setTicked]=useState<string[]>([])
 const count=Object.keys(checks).length
 const named=replicates.reduce((total,group)=>total+group.names.length,0)
 if(!count&&!named)return null
 const reasons=[...new Set(Object.values(checks))]
 const chosen=ticked.filter(condition=>replicates.some(group=>group.condition===condition))
 const all=chosen.length===replicates.length
 const toggle=(condition:string,on:boolean)=>setTicked(current=>on?[...current,condition]:current.filter(value=>value!==condition))
 return <>
  {named>0&&<div className="name-checks replicate-question" role="group" aria-labelledby="replicate-question">
   <p id="replicate-question"><strong>{named} sample names end in a number that may count replicates.</strong> Tick each group whose names are replicates of one condition. The number could also be a dose or a sample number, so a group is only combined when you tick it.</p>
   <div className="replicate-groups">{replicates.map(group=><label key={group.condition} className="inline-check">
    <input type="checkbox" checked={chosen.includes(group.condition)} onChange={event=>toggle(group.condition,event.target.checked)}/>
    <span><strong>{group.condition}</strong>: {group.names.join(', ')}{group.note&&<small className="replicate-note">{group.note}</small>}</span>
   </label>)}</div>
   <div className="question-actions">
    <button disabled={busy} onClick={()=>onReplicates?.(chosen)}>{chosen.length?`Save: ${chosen.length} group${chosen.length===1?'':'s'} as replicates${all?'':`, ${replicates.length-chosen.length} kept separate`}`:'Save: keep every name as its own condition'}</button>
    <button className="quiet-button" disabled={busy} onClick={()=>setTicked(all?[]:replicates.map(group=>group.condition))}>{all?'Untick all':'Tick all'}</button>
   </div>
  </div>}
  {count>0&&<div className="name-checks" role="status">
   <p><strong>{count} sample name{count===1?' was':'s were'} read with a guess.</strong> Rows marked <span className="name-check-badge">check</span> show what was read. Correct anything that is wrong, then confirm.</p>
   <ul>{reasons.slice(0,3).map(reason=><li key={reason}>{reason}</li>)}{reasons.length>3&&<li>and {reasons.length-3} similar</li>}</ul>
   <button className="quiet-button" disabled={busy} onClick={onConfirm}>Confirm {count} suggestion{count===1?'':'s'}</button>
  </div>}
 </>
}

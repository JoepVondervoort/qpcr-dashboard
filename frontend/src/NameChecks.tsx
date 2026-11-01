/** Asks the scientist to confirm suggestions that were read from unusual sample names. */
export function NameChecks({checks,busy,onConfirm}:{checks:Record<string,string>;busy:boolean;onConfirm:()=>void}) {
 const count=Object.keys(checks).length
 if(!count)return null
 const reasons=[...new Set(Object.values(checks))]
 return <div className="name-checks" role="status">
  <p><strong>{count} sample name{count===1?' was':'s were'} read with a guess.</strong> Rows marked <span className="name-check-badge">check</span> show what was read. Correct anything that is wrong, then confirm.</p>
  <ul>{reasons.slice(0,3).map(reason=><li key={reason}>{reason}</li>)}{reasons.length>3&&<li>and {reasons.length-3} similar</li>}</ul>
  <button className="quiet-button" disabled={busy} onClick={onConfirm}>Confirm {count} suggestion{count===1?'':'s'}</button>
 </div>
}

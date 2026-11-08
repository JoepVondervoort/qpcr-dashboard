import type {DashboardStatus,StatusItem} from './status'

export type StatusAction={label:string;onClick:()=>void;disabled?:boolean}

/** One line of status: the most urgent item leads with its fix; the rest follow as compact links. */
export function StatusBanner({status,actions,note,secondary=[]}:{status:DashboardStatus;actions:Partial<Record<StatusItem['id'],StatusAction>>;note?:string;secondary?:StatusAction[]}) {
 const lead=status.leadId?actions[status.leadId]:undefined
 return <section className={`review-banner status-${status.level}`} aria-label="Analysis status">
  <p className="status-headline"><span className="status-dot" aria-hidden="true"/><strong>{status.headline}</strong>{note&&<span className="status-note">{note}</span>}</p>
  {status.items.length>0&&<details className="status-details"><summary>{status.items.length} review note{status.items.length===1?'':'s'}</summary><ul className="status-items">{status.items.map(item=>{const action=actions[item.id];return <li key={item.id} data-level={item.level}>{action?<button className="text-button" disabled={action.disabled} onClick={action.onClick}>{item.text}</button>:item.text}</li>})}</ul></details>}
  <div className="status-actions">{secondary.map(action=><button key={action.label} className="quiet-button" disabled={action.disabled} onClick={action.onClick}>{action.label}</button>)}{lead&&<button className="status-action" disabled={lead.disabled} onClick={lead.onClick}>{lead.label}</button>}</div>
 </section>
}

import type {Run} from './types'
import {groupAnalysisVersions,type VersionEntry} from './historyGroups'

const runLabel=(runs:Run[],id:string)=>runs.find(run=>run.id===id)?.name??id

/** Saved calculations, one row per calculation; expand a row to open or download a single gene. */
export function HistoryPanel({versions,runs,exportPath,latestCsv,onOpen}:{versions:VersionEntry[];runs:Run[];exportPath:string;latestCsv?:{href:string;label:string};onOpen:(entry:VersionEntry)=>void}) {
 const groups=groupAnalysisVersions(versions)
 return <section className="panel history-panel">
  <div className="section-heading"><div><h3>Saved calculations</h3><p>Every calculation is kept. Open a gene to view that snapshot on the Overview; recalculating creates a new row.</p></div>{latestCsv&&<a className="button-link" href={latestCsv.href}>{latestCsv.label}</a>}</div>
  {!groups.length?<p>No saved calculations yet.</p>:<div className="results-table-wrap"><table className="history-table"><thead><tr><th>Saved</th><th>Run</th><th>Genes</th><th>Settings</th><th>Statistics</th></tr></thead><tbody>
   {groups.map(group=><tr key={group.key}>
    <td><time dateTime={group.created_at}>{new Date(group.created_at).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'})}</time></td>
    <td>{runLabel(runs,group.run_id)}</td>
    <td><details><summary>{group.entries.length===1?group.entries[0].result.target_assay:`${group.entries.length} genes`}</summary><ul className="history-genes">{group.entries.map(entry=><li key={entry.id}><button className="text-button" onClick={()=>onOpen(entry)}>{entry.result.target_assay}</button><a href={`${exportPath}/analyses/${entry.id}/export.json`} aria-label={`Download ${entry.result.target_assay} results and settings as JSON`}>JSON</a></li>)}</ul></details></td>
    <td>References {group.references.join(', ')||'—'} · {group.baselineCount} baseline sample{group.baselineCount===1?'':'s'}</td>
    <td>{group.method==='welch'?'Welch + Holm':group.method==='descriptive'?'Descriptive':group.method}</td>
   </tr>)}
  </tbody></table></div>}
 </section>
}

import {useState} from 'react'
import {ctFill} from './plateColors'
import {fileStem,saveFile} from './download'
import {matchesFilter,rowsCsv,type WellRow} from './plateCheck'

type Column={key:keyof WellRow;label:string}
// Columns that are empty for every well (no time points, no cell lines) are left out.
const OPTIONAL:Column[]=[{key:'time',label:'Time'},{key:'replicate',label:'Replicate'},{key:'cellLine',label:'Cell line'},{key:'confluency',label:'Confluency'}]
const natural=(a:string,b:string)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'})

function note(row:WellRow):string {
 const notes=[row.role==='control'?'Control':row.role==='unnamed'?'No sample name: left out':'',row.excluded,row.instrument&&row.role!=='unnamed'?`In the export: ${row.instrument}`:'']
 return notes.filter(Boolean).join(' · ')
}

/** Every measurement with the sample and condition the workbench gives it, to search, check and download. */
export function PlateCheckTable({rows,name,fills}:{rows:WellRow[];name:string;fills:{assay:Map<string,string>;group:Map<string,string>}}) {
 const [filter,setFilter]=useState(''),[gene,setGene]=useState('all')
 const genes=[...new Set(rows.map(r=>r.assay))].sort(natural)
 const visible=rows.filter(row=>(gene==='all'||row.assay===gene)&&matchesFilter(row,filter))
 const plates=new Set(rows.map(r=>r.plate)).size>1
 const columns=OPTIONAL.filter(column=>rows.some(row=>row[column.key]))
 return <div className="plate-check-table">
  <div className="table-tools">
   <label>Filter<input type="search" value={filter} placeholder="Well, sample, gene, condition or cell line" onChange={e=>setFilter(e.target.value)}/></label>
   <label>Gene<select aria-label="Gene in the table" value={gene} onChange={e=>setGene(e.target.value)}><option value="all">All genes</option>{genes.map(g=><option key={g}>{g}</option>)}</select></label>
   <span className="helper-text" role="status">{visible.length===rows.length?`${rows.length} measurements`:`${visible.length} of ${rows.length} measurements`}</span>
   <button className="quiet-button" disabled={!visible.length} onClick={()=>saveFile(`\ufeff${rowsCsv(visible)}`,'text/csv;charset=utf-8',`${fileStem(name)}-wells.csv`)}>Download CSV</button>
  </div>
  <p className="helper-text">Ct colors: green at 15 or below, yellow near 26.5, red at 38 or above. Lower Ct usually indicates more starting template; these are raw measurements, not normalized expression.</p>
  <div className="results-table-wrap"><table className="check-table">
   <caption>Each well's Ct with the sample and condition the workbench gives it</caption>
   <thead><tr>{plates&&<th scope="col">Plate</th>}<th scope="col">Well</th><th scope="col">Gene</th><th scope="col">Ct</th><th scope="col">Sample</th><th scope="col">Condition</th>
    {columns.map(column=><th scope="col" key={column.key}>{column.label}</th>)}<th scope="col">Note</th></tr></thead>
   <tbody>{visible.map(row=><tr key={row.id} data-role={row.role} data-excluded={Boolean(row.excluded)}>
    {plates&&<td>{row.plate}</td>}<td>{row.well}</td><td><span className="check-category" style={{backgroundColor:fills.assay.get(row.assay)}}>{row.assay}</span></td><td className="numeric" style={{backgroundColor:ctFill(row.ct),color:row.ct==null?undefined:'#172b2a'}} >{row.ct==null?'—':row.ct.toFixed(2)}</td>
    <td>{row.role==='unnamed'?'—':row.sample}</td><td>{row.role==='sample'&&row.group?<span className="check-category" style={{backgroundColor:fills.group.get(row.group)}}>{row.group}</span>:row.group||'—'}</td>
    {columns.map(column=><td key={column.key}>{String(row[column.key]??'')}</td>)}<td>{note(row)}</td></tr>)}</tbody>
  </table></div>
 </div>
}

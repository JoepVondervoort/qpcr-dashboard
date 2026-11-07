import {useState} from 'react'
import {fillFromList,parseLayoutGrid,parseNameList,type BlockShape,type WellAssay} from './plateLayout'
import {renameFromList,type PlateSample} from './sampleNumbering'

const BLOCKS:[string,BlockShape][]=[['1 well',{rows:1,cols:1}],['2 side by side',{rows:1,cols:2}],['2 stacked',{rows:2,cols:1}],['3 side by side',{rows:1,cols:3}],
 ['3 stacked',{rows:3,cols:1}],['4 side by side',{rows:1,cols:4}],['4 stacked',{rows:4,cols:1}],['2 × 2 block',{rows:2,cols:2}]]
export type Tool='rename'|'list'|'grid'|'name'
const plural=(count:number,word:string)=>`${count} ${word}${count===1?'':'s'}`

type Props={
 /** Wells the list fill applies to: the selection, or every measured well when nothing is selected. */
 targets:WellAssay[];selectedCount:number;plateSize:number|null|undefined
 /** Named biological samples on the plate in list order, for renaming them from a pasted list. */
 samples:PlateSample[];initialTool?:Tool
 /** Wells on this plate whose question (late Ct, or no Ct between samples) is still open: names would not line up. */
 pending?:string[]
 onAssign:(assignments:Record<string,string>,message:string)=>void
 onName:(name:string)=>void;onRestore:()=>void
}

const TOOLS:[Tool,string][]=[['rename','Rename samples'],['list','Fill from a list'],['grid','Paste a plate grid'],['name','Name selected wells']]

/** Ways to say which sample is in which well: rename the samples, a list in pipetting order, an Excel plate grid, or a name for the selection. */
export function PlateLayoutTools({targets,selectedCount,plateSize,samples,initialTool='list',pending=[],onAssign,onName,onRestore}:Props) {
 const [tool,setTool]=useState<Tool>(initialTool==='rename'&&!samples.length?'list':initialTool),[renames,setRenames]=useState(''),[names,setNames]=useState(''),[block,setBlock]=useState(0),[order,setOrder]=useState<'across'|'down'>('across')
 const [perGene,setPerGene]=useState(true),[grid,setGrid]=useState(''),[name,setName]=useState(''),[problem,setProblem]=useState('')
 const list=parseNameList(names)
 const genes=new Set(targets.map(t=>t.assay)).size,wells=new Set(targets.map(t=>t.well)).size
 function fill(){
  const result=fillFromList(targets,list,{block:BLOCKS[block][1],order,perGene})
  const notes=[result.unnamedBlocks?`${plural(result.unnamedBlocks,'sample block')} had no name left in the list and kept ${result.unnamedBlocks===1?'its':'their'} name`:'',
   result.unused?`${plural(result.unused,'name')} at the end of the list ${result.unused===1?'was':'were'} not needed`:''].filter(Boolean)
  onAssign(result.assignments,`Filled ${plural(Object.keys(result.assignments).length,'well')}${perGene&&genes>1?`, the list repeated for ${genes} genes`:''}.${notes.length?` ${notes.join('; ')}.`:''} Check the plate, then save.`)
 }
 function paste(){
  const result=parseLayoutGrid(grid,plateSize)
  setProblem(result.problems.join(' '))
  if(Object.keys(result.assignments).length)onAssign(result.assignments,`Read ${plural(Object.keys(result.assignments).length,'well')} from the pasted grid. Check the plate, then save.`)
 }
 return <div className="layout-tools">
  <div className="segmented" role="tablist" aria-label="Layout tool">{TOOLS.filter(([key])=>key!=='rename'||samples.length>0).map(([key,label])=>
   <button key={key} role="tab" aria-selected={tool===key} aria-pressed={tool===key} onClick={()=>{setTool(key);setProblem('')}}>{label}</button>)}</div>
  {tool==='rename'&&<RenameTool samples={samples} pending={pending} text={renames} onText={setRenames} onAssign={onAssign}/>}
  {tool==='list'&&<div className="layout-tool" role="tabpanel">
   <p>Paste sample names in the order you pipetted them, one per line. Each name fills one block of replicate wells, in plate order.</p>
   <label>Sample names<textarea rows={6} value={names} onChange={e=>setNames(e.target.value)} placeholder={'LNP4_50.1\nLNP4_50.2\nScrambled_50.1\n…'}/></label>
   <div className="layout-tool-row">
    <label>Wells per sample<select value={block} onChange={e=>setBlock(Number(e.target.value))}>{BLOCKS.map(([label],index)=><option key={label} value={index}>{label}</option>)}</select></label>
    <label>Numbering<select value={order} onChange={e=>setOrder(e.target.value as 'across'|'down')}><option value="across">Left to right, then down</option><option value="down">Top to bottom, then right</option></select></label>
   </div>
   <label className="check-row"><input type="checkbox" checked={perGene} onChange={e=>setPerGene(e.target.checked)}/>Start the list again for every gene (the same samples in each gene’s block of wells)</label>
   <button disabled={!list.length||!targets.length} onClick={fill}>Fill {selectedCount?plural(wells,'selected well'):`all ${wells} wells`} with {plural(list.length,'name')}</button>
  </div>}
  {tool==='grid'&&<div className="layout-tool" role="tabpanel">
   <p>Copy your plate layout from Excel, one cell per well, and paste it here. Row letters and column numbers may be included.</p>
   <label>Plate grid<textarea rows={6} value={grid} onChange={e=>setGrid(e.target.value)} placeholder={'\t1\t2\t3\nA\tHEK.1\tHEK.1\tHEK.1\nB\tHeLa.1\tHeLa.1\tHeLa.1'}/></label>
   <button disabled={!grid.trim()} onClick={paste}>Apply grid</button>
   {problem&&<p className="layout-problem" role="alert">{problem}</p>}
  </div>}
  {tool==='name'&&<div className="layout-tool" role="tabpanel">
   <p>Drag across the plate, or click a row letter or column number, to select wells. Shift-click extends the selection; Ctrl-click adds wells.</p>
   <label>Sample name<input value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. HEK.1 or H2O" onKeyDown={e=>{if(e.key==='Enter'&&name.trim()&&selectedCount)onName(name)}}/></label>
   <div className="layout-tool-row"><button disabled={!name.trim()||!selectedCount} onClick={()=>onName(name)}>Name {plural(selectedCount,'well')}</button>
    <button className="quiet-button" disabled={!selectedCount} onClick={onRestore}>Use the instrument’s names</button></div>
  </div>}
 </div>
}

function RenameTool({samples,pending,text,onText,onAssign}:{samples:PlateSample[];pending:string[];text:string;onText:(text:string)=>void;onAssign:Props['onAssign']}) {
 const names=parseNameList(text)
 const result=renameFromList(samples,names)
 function rename(){
  const wells=Object.keys(result.assignments).length
  onAssign(result.assignments,`Renamed ${plural(result.renamed,'sample')} in ${plural(wells,'well')}${result.unused?`; ${plural(result.unused,'name')} at the end of the list ${result.unused===1?'was':'were'} not needed`:''}. Check the plate, then save.`)
 }
 return <div className="layout-tool" role="tabpanel">
  <p>Give the {plural(samples.length,'sample')} their names: paste one name per line, in the order listed below. End a name with .1, .2, .3 for the biological replicates of one condition, as in Ctrl.1.</p>
  <label>New names<textarea rows={6} value={text} onChange={e=>onText(e.target.value)} placeholder={'Ctrl.1\nCtrl.2\nCtrl.3\nLNP4_50.1\n…'}/></label>
  <ol className="rename-pairs" aria-label="Current and new names">{result.pairs.map(([current,next],index)=><li key={`${index}:${current}`}><span>{current}</span><span aria-hidden="true">→</span><span data-kept={next===null}>{next??'keeps its name'}</span></li>)}</ol>
  {pending.length>0&&<p className="layout-problem" role="alert">First answer the question about wells {pending.join(', ')} (in the notice above the results): whether they are controls or a sample decides which name goes where.</p>}
  {result.pooled.length>0&&<p className="layout-problem" role="alert">{result.pooled.map(entry=>`“${entry.name}” is given to ${entry.count} samples`).join('; ')}, so their wells become one sample. Add .1, .2, .3 to keep biological replicates apart.</p>}
  <button disabled={!names.length||!samples.length||pending.length>0} onClick={rename}>Rename {plural(result.renamed,'sample')}</button>
 </div>
}

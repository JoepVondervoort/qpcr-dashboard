/** Plate geometry and the ways a scientist can say which sample is in which well. */
export const ROW_LETTERS='ABCDEFGHIJKLMNOP'

export type WellAssay={well:string;assay:string}
export type BlockShape={rows:number;cols:number}
export type FillOptions={block:BlockShape;order:'across'|'down';perGene:boolean}
export type FillResult={assignments:Record<string,string>;blocks:number;unnamedBlocks:number;unused:number}
export type GridResult={assignments:Record<string,string>;problems:string[]}

export function plateDimensions(size:number|null|undefined):{rows:number;cols:number} {
 return size===384?{rows:16,cols:24}:{rows:8,cols:12}
}

export function parseWell(well:string):{row:number;col:number}|null {
 const match=/^([A-P])(\d{1,2})$/.exec(well.trim().toUpperCase())
 if(!match)return null
 const col=Number(match[2])
 return col>=1&&col<=24?{row:ROW_LETTERS.indexOf(match[1]),col:col-1}:null
}

export const wellName=(row:number,col:number)=>`${ROW_LETTERS[row]}${col+1}`

/** Every well of the rectangle spanned by two corner wells, in reading order. */
export function wellsInRectangle(a:string,b:string):string[] {
 const first=parseWell(a),second=parseWell(b)
 if(!first||!second)return []
 const rows=[Math.min(first.row,second.row),Math.max(first.row,second.row)],cols=[Math.min(first.col,second.col),Math.max(first.col,second.col)]
 const wells:string[]=[]
 for(let row=rows[0];row<=rows[1];row++)for(let col=cols[0];col<=cols[1];col++)wells.push(wellName(row,col))
 return wells
}

type Block={row:number;col:number;wells:string[]}

/** Group wells into replicate blocks aligned to the group's own top-left well, then order the blocks. */
function blocksOf(wells:{well:string;row:number;col:number}[],{block,order}:FillOptions):Block[] {
 const top=Math.min(...wells.map(w=>w.row)),left=Math.min(...wells.map(w=>w.col))
 const byKey=new Map<string,Block>()
 for(const w of wells){
  const row=Math.floor((w.row-top)/block.rows),col=Math.floor((w.col-left)/block.cols),key=`${row},${col}`
  const existing=byKey.get(key)
  byKey.set(key,{row,col,wells:[...(existing?.wells??[]),w.well]})
 }
 return [...byKey.values()].sort((a,b)=>order==='across'?a.row-b.row||a.col-b.col:a.col-b.col||a.row-b.row)
}

/**
 * Give consecutive replicate blocks consecutive names from a list, as samples are usually pipetted.
 * With perGene, each gene's wells start the list again (genes in bands, the same samples in every band).
 */
export function fillFromList(wells:WellAssay[],names:string[],options:FillOptions):FillResult {
 const groups=new Map<string,Map<string,{well:string;row:number;col:number}>>()
 for(const {well,assay} of wells){
  const position=parseWell(well)
  if(!position)continue
  const key=options.perGene?assay:''
  groups.set(key,new Map([...(groups.get(key)??new Map()),[well,{well,...position}]]))
 }
 let assignments:Record<string,string>={},blocks=0,unnamedBlocks=0,used=0
 for(const group of groups.values()){
  blocksOf([...group.values()],options).forEach((block,index)=>{
   blocks+=1
   const name=names[index]
   if(name===undefined){unnamedBlocks+=1;return}
   used=Math.max(used,index+1)
   assignments={...assignments,...Object.fromEntries(block.wells.map(well=>[well,name]))}
  })
 }
 return {assignments,blocks,unnamedBlocks,unused:Math.max(0,names.length-used)}
}

const cellsOf=(line:string)=>line.split(line.includes('\t')?'\t':/[;,]/).map(cell=>cell.trim())
const ROW_LETTER=/^[A-P]$/i
/** "1 2 3 … n" after the corner cell. Sample numbers such as "1 1 2 2" never qualify. */
const isNumbering=(cells:string[])=>cells.length>0&&cells.every((cell,index)=>cell===String(index+1))

/** A plate layout copied from Excel: optional 1…24 header row and A…P header column. */
export function parseLayoutGrid(text:string,size:number|null|undefined):GridResult {
 const lines=text.replace(/\r/g,'').split('\n')
 while(lines.length&&!lines[lines.length-1].trim())lines.pop()
 const rows=lines.map(cellsOf)
 // Column numbers are only a header beside row letters: samples numbered 1-12 across row A look the same.
 const corner=rows[0]?.[0]??''
 const columnHeader=rows.length>1&&!/^\d+$/.test(corner)&&!ROW_LETTER.test(corner)&&isNumbering(rows[0].slice(1).filter(Boolean))
  &&rows.slice(1).every(cells=>ROW_LETTER.test(cells[0]??''))
 const data=columnHeader?rows.slice(1):rows
 const rowHeader=data.length>0&&data.every(cells=>ROW_LETTER.test(cells[0]??''))
 const numberedFirstRow=!columnHeader&&rows.length>1&&isNumbering(rows[0].filter(Boolean))
 const offset=rowHeader?1:0
 const columns=columnHeader?rows[0].slice(offset).map(cell=>Number(cell)||0):[]
 const {rows:maxRows,cols:maxCols}=plateDimensions(size)
 let assignments:Record<string,string>={},outside=false
 data.forEach((cells,index)=>{
  const row=rowHeader?ROW_LETTERS.indexOf(cells[0].toUpperCase()):index
  cells.slice(offset).forEach((name,position)=>{
   if(!name)return
   const col=(columns[position]||position+1)-1
   if(row<0||row>=maxRows||col<0||col>=maxCols){outside=true;return}
   assignments={...assignments,[wellName(row,col)]:name}
  })
 })
 const problems=[
  ...(numberedFirstRow?['The first row (1, 2, 3 …) was read as sample names in row A. If it is a column header, copy the row letters with it.']:[]),
  ...(outside?[`The grid is larger than a ${size===384?384:96}-well plate (${maxRows} rows × ${maxCols} columns); cells outside it were ignored.`]:[]),
  ...(!Object.keys(assignments).length?['No sample names were found in the pasted grid.']:[]),
 ]
 return {assignments,problems}
}

/** Sample names pasted one per line, or as one copied row of cells. */
export const parseNameList=(text:string)=>text.split(/\r?\n|\t/).map(name=>name.trim()).filter(Boolean)

// Mirrors backend/qpcr_engine/sample_roles.py for names that are not saved yet; the backend decides the saved role.
const NO_TEMPLATE=/^(?:(?:technical control|control)\s+)?(?:(?:h\s*2\s*[o0]|water|ntc|no\s*template(?:\s+control)?|nuclease\s*free\s+water|master\s*mix|mmix)(?:\s+(?:control|blank))?(?:\s+(?:rep(?:licate)?\s*)?\d+)?|mm(?:\s+(?:control|blank))?)$/
const NO_RT=/^(?:-\s*rt|rt\s*-|minus\s*rt|no\s*-?\s*rt|nrt)(?:\s*(?:control|ctrl))?(?:[\s_.]+\d+)?$/

export function looksLikeControl(name:string):boolean {
 const text=name.normalize('NFKC').toLowerCase().trim()
 return NO_RT.test(text)||NO_TEMPLATE.test(text.replace(/[^a-z0-9]+/g,' ').trim())
}

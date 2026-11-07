import assert from 'node:assert/strict'
import test from 'node:test'
import {loadTs} from './loadTs.mjs'

const {plateDimensions,parseWell,wellsInRectangle,fillFromList,parseLayoutGrid,parseNameList,looksLikeControl}=await loadTs('plateLayout')
const {suggestReferences}=await loadTs('referenceGenes')
const {dashboardStatus}=await loadTs('status')

const band=(assay,rows,cols)=>rows.flatMap(row=>cols.map(col=>({well:`${row}${col}`,assay})))
const range=(from,to)=>Array.from({length:to-from+1},(_,i)=>from+i)

test('plate geometry follows the plate size',()=>{
 assert.deepEqual(plateDimensions(384),{rows:16,cols:24})
 assert.deepEqual(plateDimensions(96),{rows:8,cols:12})
 assert.deepEqual(plateDimensions(null),{rows:8,cols:12})
 assert.deepEqual(parseWell('P24'),{row:15,col:23})
 assert.equal(parseWell('Q1'),null)
 assert.deepEqual(wellsInRectangle('B2','A1'),['A1','A2','B1','B2'])
})

test('2×2 blocks numbered left to right restart for every gene',()=>{
 // LAD045/LAD046 layout: each gene a 4-row band, each sample a 2×2 block.
 const wells=[...band('SCN1A',['A','B','C','D'],range(1,4)),...band('RPL32',['E','F','G','H'],range(1,4))]
 const result=fillFromList(wells,['S1','S2','S3','S4'],{block:{rows:2,cols:2},order:'across',perGene:true})
 assert.deepEqual([result.assignments.A1,result.assignments.B2,result.assignments.A3,result.assignments.C1,result.assignments.D4],['S1','S1','S2','S3','S4'])
 assert.deepEqual([result.assignments.E1,result.assignments.H4],['S1','S4'])
 assert.equal(result.blocks,8);assert.equal(result.unnamedBlocks,0);assert.equal(result.unused,0)
})

test('vertical duplicates wrap to the next band where a gene starts mid-plate',()=>{
 // Characterization layout: duplicates stacked in two rows; Nestin starts at C3 and continues in E1.
 const wells=[...band('Nestin',['C','D'],range(3,6)),...band('Nestin',['E','F'],range(1,2))]
 const result=fillFromList(wells,['d0','d3','d7','d14','d21','d28','extra'],{block:{rows:2,cols:1},order:'across',perGene:true})
 assert.deepEqual([result.assignments.C3,result.assignments.D3,result.assignments.C6,result.assignments.E1,result.assignments.F2],['d0','d0','d14','d21','d28'])
 assert.equal(result.unused,1)
})

test('top-to-bottom numbering and missing names are reported',()=>{
 const wells=band('GAPDH',['A','B','C','D','E','F'],range(1,2))
 const result=fillFromList(wells,['S1','S2','S3'],{block:{rows:3,cols:1},order:'down',perGene:false})
 assert.deepEqual([result.assignments.A1,result.assignments.D1,result.assignments.A2],['S1','S2','S3'])
 assert.equal(result.assignments.D2,undefined)
 assert.equal(result.unnamedBlocks,1)
})

test('a pasted Excel plate grid with headers maps cells to wells',()=>{
 const text='\t1\t2\t3\nA\tHEK.1\tHEK.1\t\nB\tHeLa.1\t\tH2O\n'
 const {assignments,problems}=parseLayoutGrid(text,96)
 assert.deepEqual(assignments,{A1:'HEK.1',A2:'HEK.1',B1:'HeLa.1',B3:'H2O'})
 assert.deepEqual(problems,[])
})

test('a grid without headers starts at A1 and oversize grids are explained',()=>{
 assert.deepEqual(parseLayoutGrid('S1\tS2\nS3\tS4',96).assignments,{A1:'S1',A2:'S2',B1:'S3',B2:'S4'})
 // Sample numbers are names, not a column header.
 assert.deepEqual(parseLayoutGrid('1\t1\t2\t2\n3\t3\t4\t4',96).assignments,{A1:'1',A2:'1',A3:'2',A4:'2',B1:'3',B2:'3',B3:'4',B4:'4'})
 assert.deepEqual(parseLayoutGrid('Plate\t1\t2\nA\tS1\tS2',96).assignments,{A1:'S1',A2:'S2'})
 // Samples numbered 1… across row A are data, with or without row letters.
 const numbered=parseLayoutGrid('1\t2\t3\n4\t5\t6',96)
 assert.deepEqual(numbered.assignments,{A1:'1',A2:'2',A3:'3',B1:'4',B2:'5',B3:'6'})
 assert.match(numbered.problems[0],/read as sample names in row A/)
 assert.deepEqual(parseLayoutGrid('A\t1\t2\t3\nB\t4\t5\t6',96).assignments,{A1:'1',A2:'2',A3:'3',B1:'4',B2:'5',B3:'6'})
 const wide=parseLayoutGrid(Array.from({length:13},(_,i)=>`S${i}`).join('\t'),96)
 assert.match(wide.problems[0],/12 columns/)
 assert.match(parseLayoutGrid('\n\n',96).problems[0],/No sample names/)
})

test('name lists accept lines or a single pasted row',()=>{
 assert.deepEqual(parseNameList(' S1 \n\nS2\r\nS3\n'),['S1','S2','S3'])
 assert.deepEqual(parseNameList('S1\tS2\tS3'),['S1','S2','S3'])
})

test('control-looking draft names match the backend defaults',()=>{
 for(const name of ['H2O','NTC','mm','mastermix','Master mix','water 2','-RT','noRT'])assert.ok(looksLikeControl(name),name)
 for(const name of ['HEK','MM1S','MM 1','RT 4h','Rb005'])assert.ok(!looksLikeControl(name),name)
})

test('common reference genes are suggested whatever the primer-set suffix',()=>{
 assert.deepEqual(suggestReferences(['GAPDH 1','SCN1A 3','c1orf43','18sr','rpl32','CDKN1A']),['GAPDH 1','c1orf43','18sr','rpl32'])
 assert.deepEqual(suggestReferences(['TBP','tsc2','P21','ACTB','18S rRNA','GAPDH_v2']),['TBP','ACTB','18S rRNA','GAPDH_v2'])
 assert.deepEqual(suggestReferences(['SCN1A','MAP2']),[])
})

test('an unfinished plate layout leads the dashboard status',()=>{
 const base={staleCount:0,resultCount:0,qcFindings:2,designConfirmed:false,draftDirty:false,confounded:false,mixedRoles:[]}
 const blocked=dashboardStatus({...base,layout:{blocking:2,unnamedWells:0}})
 assert.equal(blocked.leadId,'layout');assert.equal(blocked.level,'action')
 const unnamed=dashboardStatus({...base,qcFindings:0,layout:{blocking:0,unnamedWells:28}})
 assert.equal(unnamed.leadId,'layout');assert.equal(unnamed.level,'review');assert.match(unnamed.headline,/28 wells/)
})

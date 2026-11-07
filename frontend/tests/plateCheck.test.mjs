import assert from 'node:assert/strict'
import test from 'node:test'
import {loadTs} from './loadTs.mjs'

const {wellRows,sampleCards,byCondition,matchesFilter,rowsCsv,summaryCounts}=await loadTs('plateCheck')

const record=(well,sample,assay,ct,extra={})=>({run_id:'r',run_name:'Run',sample,assay,ct,well,status:ct==null?'undetermined':'detected',omit:false,sheet:'Results',row_number:0,measurement_id:`${well}:${assay}`,...extra})
const annotation=(condition,replicate,extra={})=>({condition,series:condition,timepoint:null,time_unit:'day',replicate,role:'biological',cell_line:null,confluency:null,...extra})
const key=sample=>JSON.stringify(['r',sample])

const records=[
 record('A2','Ctrl.1','GAPDH',18.2),record('A1','Ctrl.1','GAPDH',18.0),record('B1','Ctrl.1','RPL32',15.1),
 record('A3','Sample 2','GAPDH',19.0,{instrument_sample:'Unassigned sample'}),record('A4','Sample 2','GAPDH',19.4,{omit:true}),
 record('P1','NTC','GAPDH',null),record('P13','Unassigned sample','CDKN1A',27.5),
]
const annotations={[key('Ctrl.1')]:annotation('Ctrl','1',{cell_line:'HeLa',confluency:'80%'}),[key('Sample 2')]:annotation('All samples','2',{timepoint:7}),[key('NTC')]:{...annotation('NTC',''),role:'technical_control'}}

test('every well and gene becomes one row in plate order, with its sample, condition and role',()=>{
 const rows=wellRows(records,annotations,{})
 assert.deepEqual(rows.map(r=>r.well),['A1','A2','A3','A4','B1','P1','P13'])
 const first=rows[0]
 assert.equal(first.group,'Ctrl');assert.equal(first.cellLine,'HeLa');assert.equal(first.confluency,'80%');assert.equal(first.role,'sample')
 assert.equal(rows[2].instrument,'no name');assert.equal(rows[2].time,'Day 7');assert.equal(rows[2].group,'All samples · Day 7')
 assert.equal(rows[3].excluded,'Omitted by the instrument')
 assert.equal(rows[5].role,'control');assert.equal(rows[5].group,'Control')
 assert.equal(rows[6].role,'unnamed');assert.equal(rows[6].group,'')
})

test('wells excluded in QC review say so',()=>{
 const rows=wellRows(records,annotations,{'A2:GAPDH':'Pipetting error'})
 assert.equal(rows.find(r=>r.well==='A2').excluded,'Pipetting error')
})

test('samples collect their wells per gene, and the mean leaves out excluded wells',()=>{
 const cards=sampleCards(wellRows(records,annotations,{}))
 // Sorted by condition, then replicate.
 assert.deepEqual(cards.map(c=>c.sample),['Sample 2','Ctrl.1'])
 const [second,ctrl]=cards
 assert.deepEqual(ctrl.genes.map(g=>[g.assay,g.wells.map(w=>w.well),Number(g.mean.toFixed(2))]),[['GAPDH',['A1','A2'],18.1],['RPL32',['B1'],15.1]])
 assert.equal(second.genes[0].mean,19)
 const groups=byCondition(cards)
 assert.deepEqual(groups.map(g=>[g.group,g.cards.length]),[['All samples · Day 7',1],['Ctrl',1]])
})

test('the filter matches well, sample, gene and condition, ignoring case',()=>{
 const rows=wellRows(records,annotations,{})
 assert.deepEqual(rows.filter(row=>matchesFilter(row,'hela')).map(r=>r.well),['A1','A2','B1'])
 assert.deepEqual(rows.filter(row=>matchesFilter(row,'p13')).map(r=>r.well),['P13'])
 assert.equal(rows.filter(row=>matchesFilter(row,'')).length,rows.length)
})

test('counts for the summary line',()=>{
 assert.deepEqual(summaryCounts(wellRows(records,annotations,{})),{wells:7,genes:3,samples:2,conditions:2,controls:1,unnamed:1})
})

test('the table downloads as CSV that spreadsheets cannot run as a formula',()=>{
 const csv=rowsCsv(wellRows([record('A1','=cmd','GAPDH',18)],{},{}))
 assert.match(csv.split('\r\n')[0],/^"Run","Plate","Well","Gene","Ct"/)
 assert.match(csv,/"'=cmd"/)
})

test('a sample measured on two plates keeps each plate apart, never pooling their wells',()=>{
 const twoPlates=[record('A1','S.1','GAPDH',18,{plate:'P1'}),record('A1','S.1','GAPDH',22,{plate:'P2'}),record('A2','S.1','GAPDH',18.2,{plate:'P1'})]
 const [card]=sampleCards(wellRows(twoPlates,{[key('S.1')]:annotation('S','1')},{}))
 assert.deepEqual(card.genes.map(g=>[g.assay,g.plate,g.wells.length,Number(g.mean.toFixed(1))]),[['GAPDH','P1',2,18.1],['GAPDH','P2',1,22]])
})

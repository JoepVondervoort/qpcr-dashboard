import {readFileSync} from 'node:fs'
import assert from 'node:assert/strict'
import test from 'node:test'
import ts from 'typescript'
async function load(name){const source=readFileSync(new URL(`../src/${name}.ts`,import.meta.url),'utf8');const {outputText}=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext}});return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)}
const {readPresentation,orderedAssays,reorderAssays,seriesColor}=await load('presentation')
const {resultEvidence}=await load('resultEvidence')
test('presentation validates stored colors and preserves hidden assay order while reordering',()=>{
 const prefs=readPresentation({palette:'bad',colors:{one:'#123456',two:'red'},order:['B','B','A'],favorites:['A',7]})
 assert.equal(prefs.palette,'classic');assert.deepEqual(prefs.colors,{one:'#123456'})
 assert.deepEqual(prefs.favorites,['A']);assert.deepEqual(orderedAssays(['A','B','C'],prefs.order),['B','A','C'])
 assert.deepEqual(reorderAssays(['A','B','C','D'],'A','C'),['B','C','A','D'])
 assert.deepEqual(reorderAssays(['A','B'],'unknown','A'),['A','B'])
 assert.equal(seriesColor('one',0,prefs),'#123456')
})
const result={run_id:'run',context_revision:1,experiment_design:{confirmed:true,design_type:'independent'},sample_groups:{one:'drug',two:'drug'},samples:[{sample:'one',delta_ct:1,fold_change:2},{sample:'two',delta_ct:1.2,fold_change:2.4}],statistics:{method:'welch',design_confirmed:true,alpha:.05,comparisons:[{condition:'drug',status:'tested',n:2,control_n:2,adjusted_p_value:.003,reason:'Exploratory with small n'}]}}
const points=[{run:'run',sample:'one',series:'series',category:'day21'},{run:'run',sample:'two',series:'series',category:'day21'}]
test('current fully displayed Holm-significant groups get markers; stale and partial groups do not',()=>{
 const evidence=resultEvidence(result,points,1)[0]
 assert.equal(evidence.status,'significant');assert.equal(evidence.mark,'*');assert.equal(evidence.p,.003)
 const historical=resultEvidence(result,points,2)[0];assert.equal(historical.status,'historical');assert.equal(historical.mark,undefined)
 const partial=resultEvidence(result,points.slice(0,1),1)[0];assert.equal(partial.partial,true);assert.equal(partial.mark,undefined)
 const split=resultEvidence(result,[points[0],{...points[1],category:'day28'}],1)[0];assert.equal(split.mark,undefined)
})
test('raw p-values, descriptive mode, and unconfirmed designs cannot generate significance markers',()=>{
 const descriptive={...result,statistics:{...result.statistics,method:'descriptive'}}
 assert.equal(resultEvidence(descriptive,points,1)[0].status,'not_tested')
 const corrected={...result,statistics:{...result.statistics,comparisons:[{...result.statistics.comparisons[0],p_value:.001,adjusted_p_value:.2}]}}
 assert.equal(resultEvidence(corrected,points,1)[0].status,'not_significant')
 assert.equal(resultEvidence({...result,experiment_design:{confirmed:false,design_type:'independent'}},points,1)[0].mark,undefined)
})

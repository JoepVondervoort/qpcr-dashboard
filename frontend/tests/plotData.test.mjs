import {readFileSync} from 'node:fs'
import assert from 'node:assert/strict'
import test from 'node:test'
import ts from 'typescript'
const source=readFileSync(new URL('../src/plotData.ts',import.meta.url),'utf8')
const {outputText}=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext}})
const moduleExports=await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
const {suggestedMetadata,latestAnalyses,mean,sampleSD}=moduleExports
test('recognizes time and condition series without conflating replicate and day',()=>{
  const a=suggestedMetadata('LAD081_HDFn_confluency_100% day 0.1'),b=suggestedMetadata('LAD081_HDFn_confluency_100% day 28.2')
  assert.equal(a.series,b.series);assert.equal(a.timepoint,0);assert.equal(b.timepoint,28);assert.equal(b.replicate,'2')
  assert.equal(suggestedMetadata('10.2').timepoint,null)
})
test('keeps assays and runs separate while choosing latest snapshots',()=>{
  assert.equal(latestAnalyses([{run_id:'a',target_assay:'T',id:3},{run_id:'a',target_assay:'T',id:1},{run_id:'b',target_assay:'T',id:2},{run_id:'a',target_assay:'R',id:4}]).length,3)
})
test('sample SD represents biological spread, not zero uncertainty for n=1',()=>{
  assert.equal(mean([2,4]),3);assert.equal(sampleSD([2,4]),Math.sqrt(2));assert.equal(sampleSD([2]),null)
})
test('coherent overview does not silently mix different settings profiles',()=>{
  const latest={run_id:'a',target_assay:'T',profile_id:'new',created_at:'2026-02-01',samples:[]}
  const old={run_id:'a',target_assay:'OTHER',profile_id:'old',created_at:'2026-01-01',samples:[]}
  const same={run_id:'a',target_assay:'R',profile_id:'new',created_at:'2026-01-20',samples:[]}
  assert.deepEqual(moduleExports.coherentAnalyses([old,latest,same]).map(v=>v.target_assay),['T','R'])
})
test('run-scoped sample identity permits the same label at different days',()=>{
  const one=moduleExports.sampleKey('run1','10.1'),two=moduleExports.sampleKey('run2','10.1')
  assert.notEqual(one,two)
  const mappings={[one]:{condition:'10 day 0',series:'10',timepoint:0,time_unit:'day',replicate:'1'},[two]:{condition:'10 day 3',series:'10',timepoint:3,time_unit:'day',replicate:'1'}}
  assert.equal(moduleExports.sampleAnnotation(mappings,'run1','10.1').timepoint,0)
  assert.equal(moduleExports.sampleAnnotation(mappings,'run2','10.1').timepoint,3)
})
test('biological filters use conservative factors and respect explicit corrections',()=>{
 const m={condition:'LAD081_HDFn_confluency_100% day 21',series:'LAD081_HDFn_confluency_100%'}
 assert.deepEqual(moduleExports.sampleFactors(m),{cell_line:'HDFn',confluency:'100%'})
 assert.deepEqual(moduleExports.sampleFactors({...m,cell_line:'Different cells',confluency:''}),{cell_line:'Different cells',confluency:''})
 assert.deepEqual(moduleExports.sampleFactors({condition:'drug 100%',series:'drug'}),{cell_line:'',confluency:''})
})

import assert from 'node:assert/strict'
import test from 'node:test'
import {loadTs} from './loadTs.mjs'

const {sampleCts,genormM,genormRanking,pairwiseVariation,stabilityAnalysis,stabilitySummary,defaultStabilityGenes,stabilityCsv}=await loadTs('stability')

const close=(actual,expected,digits=4)=>assert.ok(Math.abs(actual-expected)<10**-digits,`${actual} ≠ ${expected}`)
const rows=(genes)=>genes.A.map((_,i)=>Object.fromEntries(Object.entries(genes).map(([gene,values])=>[gene,values[i]])))
// B moves with A (constant ratio), C stays flat: A and B are the stable pair.
const HAND={A:[20,21,22,23],B:[21,22,23,24],C:[20,20,20,20]}

test('geNorm M averages the spread of pairwise Ct differences',()=>{
 const m=genormM(rows(HAND),['A','B','C'])
 const spread=Math.sqrt(5/3) // SD of 0, 1, 2, 3
 close(m.A,spread/2);close(m.B,spread/2);close(m.C,spread)
})

test('stepwise exclusion ranks the most stable pair first',()=>{
 const {order,m}=genormRanking(rows(HAND),['C','A','B'])
 assert.deepEqual(order,['A','B','C'])
 close(m.A,0);close(m.B,0);close(m.C,Math.sqrt(5/3))
})

test('pairwise variation tells how many reference genes are enough',()=>{
 const [v]=pairwiseVariation(rows(HAND),['A','B','C'])
 assert.equal(v.n,2);close(v.v,Math.sqrt(5/3)/3)
 const steady={A:[20,21,22,23],B:[21,22,23,24],C:[22,23.05,24,25.05]}
 const result=stabilityAnalysis(steadySamples(steady),['A','B','C'])
 assert.equal(result.recommended,2)
 assert.ok(result.pairwise[0].v<0.15)
})

function steadySamples(genes,groups=['ctrl','ctrl','treated','treated']){
 return genes.A.map((_,i)=>({key:`S${i+1}`,run:'run',sample:`S${i+1}`,group:groups[i],ct:Object.fromEntries(Object.entries(genes).map(([gene,values])=>[gene,values[i]])),wells:{}}))
}

const well=(sample,assay,ct,extra={})=>({run_id:'run',run_name:'run',sheet:'Results',row_number:0,well:'A1',sample,assay,ct,status:ct==null?'undetermined':'detected',omit:false,...extra})

test('each sample is the mean of its usable wells, grouped by condition',()=>{
 const records=[well('S1','GAPDH',20),well('S1','GAPDH',21),well('S1','GAPDH',30,{omit:true}),well('S1','GAPDH',null),
  well('S2','GAPDH',22),well('S2','RPL32',18),well('S1','RPL32',17)]
 const samples=sampleCts(records,{included:r=>!r.omit&&r.ct!=null,groupOf:r=>r.sample==='S1'?'ctrl':'treated'})
 const s1=samples.find(s=>s.sample==='S1')
 assert.equal(s1.ct.GAPDH,20.5);assert.equal(s1.group,'ctrl')
 assert.deepEqual(s1.wells.GAPDH,{used:2,total:4})
 assert.equal(samples.find(s=>s.sample==='S2').ct.RPL32,18)
})

test('a condition shift shared by every gene is input, not instability',()=>{
 // Treated samples have less RNA: every gene comes up 2 cycles later.
 const result=stabilityAnalysis(steadySamples({A:[20,20.2,22,22.2],B:[25,25.1,27,27.1],C:[15,15.3,17.1,17.2]}),['A','B','C'])
 const a=result.genes.find(g=>g.assay==='A')
 close(a.shift,2,6)
 assert.ok(Math.abs(a.relativeShift)<0.1)
 assert.deepEqual(a.conditions.map(c=>[c.group,c.n]),[['ctrl',2],['treated',2]])
})

test('samples missing a compared gene are left out of geNorm and reported',()=>{
 const samples=steadySamples({A:[20,21,22,23],B:[21,22,23,24],C:[20,20,20,20]})
 const missing=[...samples,{key:'S5',run:'run',sample:'S5',group:'ctrl',ct:{A:20},wells:{}}]
 const result=stabilityAnalysis(missing,['A','B','C'])
 assert.equal(result.complete.length,4)
 assert.deepEqual(result.incomplete.map(s=>s.sample),['S5'])
 assert.equal(result.genes.find(g=>g.assay==='A').n,5)
})

test('the summary names the best pair and whether two genes are enough',()=>{
 const result=stabilityAnalysis(steadySamples({A:[20,21,22,23],B:[21,22,23,24],C:[22,23.05,24,25.05]}),['A','B','C'])
 const text=stabilitySummary(result).join(' ')
 assert.match(text,/Most stable: A and B/)
 assert.match(text,/V2\/3/)
 assert.match(text,/two reference genes are enough/)
 // The best pair moves with RNA input (raw SD above one cycle) yet keeps a constant ratio: explained, not flagged.
 const input=stabilityAnalysis(steadySamples({A:[18,20,22,24],B:[19,21,23,25],C:[20,22.5,24,26.4]}),['A','B','C'])
 assert.match(stabilitySummary(input).join(' '),/RNA input/)
 assert.match(stabilitySummary(stabilityAnalysis(steadySamples({A:[20,21,22,23]}),['A'])).join(' '),/at least two genes/)
 assert.match(stabilitySummary(stabilityAnalysis(steadySamples({A:[20,21],B:[21,22]},['x','y']).slice(0,2),['A','B'])).join(' '),/at least three samples/)
})

test('candidate reference genes are compared by default',()=>{
 assert.deepEqual(defaultStabilityGenes(['18sr','CDKN1A','GAPDH 2','SCN1A 3','c1orf43','rpl32']),['18sr','GAPDH 2','c1orf43','rpl32'])
 // Without two recognizable reference genes, every measured gene is compared.
 assert.deepEqual(defaultStabilityGenes(['GAPDH','MAP2','SCN1A']),['GAPDH','MAP2','SCN1A'])
})

test('exports list each sample with its mean Ct per gene, and the ranking',()=>{
 const result=stabilityAnalysis(steadySamples({A:[20,21,22,23],B:[21,22,23,24],C:[20,20,20,20]}),['A','B','C'])
 const {samples,ranking}=stabilityCsv(result)
 const lines=samples.split('\r\n')
 assert.equal(lines[0],'"Run","Sample","Condition","A Ct","B Ct","C Ct"')
 assert.equal(lines[1],'"run","S1","ctrl","20","21","20"')
 assert.match(ranking.split('\r\n')[1],/^"1","A",/)
})

test('a gene that moves with the condition does not make the stable genes look unstable',()=>{
 // GAPDH and ACTB are flat; a target moves 5 cycles in the treated samples.
 const result=stabilityAnalysis(steadySamples({A:[20,20.1,20,20.1],B:[22,22.1,22.05,22.1],T:[25,25.1,30,30.1]}),['A','B','T'])
 const shift=assay=>result.genes.find(g=>g.assay===assay).relativeShift
 assert.ok(shift('A')<0.1&&shift('B')<0.1,`${shift('A')} ${shift('B')}`)
 close(shift('T'),5,1)
 const text=stabilitySummary(result).join(' ')
 assert.match(text,/T shifts 5\.0 cycles/)
 assert.doesNotMatch(text,/A shifts|B shifts/)
})

test('genes on separate plates only meet in a sample when the plates are combined',()=>{
 const samples=[{key:'a',run:'plate 1',sample:'S1',group:'x',ct:{A:20},wells:{}},{key:'b',run:'plate 2',sample:'S1',group:'x',ct:{B:21},wells:{}}]
 assert.match(stabilitySummary(stabilityAnalysis(samples,['A','B'])).join(' '),/combine/)
})

test('exported cells cannot start a spreadsheet formula',()=>{
 const samples=steadySamples({A:[20,21,22,23],B:[21,22,23,24],C:[20,20,20,20]}).map((s,i)=>i===0?{...s,sample:'=HYPERLINK("x")',group:'-RT'}:s)
 const line=stabilityCsv(stabilityAnalysis(samples,['A','B','C'])).samples.split('\r\n')[1]
 assert.match(line,/^"run","'=HYPERLINK\(""x""\)","'-RT",/)
})

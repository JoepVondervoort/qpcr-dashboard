import assert from 'node:assert/strict'
import test from 'node:test'
import {loadTs} from './loadTs.mjs'

const {suggestedMetadata,analysisGroup}=await loadTs('plotData')
const {groupQualityFlags,flagGroupTitle}=await loadTs('qcGroups')
const {dashboardStatus}=await loadTs('status')
const {isAcceptedFile,withoutExtension,plateNames,experimentFiles,defaultLabel}=await loadTs('plates')
const {baselineNotes,detectionSummary,effectiveBaselines}=await loadTs('resultNotes')

test('time points glued to underscores are read like the backend does',()=>{
 const day0=suggestedMetadata('LAD080_HDFn_characterization_day0.1')
 assert.deepEqual([day0.condition,day0.series,day0.timepoint,day0.replicate],['LAD080_HDFn_characterization_day0','LAD080_HDFn_characterization',0,'1'])
 assert.equal(analysisGroup(day0),'LAD080_HDFn_characterization · Day 0')
 const resplit=suggestedMetadata('HDFn_iNeuron__day28_resplit1.1')
 assert.deepEqual([resplit.series,resplit.timepoint],['HDFn_iNeuron_resplit1',28])
 assert.equal(suggestedMetadata('LNP 72h.2').time_unit,'hour')
})

test('a label after the replicate number is its own condition',()=>{
 const rs=suggestedMetadata('LAD080_HDFn_characterization_day 21.2 RS')
 assert.deepEqual([rs.condition,rs.series,rs.timepoint,rs.replicate],['LAD080_HDFn_characterization_day 21 RS','LAD080_HDFn_characterization_RS',21,'2'])
 assert.equal(analysisGroup(rs),'LAD080_HDFn_characterization_RS · Day 21')
})

test('single-day names keep no time point and earlier conventions are unchanged',()=>{
 for(const name of ['H2O','CHD2 AD5 2D3.1','HDF_iNeuron_HIGH_SCN1A-10.1','LNP 0.5 ug'])assert.equal(suggestedMetadata(name).timepoint,null,name)
 const lad081=suggestedMetadata('LAD081_HDFn_confluency_100% day 28.2')
 assert.equal(analysisGroup(lad081),'LAD081_HDFn_confluency_100% · Day 28')
})

test('controls on different plates of one run are separate findings',()=>{
 const flag=(plate,assay)=>({id:`${plate}${assay}`,kind:'control_signal',run_id:'run',plate,sample:'H2O',assay,status:'needs_review',measurements:[]})
 const groups=groupQualityFlags([flag('P1','A'),flag('P1','B'),flag('P2','A')])
 assert.equal(groups.length,2)
 assert.equal(flagGroupTitle(groups.find(g=>g.plate==='P2')),'H2O on P2 · signal in A')
 assert.equal(flagGroupTitle(groupQualityFlags([{...flag(null,'A')}])[0]),'H2O · signal in A')
})

test('unconfirmed sample names ask for a check without outranking QC',()=>{
 const base={staleCount:0,resultCount:0,qcFindings:0,designConfirmed:true,draftDirty:false,confounded:false,mixedRoles:[]}
 const status=dashboardStatus({...base,nameChecks:3})
 assert.equal(status.leadId,'names')
 assert.match(status.headline,/3 sample names/)
 assert.equal(dashboardStatus({...base,nameChecks:3,qcFindings:1}).leadId,'qc')
})

test('legacy .xls exports are accepted and several files can be chosen',()=>{
 assert.ok(isAcceptedFile('2026-03-30_103321-LAD080_1.xls'))
 assert.ok(isAcceptedFile('run.XLSX')&&isAcceptedFile('run.csv'))
 assert.ok(!isAcceptedFile('notes.docx'))
 assert.equal(withoutExtension('LAD080_1.xls'),'LAD080_1')
})

test('an upload of several plates is named after all of them',()=>{
 assert.equal(defaultLabel(['2026-03-30_103321-LAD080_1.xls','2026-03-30_103321-LAD080_3.xls']),'2026-03-30_103321-LAD080_1 + 3')
 assert.equal(defaultLabel(['plate A.xlsx','other.csv']),'plate A + other')
 assert.equal(defaultLabel(['single.xls']),'single')
 assert.equal(defaultLabel([]),'')
})

test('combined runs list their plates and experiments list every file',()=>{
 assert.deepEqual(plateNames({id:'r',name:'X_1 + 3',plates:[{name:'X_1'},{name:'X_3'}]}),['X_1','X_3'])
 assert.deepEqual(plateNames({id:'r',name:'X_1'}),[])
 assert.deepEqual(experimentFiles({original_filename:'a.xls',parsed_summary:{files:['a.xls','b.xls']}}),['a.xls','b.xls'])
 assert.deepEqual(experimentFiles({original_filename:'a.xlsx'}),['a.xlsx'])
})

test('results explain a later baseline and partly detected wells',()=>{
 const later={target_assay:'PAX6',baseline_samples:['d0.1'],effective_baseline_samples:['d7.1'],baseline_note:'PAX6 was not detected at Day 0.',detection_notes:[]}
 const partial={target_assay:'GAD65',baseline_samples:['d0.1'],effective_baseline_samples:['d0.1'],baseline_note:null,
  detection_notes:[{sample:'d0.1',assay:'GAD65',role:'target',detected:1,total:4},{sample:'d0.2',assay:'GAD65',role:'target',detected:2,total:4}]}
 assert.deepEqual(effectiveBaselines(later),['d7.1'])
 assert.deepEqual(effectiveBaselines({baseline_samples:['a'],baseline_sample:'a'}),['a'])
 assert.deepEqual(baselineNotes([later,partial]),['PAX6 was not detected at Day 0.'])
 const summary=detectionSummary([partial],name=>name)
 assert.equal(summary.text,'Undetermined wells in 2 samples')
 assert.match(summary.detail,/d0\.1: GAD65 1 of 4 wells/)
 assert.equal(detectionSummary([later],name=>name),null)
})

test('cell-line codes are not read as hours, in step with the backend',()=>{
 const cases=[['iPSC_H1_d7.1',7,'iPSC_H1'],['H9_day0.1',0,'H9'],['H19_KO.1',null,'H19_KO'],['NCI-H1299_DMSO.1',null,'NCI-H1299_DMSO'],['H1 day 21.2',21,'H1']]
 for(const [name,time,series] of cases){const m=suggestedMetadata(name);assert.deepEqual([m.timepoint,m.time_unit,m.series],[time,'day',series],name)}
})

test('the same sample on two runs keeps both detection notes',()=>{
 const note={sample:'s.1',assay:'T',role:'target',detected:1,total:2}
 const summary=detectionSummary([{run_id:'a',detection_notes:[note]},{run_id:'b',detection_notes:[note]}],name=>name)
 assert.equal(summary.detail.split(';').length,2)
})

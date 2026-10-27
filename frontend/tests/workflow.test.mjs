import assert from 'node:assert/strict'
import test from 'node:test'
import {loadTs as load} from './loadTs.mjs'
const {groupQualityFlags,flagGroupTitle}=await load('qcGroups')
const {groupAnalysisVersions}=await load('historyGroups')
const {dashboardStatus}=await load('status')
const {normalityLabel,condenseWarnings,formatP}=await load('statisticsText')
const {sharedPrefix,withoutPrefix}=await load('sampleNames')
const {topChanges,geneCatalog,geneMatrix,extremeChanges,geneFingerprint}=await load('libraryResults')

const flag=(assay,sample,run='r1',kind='control_signal',status='needs_review')=>({id:`${kind}:${run}:${sample}:${assay}`,kind,run_id:run,sample,assay,status,measurements:[]})

test('QC flags that share a cause are grouped by run, sample and kind',()=>{
 const groups=groupQualityFlags([flag('A','H2O'),flag('B','H2O'),flag('A','H2O','r2'),flag('A','s1','r1','technical_spread'),flag('C','H2O','r1','control_signal','reviewed')])
 assert.equal(groups.length,3)
 const water=groups[0]
 assert.deepEqual(water.assays,['A','B','C']);assert.equal(water.unresolved,2);assert.equal(water.status,'mixed')
 assert.equal(groups[1].run_id,'r2');assert.equal(groups[2].kind,'technical_spread')
 assert.equal(flagGroupTitle(water),'H2O · signal in 3 assays')
 assert.equal(flagGroupTitle(groups[1]),'H2O · signal in A')
 assert.equal(flagGroupTitle(groups[2]),'s1 · wide technical range in A')
})

test('history groups one batch calculation into one row and keeps single analyses separate',()=>{
 const version=(id,assay,batch,created='2026-10-25T20:16:57')=>({id,created_at:created,result:{run_id:'run',target_assay:assay,batch_id:batch,reference_assays:['GAPDH'],baseline_samples:['b1','b2'],statistics:{method:'descriptive'},samples:[]}})
 const groups=groupAnalysisVersions([version('1','TUBB3','x'),version('2','ACTA1','x'),version('3','ACTA1',undefined,'2026-10-25T19:00:00')])
 assert.equal(groups.length,2)
 assert.deepEqual(groups[0].entries.map(entry=>entry.result.target_assay),['ACTA1','TUBB3'])
 assert.equal(groups[0].method,'descriptive');assert.deepEqual(groups[0].references,['GAPDH']);assert.equal(groups[0].baselineCount,2)
 assert.equal(groups[1].entries.length,1)
})

test('one status model: the most urgent item becomes the headline',()=>{
 const calm=dashboardStatus({staleCount:0,resultCount:4,qcFindings:0,designConfirmed:true,draftDirty:false,confounded:false,mixedRoles:[]})
 assert.equal(calm.level,'ok');assert.equal(calm.items.length,0)
 const busy=dashboardStatus({staleCount:4,resultCount:4,qcFindings:7,designConfirmed:false,draftDirty:true,confounded:true,mixedRoles:[]})
 assert.equal(busy.level,'action');assert.match(busy.headline,/out of date/i);assert.equal(busy.leadId,'stale')
 assert.deepEqual(busy.items.map(item=>item.level),['review','review','info','info'])
 const partial=dashboardStatus({staleCount:1,resultCount:4,qcFindings:0,designConfirmed:true,draftDirty:false,confounded:false,mixedRoles:[]})
 assert.match(partial.headline,/1 of 4/)
 assert.match(dashboardStatus({staleCount:0,resultCount:0,qcFindings:3,designConfirmed:true,draftDirty:false,confounded:false,mixedRoles:[]}).headline,/3 QC findings to review/)
})

test('statistics wording hides internal codes and repeated caveats',()=>{
 assert.equal(normalityLabel('not_assessable'),'Not assessable');assert.equal(normalityLabel('assessed'),'Assessed')
 const warnings=['A day 0: fewer than three complete biological samples; normality cannot be assessed and inferential results are exploratory.','A day 21: fewer than three complete biological samples; normality cannot be assessed and inferential results are exploratory.','Technical wells are averaged within biological samples.']
 const condensed=condenseWarnings(warnings)
 assert.equal(condensed.length,2);assert.match(condensed[0],/^2 conditions \(A day 0, A day 21\) have fewer than three/)
 assert.deepEqual(condenseWarnings([warnings[0],warnings[2]]),[warnings[0],warnings[2]])
})

test('long sample names show only their distinguishing part',()=>{
 const names=['LAD081_HDFn_confluency_100% day 0.1','LAD081_HDFn_confluency_150% day 21.2']
 assert.equal(sharedPrefix(names),'LAD081_HDFn_confluency_')
 assert.equal(withoutPrefix(names[1],'LAD081_HDFn_confluency_'),'150% day 21.2')
 assert.equal(sharedPrefix(['H2O','LAD081_x']),'');assert.equal(sharedPrefix(['only one']),'')
 assert.equal(sharedPrefix(['abc_1','abc_1']),'','a prefix must leave every name with text')
})

const geneRow=(assay,condition,fold,baseline=false,extra={})=>({assay,run_id:'r1',run_name:'Plate_1',condition,series:'S',timepoint:Number(condition.replace(/\D/g,''))||0,time_unit:'day',is_baseline:baseline,fold_change:fold,n:2,out_of_date:false,...extra})

test('library highlights the largest changes in either direction, never the baseline',()=>{
 const changes=topChanges([geneRow('MAP2','d0',1,true),geneRow('MAP2','d21',177),geneRow('COL1A1','d21',0.11),geneRow('TUBB3','d21',1.2),geneRow('X','d21',null),geneRow('BASE','d0',40,true)],2)
 assert.deepEqual(changes.map(change=>change.assay),['MAP2','COL1A1'])
 assert.equal(changes[1].fold_change,0.11)
})

test('gene catalog spans experiments and the matrix aligns conditions by time',()=>{
 const projects=[{id:'p',name:'P',experiments:[
  {id:'e1',name:'E1',library_summary:{gene_results:[geneRow('MAP2','d0',1,true),geneRow('MAP2','d21',5)]}},
  {id:'e2',name:'E2',library_summary:{gene_results:[geneRow('map2','d21',2),geneRow('ACTA1','d28',0.3)]}}]}]
 const catalog=geneCatalog(projects)
 assert.deepEqual(catalog.map(entry=>[entry.assay,entry.experiments]),[['ACTA1',1],['MAP2',1],['map2',1]])
 const matrix=geneMatrix(catalog.find(entry=>entry.assay==='MAP2').rows)
 assert.deepEqual(matrix.columns.map(column=>column.label),['Day 0','Day 21'])
 assert.equal(matrix.lines.length,1);assert.equal(matrix.lines[0].cells['day:21'].fold_change,5)
})

test('two conditions at the same time in one series are both kept',()=>{
 const rows=[geneRow('A','siCtrl d3',1,true,{timepoint:3}),geneRow('A','siX d3',4,false,{timepoint:3})].map(row=>({...row,project_id:'p',project_name:'P',experiment_id:'e',experiment_name:'E'}))
 const matrix=geneMatrix(rows)
 assert.equal(matrix.lines.length,2)
 assert.deepEqual(matrix.lines.map(line=>line.cells['day:3'].condition).sort(),['siCtrl d3','siX d3'])
})

test('the experiment summary names the largest increase and decrease separately',()=>{
 const {up,down}=extremeChanges([geneRow('MAP2','d0',1,true),geneRow('MAP2','d21',177),geneRow('COL1A1','d21',0.11),geneRow('TUBB3','d21',1.2),geneRow('X','d21',0.9)])
 assert.equal(up.assay,'MAP2');assert.equal(down.assay,'COL1A1')
 assert.deepEqual(extremeChanges([geneRow('A','d21',2)]),{up:{assay:'A',fold_change:2,condition:'d21',run_name:'Plate_1',out_of_date:false},down:undefined})
})

test('the largest increase is found across all conditions, not only each gene\'s strongest change',()=>{
 const {up,down}=extremeChanges([geneRow('A','d21',4),geneRow('A','d28',0.125),geneRow('B','d21',2)])
 assert.equal(up.assay,'A');assert.equal(up.fold_change,4);assert.equal(down.fold_change,0.125)
})

test('the library fingerprint has one strongest change per gene in name order',()=>{
 const strip=geneFingerprint([geneRow('TUBB3','d21',1.2),geneRow('ACTA1','d21',0.2),geneRow('ACTA1','d28',0.3),geneRow('MAP2','d0',1,true)])
 assert.deepEqual(strip.map(cell=>[cell.assay,cell.fold_change]),[['ACTA1',0.2],['TUBB3',1.2]])
})

test('p-values never round onto alpha',()=>{
 assert.equal(formatP(0.04996),'0.04996');assert.equal(formatP(0.2),'0.2');assert.equal(formatP(0.0004),'< 0.001');assert.equal(formatP(null),'—')
})

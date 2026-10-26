import assert from 'node:assert/strict'
import test from 'node:test'
import {loadTs as load} from './loadTs.mjs'
const {readPresentation,orderedAssays,reorderAssays,seriesColor,plotKey,applyPlotOptions,effectivePlotOptions,defaultPresentation}=await load('presentation')
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

test('per-plot settings, shared quantity defaults and style propagation have explicit scope',async()=>{
 const {defaultPlotOptions}=await load('plotOptions')
 let prefs=defaultPresentation(),options=defaultPlotOptions()
 options.axes.yMax=10;options.style.pointSize=6
 const expression=plotKey('expression','T'),ct=plotKey('ct','T')
 prefs=applyPlotOptions(prefs,expression,'expression',options,'plot')
 assert.equal(effectivePlotOptions(prefs,expression,'expression').axes.yMax,10)
 assert.equal(effectivePlotOptions(prefs,ct,'ct').axes.yMax,null)
 const shared=defaultPlotOptions();shared.axes.sharedY=true
 prefs=applyPlotOptions(prefs,expression,'expression',shared,'axes')
 assert.equal(effectivePlotOptions(prefs,expression,'expression').axes.sharedY,true)
 assert.equal(effectivePlotOptions(prefs,expression,'expression').style.pointSize,6)
 assert.equal(effectivePlotOptions(prefs,ct,'ct').axes.sharedY,false)
 shared.style.barOpacity=.8
 prefs=applyPlotOptions(prefs,expression,'expression',shared,'style')
 assert.equal(effectivePlotOptions(prefs,ct,'ct').style.barOpacity,.8)
 assert.equal(effectivePlotOptions(prefs,expression,'expression').axes.sharedY,true)
 const restored=readPresentation(JSON.parse(JSON.stringify(prefs)))
 assert.deepEqual(restored,prefs)
})
test('invalid stored options are sanitized and invalid editor axes are rejected',async()=>{
 const {cleanAxes,cleanStyle,axisErrors,defaultAxes,colorGroup}=await load('plotOptions')
 assert.equal(cleanAxes({yMin:10,yMax:1,yTick:-1}).yMin,null)
 assert.equal(cleanStyle({pointSize:100,groups:{bad:{point:'url(x)',bar:'#123456'}}}).pointSize,8)
 assert.deepEqual(cleanStyle({groups:{bad:{point:'url(x)',bar:'#123456'}}}).groups,{bad:{bar:'#123456'}})
 assert.ok(axisErrors({...defaultAxes(),yMin:10,yMax:1},true).length)
 assert.ok(axisErrors({...defaultAxes(),xMin:0},false).length)
 assert.ok(axisErrors({...defaultAxes(),xMin:0,xUnit:'day',spacing:'proportional'},true,'hour').length)
 assert.ok(axisErrors({...defaultAxes(),yMin:0,yMax:10,yTick:.01},true).length)
 assert.equal(colorGroup({run:'one',sample:'A',seriesLabel:'condition',data:[{confluency:'100%'}]},'confluency').key,'100%')
 assert.notEqual(colorGroup({run:'one',sample:'A'},'sample').key,colorGroup({run:'two',sample:'A'},'sample').key)
})

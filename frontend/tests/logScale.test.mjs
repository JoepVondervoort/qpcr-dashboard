import assert from 'node:assert/strict'
import test from 'node:test'
import {loadTs as load} from './loadTs.mjs'
const {log2AxisTicks,log2Domain,foldTickLabel,foldSummary}=await load('logScale')
const {automaticYRange,cleanAxes,defaultAxes,axisErrors}=await load('plotOptions')

test('log2 axis ticks sit on powers of two and always include 1x when in range',()=>{
 assert.deepEqual(log2AxisTicks(-3,3),[-3,-2,-1,0,1,2,3])
 const wide=log2AxisTicks(-3,8)
 assert.ok(wide.length<=9);assert.ok(wide.includes(0));assert.ok(wide.every(tick=>Number.isInteger(tick)))
 assert.deepEqual(log2AxisTicks(-2,2,2),[-2,0,2])
 const narrow=log2AxisTicks(Math.log2(1.2),Math.log2(1.8))
 assert.equal(narrow.length,2,'a range inside one doubling still gets labelled ends')
 assert.equal(foldTickLabel(narrow[0]),'1.2×');assert.equal(foldTickLabel(narrow[1]),'1.8×')
})

test('log2 tick density is counted in doublings, not fold-change units',()=>{
 assert.deepEqual(axisErrors({...defaultAxes(),yMin:0.125,yMax:64,yTick:1},false),[])
 assert.ok(axisErrors({...defaultAxes(),yMin:2**-30,yMax:2**30,yTick:1},false).some(error=>error.includes('40 ticks')))
})

test('stored axes from before the log2 default keep their linear meaning',()=>{
 assert.equal(cleanAxes({yMin:0,yMax:8,yTick:2}).yScale,'linear')
 assert.equal(cleanAxes({sharedY:true}).yScale,'log2')
 assert.equal(cleanAxes({yMin:0.5,yScale:'log2'}).yScale,'log2')
})

test('log2 domain hugs the data, always shows 1x and at least two powers of two',()=>{
 const [low,high]=log2Domain([0.2,1.05])
 assert.ok(low<Math.log2(0.2)&&low>-3,'pads the lowest value without jumping to the next doubling')
 assert.ok(high>Math.log2(1.05)&&high<1,'no empty doubling above the data')
 const [flatLow,flatHigh]=log2Domain([1])
 assert.ok(flatLow<=-1&&flatHigh>=1,'a flat gene still gets 0.5x and 2x reference ticks')
 const [smallLow,smallHigh]=log2Domain([1.2,1.8])
 assert.ok(smallLow<0&&smallHigh>1,'small up-regulation shows 1x and 2x')
 assert.ok(smallLow>-0.5,'but no empty doubling below 1x')
 const [wideLow,wideHigh]=log2Domain([0.13,177])
 assert.ok(wideLow<Math.log2(0.13)&&wideLow>-4);assert.ok(wideHigh>Math.log2(177)&&wideHigh<9)
 assert.ok(log2Domain([0.5,2],0.5)[1]>=log2Domain([0.5,2])[1]+0.5,'headroom for significance marks')
 assert.deepEqual(log2Domain([0.5,0,-1,Number.NaN]),log2Domain([0.5]),'non-positive values cannot be placed on a log axis')
})

test('fold tick labels read as fold changes, with fractions below 1x',()=>{
 assert.equal(foldTickLabel(0),'1×');assert.equal(foldTickLabel(3),'8×');assert.equal(foldTickLabel(8),'256×')
 assert.equal(foldTickLabel(-1),'½×');assert.equal(foldTickLabel(-2),'¼×');assert.equal(foldTickLabel(-3),'⅛×');assert.equal(foldTickLabel(-4),'1/16×')
})

test('log summaries are geometric mean x/÷ SD; linear summaries clip at zero',()=>{
 const log=foldSummary([0.5,2],'log2')
 assert.ok(Math.abs(log.center-1)<1e-12);assert.ok(Math.abs(log.upper*log.lower-1)<1e-12);assert.ok(log.upper>2)
 const linear=foldSummary([0.1,3],'linear')
 assert.equal(linear.center,1.55);assert.equal(linear.lower,0);assert.ok(linear.upper>3)
 assert.equal(foldSummary([],'log2'),null)
 const single=foldSummary([4],'log2');assert.equal(single.center,4);assert.equal(single.upper,4);assert.equal(single.sd,null)
})

test('expression axes default to log2 and reject non-positive log limits',()=>{
 assert.equal(defaultAxes().yScale,'log2')
 assert.equal(cleanAxes({}).yScale,'log2')
 assert.equal(cleanAxes({yScale:'linear'}).yScale,'linear')
 assert.equal(cleanAxes({yScale:'bogus'}).yScale,'log2')
 assert.ok(axisErrors({...defaultAxes(),yMin:0},false).some(error=>error.includes('positive')))
 assert.deepEqual(axisErrors({...defaultAxes(),yScale:'linear',yMin:0},false),[])
 assert.deepEqual(axisErrors({...defaultAxes(),yMin:0},false,undefined,'ct'),[],'Ct axes are always linear')
})

test('shared expression range on a log axis stays positive',()=>{
 const point=(values,category)=>({values,series:'s',category,data:[{assay:'A'}]})
 const [low,high]=automaticYRange([point([0.2],'a'),point([30],'b')],'expression','log2')
 assert.ok(low>0&&low<=0.2);assert.ok(high>=30)
 assert.equal(automaticYRange([point([0.2],'a')],'expression','linear')[0],0)
})

test('a shown threshold is inside the shared expression range',()=>{
 const point=(values,category)=>({values,series:'s',category,data:[{assay:'A'}]})
 const [,high]=automaticYRange([point([0.2],'a'),point([0.5],'b')],'expression','log2',[1.5])
 assert.ok(high>1.5)
})

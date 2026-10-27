import assert from 'node:assert/strict'
import test from 'node:test'
import {loadTs as load} from './loadTs.mjs'
const {seriesDodge,spreadLabels,flowLegend}=await load('figureLayout')
const {figureTheme,FIGURE_THEMES}=await load('figureTheme')
const {readoutRows}=await load('figureReadout')
const {conditionDots}=await load('statisticsDots')
const {readPresentation,defaultPresentation,setSharedY,plotKey}=await load('presentation')

test('bars from different series never overlap; line markers sit close together',()=>{
 for(const n of [1,2,3,5]){
  const {offsets,barWidth}=seriesDodge(n,140,true)
  assert.equal(offsets.length,n)
  for(let i=1;i<n;i++)assert.ok(offsets[i]-offsets[i-1]>=barWidth,'adjacent bars are at least one bar width apart')
  assert.ok(offsets[n-1]-offsets[0]+barWidth<=140,'all bars of one time point fit in its slot')
 }
 assert.deepEqual(seriesDodge(1,140,false).offsets,[0])
 const narrow=seriesDodge(6,20,true)
 for(let i=1;i<6;i++)assert.ok(narrow.offsets[i]-narrow.offsets[i-1]>=narrow.barWidth,'narrow slots still never overlap')
 assert.ok(narrow.offsets[5]-narrow.offsets[0]+narrow.barWidth<=20,'and stay inside their time slot')
 const line=seriesDodge(2,140,false)
 assert.ok(line.offsets[1]-line.offsets[0]<=16,'dodged just enough to separate error bars')
})

test('direct labels keep their order, separate by a minimum gap and stay in bounds',()=>{
 assert.deepEqual(spreadLabels([40,120,200],14,0,240),[40,120,200],'labels already apart do not move')
 const crowded=spreadLabels([100,104,101],14,0,240)
 const order=[0,2,1]
 for(let i=1;i<order.length;i++)assert.ok(crowded[order[i]]-crowded[order[i-1]]>=14-1e-9)
 const edge=spreadLabels([236,238],14,0,240)
 assert.ok(Math.max(...edge)<=240&&Math.abs(edge[1]-edge[0])>=14-1e-9)
})

test('legend items flow left to right and wrap when the row is full',()=>{
 assert.deepEqual(flowLegend([100,100,100],250,10),{items:[{x:0,row:0},{x:110,row:0},{x:0,row:1}],rows:2})
 assert.deepEqual(flowLegend([400],250,10),{items:[{x:0,row:0}],rows:1},'an over-long item gets its own row')
 assert.deepEqual(flowLegend([],250,10),{items:[],rows:0})
})

test('every figure theme keeps text at 8 pt or more in a single-column export',()=>{
 const unitsToPt=85/360*72/25.4
 for(const name of FIGURE_THEMES){
  const theme=figureTheme(name)
  assert.ok(Math.min(...Object.values(theme.text))*unitsToPt>=8-1e-9,`${name} text is readable at 85 mm`)
 }
 const journal=figureTheme('journal'),screen=figureTheme('screen')
 assert.equal(journal.grid,false);assert.equal(journal.yAxisLine,true);assert.equal(journal.tickDirection,'out')
 assert.equal(screen.grid,true);assert.equal(screen.yAxisLine,false)
 assert.equal(figureTheme('unknown').name,'screen')
})

const obs=(series,category,time,value)=>({sample:`${series}${category}${value}`,run:'r',series,seriesLabel:`S ${series}`,category,categoryLabel:`Day ${time}`,time,unit:'day',values:[value],source:'',replicate:''})
test('the readout summarises each series and time point in time order',()=>{
 const rows=readoutRows([obs('a','day:21',21,0.25),obs('a','day:21',21,1),obs('a','day:0',0,1),obs('b','day:0',0,2)],'expression','log2')
 assert.deepEqual(rows.map(row=>[row.series,row.category]),[['a','day:0'],['a','day:21'],['b','day:0']])
 const day21=rows[1]
 assert.ok(Math.abs(day21.center-0.5)<1e-12,'geometric mean');assert.equal(day21.n,2)
 assert.ok(Math.abs(day21.spread-2**Math.SQRT2)<1e-9,'×/÷ factor is 2^SD of log2 values')
 const ct=readoutRows([obs('a','day:0',0,20),obs('a','day:0',0,22)],'ct','linear')
 assert.equal(ct[0].center,21);assert.ok(Math.abs(ct[0].spread-Math.SQRT2)<1e-12,'Ct spread is the sample SD')
})

test('statistics dots turn biological ΔCt into log2 fold changes against the baseline mean',()=>{
 const dots=conditionDots([{condition:'base',is_baseline:true,delta_ct_values:[5,7]},{condition:'treated',is_baseline:false,delta_ct_values:[3,4]},{condition:'empty',is_baseline:false}])
 assert.deepEqual(dots.values.base,[1,-1]);assert.deepEqual(dots.values.treated,[3,2]);assert.deepEqual(dots.values.empty,[])
 assert.ok(dots.domain[0]<-1&&dots.domain[1]>3)
 assert.equal(conditionDots([{condition:'x',is_baseline:false,delta_ct_values:[1]}]),null,'no baseline means no fold changes')
})

test('figure theme is stored with the presentation and validated',()=>{
 assert.equal(defaultPresentation().figureTheme,'screen')
 assert.equal(readPresentation({figureTheme:'journal'}).figureTheme,'journal')
 assert.equal(readPresentation({figureTheme:'neon'}).figureTheme,'screen')
})

test('sharing the y-axis keeps every per-plot axis choice except the shared flag',()=>{
 const key=plotKey('expression','ACTA1')
 const base={...defaultPresentation(),plotOverrides:{[key]:{axes:{...defaultPresentation().plotDefaults.expression.axes,yScale:'linear',yLabel:'Custom'}},[plotKey('ct','ACTA1')]:{axes:{...defaultPresentation().plotDefaults.ct.axes,yMin:15}}}}
 const next=setSharedY(base,'expression',true)
 assert.equal(next.plotDefaults.expression.axes.sharedY,true)
 assert.equal(next.plotOverrides[key].axes.sharedY,true);assert.equal(next.plotOverrides[key].axes.yScale,'linear');assert.equal(next.plotOverrides[key].axes.yLabel,'Custom')
 assert.equal(next.plotOverrides[plotKey('ct','ACTA1')].axes.sharedY,false,'other quantities are untouched')
 assert.equal(base.plotDefaults.expression.axes.sharedY,false,'the input is not mutated')
})

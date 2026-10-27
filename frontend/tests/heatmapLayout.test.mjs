import assert from 'node:assert/strict'
import test from 'node:test'
import {loadTs as load} from './loadTs.mjs'
const {groupColumns,foldColor,legendTicks,sortRows,ctColor,ctDomain,textOn,foldLabel,legendGradient,typicalN}=await load('heatmapLayout')
const luminance=color=>{const [r,g,b]=color.match(/\d+/g).map(Number).map(v=>{v/=255;return v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4});return 0.2126*r+0.7152*g+0.0722*b}

test('consecutive columns from one series and run share a spanning header',()=>{
 const columns=[{series:'100%',run:'r2',groupLabel:'100% · Plate 2'},{series:'100%',run:'r2',groupLabel:'100% · Plate 2'},{series:'150%',run:'r3',groupLabel:'150% · Plate 3'}]
 assert.deepEqual(groupColumns(columns),[{label:'100% · Plate 2',span:2},{label:'150% · Plate 3',span:1}])
})

test('fold colors diverge around a near-white 1x and saturate at 8x either way',()=>{
 assert.equal(foldColor(null),'var(--heat-empty)')
 assert.equal(foldColor(8),foldColor(64),'saturates beyond ±3 log2')
 assert.notEqual(foldColor(0.125),foldColor(8))
 assert.match(foldColor(1),/^rgb\(/,'solid colors, so text contrast can be computed')
 assert.ok(luminance(foldColor(1))>0.85);assert.ok(luminance(foldColor(8))<0.35);assert.ok(luminance(foldColor(0.125))<0.35)
})

test('Ct colors match the plate map: darker means lower Ct, fitted to the data',()=>{
 assert.deepEqual(ctDomain([16.3,33.9,21]),[16,34]);assert.deepEqual(ctDomain([]),[15,35]);assert.deepEqual(ctDomain([25,25.4]),[24,27])
 assert.ok(luminance(ctColor(16,[16,34]))<luminance(ctColor(34,[16,34])))
 assert.equal(ctColor(10,[16,34]),ctColor(16,[16,34]),'clamped to the domain');assert.equal(ctColor(null,[16,34]),'var(--heat-empty)')
})

test('cell text keeps at least 4.5:1 contrast on every fill',()=>{
 const contrast=(a,b)=>(Math.max(a,b)+.05)/(Math.min(a,b)+.05)
 for(let log=-3;log<=3;log+=.1){const fill=foldColor(2**log),text=textOn(fill)==='#fff'?1:0;assert.ok(contrast(luminance(fill),text)>=4.5,`fold 2^${log.toFixed(1)}`)}
 for(let ct=16;ct<=34;ct+=.5){const fill=ctColor(ct,[16,34]),text=textOn(fill)==='#fff'?1:0;assert.ok(contrast(luminance(fill),text)>=4.5,`Ct ${ct}`)}
})

test('cell text flips to white on dark colors',()=>{
 assert.equal(textOn(foldColor(1)),'var(--heat-ink)');assert.equal(textOn(ctColor(16,[16,34])),'#fff');assert.equal(textOn('var(--heat-empty)'),'var(--heat-ink)')
})

test('heatmap values use two significant figures',()=>{
 assert.deepEqual([0.214,58.8,177,1,1.06,0.876,3.72].map(foldLabel),['0.21×','59×','180×','1×','1.1×','0.88×','3.7×'])
})

test('the fold legend is one continuous gradient through all tick colors',()=>{
 const gradient=legendGradient()
 assert.match(gradient,/^linear-gradient\(90deg,/)
 for(const tick of legendTicks())assert.ok(gradient.includes(tick.color))
})

test('legend ticks label the color scale in fold change',()=>{
 assert.deepEqual(legendTicks().map(tick=>tick.label),['⅛×','¼×','½×','1×','2×','4×','8×'])
})

test('rows sort by largest change in either direction when requested',()=>{
 const rows=[{assay:'A',effect:0.2},{assay:'B',effect:3},{assay:'C',effect:null}]
 assert.deepEqual(sortRows(rows,'assay').map(row=>row.assay),['A','B','C'])
 assert.deepEqual(sortRows(rows,'effect').map(row=>row.assay),['B','A','C'])
})

test('a column states its usual n so only genes with a different n are labelled',()=>{
 assert.equal(typicalN([2,2,1,2]),2);assert.equal(typicalN([1,3]),3,'ties take the larger n');assert.equal(typicalN([]),null)
})

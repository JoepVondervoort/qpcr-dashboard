import assert from 'node:assert/strict'
import test from 'node:test'
import {loadTs as load} from './loadTs.mjs'
const {groupColumns,foldColor,legendTicks,sortRows}=await load('heatmapLayout')

test('consecutive columns from one series and run share a spanning header',()=>{
 const columns=[{series:'100%',run:'r2',groupLabel:'100% · Plate 2'},{series:'100%',run:'r2',groupLabel:'100% · Plate 2'},{series:'150%',run:'r3',groupLabel:'150% · Plate 3'}]
 assert.deepEqual(groupColumns(columns),[{label:'100% · Plate 2',span:2},{label:'150% · Plate 3',span:1}])
})

test('fold colors diverge around 1x and saturate at 8x either way',()=>{
 assert.equal(foldColor(null),'var(--heat-empty)')
 assert.equal(foldColor(8),foldColor(64),'saturates beyond ±3 log2')
 assert.notEqual(foldColor(0.125),foldColor(8))
 assert.match(foldColor(1),/rgba\(/)
})

test('legend ticks label the color scale in fold change',()=>{
 assert.deepEqual(legendTicks().map(tick=>tick.label),['⅛×','¼×','½×','1×','2×','4×','8×'])
})

test('rows sort by largest change in either direction when requested',()=>{
 const rows=[{assay:'A',effect:0.2},{assay:'B',effect:3},{assay:'C',effect:null}]
 assert.deepEqual(sortRows(rows,'assay').map(row=>row.assay),['A','B','C'])
 assert.deepEqual(sortRows(rows,'effect').map(row=>row.assay),['B','A','C'])
})

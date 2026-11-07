import assert from 'node:assert/strict'
import test from 'node:test'
import {loadTs} from './loadTs.mjs'
const {ctFill}=await loadTs('plateColors')
test('Ct colors use a fixed green to red scale and leave missing measurements blank',()=>{
 assert.equal(ctFill(15),'hsl(120.0 60% 85%)')
 assert.equal(ctFill(26.5),'hsl(60.0 60% 85%)')
 assert.equal(ctFill(38),'hsl(0.0 60% 85%)')
 assert.equal(ctFill(50),ctFill(38))
 assert.equal(ctFill(null),undefined)
 assert.equal(ctFill(NaN),undefined)
})

const {categoryFills}=await loadTs('plateColors')
const {defaultPresentation,seriesColor}=await loadTs('presentation')
test('condition colors match figure condition colors and genes stay stable across row order',()=>{
 const presentation=defaultPresentation()
 const conditions=[{group:'Drug · Day 2',series:'Drug'},{group:'Control · Day 0',series:'Control'},{group:'Drug · Day 4',series:'Drug'}]
 const first=categoryFills(conditions,['Z','A','Z'],presentation)
 const reordered=categoryFills([...conditions].reverse(),['A','Z'],presentation)
 assert.equal(first.group.get('Drug · Day 2'),seriesColor('condition:Drug',1,presentation)+'26')
 assert.equal(first.group.get('Drug · Day 2'),first.group.get('Drug · Day 4'))
 for(const [label,color] of first.group)assert.equal(reordered.group.get(label),color)
 for(const [label,color] of first.assay)assert.equal(reordered.assay.get(label),color)
})
test('shared palette and saved condition colors carry into the plate table',()=>{
 const presentation=defaultPresentation()
 presentation.palette='accessible'
 presentation.colors['condition:Drug']='#123456'
 const conditions=[{group:'Drug',series:'Drug'}]
 assert.equal(categoryFills(conditions,['GAPDH'],presentation).group.get('Drug'),'#12345626')
 presentation.plotDefaults.ct.style.colorBy='condition'
 presentation.plotDefaults.ct.style.groups.Drug={outline:'#abcdef'}
 assert.equal(categoryFills(conditions,[],presentation).group.get('Drug'),'#abcdef26')
})

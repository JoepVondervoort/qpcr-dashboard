import assert from 'node:assert/strict'
import test from 'node:test'
import {loadTs} from './loadTs.mjs'
const {CULTURE_VESSELS,cultureVessel,culturePages}=await loadTs('cultureVessels')
test('12-well plate is the initial default, including for invalid saved preferences',()=>{
 for(const value of [null,undefined,'invalid',{},12])assert.equal(cultureVessel(value).id,'12')
 for(const vessel of CULTURE_VESSELS)assert.equal(cultureVessel(vessel.id),vessel)
})
test('plate dimensions match standard culture layouts',()=>{
 for(const id of ['6','12','24','48','96']){
  const vessel=cultureVessel(id)
  assert.equal(vessel.rows*vessel.columns,Number(id))
 }
 for(const id of ['dish35','dish60','dish100']){
  const vessel=cultureVessel(id)
  assert.equal(vessel.rows*vessel.columns,1)
 }
})
test('overflow samples get extra vessels without dropping or repeating samples',()=>{
 const samples=Array.from({length:53},(_,i)=>`Sample ${i+1}`)
 for(const vessel of CULTURE_VESSELS){
  const capacity=vessel.rows*vessel.columns,pages=culturePages(samples,capacity)
  assert.deepEqual(pages.flat(),samples)
  assert.equal(pages.length,Math.ceil(samples.length/capacity))
  assert.ok(pages.every(page=>page.length<=capacity))
 }
 assert.deepEqual(culturePages([],12),[])
})

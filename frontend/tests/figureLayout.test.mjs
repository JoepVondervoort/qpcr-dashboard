import {readFileSync} from 'node:fs'
import assert from 'node:assert/strict'
import test from 'node:test'
import ts from 'typescript'
const source=readFileSync(new URL('../src/figureLayout.ts',import.meta.url),'utf8')
const {outputText}=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext}})
const {resolveTimeSpacing,pngWithDpi}=await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
test('time is proportional unless neighbouring time points would collide, and remains overridable',()=>{
 assert.equal(resolveTimeSpacing([0,21,28],false,'auto'),'proportional')
 assert.equal(resolveTimeSpacing([0,7,14,21],false,'auto'),'proportional')
 assert.equal(resolveTimeSpacing([0,1,2,28],false,'auto'),'measured','one-day steps inside four weeks would overlap')
 assert.equal(resolveTimeSpacing([0,7,14,21],true,'auto'),'measured','bars need equal slots')
 assert.equal(resolveTimeSpacing([0,21,28],true,'proportional'),'proportional')
 assert.equal(resolveTimeSpacing([0,0,21,28],false,'auto'),'proportional')
 assert.equal(resolveTimeSpacing([5],false,'auto'),'proportional')
})
test('600 dpi PNG resolution replaces an existing resolution chunk without changing image data',()=>{
 const original=new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQ1kAAAAASUVORK5CYII=','base64'))
 const output=pngWithDpi(original,600)
 assert.equal(output.length,original.length+21)
 assert.equal(new TextDecoder().decode(output.subarray(37,41)),'pHYs')
 assert.equal(new DataView(output.buffer).getUint32(41),23622)
 assert.equal(new DataView(output.buffer).getUint32(45),23622)
 assert.equal(output[49],1)
 assert.deepEqual(output.subarray(54),original.subarray(33))
 assert.deepEqual(pngWithDpi(output,600),output)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import {loadTs} from './loadTs.mjs'

const {addFiles,fileKey,uploadRequests,importReport}=await loadTs('uploads')

const file=(name,size=100,lastModified=1)=>({name,size,lastModified})

test('chosen and dropped files add up, and the same file is kept once',()=>{
 const first=[file('plate 1.xlsx')]
 const added=addFiles(first,[file('plate 1.xlsx'),file('plate 2.xlsx'),file('plate 2.xlsx')])
 assert.deepEqual(added.map(f=>f.name),['plate 1.xlsx','plate 2.xlsx'])
 assert.deepEqual(first.map(f=>f.name),['plate 1.xlsx'])
 // Files with the same name from different folders are different files.
 assert.equal(addFiles(added,[file('plate 1.xlsx',200)]).length,3)
 assert.notEqual(fileKey(file('a.xls',1)),fileKey(file('a.xls',2)))
})

test('one file is one experiment, named by the label or the file',()=>{
 assert.deepEqual(uploadRequests([file('LAD081.xlsx')],null,''),[{name:'LAD081',files:[file('LAD081.xlsx')],combine:false}])
 assert.equal(uploadRequests([file('LAD081.xlsx')],'experiments','  Day 21 ')[0].name,'Day 21')
 assert.deepEqual(uploadRequests([],'experiments',''),[])
})

test('several files wait for the scientist to say how they belong together',()=>{
 const files=[file('housekeeping genes _stability 2  .xls'),file('20250402.xlsx'),file('mv01.xls')]
 assert.deepEqual(uploadRequests(files,null,''),[])
 const separate=uploadRequests(files,'experiments','ignored label')
 assert.deepEqual(separate.map(r=>[r.name,r.files.length,r.combine]),[['housekeeping genes _stability 2',1,false],['20250402',1,false],['mv01',1,false]])
 const plates=[file('X_1.xls'),file('X_3.xls')]
 assert.deepEqual(uploadRequests(plates,'runs',''),[{name:'X_1 + 3',files:plates,combine:false}])
 assert.deepEqual(uploadRequests(plates,'combined','Shared baseline'),[{name:'Shared baseline',files:plates,combine:true}])
})

test('a batch report says what was imported and which files were not',()=>{
 const request=name=>({name,files:[file(`${name}.xls`)],combine:false})
 assert.deepEqual(importReport([{request:request('a'),error:null},{request:request('b'),error:null}]),
  {imported:['a','b'],failed:[],message:'Imported 2 experiments. Open each one to set up its analysis.'})
 const partly=importReport([{request:request('a'),error:null},{request:request('b'),error:'Unsupported layout'}])
 assert.deepEqual([partly.imported,partly.failed],[['a'],[{key:fileKey(file('b.xls')),name:'b.xls',error:'Unsupported layout'}]])
 assert.equal(partly.message,'Imported 1 of 2 files. The file below was not imported; remove it or try again.')
 assert.equal(importReport([{request:request('a'),error:'x'},{request:request('b'),error:'y'}]).message,'None of the 2 files was imported. Check the reasons below.')
 // The server names the file in its message; the list shows the name already.
 assert.deepEqual(importReport([{request:request('c'),error:'c.xls: This file could not be read as an Excel file.'}]).failed.map(f=>f.error),['This file could not be read as an Excel file.'])
 // Two files with one name from different folders keep their own reasons.
 const twins=importReport([{request:{name:'x',files:[file('x.xls',1)],combine:false},error:'first'},{request:{name:'x',files:[file('x.xls',2)],combine:false},error:'second'}])
 assert.deepEqual(twins.failed.map(f=>[f.key,f.error]),[[fileKey(file('x.xls',1)),'first'],[fileKey(file('x.xls',2)),'second']])
})

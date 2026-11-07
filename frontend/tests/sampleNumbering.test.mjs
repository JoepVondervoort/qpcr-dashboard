import assert from 'node:assert/strict'
import test from 'node:test'
import {loadTs} from './loadTs.mjs'

const {renameFromList,renameList,samplesInOrder}=await loadTs('sampleNumbering')

const sample=(name,wells)=>({name,wells})

test('numbered samples are listed in number order, controls and unnamed wells left out',()=>{
 const listed=samplesInOrder([sample('Sample 10',['A19']),sample('Sample 2',['A3']),sample('NTC',['P1']),sample('Unassigned sample',['P13']),sample('Sample 1',['A1'])],name=>name==='NTC')
 assert.deepEqual(listed.map(s=>s.name),['Sample 1','Sample 2','Sample 10'])
})

test('pasted names replace the listed samples in order, in every well of each sample',()=>{
 const samples=[sample('Sample 1',['A1','A2','D1','D2']),sample('Sample 2',['A3','A4']),sample('Sample 3',['A5','A6'])]
 const result=renameFromList(samples,['Ctrl.1','Ctrl.2'])
 assert.deepEqual(result.assignments,{A1:'Ctrl.1',A2:'Ctrl.1',D1:'Ctrl.1',D2:'Ctrl.1',A3:'Ctrl.2',A4:'Ctrl.2'})
 assert.deepEqual(result.pairs,[['Sample 1','Ctrl.1'],['Sample 2','Ctrl.2'],['Sample 3',null]])
 assert.equal(result.renamed,2)
 assert.equal(result.unused,0)
 assert.deepEqual(result.pooled,[])
})

test('one name for several samples is pointed out, and extra names are counted',()=>{
 const samples=[sample('Sample 1',['A1']),sample('Sample 2',['A3'])]
 const result=renameFromList(samples,['Ctrl','Ctrl','LNP'])
 assert.deepEqual(result.pooled,[{name:'Ctrl',count:2}])
 assert.equal(result.unused,1)
})

test('numbered samples keep number order and their wells, so a rename can be applied twice or after saving part of it',()=>{
 const auto={wells:{A1:'Sample 1',A2:'Sample 1',A3:'Sample 2',A4:'Sample 2',A19:'Sample 10',A20:'Sample 10',P1:'NTC'}}
 const saved={A1:'WT.1',A2:'WT.1'}
 const listed=renameList(auto,[],well=>saved[well]??auto.wells[well])
 assert.deepEqual(listed,[{name:'WT.1',wells:['A1','A2']},{name:'Sample 2',wells:['A3','A4']},{name:'Sample 10',wells:['A19','A20']}])
 // The same pasted list gives the same wells the same names, whatever was renamed before.
 assert.deepEqual(renameFromList(listed,['WT.1','KO.1']).assignments,{A1:'WT.1',A2:'WT.1',A3:'KO.1',A4:'KO.1'})
 const fallback=[sample('B',['B1']),sample('A',['A1'])]
 assert.equal(renameList(undefined,fallback,()=>''),fallback)
})

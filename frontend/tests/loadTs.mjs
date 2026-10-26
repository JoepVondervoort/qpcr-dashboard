import {readFileSync} from 'node:fs'
import ts from 'typescript'
const cache=new Map()
export function compileTs(url){
 const key=String(url);if(cache.has(key))return cache.get(key)
 const {outputText}=ts.transpileModule(readFileSync(url,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext}})
 const resolved=outputText.replace(/from ['"](.+?)['"]/g,(match,path)=>path.startsWith('.')?`from '${compileTs(new URL(path.endsWith('.ts')?path:path+'.ts',url))}'`:match)
 const data=`data:text/javascript;base64,${Buffer.from(resolved).toString('base64')}`;cache.set(key,data);return data
}
export async function loadTs(name){return import(compileTs(new URL(`../src/${name}.ts`,import.meta.url)))}

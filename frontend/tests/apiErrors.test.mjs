import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import test from 'node:test'
import ts from 'typescript'
const source = readFileSync(new URL('../src/apiErrors.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } })
const { apiErrorMessage } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)

test('formats FastAPI validation objects as named field errors', () => {
  assert.equal(apiErrorMessage({ detail: [{ loc: ['body','reference_assays'], msg: 'List should have at least 1 item', type: 'too_short' }] }, 422), 'reference_assays: List should have at least 1 item')
})
test('explains outdated single-baseline API', () => {
  assert.match(apiErrorMessage({detail:[{loc:['body','baseline_sample'],msg:'Field required',type:'missing'}]},422), /backend is outdated.*Restart/s)
})
test('preserves scientific errors and handles non-JSON failures', () => {
  assert.equal(apiErrorMessage({detail:'Every baseline requires all reference assays.'},422), 'Every baseline requires all reference assays.')
  assert.equal(apiErrorMessage(null,500), 'Request failed (HTTP 500).')
  assert.equal(apiErrorMessage({detail:{message:'Invalid reference'}},422),'Invalid reference')
  assert.equal(apiErrorMessage({detail:{reason:'Invalid'}},422),'{"reason":"Invalid"}')
})

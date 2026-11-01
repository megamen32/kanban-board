import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {clearDiagnostics,diagnosticSnapshot,recordDiagnostic,subscribeDiagnostics} from './board-diagnostics';
import {boardMutationRequest,readMutationResponse} from './mutation-response';
beforeEach(clearDiagnostics);afterEach(()=>vi.unstubAllGlobals());
describe('safe board diagnostic journal',()=>{
 it('never stores arbitrary response payload, URL, token or unknown reasons',()=>{
  recordDiagnostic('update',400,'secret bearer https://private');
  recordDiagnostic('update',400,'__proto__');
  const text=JSON.stringify(diagnosticSnapshot());
  expect(text).not.toMatch(/secret|bearer|private|__proto__/);expect(diagnosticSnapshot()[0].reason).toBe('mutation_rejected');
 });
 it('bounds recent entries and notifies on clear',()=>{
  const listener=vi.fn();const unsubscribe=subscribeDiagnostics(listener);
  for(let i=0;i<40;i++)recordDiagnostic('update',409,'version_conflict');
  expect(diagnosticSnapshot()).toHaveLength(30);clearDiagnostics();expect(diagnosticSnapshot()).toEqual([]);
  expect(listener).toHaveBeenCalledTimes(41);unsubscribe();
 });
 it('retains canonical review guidance without a transition',async()=>{
  await expect(readMutationResponse(Response.json({error:'review_requires_explicit_decision'},{status:400}),false,'review')).rejects.toThrow('доработку');
  expect(diagnosticSnapshot()[0]).toMatchObject({action:'review',reason:'review_requires_explicit_decision'});
 });
 it('records CAS conflicts while preserving the existing caller contract',async()=>{
  const body={conflict:true,serverCard:{id:'synthetic',version:3}};
  expect(await readMutationResponse(Response.json(body,{status:409}),true)).toEqual(body);
  expect(diagnosticSnapshot()[0].reason).toBe('version_conflict');
 });
 it('sends a request ID and associates the refused response without payload',async()=>{
  const fetcher=vi.fn().mockResolvedValue(Response.json({error:'private server detail'},{status:503}));vi.stubGlobal('fetch',fetcher);
  const response=await boardMutationRequest('/synthetic',{method:'POST',body:'secret'},'create');
  await expect(readMutationResponse(response,false,'create')).rejects.toThrow();
  const requestId=new Headers(fetcher.mock.calls[0][1].headers).get('x-board-request-id');
  expect(diagnosticSnapshot()[0].requestId).toBe(requestId);expect(JSON.stringify(diagnosticSnapshot())).not.toMatch(/secret|private|synthetic/);
 });
 it('does not replay unknown network outcomes and explains readback',async()=>{
  const fetcher=vi.fn().mockRejectedValue(new Error('secret'));vi.stubGlobal('fetch',fetcher);
  await expect(boardMutationRequest('/synthetic',{method:'PATCH'},'update')).rejects.toThrow('могло сохраниться');
  expect(fetcher).toHaveBeenCalledTimes(1);expect(diagnosticSnapshot()[0].reason).toBe('network_unconfirmed');
 });
 it('does not create errors for success',async()=>{
  await readMutationResponse(Response.json({success:true}));expect(diagnosticSnapshot()).toEqual([]);
 });
});

import {admitSourceTask,listPendingSourceIntents} from './source-operation';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createCard, createAdmittedCard, findCardById, updateCard } from './file-store';
import { startDotExecution, recordDotEvent, answerDotQuestion, dotExecutionAvailability, type DotTransport } from './dot-execution';
vi.mock('@/lib/kanban/task-execution-client', () => ({callOwnerHerderTool: vi.fn(() => {throw Error('native calls forbidden in dot tests');})}));
let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'dot-board-fixture-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const room = 'a'.repeat(32);
function fixture() {
  const card = createCard('Synthetic owner task', 'Only fixture text', 'todo', 'medium', [], 'fixture', ['nikita'], dir);
  const transport: DotTransport = { roomId: room, authorize: vi.fn(async () => true), enqueueTrusted: vi.fn(async () => ({status:'submitted_unconfirmed'})) };
  return { card, transport, context: { card, actor:'nikita', tasksDir:dir, commission:{kind:'owner-command' as const,actor:'nikita',sourceRef:'fixture-owner-command'} }, request: { expectedVersion:card.version, operationId:'fixture-operation-123456' } };
}
it('persists genuine dot receipt before enqueue and never native session IDs', async () => {
  const f=fixture(); f.transport.enqueueTrusted=vi.fn(async input => {
    const saved=findCardById(f.card.id,dir)!; const attempt=saved.taskExecutionHistory!.at(-1)!;
    expect(attempt.provider).toBe('dot'); expect(attempt.dot?.requestId).toBe(input.requestId);
    expect(attempt.nativeSessionId).toBeUndefined(); expect(attempt.nativeTurnId).toBeUndefined();
    expect(input.text).not.toContain('executor-key'); return {status:'submitted_unconfirmed'};
  });
  expect((await startDotExecution(f.context,f.request,f.transport)).status).toBe(202);
  expect(f.transport.enqueueTrusted).toHaveBeenCalledTimes(1);
  const saved=findCardById(f.card.id,dir)!;
  expect(saved.taskExecutionHistory![0].phase).toBe('dispatch-unknown');
  expect(saved.taskExecutionHistory![0].dot?.delivery).toBe('unknown');
});
it('restart/repeated same request never dispatches twice',async()=>{
  const f=fixture(); await startDotExecution(f.context,f.request,f.transport);
  const result=await startDotExecution({...f.context,card:findCardById(f.card.id,dir)!},f.request,f.transport);
  expect(result.body).toHaveProperty('replay',true);expect(f.transport.enqueueTrusted).toHaveBeenCalledTimes(1);
});
it('unknown enqueue failure remains claimed, no replay',async()=>{
  const f=fixture();f.transport.enqueueTrusted=vi.fn(async()=>{throw Error('network');});
  await startDotExecution(f.context,f.request,f.transport);
  await startDotExecution({...f.context,card:findCardById(f.card.id,dir)!},f.request,f.transport);
  expect(f.transport.enqueueTrusted).toHaveBeenCalledTimes(1);
});
it('different concurrent operation cannot claim same card',async()=>{
  const f=fixture();await startDotExecution(f.context,f.request,f.transport);
  const fresh=findCardById(f.card.id,dir)!;
  expect((await startDotExecution({...f.context,card:fresh},{expectedVersion:fresh.version,operationId:'different-operation-123'},f.transport)).status).toBe(409);
  expect(f.transport.enqueueTrusted).toHaveBeenCalledTimes(1);
});
it('transport absent creates no receipt and cannot fall back',async()=>{
 const f=fixture();expect((await startDotExecution(f.context,f.request)).status).toBe(503);
 expect(findCardById(f.card.id,dir)?.taskExecutionHistory).toBeUndefined();
});
it('current owner denial prevents reservation and dispatch',async()=>{
 const f=fixture();f.transport.authorize=vi.fn(async()=>false);
 expect((await startDotExecution(f.context,f.request,f.transport)).status).toBe(403);
 expect(f.transport.enqueueTrusted).not.toHaveBeenCalled();
});
it('changed card and blocked card refuse start',async()=>{
 const f=fixture();updateCard(f.card.id,{column:'blocked'},f.card.version,dir);
 expect((await startDotExecution(f.context,f.request,f.transport)).status).toBe(409);
 expect(f.transport.enqueueTrusted).not.toHaveBeenCalled();
});
it('authorization revoked after reservation never sends',async()=>{
 const f=fixture();let count=0;f.transport.authorize=vi.fn(async()=>++count===1);
 expect((await startDotExecution(f.context,f.request,f.transport)).status).toBe(409);
 expect(f.transport.enqueueTrusted).not.toHaveBeenCalled();
 expect(findCardById(f.card.id,dir)?.taskExecutionHistory).toHaveLength(1);
});
it('dot receipt cannot carry fabricated native session',async()=>{
 const f=fixture();await startDotExecution(f.context,f.request,f.transport);const c=findCardById(f.card.id,dir)!;
 expect(()=>updateCard(c.id,{taskExecutionHistory:c.taskExecutionHistory!.map(a=>({...a,nativeSessionId:'fake'}))},c.version,dir)).toThrow();
});

it('protected result enters review and never automatic done',async()=>{
 const f=fixture();await startDotExecution(f.context,f.request,f.transport);const a=findCardById(f.card.id,dir)!.taskExecutionHistory![0];
 const event={cardId:f.card.id,tasksDir:dir,operationId:a.operationId,roomId:room,requestId:a.dot!.requestId,receiptId:'fixture-result',kind:'done' as const};
 const r=await recordDotEvent(event,async()=>({safeSummary:'Synthetic verified result'}));
 expect(r.status).toBe(200);expect(findCardById(f.card.id,dir)?.column).toBe('review');expect(findCardById(f.card.id,dir)?.needsReview).toBe(true);
 expect((await recordDotEvent(event,async()=>({safeSummary:'Synthetic verified result'}))).body).toHaveProperty('idempotent',true);
 expect((await recordDotEvent(event,async()=>({safeSummary:'Different result'}))).status).toBe(409);
});
it('unverified callback cannot write result',async()=>{
 const f=fixture();await startDotExecution(f.context,f.request,f.transport);const a=findCardById(f.card.id,dir)!.taskExecutionHistory![0];
 const r=await recordDotEvent({cardId:f.card.id,tasksDir:dir,operationId:a.operationId,roomId:room,requestId:a.dot!.requestId,receiptId:'fixture-result',kind:'done'},async()=>null);
 expect(r.status).toBe(403);expect(findCardById(f.card.id,dir)?.column).toBe('todo');
});
it('verified callback cannot copy private text without board-safe summary',async()=>{
 const f=fixture();await startDotExecution(f.context,f.request,f.transport);const a=findCardById(f.card.id,dir)!.taskExecutionHistory![0];
 const r=await recordDotEvent({cardId:f.card.id,tasksDir:dir,operationId:a.operationId,roomId:room,requestId:a.dot!.requestId,receiptId:'fixture-result',kind:'done'},async()=>({}));
 expect(r.status).toBe(400);expect(findCardById(f.card.id,dir)?.resultHistory ?? []).toHaveLength(0);
});
it('foreign room and operation callbacks are rejected before verifier',async()=>{
 const f=fixture();await startDotExecution(f.context,f.request,f.transport);const a=findCardById(f.card.id,dir)!.taskExecutionHistory![0];const verify=vi.fn(async()=>({}));
 expect((await recordDotEvent({cardId:f.card.id,tasksDir:dir,operationId:a.operationId,roomId:'b'.repeat(32),requestId:a.dot!.requestId,receiptId:'fixture-result',kind:'running'},verify)).status).toBe(409);
 expect(verify).not.toHaveBeenCalled();
});

async function askFixture() {
 const f=fixture();await startDotExecution(f.context,f.request,f.transport);
 const a=findCardById(f.card.id,dir)!.taskExecutionHistory![0];
 const event={cardId:f.card.id,tasksDir:dir,operationId:a.operationId,roomId:room,requestId:a.dot!.requestId,receiptId:'fixture-question',kind:'needs_input' as const};
 expect((await recordDotEvent(event,async()=>({safeQuestion:{question:'Synthetic choice?',choices:[{value:'a',label:'A'},{value:'b',label:'B'}]}}))).status).toBe(200);
 return f;
}
it('question continuation reserves once in same dot without native session',async()=>{
 const f=await askFixture();const card=findCardById(f.card.id,dir)!;
 expect(card.pendingQuestion?.timeoutValue).toBeUndefined();
 const result=await answerDotQuestion({...f.context,card},'a',f.transport);
 expect(result.status).toBe(202);expect(f.transport.enqueueTrusted).toHaveBeenCalledTimes(2);
 const second=(f.transport.enqueueTrusted as ReturnType<typeof vi.fn>).mock.calls[1][0];
 expect(second.requestId).toContain(':answer:');expect(JSON.parse(second.text).kind).toBe('board_task_answer');
 expect((await answerDotQuestion({...f.context,card:findCardById(f.card.id,dir)!},'a',f.transport)).body).toHaveProperty('idempotent',true);
 expect(f.transport.enqueueTrusted).toHaveBeenCalledTimes(2);
 expect((await answerDotQuestion({...f.context,card:findCardById(f.card.id,dir)!},'b',f.transport)).status).toBe(409);
});
it('missing answer transport never consumes question',async()=>{
 const f=await askFixture();expect((await answerDotQuestion({...f.context,card:findCardById(f.card.id,dir)!},'a')).status).toBe(503);
 expect(findCardById(f.card.id,dir)?.pendingQuestion?.answer).toBeUndefined();
});
it('foreign actor cannot answer or expose dot readiness',async()=>{
 const f=await askFixture();f.transport.authorize=vi.fn(async()=>false);const card=findCardById(f.card.id,dir)!;
 expect((await answerDotQuestion({...f.context,actor:'other',card},'a',f.transport)).status).toBe(403);
 expect((await dotExecutionAvailability(card,'other',f.transport)).dotStartAvailable).toBe(false);
});

it('uncommissioned or foreign-source task cannot start',async()=>{const f=fixture();expect((await startDotExecution({...f.context,commission:undefined},f.request,f.transport)).status).toBe(403);expect((await startDotExecution({...f.context,commission:{kind:'source-intent',actor:'nikita',sourceRef:'fake'}},f.request,f.transport)).status).toBe(403);expect(f.transport.enqueueTrusted).not.toHaveBeenCalled();});

it('owner explicit source intent is consumed durably before enqueue',async()=>{
 const admitted=admitSourceTask({tenant:'fixture',sourceOwner:'nikita',sourceEvent:'event-1',primaryItem:'primary',sourceRevision:'rev1',project:'fixture',title:'Commissioned task',description:'Synthetic',priority:'medium',assignees:['nikita'],classification:'explicit-task',evidenceRefs:['fixture:event-1']},dir,id=>findCardById(id,dir),input=>createAdmittedCard(input,dir));
 const card=findCardById(admitted.cardId,dir)!;
 const transport:DotTransport={roomId:room,authorize:async()=>true,enqueueTrusted:vi.fn(async()=>{
  expect(listPendingSourceIntents(dir,id=>findCardById(id,dir))).toHaveLength(0);
  expect(findCardById(card.id,dir)?.taskExecutionHistory?.[0].dot?.commission.sourceRef).toBe(card.sourceAdmission?.operationKey);
  return {status:'accepted'};
 })};
 const context={actor:'nikita',tasksDir:dir,card,commission:{kind:'source-intent' as const,actor:'nikita',sourceRef:card.sourceAdmission!.operationKey}};
 expect((await startDotExecution(context,{expectedVersion:card.version,operationId:'fixture-commissioned-op'},transport)).status).toBe(202);
 expect(transport.enqueueTrusted).toHaveBeenCalledTimes(1);
});

it('delayed callback retries cannot regress or recreate a question',async()=>{
 const f=fixture();await startDotExecution(f.context,f.request,f.transport);const a=findCardById(f.card.id,dir)!.taskExecutionHistory![0];
 const base={cardId:f.card.id,tasksDir:dir,operationId:a.operationId,roomId:room,requestId:a.dot!.requestId};
 const running={...base,receiptId:'running-1',kind:'running' as const};
 const question={...base,receiptId:'question-1',kind:'needs_input' as const};
 const verifyQuestion=async()=>({safeQuestion:{question:'Synthetic?',choices:[{value:'a',label:'A'},{value:'b',label:'B'}]}});
 await recordDotEvent(running,async()=>({}));await recordDotEvent(question,verifyQuestion);
 expect((await recordDotEvent(running,async()=>({}))).body).toHaveProperty('idempotent',true);
 expect(findCardById(f.card.id,dir)!.taskExecutionHistory![0].phase).toBe('waiting');
 expect((await recordDotEvent({...running,receiptId:'late-new-running'},async()=>({}))).status).toBe(409);
 const fresh=findCardById(f.card.id,dir)!;expect((await answerDotQuestion({...f.context,card:fresh},'a',f.transport)).status).toBe(202);
 expect((await recordDotEvent(question,verifyQuestion)).body).toHaveProperty('idempotent',true);
 expect(findCardById(f.card.id,dir)?.pendingQuestion?.answer?.value).toBe('a');
});
it('card edit during awaited pre-send authorization prevents task send',async()=>{
 const f=fixture();let count=0;f.transport.authorize=async()=>{if(++count===2){const c=findCardById(f.card.id,dir)!;updateCard(c.id,{column:'blocked'},c.version,dir);}return true;};
 expect((await startDotExecution(f.context,f.request,f.transport)).status).toBe(409);
 expect(f.transport.enqueueTrusted).not.toHaveBeenCalled();expect(findCardById(f.card.id,dir)?.column).toBe('blocked');
 expect(findCardById(f.card.id,dir)?.taskExecutionHistory?.[0].dot?.delivery).toBe('not_accepted');
});
it('card edit during awaited answer authorization prevents continuation',async()=>{
 const f=await askFixture();let count=0;f.transport.authorize=async()=>{if(++count===2){const c=findCardById(f.card.id,dir)!;updateCard(c.id,{column:'blocked'},c.version,dir);}return true;};
 expect((await answerDotQuestion({...f.context,card:findCardById(f.card.id,dir)!},'a',f.transport)).status).toBe(409);
 expect(f.transport.enqueueTrusted).toHaveBeenCalledTimes(1);
 expect(findCardById(f.card.id,dir)?.taskExecutionHistory?.[0].phase).toBe('waiting');
 expect(findCardById(f.card.id,dir)?.taskExecutionHistory?.[0].dot?.delivery).toBe('accepted');
 expect(findCardById(f.card.id,dir)?.pendingQuestion?.deliveryError).toBe('dot_answer_not_accepted');
});
it('proven queue refusal is terminal not-attempted, not a permanent unknown claim',async()=>{
 const f=fixture();f.transport.enqueueTrusted=vi.fn(async()=>({status:'queue_full_not_accepted'}));
 const r=await startDotExecution(f.context,f.request,f.transport);expect(r.body).toHaveProperty('state','not_attempted');
 const c=findCardById(f.card.id,dir)!;expect(c.taskExecutionHistory![0].phase).toBe('stopped');expect(c.taskExecutionHistory![0].dot?.delivery).toBe('not_accepted');
 await startDotExecution({...f.context,card:c},f.request,f.transport);expect(f.transport.enqueueTrusted).toHaveBeenCalledTimes(1);
});

it('known answer refusal never stops the accepted parent task',async()=>{
 const f=await askFixture();f.transport.enqueueTrusted=vi.fn(async()=>({status:'queue_full_not_accepted'}));
 const r=await answerDotQuestion({...f.context,card:findCardById(f.card.id,dir)!},'a',f.transport);
 expect(r.body).toHaveProperty('delivery','not_attempted');
 const current=findCardById(f.card.id,dir)!;
 expect(current.taskExecutionHistory![0].phase).toBe('waiting');
 expect(current.taskExecutionHistory![0].dot?.delivery).toBe('accepted');
 expect(current.pendingQuestion?.deliveryError).toBe('dot_answer_not_accepted');
});

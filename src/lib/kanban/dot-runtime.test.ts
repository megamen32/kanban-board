import {mkdtempSync,rmSync,writeFileSync,readFileSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {createCard,findCardById,updateCard} from './file-store';
import {startDotExecution} from './dot-execution';
import {configuredDotTransport,handleDotCallback,DOT_ROOM,reconcileConfiguredDotReceipt} from './dot-runtime';
vi.mock('@/lib/kanban/task-execution-client',()=>({callOwnerHerderTool:vi.fn()}));
let dir:string,state:string;
beforeEach(()=>{dir=mkdtempSync(join(tmpdir(),'dot-runtime-'));state=mkdtempSync(join(tmpdir(),'dot-grant-'));vi.stubEnv('BOARD_DOT_STATE_DIR',state);});
afterEach(()=>{vi.unstubAllEnvs();rmSync(dir,{recursive:true,force:true});rmSync(state,{recursive:true,force:true});});
function fixture(){
 const c=createCard('Nonsecret canary','Return fixture marker','todo','medium',[],'fixture',['nikita'],dir);
 const card=updateCard(c.id,{owner:'nikita'},c.version,dir);if('conflict' in card)throw Error();
 const binding={enabled:true,owner:'540308572',room:DOT_ROOM,token:'T'.repeat(40),actors:['nikita'],
  cards:[{id:card.id,project:card.project,owner:'nikita'}],expiresAt:new Date(Date.now()+3600000).toISOString()};
 const save=()=>writeFileSync(join(state,'binding.json'),JSON.stringify(binding),{mode:0o600});
 save();return {card,binding,save};
}
async function run(){
 const f=fixture();
 const fetcher=vi.fn(async(_url:unknown,options?:RequestInit)=>{const input=JSON.parse(options!.body as string);
 return Response.json({requestId:input.requestId,status:'accepted'},{status:202});});
 const transport=configuredDotTransport(dir,fetcher as typeof fetch)!;
 const result=await startDotExecution({card:f.card,actor:'nikita',tasksDir:dir,commission:{kind:'owner-command',actor:'nikita',sourceRef:'fixture-authorized'}},
 {expectedVersion:f.card.version,operationId:'test-operation-123456'},transport);
 const card=findCardById(f.card.id,dir)!;const op=card.taskExecutionHistory!.at(-1)!.operationId;
 const cap=JSON.parse(readFileSync(join(state,'attempts',op+'.json'),'utf8'));
 return {...f,fetcher,result,op,cap};
}
it('is disabled without protected configuration and refuses permissive file mode',()=>{
 expect(configuredDotTransport(dir)).toBeUndefined();fixture();chmodSync(join(state,'binding.json'),0o644);
 expect(configuredDotTransport(dir)).toBeUndefined();
});
it('enqueues only exact owned allowlisted card to fixed origin and stores callback key server-side',async()=>{
 const f=await run();expect(f.result.status).toBe(202);expect(f.fetcher).toHaveBeenCalledTimes(1);
 const [url,options]=f.fetcher.mock.calls[0];expect(url).toBe('https://msg.bezrabotnyi.com/telegram-qr/dot-board/requests');
 expect(options!.redirect).toBe('error');expect(options!.body).not.toContain(f.cap.key);
 const other=createCard('Other','','todo','medium',[],'fixture',['nikita'],dir);
 expect(await configuredDotTransport(dir)!.authorize('nikita',other)).toBe(false);
 expect(await configuredDotTransport(dir)!.authorize('stranger',f.card)).toBe(false);
});
it('actual callback records review, duplicate is idempotent and a tampered key or card is forbidden',async()=>{
 const f=await run();const body={operationId:f.op,requestId:'board:'+f.op,receiptId:'fixture-result',kind:'done',summary:'Fixture marker verified'};
 const request=(key=f.cap.key)=>new Request('http://localhost/api/kanban/cards/'+f.card.id+'/dot-event',{method:'POST',headers:{'x-kanban-executor-key':key},body:JSON.stringify(body)});
 expect((await handleDotCallback(request('0'.repeat(64)),f.card.id,dir)).status).toBe(403);
 expect((await handleDotCallback(request(),'other',dir)).status).toBe(403);
 const result=await handleDotCallback(request(),f.card.id,dir);expect(result.status).toBe(200);
 expect(findCardById(f.card.id,dir)!.column).toBe('review');
 expect((await (await handleDotCallback(request(),f.card.id,dir)).json()).idempotent).toBe(true);
 const read=await handleDotCallback(new Request('http://localhost/api/kanban/cards/'+f.card.id+'/dot-event?operationId='+f.op+'&receiptId=fixture-result',
 {headers:{'x-kanban-executor-key':f.cap.key}}),f.card.id,dir);
 expect((await read.json()).recorded).toBe(true);
});
it('revoked audience blocks callback and subsequent transport admission',async()=>{
 const f=await run();f.binding.cards=[];f.save();
 const r=await handleDotCallback(new Request('http://localhost/dot-event',{method:'POST',headers:{'x-kanban-executor-key':f.cap.key},
 body:JSON.stringify({operationId:f.op,requestId:'board:'+f.op,receiptId:'r',kind:'done',summary:'No'})}),f.card.id,dir);
 expect(r.status).toBe(503);expect(findCardById(f.card.id,dir)!.column).not.toBe('review');
});
it('transport timeout preserves unknown and does not resend the same operation',async()=>{
 const f=fixture();const fetcher=vi.fn(async()=>{throw Error('network timeout');});
 const transport=configuredDotTransport(dir,fetcher as typeof fetch)!;
 const context={card:f.card,actor:'nikita',tasksDir:dir,commission:{kind:'owner-command' as const,actor:'nikita',sourceRef:'test'}};
 const request={expectedVersion:f.card.version,operationId:'test-operation-123456'};
 await startDotExecution(context,request,transport);await startDotExecution(context,request,transport);
 expect(fetcher).toHaveBeenCalledTimes(1);expect(findCardById(f.card.id,dir)!.taskExecutionHistory![0].dot!.delivery).toBe('unknown');
});

it('real CLI helper module sends one authenticated callback then uses readback only',async()=>{
 const f=await run();
 const helperURL=new URL('../../../scripts/dot-board-report.mjs',import.meta.url).href;
 const {reportDotEvent}=await import(helperURL);
 const verbs:string[]=[];
 const fetcher=async(url:string,options:RequestInit={})=>{
   verbs.push(options.method??'GET');
   return handleDotCallback(new Request(url,options),f.card.id,dir);
 };
 const event={cardId:f.card.id,operationId:f.op,receiptId:'helper-result',kind:'done',summary:'Synthetic helper callback verified'};
 const first=await reportDotEvent(event,{stateDir:state,fetcher});
 expect(first.status).toBe('recorded');expect(findCardById(f.card.id,dir)!.column).toBe('review');
 const again=await reportDotEvent(event,{stateDir:state,fetcher});expect(again.status).toBe('recorded');
 expect(verbs).toEqual(['POST','GET']);
 expect(JSON.stringify(first)).not.toContain(f.cap.key);
 const changed=await reportDotEvent({...event,summary:'Changed'},{stateDir:state,fetcher});
 expect(changed.status).toBe('receipt_conflict');expect(verbs).toHaveLength(2);
});
it('helper never repeats an unknown POST and does not accept arbitrary callback destination',async()=>{
 const f=await run();
 const helperURL=new URL('../../../scripts/dot-board-report.mjs',import.meta.url).href;
 const {reportDotEvent}=await import(helperURL);
 const verbs:string[]=[];
 const fetcher=async(url:string,options:RequestInit={})=>{expect(url.startsWith('http://127.0.0.1:3001/api/kanban/cards/')).toBe(true);verbs.push(options.method??'GET');throw Error('unknown');};
 const event={cardId:f.card.id,operationId:f.op,receiptId:'unknown-result',kind:'done',summary:'Test'};
 expect((await reportDotEvent(event,{stateDir:state,fetcher})).status).toBe('unknown');
 expect((await reportDotEvent(event,{stateDir:state,fetcher})).status).toBe('unknown');
 expect(verbs).toEqual(['POST','GET']);
 expect((await reportDotEvent({...event,url:'https://other.invalid'},{stateDir:state,fetcher})).status).toBe('invalid_request');
});

it('query-only admission readback updates accepted metadata without starting work or replaying POST',async()=>{
 const f=fixture();const failing=vi.fn(async()=>{throw Error('unknown');});
 await startDotExecution({card:f.card,actor:'nikita',tasksDir:dir,commission:{kind:'owner-command',actor:'nikita',sourceRef:'owner-test'}},
 {expectedVersion:f.card.version,operationId:'test-operation-123456'},configuredDotTransport(dir,failing as typeof fetch));
 const card=findCardById(f.card.id,dir)!, op=card.taskExecutionHistory![0].operationId;
 const get=vi.fn(async(_url:unknown,options?:RequestInit)=>{expect(options?.method).toBeUndefined();return Response.json({requestId:'board:'+op,status:'accepted'});});
 const refreshed=await reconcileConfiguredDotReceipt(card,dir,'nikita',get as typeof fetch);
 expect(refreshed.taskExecutionHistory![0].dot!.delivery).toBe('accepted');
 expect(refreshed.taskExecutionHistory![0].phase).toBe('dispatch-unknown');
 expect(refreshed.column).toBe('todo');expect(failing).toHaveBeenCalledTimes(1);expect(get).toHaveBeenCalledTimes(1);
});

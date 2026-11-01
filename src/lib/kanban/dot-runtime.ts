import { constants, openSync, closeSync, fstatSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { findCardById, updateCard } from './file-store';
import { composeDotTransport } from './dot-transport-binding';
import { recordDotEvent } from './dot-execution';
import type { KanbanCard } from './types';

export const DOT_ROOM = '6ae67c78b7c0819380955b36a09b88cd';
const ORIGIN = 'https://msg.bezrabotnyi.com/telegram-qr/dot-board/requests';
type Grant = { enabled:true; owner:'540308572'; room:typeof DOT_ROOM; token:string;
  actors:string[]; cards:Array<{id:string;project:string;owner:string}>; expiresAt:string };
type Capability = { cardId:string; operationId:string; requestId:string; roomId:string;
  actor:string; project:string; owner:string; key:string; keyHash:string; expiresAt:number };

function protectedJSON(file:string):unknown {
  let fd:number|undefined;
  try {
    fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW);
    const st=fstatSync(fd);
    if(!st.isFile() || st.uid!==process.getuid?.() || (st.mode&0o077)!==0 || st.size>65536) return null;
    return JSON.parse(readFileSync(fd,'utf8'));
  } catch { return null; } finally { if(fd!==undefined)closeSync(fd); }
}
function directory() { const p=process.env.BOARD_DOT_STATE_DIR; return p && isAbsolute(p)?p:undefined; }
function grant():Grant|null {
  const dir=directory(); if(!dir)return null;
  const raw=protectedJSON(join(dir,'binding.json')) as Grant|null;
  if(!raw || raw.enabled!==true || raw.owner!=='540308572' || raw.room!==DOT_ROOM
    || typeof raw.token!=='string' || !/^[A-Za-z0-9_-]{32,256}$/.test(raw.token)
    || !Array.isArray(raw.actors) || !raw.actors.length || raw.actors.some(a=>typeof a!=='string'||!a)
    || !Array.isArray(raw.cards) || !raw.cards.length || raw.cards.some(c=>!c||typeof c.id!=='string'||!c.id||typeof c.project!=='string'||!c.project||c.owner!=='nikita')
    || !Number.isFinite(Date.parse(raw.expiresAt)) || Date.parse(raw.expiresAt)<=Date.now())return null;
  return raw;
}
function allowed(g:Grant,card:KanbanCard,actor:string) {
  return g.actors.includes(actor) && card.shared!==true
    && g.cards.some(c=>c.id===card.id && c.project===card.project && c.owner===card.owner);
}
function capability(operationId:string):Capability|null {
  const dir=directory();if(!dir||!/^[a-f0-9]{64}$/.test(operationId))return null;
  const v=protectedJSON(join(dir,'attempts',operationId+'.json')) as Capability|null;
  return v && v.operationId===operationId && v.roomId===DOT_ROOM && /^[a-f0-9]{64}$/.test(v.keyHash??'')
    && /^[a-f0-9]{64}$/.test(v.key??'') && v.expiresAt>Date.now()?v:null;
}
function reserveCapability(card:KanbanCard,operationId:string,requestId:string,actor:string) {
  const dir=directory();if(!dir)throw Error('binding_unavailable');
  const previous=capability(operationId);
  if(previous) {
    if(previous.cardId!==card.id||previous.requestId!==requestId||previous.actor!==actor||previous.project!==card.project||previous.owner!==card.owner)throw Error('callback_conflict');
    return;
  }
  const key=randomBytes(32).toString('hex');
  const cap:Capability={cardId:card.id,operationId,requestId,roomId:DOT_ROOM,actor,project:card.project,owner:card.owner!,
    key,keyHash:createHash('sha256').update(key).digest('hex'),expiresAt:Date.now()+6*60*60*1000};
  mkdirSync(join(dir,'attempts'),{recursive:true,mode:0o700});
  writeFileSync(join(dir,'attempts',operationId+'.json'),JSON.stringify(cap),{mode:0o600,flag:'wx'});
}
export function configuredDotTransport(tasksDir:string,fetcher:typeof fetch=fetch) {
  const initial=grant();if(!initial)return undefined;
  const channel={peer:{audience:'userio-dot-board' as const,roomId:DOT_ROOM,ownerActor:'540308572'},
    async enqueueTrusted(input:{source:'board';requestId:string;text:string}) {
      const current=grant();if(!current) return {status:'not_accepted'};
      let task:Record<string,unknown>;try{task=JSON.parse(input.text);}catch{return {status:'not_accepted'};}
      const operationId=input.requestId.split(':')[1];
      const cardId=typeof task.cardId==='string'?task.cardId:'';
      const card=findCardById(cardId,tasksDir);
      const attempt=card?.taskExecutionHistory?.at(-1);
      if(!card||attempt?.provider!=='dot'||attempt.operationId!==operationId||!allowed(current,card,attempt.startedBy))return {status:'not_accepted'};
      try{reserveCapability(card,operationId,'board:'+operationId,attempt.startedBy);}catch{return {status:'not_accepted'};}
      // Once fetch starts, any transport failure is unknown, never an automatic replay.
      try {
        const response=await fetcher(ORIGIN,{method:'POST',redirect:'error',signal:AbortSignal.timeout(25000),
          headers:{Authorization:'Bearer '+current.token,'Content-Type':'application/json'},
          body:JSON.stringify({requestId:input.requestId,text:input.text})});
        if([400,401,403,404,413].includes(response.status))return {status:'not_accepted'};
        if(response.status!==202)return {status:'unknown'};
        const raw=await response.text();if(raw.length>2048)return {status:'unknown'};
        const receipt=JSON.parse(raw);
        return receipt.requestId===input.requestId && ['accepted','queued','unknown','not_accepted','queue_full_not_accepted'].includes(receipt.status)
          ? {status:receipt.status as string}:{status:'unknown'};
      } catch {return {status:'unknown'};}
    }};
  return composeDotTransport({roomId:DOT_ROOM,ownerActor:'540308572',ownerAlias:'nikita'},channel,
    async(card,actor)=>{const g=grant();return !!g&&allowed(g,card,actor);},
    async actor=>{const g=grant();return g?.actors.includes(actor)?'540308572':null;});
}
export async function handleDotCallback(request:Request,cardId:string,tasksDir:string) {
  const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
  const g=grant();if(!g)return reply({error:'binding_disabled'},503);
  const key=request.headers.get('x-kanban-executor-key')??'';
  if(!/^[a-f0-9]{64}$/.test(key))return reply({error:'unauthorized'},401);
  if(request.method==='GET') {
    const url=new URL(request.url);
    if([...url.searchParams.keys()].some(k=>!['operationId','receiptId'].includes(k)))return reply({error:'invalid_request'},400);
    const cap=capability(url.searchParams.get('operationId')??'');
    const card=findCardById(cardId,tasksDir), attempt=card?.taskExecutionHistory?.at(-1);
    if(!cap||cap.cardId!==cardId||!card||!allowed(g,card,cap.actor)||card.project!==cap.project||card.owner!==cap.owner
      ||attempt?.operationId!==cap.operationId||attempt.provider!=='dot'
      ||!timingSafeEqual(createHash('sha256').update(key).digest(),Buffer.from(cap.keyHash,'hex')))return reply({error:'forbidden'},403);
    const receiptId=url.searchParams.get('receiptId');
    return reply({recorded:!!attempt.dot?.receipts?.some(r=>r.id===receiptId),phase:attempt.phase});
  }
  if(request.method!=='POST'||new URL(request.url).search)return reply({error:'invalid_request'},400);
  let text='',bytes=0;const reader=request.body?.getReader();if(!reader)return reply({error:'invalid_body'},400);
  const decoder=new TextDecoder();
  try{for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>16000){await reader.cancel();return reply({error:'body_too_large'},413);}text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();}catch{return reply({error:'invalid_body'},400);}
  let body;try{body=JSON.parse(text);}catch{return reply({error:'invalid_body'},400);}
  if(!body||Object.keys(body).some(k=>!['operationId','requestId','receiptId','kind','summary','question'].includes(k))
    || !/^[a-f0-9]{64}$/.test(body.operationId??'')||typeof body.receiptId!=='string'
    || !['running','needs_input','done'].includes(body.kind))return reply({error:'invalid_event'},400);
  const cap=capability(body.operationId);
  if(!cap||cap.cardId!==cardId||cap.requestId!==body.requestId
    || !timingSafeEqual(createHash('sha256').update(key).digest(),Buffer.from(cap.keyHash,'hex')))return reply({error:'forbidden'},403);
  const result=await recordDotEvent({cardId,tasksDir,operationId:cap.operationId,roomId:DOT_ROOM,requestId:cap.requestId,
    receiptId:body.receiptId,kind:body.kind},async(_,card)=>{
    const fresh=grant();
    if(!fresh||!allowed(fresh,card,cap.actor)||card.project!==cap.project||card.owner!==cap.owner||!capability(cap.operationId))return null;
    if(body.summary!==undefined&&(typeof body.summary!=='string'||body.summary.length>4000))return null;
    return {safeSummary:body.summary,safeQuestion:body.question};
  });
  return reply(result.body,result.status);
}

/** Query-only recovery of an uncertain admission. Never repeats POST or claims task completion. */
export async function reconcileConfiguredDotReceipt(card:KanbanCard,tasksDir:string,actor:string|undefined,fetcher:typeof fetch=fetch):Promise<KanbanCard> {
  const g=grant(), attempt=card.taskExecutionHistory?.at(-1);
  if(!g||!actor||!allowed(g,card,actor)||attempt?.provider!=='dot'||attempt.dot?.delivery!=='unknown'
    ||['result','stopped'].includes(attempt.phase))return card;
  let status:string;
  try {
    const r=await fetcher(ORIGIN+'/'+encodeURIComponent(attempt.dot.requestId),{headers:{Authorization:'Bearer '+g.token},
      redirect:'error',signal:AbortSignal.timeout(10000),cache:'no-store'});
    if(!r.ok)return card;
    const text=await r.text();if(text.length>2048)return card;
    const receipt=JSON.parse(text);
    if(receipt.requestId!==attempt.dot.requestId||receipt.status!=='accepted')return card;
    status=receipt.status;
  }catch{return card;}
  const fresh=findCardById(card.id,tasksDir),currentGrant=grant();
  if(!fresh||fresh.version!==card.version||!currentGrant||!allowed(currentGrant,fresh,actor)||status!=='accepted')return fresh??card;
  const saved=updateCard(card.id,{taskExecutionHistory:fresh.taskExecutionHistory!.map(item=>item.operationId===attempt.operationId
    ?{...item,lastBoardVersion:fresh.version+1,updatedAt:new Date().toISOString(),dot:{...item.dot!,delivery:'accepted'}}:item)},fresh.version,tasksDir);
  return 'conflict' in saved?findCardById(card.id,tasksDir)??card:saved;
}

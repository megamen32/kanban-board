import {openSync,closeSync,fstatSync,readFileSync,writeFileSync,constants} from 'node:fs';
import {join,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
function readProtected(file){let fd;try{fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW);const s=fstatSync(fd);if(!s.isFile()||s.uid!==process.getuid()||(s.mode&0o077)!==0||s.size>65536)throw Error();return JSON.parse(readFileSync(fd,'utf8'));}finally{if(fd!==undefined)closeSync(fd);}}
export async function reportDotEvent(body,{stateDir=process.env.BOARD_DOT_STATE_DIR,fetcher=fetch}={}) {
 if(!stateDir||!isAbsolute(stateDir)||!body||Object.keys(body).some(k=>!['cardId','operationId','receiptId','kind','summary','question'].includes(k))
   ||!/^[A-Za-z0-9_-]+$/.test(body.cardId??'')||!/^[a-f0-9]{64}$/.test(body.operationId??'')
   ||!/^[A-Za-z0-9:_-]{1,200}$/.test(body.receiptId??'')||!['running','needs_input','done'].includes(body.kind))return {status:'invalid_request'};
 let cap;try{cap=readProtected(join(stateDir,'attempts',body.operationId+'.json'));}catch{return {status:'capability_unavailable'};}
 if(cap.cardId!==body.cardId||cap.operationId!==body.operationId||cap.roomId!=='6ae67c78b7c0819380955b36a09b88cd'
    ||cap.requestId!=='board:'+body.operationId||cap.expiresAt<=Date.now()||!/^[a-f0-9]{64}$/.test(cap.key??''))return {status:'forbidden'};
 const {cardId,...event}=body;event.requestId=cap.requestId;
 const raw=JSON.stringify(event);if(Buffer.byteLength(raw)>16000)return {status:'invalid_request'};
 const digest=createHash('sha256').update(raw).digest('hex');
 const receiptHash=createHash('sha256').update(body.receiptId).digest('hex');
 const journal=join(stateDir,'attempts',body.operationId+'.report.'+receiptHash+'.json');
 const url='http://127.0.0.1:3001/api/kanban/cards/'+encodeURIComponent(cardId)+'/dot-event';
 let previous;
 try{previous=readProtected(journal);}catch{}
 if(previous){
  if(previous.digest!==digest)return {status:'receipt_conflict'};
  try{
   const r=await fetcher(url+'?operationId='+body.operationId+'&receiptId='+encodeURIComponent(body.receiptId),
     {headers:{'x-kanban-executor-key':cap.key},redirect:'error',signal:AbortSignal.timeout(10000)});
   const data=await r.json();return r.ok&&data.recorded===true?{status:'recorded',phase:data.phase}:{status:'unknown',retryable:false};
  }catch{return {status:'unknown',retryable:false};}
 }
 try{writeFileSync(journal,JSON.stringify({digest,created:Date.now()}),{mode:0o600,flag:'wx'});}catch{return {status:'journal_conflict',retryable:false};}
 try{
  const r=await fetcher(url,{method:'POST',headers:{'x-kanban-executor-key':cap.key,'Content-Type':'application/json'},
    redirect:'error',signal:AbortSignal.timeout(10000),body:raw});
  const data=await r.json();return r.ok?{status:'recorded',phase:data.phase,idempotent:data.idempotent===true}:{status:'refused_or_unknown',httpStatus:r.status,retryable:false};
 }catch{return {status:'unknown',retryable:false};}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 let text='',bytes=0;try{for await(const chunk of process.stdin){bytes+=chunk.length;if(bytes>16000)throw Error();text+=chunk.toString('utf8');}
 console.log(JSON.stringify(await reportDotEvent(JSON.parse(text))));}catch{console.log(JSON.stringify({status:'invalid_request'}));process.exitCode=1;}
}

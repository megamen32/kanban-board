import { expect, it, vi } from 'vitest';
import { composeDotTransport, type AuthenticatedDotChannel } from './dot-transport-binding';
import type { KanbanCard } from './types';
const binding={roomId:'a'.repeat(32),ownerActor:'owner-uuid',ownerAlias:'nikita'};
const card={owner:'nikita'} as KanbanCard;
function channel(): AuthenticatedDotChannel {return {peer:{audience:'userio-dot-board',roomId:binding.roomId,ownerActor:binding.ownerActor},enqueueTrusted:vi.fn(async()=>({status:'accepted'}))};}
it('absent authenticated binding stays unavailable',()=>expect(composeDotTransport(binding,undefined,async()=>true)).toBeUndefined());
it('wrong audience never receives a request or credential',()=>{
 const c=channel();c.peer.audience='herder' as 'userio-dot-board';expect(composeDotTransport(binding,c,async()=>true)).toBeUndefined();expect(c.enqueueTrusted).not.toHaveBeenCalled();
});
it('wrong room and owner binding rejected',()=>{
 const c=channel();c.peer.roomId='b'.repeat(32);expect(composeDotTransport(binding,c,async()=>true)).toBeUndefined();
 c.peer.roomId=binding.roomId;c.peer.ownerActor='other';expect(composeDotTransport(binding,c,async()=>true)).toBeUndefined();
});
it('current actor and explicit commissioned card scope both required',async()=>{
 const c=channel();const auth=vi.fn(async()=>false);const t=composeDotTransport(binding,c,auth)!;
 expect(await t.authorize('other',card)).toBe(false);expect(auth).not.toHaveBeenCalled();
 expect(await t.authorize(binding.ownerActor,card)).toBe(false);expect(auth).toHaveBeenCalledTimes(1);
});
it('cannot send foreign namespaces or oversized content',async()=>{
 const c=channel();const t=composeDotTransport(binding,c,async()=>true)!;
 await expect(t.enqueueTrusted({source:'board',requestId:'telegram:123',text:'x'})).rejects.toThrow();
 await expect(t.enqueueTrusted({source:'board',requestId:'board:'+'b'.repeat(64),text:'x'.repeat(16001)})).rejects.toThrow();
 expect(c.enqueueTrusted).not.toHaveBeenCalled();
});
it('approved adapter forwards only exact board envelope',async()=>{
 const c=channel();const t=composeDotTransport(binding,c,async()=>true)!;
 const envelope={source:'board' as const,requestId:'board:'+'b'.repeat(64),text:'fixture'};
 expect(await t.authorize(binding.ownerActor,card)).toBe(true);
 expect((await t.enqueueTrusted(envelope)).status).toBe('accepted');expect(c.enqueueTrusted).toHaveBeenCalledWith(envelope);
});

it('explicit verified owner mapping permits native start and browser answer identity without admitting another person',async()=>{
 const c=channel();const resolve=async(actor:string)=>[binding.ownerActor,'verified-browser-owner'].includes(actor)?binding.ownerActor:null;
 const t=composeDotTransport(binding,c,async()=>true,resolve)!;
 expect(await t.authorize(binding.ownerActor,card)).toBe(true);
 expect(await t.authorize('verified-browser-owner',card)).toBe(true);
 expect(await t.authorize('unverified-alias',card)).toBe(false);
});

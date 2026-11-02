import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {createCard,findCardById,updateCard} from '../kanban/file-store';
import {DOT_ROOM} from '../kanban/dot-runtime';
import {createKanbanMcpServer} from './kanban-server';

let tasksDir:string,stateDir:string,client:Client,server:ReturnType<typeof createKanbanMcpServer>;
async function connect(options:Parameters<typeof createKanbanMcpServer>[1] = {}) {
 const [ct,st]=InMemoryTransport.createLinkedPair();
 server=createKanbanMcpServer('work',options);
 client=new Client({name:'fixture-oauth',version:'1'});
 await server.connect(st);await client.connect(ct);
}
function json(response:unknown) {
 return JSON.parse((response as {content:Array<{text:string}>}).content[0].text);
}
beforeEach(()=>{
 tasksDir=mkdtempSync(join(tmpdir(),'dot-mcp-cards-'));
 stateDir=mkdtempSync(join(tmpdir(),'dot-mcp-grant-'));
 vi.stubEnv('TASKS_DIR',tasksDir);vi.stubEnv('BOARD_DOT_STATE_DIR',stateDir);
});
afterEach(async()=>{
 if(client)await client.close();if(server)await server.close();
 vi.unstubAllEnvs();rmSync(tasksDir,{recursive:true,force:true});rmSync(stateDir,{recursive:true,force:true});
 client=undefined!;server=undefined!;
});
function grant(card:{id:string;project:string;owner?:string}) {
 writeFileSync(join(stateDir,'binding.json'),JSON.stringify({
  enabled:true,owner:'540308572',room:DOT_ROOM,token:'T'.repeat(40),actors:['nikita'],
  cards:[{id:card.id,project:card.project,owner:card.owner}],expiresAt:new Date(Date.now()+3600000).toISOString()
 }),{mode:0o600});
}
it('separates dot executor from original owner/reviewer, requires owner authority and version CAS',async()=>{
 const card=createCard('Existing work','','todo','medium',[],'team',['human'],tasksDir);
 const original=updateCard(card.id,{owner:'nikita',requiresApprovalFrom:['human-reviewer']},card.version,tasksDir);
 if('conflict' in original)throw Error('setup conflict');
 await connect();
 expect((await client.callTool({name:'kanban.change',arguments:{mode:'edit',cardId:card.id,
  expectedVersion:original.version,executor:'dot'}})).isError).toBe(true);
 expect(findCardById(card.id,tasksDir)?.executor).toBeUndefined();
 await client.close();await server.close();
 await connect({allowConfirmedOwnerCommands:true});
 const changed=await client.callTool({name:'kanban.change',arguments:{mode:'edit',cardId:card.id,
  expectedVersion:original.version,ownerCommandConfirmed:true,executor:'dot'}});
 expect(changed.isError).not.toBe(true);
 expect(json(changed).card).toMatchObject({owner:'nikita',executor:'dot',assignees:['human'],requiresApprovalFrom:['human-reviewer']});
 expect((await client.callTool({name:'kanban.change',arguments:{mode:'edit',cardId:card.id,
  expectedVersion:original.version,ownerCommandConfirmed:true,executor:null}})).isError).toBe(true);
 await client.close();await server.close();
 await connect({allowInternalTeamCommands:true});
 const trusted=await client.callTool({name:'kanban.change',arguments:{mode:'edit',cardId:card.id,
   expectedVersion:original.version+1,executor:null}});
 expect(trusted.isError).not.toBe(true);
 expect(json(trusted).card.executor).toBeUndefined();
 expect(json(trusted).card.owner).toBe('nikita');
});
it('only shows exact granted and dot-assigned cards with bounded read-only list/get/progress',async()=>{
 const a=createCard('Visible task','Safe input','todo','medium',[],'team',['human'],tasksDir);
 const v=updateCard(a.id,{owner:'nikita',executor:'dot',requiresApprovalFrom:['human-reviewer']},a.version,tasksDir);
 if('conflict' in v)throw Error();
 const b=createCard('Invisible other tenant','','todo','medium',[],'other',['human'],tasksDir);
 updateCard(b.id,{owner:'nikita',executor:'dot'},b.version,tasksDir);
 grant(v);
 await connect({dotTaskActor:'nikita'});
 const names=(await client.listTools()).tools;
 for(const name of ['kanban.mine.list','kanban.mine.get','kanban.mine.progress']) {
  expect(names.find(x=>x.name===name)?.annotations).toMatchObject({readOnlyHint:true,openWorldHint:false});
 }
 const listed=json(await client.callTool({name:'kanban.mine.list',arguments:{limit:2}}));
 expect(listed.tasks).toHaveLength(1);
 expect(listed.tasks[0]).toMatchObject({id:v.id,owner:'nikita',executor:'dot',reviewers:['human-reviewer'],
  status:'todo',blocker:null,nextAction:null,eta:null,evidence:[],sessionUrl:null});
 expect(json(await client.callTool({name:'kanban.mine.get',arguments:{cardId:v.id}})).task.description).toBe('Safe input');
 expect(json(await client.callTool({name:'kanban.mine.progress',arguments:{cardId:v.id}})).progress.id).toBe(v.id);
 expect((await client.callTool({name:'kanban.mine.get',arguments:{cardId:b.id}})).isError).toBe(true);
 expect((await client.callTool({name:'kanban.mine.list',arguments:{limit:51}})).isError).toBe(true);
 rmSync(join(stateDir,'binding.json'));
 expect(json(await client.callTool({name:'kanban.mine.list',arguments:{}})).count).toBe(0);
 expect((await client.callTool({name:'kanban.mine.progress',arguments:{cardId:v.id}})).isError).toBe(true);
});
it('never registers dot tools for a non-owner or an unscoped service',async()=>{
 await connect({dotTaskActor:'another-user'});
 expect((await client.listTools()).tools.some(x=>x.name.startsWith('kanban.mine.'))).toBe(false);
 await client.close();await server.close();
 await connect({dotTaskActor:'nikita',requireExManagerReadScope:true});
 expect((await client.listTools()).tools.some(x=>x.name.startsWith('kanban.mine.'))).toBe(false);
 await client.close();await server.close();
 await connect({dotTaskActor:'nikita',readOnlyApp:true});
 expect((await client.listTools()).tools.some(x=>x.name.startsWith('kanban.mine.'))).toBe(false);
});

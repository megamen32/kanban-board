import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {ExecutionStatusReads,automaticExecutionSyncAllowed} from './execution-status-reads';
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(0)});afterEach(()=>vi.useRealTimers());
describe('bounded explicit execution reads',()=>{
 it('does nothing until explicitly requested, even over many refresh intervals',async()=>{
  const load=vi.fn();new ExecutionStatusReads();await vi.advanceTimersByTimeAsync(3600000);expect(load).not.toHaveBeenCalled();
 });
 it('deduplicates overlapping same-card reads and refuses a newer version until idle',async()=>{
  const reader=new ExecutionStatusReads<number>();let resolve!:(v:number)=>void;
  const load=vi.fn(()=>new Promise<number>(r=>{resolve=r}));
  const a=reader.read('one',1,load);const b=reader.read('one',1,load);
  await Promise.resolve();expect(load).toHaveBeenCalledOnce();expect(a).toBe(b);
  expect(await reader.read('one',2,load)).toBeNull();resolve(3);expect(await a).toBe(3);
 });
 it('uses successful TTL and only explicitly refreshes after it expires',async()=>{
  const reader=new ExecutionStatusReads<number>();const load=vi.fn().mockResolvedValue(3);
  await reader.read('one',1,load);await reader.read('one',1,load);expect(load).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(30001);expect(load).toHaveBeenCalledOnce();
  await reader.read('one',1,load);expect(load).toHaveBeenCalledTimes(2);
 });
 it('backs off failures without timers that retry or bulk scans',async()=>{
  const reader=new ExecutionStatusReads<number>();const load=vi.fn().mockRejectedValue(Error());
  await reader.read('one',1,load);await reader.read('one',1,load);expect(load).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(10001);await reader.read('one',1,load);expect(load).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(10001);await reader.read('one',1,load);expect(load).toHaveBeenCalledTimes(2);
 });
 it('limits concurrent distinct-card reads to two',async()=>{
  const reader=new ExecutionStatusReads<number>();const load=vi.fn(()=>new Promise<number>(()=>{}));
  void reader.read('one',1,load);void reader.read('two',1,load);expect(await reader.read('three',1,load)).toBeNull();
  await Promise.resolve();expect(load).toHaveBeenCalledTimes(2);reader.abort();
 });
 it('aborts pending fetches on unmount and never retries',async()=>{
  const reader=new ExecutionStatusReads<number>();const load=vi.fn((signal:AbortSignal)=>new Promise<number>((_,reject)=>signal.addEventListener('abort',()=>reject(Error()))));
  const pending=reader.read('one',1,load);await Promise.resolve();reader.abort();expect(await pending).toBeNull();
  await vi.advanceTimersByTimeAsync(60000);expect(load).toHaveBeenCalledOnce();
 });
 it('aborts slow reads after ten seconds',async()=>{
  const reader=new ExecutionStatusReads<number>();const load=vi.fn((signal:AbortSignal)=>new Promise<number>((_,reject)=>signal.addEventListener('abort',()=>reject(Error()))));
  const pending=reader.read('one',1,load);await vi.advanceTimersByTimeAsync(10001);expect(await pending).toBeNull();
 });
 it('does not poll inactive, hidden or offscreen work, or beyond the observation window',()=>{
  expect(automaticExecutionSyncAllowed(true,true,true,1)).toBe(true);
  for(const args of [[false,true,true,1],[true,false,true,1],[true,true,false,1],[true,true,true,1800000]] as const)
   expect(automaticExecutionSyncAllowed(args[0],args[1],args[2],args[3])).toBe(false);
 });
});

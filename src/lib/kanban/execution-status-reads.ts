/** Per-view, explicit reads only. Never starts a timer that retries or scans cards. */
export class ExecutionStatusReads<T>{
 private entries=new Map<string,{version:number,value:T|null,nextAt:number,failures:number,pending?:Promise<T|null>,controller?:AbortController}>();
 constructor(private now:()=>number=Date.now){}
 read(id:string,version:number,load:(signal:AbortSignal)=>Promise<T>):Promise<T|null>{
  const old=this.entries.get(id);
  if(old?.pending)return old.version===version?old.pending:Promise.resolve(null);
  if(old?.version===version&&this.now()<old.nextAt)return Promise.resolve(old.value);
  if([...this.entries.values()].filter(e=>e.pending).length>=2)return Promise.resolve(null);
  if(this.entries.size>=64&&!old){const first=[...this.entries].find(([,e])=>!e.pending);if(first)this.entries.delete(first[0]);}
  const entry={version,value:null as T|null,nextAt:0,failures:old?.failures??0,pending:undefined as Promise<T|null>|undefined,controller:new AbortController()};
  this.entries.set(id,entry);
  const timer=setTimeout(()=>entry.controller.abort(),10000);
  entry.pending=Promise.resolve().then(()=>load(entry.controller.signal)).then(value=>{
   entry.value=value;entry.failures=0;entry.nextAt=this.now()+30000;return value;
  }).catch(()=>{entry.failures++;entry.nextAt=this.now()+Math.min(120000,10000*2**(entry.failures-1));return null;})
   .finally(()=>{clearTimeout(timer);entry.pending=undefined;});
  return entry.pending;
 }
 abort(){for(const entry of this.entries.values())entry.controller?.abort();this.entries.clear();}
}
export function automaticExecutionSyncAllowed(active:boolean,visible:boolean,documentVisible:boolean,elapsed:number){
 return active&&visible&&documentVisible&&elapsed<30*60000;
}

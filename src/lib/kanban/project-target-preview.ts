import {createHash} from 'node:crypto';
import type {TaskExecutionProjectBinding} from './types';
/** A preview is evidence of the exact existing project route, not an account/access grant. */
export function projectTargetPreview(binding:TaskExecutionProjectBinding,actor:string,cardId:string,cardVersion:number,nativeUser?:string) {
  const {observedAtMs:_observedAtMs,...stable}=binding;
  const previewId=createHash('sha256').update(JSON.stringify({actor,cardId,cardVersion,binding:stable})).digest('hex');
  return {previewId,cardVersion,hostId:binding.hostId,harness:binding.harness,model:binding.model,
    runtimeInstanceId:binding.runtimeInstanceId,
    ...(nativeUser?.trim()?{processUser:nativeUser.trim().slice(0,128)}:{}),
    selectable:binding.harness!=='codex',
    ...(binding.harness==='codex'?{reason:'Лимит Codex не подтверждён; автоматический запуск отключён.'}:{})};
}

export type DiagnosticAction = 'read'|'create'|'update'|'delete'|'reorder'|'review';
export interface BoardDiagnostic { id:string; requestId?:string; at:string; action:DiagnosticAction; status:number; reason:string; nextStep:string }
export const mutationReasons: Record<string, string> = {
    assignee_change_requires_owner_authorization: 'Подтвердите переназначение ответственных перед сохранением.',
    reviewer_change_requires_owner_authorization: 'Список принимающих результат меняет только владелец доски.',
    parent_relation_cycle: 'Такая связь создала бы цикл между родительской задачей и подзадачей.',
    deadline_change_requires_human_ui: 'Для изменения срока нужен подтверждённый вход. Обновите страницу и войдите снова.',
    weekly_plan_requires_batch_acceptance: 'План недели принимается отдельно на вкладке «Неделя».',
    weekly_plan_allows_at_most_six_big_rocks: 'На неделю можно принять не больше шести Big Rocks. Сначала пересмотрите текущий план.',
    blocked_reason_required: 'Напиши, что блокирует задачу; тогда будет понятно, что нужно для продолжения.',
    blocker_reason_invalid: 'Причина блокировки слишком длинная или имеет неверный формат.',
    review_requires_explicit_decision: 'Сначала прими результат или верни задачу на доработку в окне карточки.',
};
const actions=new Set<DiagnosticAction>(['read','create','update','delete','reorder','review']);
const listeners=new Set<()=>void>();
let entries:ReadonlyArray<BoardDiagnostic>=[];
const empty:ReadonlyArray<BoardDiagnostic>=[];
export function diagnosticSnapshot(){return entries}
export function diagnosticServerSnapshot(){return empty}
export function subscribeDiagnostics(listener:()=>void){listeners.add(listener);return ()=>{listeners.delete(listener)}}
export function clearDiagnostics(){entries=[];listeners.forEach(fn=>fn())}
export function recordDiagnostic(action:DiagnosticAction,status:number,rawReason:unknown,requestId?:string){
  const reason=typeof rawReason==='string' && Object.hasOwn(mutationReasons,rawReason)?rawReason
    :status===0?'network_unconfirmed':status===401||status===403?'authentication_required':status===409?'version_conflict':status>=500?'server_unavailable':'mutation_rejected';
  const nextStep=mutationReasons[reason]??(reason==='network_unconfirmed'?'Ответ не получен. Сначала обновите карточку; не повторяйте действие вслепую.':reason==='authentication_required'?'Войдите снова. Несохранённые данные остаются в форме.'
    :reason==='version_conflict'?'Обновите карточку и сравните изменения перед повтором.'
    :reason==='server_unavailable'?'Сервер временно недоступен. Проверьте состояние перед повтором.'
    :'Проверьте поля и актуальную версию карточки.');
  const entry:BoardDiagnostic={id:globalThis.crypto?.randomUUID?.()??'local-'+Date.now()+'-'+Math.random().toString(36).slice(2),
    ...(requestId&&/^[a-f0-9-]{36}$/.test(requestId)?{requestId}:{}),at:new Date().toISOString(),action:actions.has(action)?action:'update',
    status:Number.isInteger(status)&&status>=100&&status<=599?status:0,reason,nextStep};
  entries=[entry,...entries].slice(0,30);
  listeners.forEach(fn=>fn());return entry;
}

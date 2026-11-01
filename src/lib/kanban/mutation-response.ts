import {mutationReasons,recordDiagnostic,type DiagnosticAction} from './board-diagnostics';
import type { KanbanCard, RoleDefinition } from './types';

interface MutationReply {
  card?: KanbanCard;
  cards?: KanbanCard[];
  roles?: RoleDefinition[];
  success?: boolean;
  conflict?: boolean;
  serverCard?: KanbanCard;
  error?: string;
  text?: string;
}

const requestIds=new WeakMap<Response,string>();
/** Correlation only, never authorization; no URL or payload enters diagnostics. */
export async function boardMutationRequest(url:string,init:RequestInit,action:DiagnosticAction):Promise<Response>{
  const requestId=globalThis.crypto.randomUUID();
  const headers=new Headers(init.headers);headers.set('x-board-request-id',requestId);
  try {const response=await fetch(url,{...init,headers});requestIds.set(response,requestId);return response}
  catch {recordDiagnostic(action,0,'network_unconfirmed',requestId);throw new BoardMutationError('Ответ не получен. Обновите карточку перед повтором; действие могло сохраниться.')}
}
export class BoardMutationError extends Error {}

export function mutationErrorMessage(error: unknown): string {
  return error instanceof BoardMutationError ? error.message
    : 'Не удалось сохранить изменение. Введённые данные сохранены в форме; попробуйте ещё раз.';
}

/** HTTP errors and login HTML must not close editors or remove local cards. */
export async function readMutationResponse(response: Response, allowConflict = false, action:DiagnosticAction = 'update'): Promise<MutationReply> {
  const data = await response.json().catch(() => null) as MutationReply | null;
  if (allowConflict && response.status === 409 && data?.conflict && data.serverCard) { recordDiagnostic(action,409,'version_conflict',requestIds.get(response)); return data; }
  if (response.ok && data && typeof data === 'object') return data;

  recordDiagnostic(action,response.status,data?.error,requestIds.get(response));
  const message = !data || response.status === 401 || response.status === 403
    ? 'Войдите снова и повторите сохранение. Введённые данные не удалены.'
    : (Object.hasOwn(mutationReasons,data.error ?? '')?mutationReasons[data.error!]:undefined) ?? (response.status >= 500
      ? 'Сервер временно недоступен. Введённые данные не удалены; попробуйте ещё раз.'
      : 'Изменение не сохранено. Проверьте поля и актуальную версию карточки.');
  throw new BoardMutationError(message);
}

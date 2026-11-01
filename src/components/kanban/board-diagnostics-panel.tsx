'use client';
import {useEffect,useSyncExternalStore} from 'react';
import {clearDiagnostics,diagnosticSnapshot,diagnosticServerSnapshot,subscribeDiagnostics} from '@/lib/kanban/board-diagnostics';
const labels={read:'Чтение',create:'Создание',update:'Изменение',delete:'Удаление',reorder:'Порядок',review:'Решение по результату'};
export function BoardDiagnosticsPanel({identity}:{identity?:string|null}){
 const entries=useSyncExternalStore(subscribeDiagnostics,diagnosticSnapshot,diagnosticServerSnapshot);
 useEffect(()=>{clearDiagnostics();return ()=>clearDiagnostics()},[identity]);
 return <details className="rounded border p-2 text-xs" aria-label="Диагностика доски">
  <summary className="cursor-pointer">Диагностика доски ({entries.length})</summary>
  <p>Ошибки изменений в этой вкладке, до 30 записей. Request ID отправляется с запросом; это не подтверждение выполнения. Без текста задач и секретов. Перезагрузка очищает журнал.</p>
  <button type="button" onClick={clearDiagnostics} disabled={!entries.length}>Очистить журнал</button>
  {!entries.length&&<p>Отказов сохранения в этой вкладке пока нет.</p>}
  <ol>{entries.map(entry=><li key={entry.id} className="mt-2 border-t pt-2">
   <p>{entry.at} · {labels[entry.action]} · HTTP {entry.status} · {entry.reason}</p>
   <p>{entry.nextStep}</p><code>{entry.requestId?'Request ID: '+entry.requestId:'Локальная запись: '+entry.id}</code>
  </li>)}</ol>
 </details>;
}

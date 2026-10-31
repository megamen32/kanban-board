'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { applyGraphLayoutChange, defaultGraphLayout, parseStoredGraphLayout, type GraphLayoutChange, type GraphLayoutPreferences } from '../../lib/kanban/graph-layout-preferences';
export type LayoutSaveStatus = 'loading' | 'saved' | 'saving' | 'error' | 'readonly';
const URL = '/api/kanban/graph-layout';

/** Serialize small per-drag patches; never replace another device's whole layout. */
export function useGraphLayout() {
  const [layout, setLayout] = useState<GraphLayoutPreferences>(defaultGraphLayout);
  const [status, setStatus] = useState<LayoutSaveStatus>('loading');
  const committed = useRef<GraphLayoutPreferences>(defaultGraphLayout());
  const pending = useRef<GraphLayoutChange[]>([]);
  const active = useRef(false);
  const mounted = useRef(true);
  const loaded = useRef(false);
  const render = useCallback(() => {
    if (mounted.current) setLayout(pending.current.reduce(applyGraphLayoutChange, committed.current));
  }, []);
  const save = useCallback(async () => {
    if (active.current || !loaded.current || !pending.current.length) return;
    active.current = true;
    if (mounted.current) setStatus('saving');
    try {
      while (pending.current.length) {
        const change = pending.current[0];
        let accepted = false;
        for (let retry = 0; retry < 2; retry++) {
          const response = await fetch(URL, { method: 'PATCH', credentials: 'same-origin', cache: 'no-store',
            headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedVersion: committed.current.version, change }) });
          const payload = await response.json();
          const server = parseStoredGraphLayout(payload.layout);
          if (response.status === 409 && server) { committed.current = server; render(); continue; }
          if (!response.ok || !server) throw new Error('save_failed');
          committed.current = server;
          pending.current.shift();
          accepted = true;
          render();
          break;
        }
        if (!accepted) throw new Error('concurrent_update');
      }
      if (mounted.current) setStatus('saved');
    } catch { if (mounted.current) setStatus('error'); }
    finally { active.current = false; }
  }, [render]);
  const load = useCallback(async () => {
    if (active.current || pending.current.length) return;
    try {
      const response = await fetch(URL, { credentials: 'same-origin', cache: 'no-store' });
      if (response.status === 401) { loaded.current = false; if (mounted.current) setStatus('readonly'); return; }
      const value = parseStoredGraphLayout((await response.json()).layout);
      if (!response.ok || !value) throw new Error('load_failed');
      committed.current = value; loaded.current = true;
      render();
      if (mounted.current) setStatus('saved');
    } catch { if (mounted.current) setStatus('error'); }
  }, [render]);
  useEffect(() => {
    mounted.current = true;
    void load();
    const focus = () => { if (!active.current && !pending.current.length) void load(); };
    window.addEventListener('focus', focus);
    return () => { mounted.current = false; window.removeEventListener('focus', focus); };
  }, [load]);
  const change = useCallback((patch: GraphLayoutChange) => {
    if (!loaded.current) return;
    pending.current.push(patch); render(); void save();
  }, [render, save]);
  const retry = useCallback(() => { if (loaded.current && pending.current.length) void save(); else void load(); }, [load, save]);
  return { layout, status, change, retry, editable: loaded.current };
}

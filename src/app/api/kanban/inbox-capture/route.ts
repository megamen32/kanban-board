import { NextRequest, NextResponse } from 'next/server';
import { createCard, updateCard } from '@/lib/kanban/file-store';
import { boardIdentityFromRequest } from '@/lib/auth/request';
import { tasksDirForScope } from '@/lib/auth/data-scope';
import { dispatchNotification } from '@/lib/notifications/push';
import { extractSecretaryTasks, persistSecretaryTasks, SecretaryUnavailableError } from '@/lib/kanban/secretary';

export const runtime = 'nodejs';

function captureTitle(text: string): string {
  const firstLine = text.replace(/\s+/g, ' ').trim().slice(0, 96);
  return firstLine || 'Голосовая заметка';
}

function createInboxCard(text: string, owner: string, source: string) {
  const card = createCard(captureTitle(text), text.trim(), 'inbox', 'medium', ['inbox-capture'], 'Inbox', [], tasksDirForScope('work'));
  return updateCard(card.id, { owner, source, needsReview: true }, undefined, tasksDirForScope('work'));
}

async function captureWithSecretary(text: string, owner: string, source: string, scope: 'work' | 'personal') {
  const tasksDir = tasksDirForScope('work');
  try {
    const tasks = await extractSecretaryTasks(text, owner);
    const cards = persistSecretaryTasks(tasks, text, owner, tasksDir);
    await dispatchNotification({
      scope,
      owner,
      eventKey: `${scope}:${owner}:secretary:${cards.map(card => card.id).join(':')}`,
      payload: { title: 'Секретарь разобрал заметку', body: `Создано задач: ${cards.length}`, tag: 'kanban-secretary', url: '/' },
    }).catch(() => undefined);
    return { cards, secretary: 'completed' as const };
  } catch (error) {
    if (!(error instanceof SecretaryUnavailableError)) throw error;
    return { cards: [createInboxCard(text, owner, source)], secretary: 'waiting_for_key' as const };
  }
}

/** Transcribes input, then lets the built-in secretary classify it when configured. */
export async function POST(request: NextRequest) {
  try {
    const identity = boardIdentityFromRequest(request);
    const contentType = request.headers.get('content-type') ?? '';
    if (!contentType.includes('multipart/form-data')) {
      const body = await request.json() as { text?: unknown; owner?: unknown };
      if (typeof body.text !== 'string' || !body.text.trim()) return NextResponse.json({ error: 'text is required' }, { status: 400 });
      const owner = typeof body.owner === 'string' && body.owner.trim() ? body.owner.trim() : identity.username;
      return NextResponse.json(await captureWithSecretary(body.text, owner, 'transcript:paste', identity.scope), { status: 201 });
    }

    const form = await request.formData();
    const audio = form.get('audio');
    if (!(audio instanceof File) || audio.size === 0) return NextResponse.json({ error: 'audio is required' }, { status: 400 });
    const apiKey = process.env.KANBAN_WHISPER_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'transcription is not configured' }, { status: 503 });
    const whisperForm = new FormData();
    whisperForm.set('model', 'whisper-1');
    whisperForm.set('file', audio, audio.name || 'voice.webm');
    const response = await fetch(`${process.env.KANBAN_WHISPER_URL || 'https://whisper.bezrabotnyi.com/v1'}/audio/transcriptions`, {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: whisperForm,
    });
    if (!response.ok) return NextResponse.json({ error: 'transcription failed' }, { status: 502 });
    const result = await response.json() as { text?: unknown };
    if (typeof result.text !== 'string' || !result.text.trim()) return NextResponse.json({ error: 'transcription returned no text' }, { status: 502 });
    const requestedOwner = form.get('owner');
    const owner = typeof requestedOwner === 'string' && requestedOwner.trim() ? requestedOwner.trim() : identity.username;
    return NextResponse.json(await captureWithSecretary(result.text, owner, 'transcript:whisper', identity.scope), { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}

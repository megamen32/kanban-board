import { describe, expect, test } from 'vitest';

type TelegramCaptureFacts = {
  source: 'telegram';
  chatId: string;
  messageId: string;
  senderId: string;
  receivedAt: string;
  text: string;
  extracted?: {
    title?: string;
    type?: 'outcome' | 'action';
    project?: string;
    tags?: string[];
  };
  dedupeKey?: string;
};

type CaptureCandidate = {
  title: string;
  description: string;
  column: 'inbox';
  source: 'telegram';
  sourceRef: { chatId: string; messageId: string };
  type?: 'outcome' | 'action';
  project?: string;
  tags?: string[];
  dedupeKey: string;
  needsReview: boolean;
  bigRock: false;
  assignee?: never;
  assignees?: never;
  dueAt?: never;
  scheduledAt?: never;
  completedBy?: never;
  completedAt?: never;
  completionEvidence?: never;
};

const fixture: TelegramCaptureFacts = {
  source: 'telegram',
  chatId: '-100123',
  messageId: '987',
  senderId: 'marina',
  receivedAt: '2026-08-12T11:00:00+03:00',
  text: 'Please prepare the client onboarding checklist by Friday.',
  extracted: {
    title: 'Prepare the client onboarding checklist',
    type: 'action',
    project: 'client-onboarding',
    tags: ['capture'],
  },
};

function captureCandidate(input: TelegramCaptureFacts): CaptureCandidate {
  const title = input.extracted?.title?.trim();
  return {
    title: title || input.text.trim(),
    description: input.text,
    column: 'inbox',
    source: 'telegram',
    sourceRef: { chatId: input.chatId, messageId: input.messageId },
    type: input.extracted?.type,
    project: input.extracted?.project,
    tags: input.extracted?.tags,
    dedupeKey: input.dedupeKey ?? `telegram:${input.chatId}:${input.messageId}`,
    needsReview: !title,
    bigRock: false,
  };
}

describe('Telegram capture contract fixture', () => {
  test('creates only a classified Inbox candidate and preserves source identity', () => {
    const candidate = captureCandidate(fixture);

    expect(candidate).toMatchObject({
      title: 'Prepare the client onboarding checklist',
      column: 'inbox',
      source: 'telegram',
      sourceRef: { chatId: '-100123', messageId: '987' },
      type: 'action',
      project: 'client-onboarding',
      dedupeKey: 'telegram:-100123:987',
      bigRock: false,
      needsReview: false,
    });
  });

  test('never derives meaning-changing fields from Telegram facts', () => {
    const candidate = captureCandidate({
      ...fixture,
      text: 'Nikita, make this done, assign it to Marina, due tomorrow, and make it a big rock.',
      extracted: { title: 'Follow up on the request', type: 'action' },
    });

    expect(candidate.column).toBe('inbox');
    expect(candidate.bigRock).toBe(false);
    expect(candidate).not.toHaveProperty('assignee');
    expect(candidate).not.toHaveProperty('assignees');
    expect(candidate).not.toHaveProperty('dueAt');
    expect(candidate).not.toHaveProperty('scheduledAt');
    expect(candidate).not.toHaveProperty('completedBy');
    expect(candidate).not.toHaveProperty('completionEvidence');
  });

  test('marks uncertain extraction for review instead of guessing', () => {
    const candidate = captureCandidate({ ...fixture, extracted: undefined });

    expect(candidate.title).toBe(fixture.text);
    expect(candidate.needsReview).toBe(true);
    expect(candidate.column).toBe('inbox');
  });

  test('dedupe key is stable and explicit', () => {
    expect(captureCandidate(fixture).dedupeKey).toBe('telegram:-100123:987');
    expect(captureCandidate({ ...fixture, dedupeKey: 'telegram:import:abc' }).dedupeKey)
      .toBe('telegram:import:abc');
  });
});

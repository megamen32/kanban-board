# Telegram capture contract

This contract describes the boundary between a Telegram secretary and the
Markdown Kanban planner. It is an input/output contract only; it does not
authorize bot provisioning, sending messages, deployment, or direct writes to
the Kanban server.

## Input: Telegram-derived facts

The capture adapter may submit facts observed from one Telegram message:

```ts
type TelegramCaptureFacts = {
  source: 'telegram';
  chatId: string;
  messageId: string;
  senderId: string;
  receivedAt: string; // RFC3339 timestamp with offset
  text: string;
  extracted?: {
    title?: string;
    type?: 'outcome' | 'action';
    project?: string;
    tags?: string[];
  };
  dedupeKey?: string;
};
```

`chatId`, `messageId`, `senderId`, `receivedAt`, and `text` are source facts.
Extraction is advisory and may classify a card, but it cannot make a
meaning-changing assignment.

## Output: capture candidates

Each accepted, non-duplicate message produces a candidate with these safe
defaults:

```ts
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
```

The adapter may deduplicate by a stable `dedupeKey` (normally
`telegram:<chatId>:<messageId>`) and classify `type`, project, or tags when the
evidence is explicit. It must not silently merge distinct messages.

## Explicit policy

- Every new candidate starts in `inbox`; capture never creates `done`,
  `in-progress`, `review`, `blocked`, or `someday` cards.
- Capture never sets `assignee`/`assignees`, a deadline (`dueAt`),
  `scheduledAt`, `week`, or `bigRock`. A person, deadline, or weekly choice
  mentioned in text remains in the description and is reviewed later.
- Capture never sets completion fields or completion evidence and can never
  auto-complete a card. Completion is handled by the shared transition policy.
- If title/type/project/tags/dedupe identity is missing, contradictory, or
  inferred with low confidence, set `needsReview: true`. Uncertainty is
  preserved; it is not resolved by guessing an owner or deadline.
- A duplicate is a no-op with an audit result (`duplicate_of`); it does not
  update or complete the existing card.
- The existing server-side transition validator remains authoritative for any
  later edit. This contract does not bypass REST, MCP, or UI policy checks.

## Result categories

The adapter returns one result per source message:

```ts
type CaptureResult =
  | { kind: 'created'; candidate: CaptureCandidate }
  | { kind: 'duplicate'; dedupeKey: string; duplicateOf: string }
  | { kind: 'rejected'; reason: 'missing_source_identity' | 'empty_text' };
```

This contract is intentionally suitable for a fixture/API canary. A live
Telegram test-group capture is a separate integration task and is not proof of
this contract or permission to operate a bot.

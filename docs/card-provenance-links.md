# Source-message and originating-session links

Cards can retain two optional display references alongside the existing source label:

| HTTP / MCP field | Markdown frontmatter | Meaning |
| --- | --- | --- |
| sourceMessageUrl | source_message_url | The exact permalink of the source message, supplied by the user or returned by User.IO (deep_link) or another source. |
| sourceSessionUrl | source_session_url | The exact URL of the agent session where the task originated. |

Both fields accept absolute HTTP(S) URLs up to 2048 characters. Credentials,
raw whitespace, control characters and non-HTTP(S) schemes are rejected.
Percent-encoded control characters are also rejected. URLs are stored as supplied;
the board does not construct provider routes, resolve IDs into guessed links,
fetch the destination or copy a source message's private body.

On an edit, omission preserves the existing field and null explicitly removes it.
An empty string is invalid. On creation, null leaves the field absent.
Missing or unusable imported references remain unknown in the UI. Unrelated
legacy frontmatter remains lossless; a malformed imported URL does not hide its
card. An explicit replacement or clear removes that old URL entry.

The existing source string remains a free-form label or identifier. Its values
are neither migrated nor reinterpreted as signed provenance. A safe legacy URL
can still be displayed by the UI as an existing command/reference link.

## Native MCP

Writable MCP clients can pass both fields to kanban.change in mode=new or
mode=edit. kanban.capture_inbox accepts the same optional references with a raw
transcript. Its Inbox, no-classification and no-assignment behavior is unchanged.
The fields and their semantics appear in the actual tools/list schemas,
descriptions and initialization instructions.

Read before editing and use the returned expectedVersion. kanban.read and
kanban.list return persisted optional fields. Read-only application clients
remain read-only and do not gain change or capture tools.

The following URLs and identifiers are synthetic examples, not provider URL
templates. Replace them only with a verified, already available permalink.

Create with kanban.change:

~~~json
{
  "mode": "new",
  "title": "Synthetic task",
  "project": "Synthetic project",
  "column": "inbox",
  "source": "import:opaque-reference",
  "sourceMessageUrl": "https://messages.example.test/opaque-link",
  "sourceSessionUrl": "https://sessions.example.test/opaque-link"
}
~~~

Clear one link with kanban.change while preserving the other:

~~~json
{
  "mode": "edit",
  "cardId": "00000000-0000-4000-8000-000000000001",
  "expectedVersion": 3,
  "sourceSessionUrl": null
}
~~~

Capture a raw note with kanban.capture_inbox:

~~~json
{
  "transcript": "Synthetic raw note",
  "sourceMessageUrl": "https://messages.example.test/opaque-link"
}
~~~

## Existing HTTP API

POST /api/kanban/cards accepts both fields with the normal new-card body.
PATCH /api/kanban/cards/{id} accepts both fields with the existing optimistic
version contract. Invalid references return 400 before creating, renaming or
changing a card. No new endpoint, login, grant or confirmation flag is introduced.

## Authority and managed execution receipts

These links are display metadata. They do not establish message ownership,
source admission, team membership, task approval, completion or permission to
control a session. The signed sourceAdmission binding and board-owned
taskExecutionHistory remain separate, with their existing protected write paths.

The UI can show the latest known valid managed execution-session URL, falling
back to sourceSessionUrl when no valid receipt link is available. Adding a link
does not create an execution receipt or launch a session. A newer pending receipt
does not erase an older known link. The existing taskSessionUrl builder remains
the authority for managed host/harness/native-session links.

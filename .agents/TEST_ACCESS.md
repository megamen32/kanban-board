# Todo UX QA access

## Default: local UI without SSO

- Open `http://127.0.0.1:43330/` from the server-100 host. This is the
  loopback-only QA container `kanban-uxqa-20261026-01a17559`, not the public Todo site.
- The container has a dedicated synthetic QA store under
  `/home/roomhacker/todo-kanban-qa-20261026/data`; its listener is bound to
  `127.0.0.1:43330`. Push is disabled (`GET /api/notifications/public-key`
  returns 503). Use only the project `UX QA 2026-10-26` and synthetic cards.
- QA-only anonymous board reads are enabled for this loopback host; they expose
  only the synthetic `UX QA 2026-10-26` project in this container. `/api/auth/session` still returns 401:
  this is expected and does not create or impersonate a human session.
- For native `agent-browser`, use a fresh short session and namespace, set
  `AGENT_BROWSER_ALLOWED_DOMAINS='127.0.0.1'`, unset `AGENT_BROWSER_ARGS`, and
  open the loopback URL. Keep those same session/namespace flags on every call.
- Use the UI for writes. Never read or write the QA store files directly. Do not
  launch tasks, ask executor questions, send messages, or create notifications.
- The visible identity chooser is only a board filter. The unauthenticated
  loopback route returns 401 from `/api/auth/session`; it does not create a
  signed-in human session. In this anonymous QA mode, new synthetic cards use
  the board owner's `nikita` space; the profile filter does not change ownership.
  Authenticated sessions use the server-verified username (`roomhacker` maps to
  `nikita`). Do not impersonate the board owner or fabricate headers to assign
  or transfer ownership. Record the denial and continue with unassigned synthetic
  work where that still tests the user goal.

## SSO checks only

Ordinary desktop/mobile UX checks should use the loopback URL above and must not
spend time on SSO. When the authentication flow itself is the subject of a test,
use the protected reference `sso.qa.admin-equivalent` and the fixed procedure in
`/home/roomhacker/simple-cookie-auth/docs/SSO-QA-ACCESS.md`:

```sh
AGENT_BROWSER_ALLOWED_DOMAINS='qa-board.bezrabotnyi.com,auth.bezrabotnyi.com' \
AGENT_BROWSER_ARGS='--host-resolver-rules=MAP qa-board.bezrabotnyi.com 192.168.2.100' \
/home/roomhacker/.local/bin/sss-run sso.qa.admin-equivalent -- \
/home/roomhacker/simple-cookie-auth/scripts/sso-qa-fill.py \
  --session <short-session> --namespace <short-namespace>
```

`qa-board.bezrabotnyi.com` is served by the server-100 HTTPS ingress on LAN
address `192.168.2.100:443`, then routed through its shared SNI listener to the
QA-only vhost on `127.0.0.1:8444`. Its dedicated valid certificate is installed
for this hostname. Do not map it to `127.0.0.1`: there is no listener on
`127.0.0.1:443`. The vhost requires the existing GPTAdmin cookie
`auth_request` and proxies only to the loopback QA container on port `43330`;
it does not route to production Todo (`43327`). If server-100's LAN address
changes, update this resolver rule to the current ingress address.
Use the native `agent-browser` CLI that owns that exact session. Confirm the
visible login name is `testlogin`, snapshot after the helper, submit the visible
button once, then verify `/api/auth/session` reports `authenticated: true`.
Never print/read credentials or cookies. If the form or outcome is unclear,
capture and inspect a secret-safe screenshot in that same session before any
retry, navigation, or cleanup. Use the loopback route for UX work when SSO setup
is the only obstacle; do not repeatedly reauthenticate to test ordinary board
behavior.

## Production boundary

`https://todo.bezrabotnyi.com/` is read-only during QA: push is enabled there.
Never create, edit, delete, move, reorder, or assign public cards. Keep all writes
inside the loopback QA project, never in the shared production work store.

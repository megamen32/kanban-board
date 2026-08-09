# Kanban auth and ChatGPT OAuth

The Kanban API is fail-closed: without a session cookie or scoped bearer token,
`/api/kanban/*` returns `401`. The work deployment is the primary ChatGPT
integration and mounts both data roots as named scopes. The personal deployment
mounts only the personal root.

## Runtime secrets

Create an untracked file at `/home/roomhacker/todo-kanban/work-auth/runtime.env`
with:

```dotenv
KANBAN_AUTH_SECRET=<random value of at least 32 characters>
KANBAN_SETUP_TOKEN=<one-time setup token>
KANBAN_OAUTH_CLIENT_ID=chatgpt-kanban
KANBAN_OAUTH_CLIENT_SECRET=<random client secret>
KANBAN_OAUTH_REDIRECT_URIS=<exact ChatGPT OAuth callback URI>
```

Use a separate `KANBAN_AUTH_SECRET` and setup token in
`/home/roomhacker/todo-kanban/personal-auth/runtime.env`. Never commit these
files or put secrets in the public code repository.

## First setup

Call the setup endpoint once over the protected HTTPS host, supplying the setup
token in `X-Kanban-Setup-Token` and a password of at least 12 characters. If no
`totpSecret` is supplied, the response returns a one-time secret and `otpauth`
URI to add to an authenticator app. The setup endpoint refuses a second owner.

```text
POST /api/auth/setup
X-Kanban-Setup-Token: <setup token>
{"username":"<owner>","password":"<password>"}
```

The owner then logs in with password plus a six-digit TOTP code. The browser
login creates an HttpOnly session cookie.

## ChatGPT plugin OAuth

For a GPT Action, import the OpenAPI schema from
`https://excode.bezrabotnyi.com/openapi.json`. The Action editor supplies the
OAuth callback URL; copy that exact URL into `KANBAN_OAUTH_REDIRECT_URIS` (do
not invent or generalize it). Configure OAuth with the client ID and secret
from `KANBAN_OAUTH_CLIENT_ID` and `KANBAN_OAUTH_CLIENT_SECRET`.

Configure the plugin with:

```text
authorize: /oauth/authorize
token:     /oauth/token
scopes:    kanban:work kanban:personal
revoke:    /oauth/revoke
```

The authorize screen defaults to `kanban:work` and requires explicit consent
for `kanban:personal`. Authorization codes are one-time, bearer tokens are
stored only as hashes, and each token resolves exactly one data root. A work
token cannot read personal cards, and query parameters cannot change its scope.

# Existing OAuth configuration blocker

- Symptom: live `/oauth/authorize` returns `400 invalid OAuth request` when exercised with the configured client and callback probe.
- Smallest evidence: parsing `/home/roomhacker/todo-kanban/work-auth/runtime.env` through the existing `oauthRedirectUris()` logic reports `redirectCount=0`; no secret values were printed.
- Blocker: the exact ChatGPT OAuth callback URI is user/provider-owned and is not present in runtime config; do not invent or mutate it in the board deploy task.

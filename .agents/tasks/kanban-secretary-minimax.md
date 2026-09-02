# Kanban secretary MiniMax switch

Started at 2026-09-02T14:12:24+03:00 (system date command)
Estimate: 10-20 active minutes

## Minimal path
- Wanted result: secretary uses MiniMax instead of qwen3.5.
- Real canary: a pasted note is classified by MiniMax and returned as cards.
- Smallest slice: update only runtime model/provider settings; no UI or schema change.
- Discarded: A2A, new agent service, UI changes, task model migration.

## Result

- Status: done
- Runtime: direct `https://api.minimax.io/v1`, model `MiniMax-M3`; key stays only in the external runtime env file.
- Live canary: 2026-09-02 — one pasted note created a `todo` card for `marina`, project `EE Frontier`, with its explicit deadline; the test card was deleted (HTTP 200).
- Public checks: excode HTTP 200, todo HTTP 200.

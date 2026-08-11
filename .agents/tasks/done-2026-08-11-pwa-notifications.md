# Task: mobile-first agent-first PWA notifications

Role: Lead
Status: done; production deployment and live physical-device acceptance passed
Date: 2026-08-11

## Original request / goal

Сделать эту Kanban-доску mobile-first и agent-first PWA, которая после явного разрешения пользователя самостоятельно отправляет web push-уведомления о нужных изменениях и сроках.

## Objective

Deliver and prove a real PWA notification path for the excode Kanban: installable mobile shell, explicit notification permission and subscription, durable server-side subscription handling, automatic push on relevant card changes and due reminders, and a real mobile browser notification canary.

## Business canary

On a fresh mobile-sized browser context, the board exposes installable PWA metadata and a notification opt-in. After the user explicitly enables notifications, a subscription is accepted and survives a reload. A server-triggered card event or due reminder sends a Web Push payload, and the same browser's service worker displays the notification while the app is backgrounded. A user can disable notifications and the subscription is removed.

## Confirmed scope

- `/home/roomhacker/excode` source, current work/personal scope model, and existing Docker deployment contract.
- Mobile list surface, installability metadata, service worker, Web Push subscription lifecycle, and server-side notification dispatch.
- Automatic triggers limited to card create/update/move/reorder events and due reminders that are needed to prove the goal.
- Explicit user permission, unsubscribe, secret-safe configuration, focused tests, live redeploy, and real BrowserOS/mobile-size evidence.

## Explicit exclusions

- No Telegram/email/Matrix delivery or replacement of the existing notification-center product.
- No silent permission requests, background data scraping, or notification delivery without an explicit browser subscription.
- No production deploy before focused checks and a live canary; no unrelated service restarts.
- No broad rewrite of Kanban data storage or auth scopes beyond the minimum durable subscription boundary.

## Initial active-minute estimate (immutable)

- Optimistic: 120 minutes
- Likely: 240 minutes
- Pessimistic: 420 minutes

## Initial plan

1. Проверить текущий UI, deployment contract, auth/scope boundary и отсутствие PWA/push-контуров; определить минимальный end-to-end canary.
2. Зафиксировать красный canary для manifest/service worker, подписки, автоматического события и удаления подписки.
3. Реализовать installable mobile shell, explicit opt-in UI, subscription API/storage, Web Push dispatch и due-event scheduler в текущем runtime.
4. Прогнать focused tests, build и реальный mobile BrowserOS canary; затем redeploy только excode и проверить push на живом surface.
5. Выполнить независимый review/real-use gate, commit и push; цель закрыть только после доказанного browser notification.

## Stop / abandon / authorization

- stop_when: fresh mobile browser receives an automatic notification after explicit opt-in, unsubscribe is proven, and redeployed public canary passes.
- abandon_when: the current runtime cannot safely persist subscriptions or deliver a real push without introducing a new external service; record the exact dependency and keep the goal active.
- forbidden_without_explicit_user_request: new paid provider, Telegram/email delivery, broad auth redesign, destructive data migration, unrelated production restarts, or public exposure of secrets.

## Estimate revisions

- 2026-08-11: optimistic/likely/pessimistic revised to 150/300/480 active minutes after reconnaissance found no due field, scheduler, subscription persistence, or push dependency; evidence: both explorer reports and live 404 probes.

## Evidence log

- 2026-08-11: Current repository has no manifest, service worker, Notification API, Push API, VAPID, or Web Push implementation. It is Next.js standalone with Docker runtime and Markdown card storage.
- 2026-08-11: Fresh public probes are red for the required PWA seams: `/manifest.webmanifest`, `/manifest.json`, `/sw.js`, `/service-worker.js`, `/api/notifications/subscription`, and `/api/notifications/test` all return HTTP 404; the existing `/api/kanban/cards` returns HTTP 200.
- 2026-08-11: Recommended plan 2 selected for implementation: device-scoped explicit opt-in, atomic JSON subscription store, `web-push` 3.6.7, explicit `dueAt`, and a documented single-instance scheduler.
- 2026-08-11: `npm view web-push` confirms version 3.6.7 and Node >=16; private VAPID material will remain server-only.
- 2026-08-11: Red-first notification tests initially failed on missing modules/assets and missing dueAt; after implementation, focused tests pass 8/8 and full `bun x vitest run` passes 17 files / 36 tests.
- 2026-08-11: Local standalone runtime with ephemeral non-persisted VAPID keys passed manifest, active service-worker registration, public-key, malformed 400, valid 201, read-after-reload subscription, dueAt create/read, and unsubscribe canaries.
- 2026-08-11: BrowserOS page 59 exposed the explicit opt-in control, but the permission click remained at `Notification.permission=default` with no registration; screenshot was captured and this is not counted as real push acceptance. Touchpoint transport was closed, so OS permission UI could not be independently controlled.
- 2026-08-11: Production runtime has no VAPID variables in either external auth env file; live push requires an explicit server-only VAPID configuration boundary before deploy.
- 2026-08-11: Repeated continuation audit found the same release blocker unchanged: production PWA and notification routes remain HTTP 404 because the implementation is not deployed, and both external auth env files still have no VAPID configuration. Goal status set to blocked only after the repeated gate exceeded three consecutive goal turns.
- 2026-08-11: User-authorized third isolated preview started as `excode-pwa-preview` on loopback `127.0.0.1:43330`, with empty preview-only work/personal data, isolated subscription storage, and ephemeral VAPID keys supplied only to the container environment. Preview probes: manifest 200/standalone, service worker 200 with push handler, public key 200/enabled. Focused notification tests passed 8/8; full suite passed 18 files / 38 tests and production build passed.
- 2026-08-11: Desktop BrowserOS Tester stopped honestly: no 390x844 surface and no true browser permission/notification prompt. A physical S21 is connected and routed to the isolated preview through ADB reverse for a fresh agent-device-only acceptance run; no ADB UI control is used.
- 2026-08-11: Physical S21 Tester also stopped at a real-surface infrastructure boundary: agent-device opened the device, but Chrome was covered by a system overlay and the required screenshot was fully black. Screenshot was captured/inspected before one Back attempt; no preview UI, permission, subscription, card, or notification was touched. This is `STOP_MISSING_REAL_SURFACE`, not PWA acceptance.
- 2026-08-11: Physical-device bootstrap diagnosis confirmed the overlay is Samsung Always-On Display/lock surface, not a PWA failure. Agent-device opened Chrome, snapshot showed only `com.android.systemui` AOD nodes, and one safe tap produced no state change; session was closed. User unlock is required for the real mobile canary; no lock-screen bypass attempted.
- 2026-08-11: Reliability hardening slices completed with focused red→green tests: failed push delivery is retryable then deduplicated after success; strict validation rejects malformed keys and literal local/private endpoints while retaining a realistic public endpoint; Node instrumentation starts the due scheduler at cold runtime; unsubscribe waits for server deletion success before local unsubscribe/state-off.
- 2026-08-11: Follow-up hardening is green: a process-local delivery lease prevents a concurrent duplicate send in the single Node runtime while preserving retry after failure; subscription keys now require canonical decoded sizes (p256dh=65 bytes, auth=16 bytes). Full suite is 20 files / 55 tests, production build and diff check pass.
- 2026-08-11: User-authorized Redroid Android preview is live only on loopback and uses the isolated preview board plus ephemeral VAPID keys. Android WebView Shell (720x1280) successfully opened the board, exposed the List/Kanban controls, created `PWA Redroid canary`, and after the mobile-header fix visibly exposed both `Моя роль` / `Фильтр по роли` and the complete header without horizontal clipping. The initial mobile screenshot showed role and push controls clipped; the post-fix screenshot and accessibility snapshot show the role selector in the first control row.
- 2026-08-11: Redroid's bundled Chromium WebView Shell has no Service Worker/Push capability: the notification control is not rendered after capability detection, so it cannot prove explicit permission, subscription, or displayed Web Push. This is useful Android UI evidence but not the required real Chrome notification canary. No production deployment or VAPID configuration was changed.
- 2026-08-11: Fresh review found and a red→green worker fixed one P1: reordering a column previously dispatched one push per returned card. A multi-card reorder now dispatches exactly once (empty reorder zero times), covered by `src/app/api/kanban/reorder/route.test.ts`. Final independent re-review found no P0/P1/P2; full suite is 21 files / 56 tests, build and diff check pass.
- 2026-08-11: Independent Redroid Tester passed mobile header, List↔Kanban switching, creation, and UI deletion cleanup of its own card. It recorded `STOP_MISSING_REAL_SURFACE` only for native Push permission/subscription/displayed delivery: the current Redroid WebView Shell lacks that capability. Official Chrome installation requires Google Play; this isolated Redroid has neither Play Store nor Chrome, and no third-party APK was used.
- 2026-08-11: Fresh S21 retry remains `STOP_MISSING_REAL_SURFACE`: `agent-device open` resolved the real `com.android.chrome` target, but the interactive snapshot contained only Samsung AOD/lock nodes (`com.android.systemui`, `systemSurfaceOnly=true`). Session was closed without bypassing the lock. This repeats the same real-Chrome acceptance gate; preview and production state were not changed.
- 2026-08-11: User clarified the S21 had no lock. After mobile-agent swipes did not wake AOD, one allowed transport-bootstrap `KEYCODE_WAKEUP` plus swipe exposed real Chrome without PIN/biometric. The isolated preview rendered mobile role controls and an explicit `Включить уведомления` control; Chrome displayed its native permission prompt. On `Разрешить`, Chrome rejected the request with `Этот сайт не может запросить разрешение` / `Закройте всплывающие подсказки или окна, связанные с другими приложениями`. Read-only settings evidence shows Samsung Edge Panels are enabled (`secure.edge_enable=1`) and the visible `com.sec.android.app.launcher` Edge trigger is the remaining overlay. No permission/subscription/push was claimed; disabling this device setting requires a separate explicit user gate and must be restored afterwards.
- 2026-08-11: With the user's explicit approval, the temporary Samsung Edge/RustDesk overlay suppression was applied only for the Chrome permission flow and then restored (`edge_enable=1`, RustDesk `SYSTEM_ALERT_WINDOW=allow`). On the isolated preview, real S21 Chrome accepted permission, showed `Уведомления включены`, delivered the test notification while backgrounded, delivered an automatic `Новая карточка` notification for a temporary card, unsubscribed through the UI, and the test card was deleted.
- 2026-08-11: Production VAPID public/private material was generated once without logging it and saved server-only (mode 0600) in both existing work and personal runtime env files. `excode-kanban-1` was rebuilt/recreated from `docker-compose.deploy.yml`; `kanban-board-kanban-1` was force-recreated without rebuilding to pick up the same environment. Both containers are Up; work manifest responds HTTP 200 and personal local endpoint responds HTTP 200.
- 2026-08-11: On the live HTTPS public board `https://excode.bezrabotnyi.com`, physical S21 Chrome exposed the mobile role selector, accepted explicit notification permission, showed `Уведомления включены`, and displayed the test push in Android's notification shade with the public host as source. A temporary card created via the live board API returned 201 and produced a backgrounded Android notification titled `Новая карточка`; it was deleted immediately with HTTP 200. This completes the public automatic-change canary.

# Fresh Tester: personal Kanban after shared-auth image refresh

Role: Tester
Status: work
Created: 2026-08-11

## Original request

«Да, разрешаю.» — разрешение пересоздать personal Kanban container after diagnosis that the old image showed an invalid local password/2FA gate instead of using the existing `auth.bezrabotnyi.com` session.

## Objective

Проверить персональный сайт после image refresh через существующую shared-auth browser session и доказать реальный пользовательский CRUD.

## Business canary

В свежей BrowserOS-owned mobile page открыть `https://todo.bezrabotnyi.com`. Если shared-auth session уже есть, убедиться, что после auth нет локальной формы Kanban/password/2FA. Через видимый UI создать уникальную временную карточку `QA personal shared-auth 2026-08-11`, изменить заголовок или описание, удалить её и подтвердить отсутствие. Если shared-auth session отсутствует, не вводить пароль/2FA: сохранить screenshot и вернуть `STOP_MISSING_SHARED_SESSION`.

## Confirmed scope

- Только real-use BrowserOS UI, fresh context, mobile-sized viewport.
- Existing `auth.bezrabotnyi.com` session only; no credential entry.
- One temporary card, create → update → delete, with visible verification and cleanup.

## Explicit exclusions

- Не читать source, API, logs, Docker или task files приложения.
- Не использовать REST/CDP/page-context scripts вместо пользовательских действий.
- Не менять постоянные карточки и не оставлять тестовую карточку.
- Не вводить никакой локальный Kanban password, username или 2FA.

## Tester protocol

Использовать свежий BrowserOS контекст и `only-new`. Перед каждым действием наблюдать UI, после каждого — проверять видимый результат. При timeout/error/ambiguous state сначала снять и осмотреть secret-safe screenshot на той же странице, затем максимум одна осторожная retry. Дописать append-only evidence и вернуть PASS либо точный blocker.

## Tester evidence — 2026-08-11

- Surface/tool: BrowserOS-owned fresh page `96`; opened from `about:blank` and navigated through the visible browser UI to `https://todo.bezrabotnyi.com`. No source, API, logs, Docker, CDP, page-context script, or credentials were used.
- Initial observation: the page showed `My Kanban`, `Kanban`/`Список`, project and role filters, and the Inbox board. No local Kanban password, username, 2FA, or other local auth form appeared; the existing shared-auth session was accepted.
- Create: clicked visible Inbox `Добавить`, filled `QA personal shared-auth 2026-08-11` and `Temporary shared-auth CRUD canary`, supplied the required visible project field as `kanban`, and clicked `Создать`. After the save completed, a visible card button `Открыть задачу: QA personal shared-auth 2026-08-11` appeared in Inbox.
- Update: opened that card, changed the visible description to `Temporary shared-auth CRUD canary — updated`, clicked `Сохранить`, waited for the dialog to close, then reopened the same card. The edit dialog visibly showed the updated description, proving persistence through the user flow.
- Delete/cleanup: clicked visible `Удалить`. The first diff did not show a confirmation, so before any retry, reload, navigation, or cleanup I captured and inspected a secret-safe screenshot on the same page. It showed the edit dialog gone and the board returned to its prior visible state. A fresh BrowserOS snapshot then contained no `QA personal shared-auth 2026-08-11` card/button anywhere in the board, confirming cleanup.
- Evidence: BrowserOS screenshots were captured and inspected for the initial surface, the create dialog, the ambiguous delete transition, and the post-delete board. The delete-transition screenshot contained only the board and generic test data; no credentials or secrets were exposed.
- Acceptance: `PASS` — shared-auth entry and real UI create → persistent update → delete → absence were all proven on the fresh BrowserOS page, with no test card left behind.

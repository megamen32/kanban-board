# Fresh Tester: personal Kanban site

Role: Tester
Status: work
Created: 2026-08-11

## Original request

«Делаем рестарт и запускай тестера, пусть тестирует. Двух. Один тестирует MCP, а второй тестирует сайт персональный. Там создаст что-то, поудаляет, попробует поменять. В целом.»

## Objective

Проверить персональную доску на реальном пользовательском сайте после рестарта: создать карточку, изменить её, затем удалить и подтвердить итоговое состояние.

## Business canary

Открыть `https://todo.bezrabotnyi.com` как обычный пользователь; определить по видимому интерфейсу, что это персональная Kanban-доска; создать уникальную временную карточку `QA personal canary 2026-08-11`, изменить её заголовок/описание или другой доступный параметр, затем удалить её и убедиться, что она исчезла. Если персональная доска доступна на другом явно указанном в UI маршруте, продолжить только на нём.

## Confirmed scope

- Только black-box browser-проверка реального публичного сайта.
- Реальные видимые действия create, update и delete с одной временной карточкой.
- Мобильный размер viewport предпочтителен; сохранить secret-safe screenshot результата или blocker.

## Explicit exclusions

- Не читать исходники, API напрямую, логи, Docker state или task files приложения.
- Не использовать REST/CDP/скрипты вместо пользовательских действий.
- Не менять чужие карточки или постоянные данные; не оставлять тестовую карточку.
- Не вводить пароль/2FA и не обходить login gate; при gate/timeout сохранить screenshot и вернуть точный blocker.

## Tester protocol

Использовать свежий браузерный контекст и реальное UI. Перед каждым действием — наблюдать текущую страницу, после действия — проверить видимый результат. При ошибке/таймауте/неоднозначности сначала сохранить и осмотреть screenshot, только потом допустима одна осторожная повторная попытка. В конце дописать сюда append-only evidence и вернуть TL;DR с PASS или точным blocker.

## Tester evidence — 2026-08-11

- Verdict: `STOP_MISSING_REAL_SURFACE`.
- Chosen surface/tool: fresh BrowserOS-owned tab, page `94`, mobile-oriented screenshot size `390x844`; URL `https://todo.bezrabotnyi.com`.
- Fresh black-box journey: opened the public URL and took an initial accessibility snapshot before any interaction. The visible page was a login form headed `Вход в Kanban` with required fields `Пользователь`, `Пароль`, and `Код 2FA`, plus `Войти`.
- Blocker: the personal Kanban board was not reachable as an ordinary logged-in user. The task explicitly forbids entering a password/2FA or bypassing the login gate, so create/update/delete could not be attempted.
- Evidence: captured a screenshot of the same owned page before stopping, then inspected it. It showed the centered login card, all three fields empty, and no secret data. No retry, reload, navigation, cleanup, or alternate surface was performed after the blocker.
- Acceptance decision: business canary is inconclusive/blocked at authentication; no card was created, changed, or left behind. This is a real-surface access boundary, not a PASS.

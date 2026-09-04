# Менеджер: общая память человека и управление Kanban

Status: work
Started at 2026-09-05T00:16:39+03:00 (manual clock)
Original estimate: minimum 45 / maximum 90 active minutes
Active-time source: не контролировал непрерывно

## Запрос владельца

Добавить менеджера, который автоматически выдаёт задачи, исправить потерю контекста
между личным и общим Telegram-чатом за счёт памяти, привязанной к человеку, и дать
менеджеру управление карточками Kanban. Старые карточки не пересоздавать без
доказанной несовместимости.

## Минимальный путь

- Результат: менеджер узнаёт одного человека во всех его разрешённых чатах, использует его память и создаёт/обновляет назначенные ему Kanban-карточки.
- Кратчайший реальный canary: факт из ЛС доступен менеджеру в групповом ходе того же Telegram sender, после чего менеджер создаёт или обновляет тестовую карточку через реальный production consumer path.
- YAGNI-слайс: исправить identity-to-memory retrieval и подключить существующий Kanban API/MCP как инструменты менеджера с детерминированным автоподбором исполнителя; мигрировать только реально несовместимые карточки.
- Не делаем сейчас: новый Kanban, удаление старых карточек, массовую перегенерацию данных, автономную отправку внешних сообщений, новую систему идентификации или векторную БД.

## Декомпозиция

1. Найти реальный runtime owner памяти и manager turn, доказать причину разрыва ЛС/группа. Проверка: регрессионный red-test. 15–25 активных минут.
2. Исправить person-scoped retrieval и добавить минимальный Kanban tool path для назначения/обновления карточек. Проверка: focused tests. 20–40 активных минут.
3. Развернуть реальный owner-сервис(ы), выполнить изолированный live canary и проверить карточки в браузере. 10–25 активных минут.

## Ограничения

- Сохранить чужие dirty changes в `/home/roomhacker/excode`.
- Не смешивать work/personal scope и не ослаблять OAuth/approval boundaries.
- Не удалять и не пересоздавать существующие карточки без отдельного evidence-backed migration decision.

## Evidence

- Person-memory regression: red before fix; focused manager suite 10/10 green after fix.
- Excode manager-credential route tests: red 3/18 before implementation; green 18/18 after implementation.
- Excode build and lint pass. Full suite is 136/139 with three pre-existing contract-test failures in MCP tool inventory, data-scope caching, and legacy role validation; none touch this slice.
- Deployment and real canary pending.

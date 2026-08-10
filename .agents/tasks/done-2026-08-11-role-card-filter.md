# Фильтр карточек по роли/исполнителю

## Original request

> не вижу выбор роли чтобы я мог выбрать показывать только мои карточки

## Objective

Добавить на Kanban видимый выбор роли/исполнителя и режим, позволяющий показать только карточки выбранного пользователя.

## Business canary

В реальном UI пользователь выбирает роль/исполнителя, включает «Только мои», и доска показывает только карточки, где выбранный исполнитель указан в `assignees`; сброс возвращает полный список.

## Confirmed scope

- Найти существующую модель `assignees` и текущую панель фильтров.
- Добавить локальный UI-фильтр без изменения API, файлов карточек и OAuth.
- Покрыть фильтрацию focused regression-тестом до исправления.
- Проверить desktop/mobile-sized UI locally; production deploy только отдельным подтверждением.

## Explicit exclusions

- Не менять роли/исполнителей в существующих карточках.
- Не добавлять новый auth/user profile backend.
- Не деплоить и не перезапускать production без отдельного подтверждения.

## Estimate (immutable initial)

- Optimistic: 20 active minutes
- Likely: 45 active minutes
- Pessimistic: 90 active minutes

## Initial plan (по-русски)

1. Read-only найти assignees, view-model и место фильтров.
2. Зафиксировать красный тест на режим «только мои карточки».
3. Реализовать выбор роли и фильтрацию с понятным сбросом.
4. Запустить focused tests, build и локальный UI-canary.

## Worker assignment

- Worker owns only `src/components/kanban/view-model.ts`.
- Add `getAssigneeOptions(cards)` and extend `filterCards(cards, project, assignee = 'all')` without mutating the source collection.
- Do not edit tests, `kanban-board.tsx`, API routes, card files, auth, or deployment files.
- Acceptance: the new red tests in `src/components/kanban/view-model.test.ts` pass.

## Pre-implementation status

Production was untouched; implementation stayed local.

## Progress

- Red-first evidence: `bun test src/components/kanban/view-model.test.ts` initially failed because `getAssigneeOptions` was not exported.
- Worker implemented only `src/components/kanban/view-model.ts`: unique sorted assignee options and combined project/assignee filtering without source mutation.
- UI integration in `src/components/kanban/kanban-board.tsx` adds visible `Моя роль` / `Фильтр по роли` selector with `Все карточки` reset and stale-role reset.
- Focused view-model tests pass: 5/5; TypeScript check passes; production build passes.
- Local BrowserOS canary with real work cards: roles were visible; selecting `Секретарь` reduced the board to 3 cards; selecting `Все карточки` restored 33 cards.
- Full test suite: 26 passed, 2 failed in the pre-existing `origin.test.ts` `vi.stubEnv` compatibility blocker; no unrelated fix attempted.
- No API, card data, auth, deploy, or production restart changes.

## Status

Complete locally; production deployment remains explicitly excluded.

## Worker evidence

- Implementation status: complete for the assigned `view-model.ts` slice.
- Changed file: `src/components/kanban/view-model.ts` only.
- Changed symbols: added `getAssigneeOptions(cards)`; extended `filterCards(cards, project, assignee = 'all')` with a composed project/assignee predicate and preserved the unfiltered fast path.
- Red evidence before implementation: `npm test -- src/components/kanban/view-model.test.ts` failed 2 tests: missing `getAssigneeOptions` export and ignored selected assignee.
- Acceptance evidence after implementation: `npm test -- src/components/kanban/view-model.test.ts` passed, 1 file and 5 tests.
- Additional checks: `npx tsc --noEmit --pretty false` passed; `git diff --check -- src/components/kanban/view-model.ts` passed.
- Lint check was attempted but the repository has no ESLint flat config (`eslint.config.js|mjs|cjs`), so ESLint could not run.
- Scope preserved: no edits to tests, `kanban-board.tsx`, API routes, card files, auth, deployment, or production state.
- Not tested by this Worker: production deployment/restart and real UI desktop/mobile canary; those remain outside this bounded view-model acceptance contract.

## Status update

Implementation and focused acceptance test contract complete; ready for Lead integration and UI-level canary.

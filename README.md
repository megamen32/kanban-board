# TODO Kanban Board

Kanban-доска с двусторонней синхронизацией с Markdown-файлами.

## Возможности

- **6 колонок**: Inbox, To Do, In Progress, Review, Done, Archived
- **Drag & Drop**: перетаскивайте карточки между колонками
- **Markdown-файлы**: каждая карточка = `.md` файл с YAML frontmatter
- **Двусторонняя синхронизация**:
  - Создание карточки в UI → создание `.md` файла
  - Создание/изменение `.md` файла → появление/обновление карточки (WebSocket)
- **Конфликты**: при одновременном редактировании — диалог разрешения
- **Stable ID**: UUID в frontmatter, не зависит от имени файла
- **4 уровня приоритета**: low, medium, high, critical
- **Теги**: произвольные метки

## Быстрый старт

```bash
docker compose up -d --build
```

Откройте `http://localhost:3000`

## Монтирование существующих файлов

```yaml
volumes:
  - /path/to/todo-kanban/tasks:/app/data/tasks
```

## Формат файла

```markdown
---
id: 'uuid'
title: 'Название задачи'
column: 'todo'
priority: 'high'
tags: ['research']
order: 0
created: '2026-08-06T20:00:00Z'
updated: '2026-08-06T20:00:00Z'
version: 1
---

Описание в markdown.
```

## Без Docker

```bash
bun install
# Terminal 1:
TASKS_DIR=./data/tasks bun run dev
# Terminal 2:
cd mini-services/kanban-ws && TASKS_DIR=../data/tasks bun run dev
```

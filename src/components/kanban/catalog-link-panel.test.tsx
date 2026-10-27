import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CatalogTaskLink } from '@/lib/kanban/types';
import { CatalogLinkPanel } from './catalog-link-panel';

const link: CatalogTaskLink = {
  version: 1,
  taskId: 'task-1',
  operationRef: 'operation-ref-1',
  boardVersion: 4,
  sourceRef: 'source-event-2',
  sourceRevision: 'source-rev-3',
  projectId: 'catalog-project-7',
  planIds: ['plan-1'],
  gateIds: ['gate-2'],
  contactIds: ['contact-3'],
  catalogRevision: 'catalog-rev-9',
};

describe('catalog link panel', () => {
  it('renders only the stored opaque IDs and revisions with a clear live-state limit', () => {
    const html = renderToStaticMarkup(React.createElement(CatalogLinkPanel, { link }));
    for (const value of [
      'Сохранённая связь с каталогом', 'catalog-project-7', 'source-event-2', 'source-rev-3',
      'catalog-rev-9', 'plan-1', 'gate-2', 'contact-3', 'Текущий этап проекта и журнал активности каталога здесь не загружаются.',
    ]) expect(html).toContain(value);
    expect(html).not.toContain('operation-ref-1');
    expect(html).not.toContain('task-1');
  });

  it('reports empty reference sets without inventing linked catalog rows', () => {
    const html = renderToStaticMarkup(React.createElement(CatalogLinkPanel, {
      link: { ...link, planIds: [], gateIds: [], contactIds: [] },
    }));
    expect(html.match(/Нет привязанных ссылок/g)).toHaveLength(3);
  });
});

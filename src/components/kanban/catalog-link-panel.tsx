'use client';

import type { CatalogTaskLink } from '@/lib/kanban/types';
import { getCatalogLinkDisplay } from './integrator-dashboard-model';

export function CatalogLinkPanel({ link }: { link: CatalogTaskLink }) {
  const catalogLink = getCatalogLinkDisplay({ catalogLink: link });
  if (!catalogLink) return null;

  const referenceRows = [
    { label: 'Планы', ids: catalogLink.planIds },
    { label: 'Этапы', ids: catalogLink.gateIds },
    { label: 'Контакты', ids: catalogLink.contactIds },
  ];

  return (
    <section className="space-y-2 rounded-md border p-3" aria-label="Сохранённая связь с каталогом">
      <div>
        <h3 className="text-sm font-medium">Сохранённая связь с каталогом</h3>
        <p className="text-xs text-muted-foreground">Показываются только ссылки и версии, сохранённые при привязке задачи.</p>
      </div>
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div className="min-w-0"><dt className="text-xs text-muted-foreground">Проект каталога</dt><dd className="break-all font-mono text-xs">{catalogLink.projectId}</dd></div>
        <div className="min-w-0"><dt className="text-xs text-muted-foreground">Версия каталога при привязке</dt><dd className="break-all font-mono text-xs">{catalogLink.catalogRevision}</dd></div>
        <div className="min-w-0"><dt className="text-xs text-muted-foreground">Источник</dt><dd className="break-all font-mono text-xs">{catalogLink.sourceRef}</dd></div>
        <div className="min-w-0"><dt className="text-xs text-muted-foreground">Версия источника</dt><dd className="break-all font-mono text-xs">{catalogLink.sourceRevision}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Версия карточки при привязке</dt><dd>{catalogLink.boardVersion}</dd></div>
        {referenceRows.map(({ label, ids }) => (
          <div key={label} className="min-w-0">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd>{ids.length > 0
              ? <ul className="list-disc break-all pl-5 font-mono text-xs">{ids.map(id => <li key={id}>{id}</li>)}</ul>
              : <span className="text-xs text-muted-foreground">Нет привязанных ссылок</span>}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted-foreground">Текущий этап проекта и журнал активности каталога здесь не загружаются.</p>
    </section>
  );
}

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('React', React);
import { MarkdownText } from './markdown-text';

const render = (text: string) => renderToStaticMarkup(React.createElement(MarkdownText, { text }));

describe('read-only Markdown rendering', () => {
  it('renders headings, emphasis and lists without the raw syntax', () => {
    const html = render([
      '## Блокер',
      '',
      'Поставщик **не прислал** тестовый файл.',
      '',
      '- итог: ожидание подтверждения',
      '- заметка: исходная формулировка',
    ].join('\n'));

    expect(html).toContain('Блокер');
    expect(html).toContain('<h2');
    expect(html).not.toContain('##');
    expect(html).toMatch(/<strong[^>]*>не прислал<\/strong>/);
    expect(html).toMatch(/<li[^>]*>итог: ожидание подтверждения<\/li>/);
    expect(html).toMatch(/<li[^>]*>заметка: исходная формулировка<\/li>/);
    expect(html).toContain('<ul');
  });

  it('keeps the stored text verbatim in the editor sense: no markup is injected', () => {
    const html = render('Обычный текст без разметки');
    expect(html).toContain('Обычный текст без разметки');
  });

  it('escapes raw html instead of rendering it', () => {
    const html = render('<img src=x onerror=alert(1)> и <b>жирный</b>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;img');
  });

  it('renders nothing for an empty description', () => {
    expect(render('   ')).toBe('');
  });
});

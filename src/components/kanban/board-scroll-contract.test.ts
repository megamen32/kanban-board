import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The board page is a fixed-height shell (`h-screen` + `overflow-hidden`), so a
 * tab panel without its own vertical scroller pushes everything below the fold
 * out of reach: the page never scrolls and the panel overflow is clipped.
 *
 * The dashboard and task-list panels regressed exactly that way. The panel grew
 * past the viewport, `overflow-y` stayed `visible` and the lower card actions
 * ("Запустить задачу", "Открыть проверку") could not be reached on desktop or
 * mobile.
 */

function source(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
}

interface TabPanel { value: string; classes: string }

function tabPanels(boardSource: string): TabPanel[] {
  const panels: TabPanel[] = [];
  const pattern = /<TabsContent\s+value="([^"]+)"\s+className="([^"]*)"/g;
  for (const match of boardSource.matchAll(pattern)) panels.push({ value: match[1], classes: match[2] });
  return panels;
}

const boardSource = source('./kanban-board.tsx');
const pageSource = source('../../app/page.tsx');

describe('board tab panel scroll contract', () => {
  it('keeps the fixed-height page shell that makes panel scrolling mandatory', () => {
    expect(pageSource).toContain('overflow-hidden');
    expect(pageSource).toContain('h-screen');
  });

  it('gives every tab panel its own vertical scroll container', () => {
    const panels = tabPanels(boardSource);
    expect(panels.length).toBeGreaterThan(0);
    for (const panel of panels) {
      expect(panel.classes, `tab panel "${panel.value}" must scroll vertically`).toContain('overflow-y-auto');
      expect(panel.classes, `tab panel "${panel.value}" must be allowed to shrink`).toContain('min-h-0');
    }
  });

  it('keeps the dashboard and task-list panels scrollable', () => {
    const panels = tabPanels(boardSource);
    for (const value of ['dashboard', 'execution']) {
      const panel = panels.find(item => item.value === value);
      expect(panel, `missing tab panel "${value}"`).toBeDefined();
      expect(panel?.classes).toContain('min-h-0');
      expect(panel?.classes).toContain('overflow-y-auto');
    }
  });

  it('keeps narrow navigation below content and wide navigation to its left with labels', () => {
    expect(boardSource).toContain('className="flex min-h-0 flex-1 flex-col gap-0 md:flex-row"');
    expect(boardSource).toContain('order-2 mt-auto w-full shrink-0 border-t');
    expect(boardSource).toContain('md:order-1 md:mt-0 md:h-full md:w-40');
    const strip = boardSource.split('<TabsList aria-label="Разделы доски"')[1]?.split('</TabsList>')[0];
    expect(strip).toContain('md:h-auto md:flex-col');
    expect(strip).toContain('md:justify-start');
    expect(strip).toContain('>Активные</span>');
    expect(strip).toContain('>Закрытые</span>');
    for (const panel of tabPanels(boardSource)) {
      expect(panel.classes).toContain('order-1 md:order-2');
    }
  });

  it('keeps the tab strip reachable on narrow viewports', () => {
    expect(boardSource).toContain('overflow-x-auto');
  });
});

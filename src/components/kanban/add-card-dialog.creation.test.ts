import { describe, expect, it, vi } from 'vitest';
import { mutationErrorMessage } from '@/lib/kanban/mutation-response';

vi.mock('@/components/ui/dialog', () => ({ Dialog: () => null, DialogContent: () => null, DialogDescription: () => null, DialogHeader: () => null, DialogTitle: () => null, DialogFooter: () => null }));
vi.mock('@/components/ui/button', () => ({ Button: () => null }));
vi.mock('@/components/ui/input', () => ({ Input: () => null }));
vi.mock('@/components/ui/textarea', () => ({ Textarea: () => null }));
vi.mock('@/components/ui/badge', () => ({ Badge: () => null }));

import { createWithReviewGate, initialCreationColumn } from './add-card-dialog';

describe('creation requiring a checked result before completion', () => {
  it('refuses done before the create mutation can be called', async () => {
    const create = vi.fn(async () => ({ id: 'new-card', column: 'done' }));
    await expect(createWithReviewGate('done', true, create)).rejects.toThrow('проверьте результат и доказательство');
    expect(create).not.toHaveBeenCalled();
  });

  it('preserves the review instruction through the normal form error renderer', async () => {
    const failure = await createWithReviewGate('done', true, async () => undefined).catch(error => error);
    expect(mutationErrorMessage(failure)).toContain('проверьте результат и доказательство');
  });

  it.each(['inbox', 'todo', 'in-progress', 'review', 'blocked', 'someday', 'archived'])(
    'preserves the existing create request and server receipt for %s', async column => {
      const saved = { id: 'new-card', column, version: 1 };
      const create = vi.fn(async () => saved);
      expect(await createWithReviewGate(column, true, create)).toBe(saved);
      expect(create).toHaveBeenCalledOnce();
      expect(initialCreationColumn(column, true)).toBe(column);
    },
  );

  it('starts an unchecked new goal as todo if a stale caller supplies done', () => {
    expect(initialCreationColumn('done', true)).toBe('todo');
  });

  it('preserves classic creation when the requirement is not enabled', async () => {
    const saved = { id: 'classic-card', column: 'done' };
    const create = vi.fn(async () => saved);
    expect(initialCreationColumn('done')).toBe('done');
    expect(await createWithReviewGate('done', false, create)).toBe(saved);
    expect(create).toHaveBeenCalledOnce();
  });
});

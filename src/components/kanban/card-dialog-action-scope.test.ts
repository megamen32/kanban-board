import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createCardDialogActionScope } from './card-dialog-action-scope';

describe('card dialog action lifetime', () => {
  it('permits completion in the same open dialog', () => {
    const scope = createCardDialogActionScope();
    scope.enter();
    expect(scope.capture()()).toBe(true);
  });

  it('finishes an issued save A without closing B after A unmounts', async () => {
    const scope = createCardDialogActionScope();
    scope.enter();
    const isCurrent = scope.capture();
    let finish!: () => void;
    const mutation = new Promise<void>(resolve => { finish = resolve; });
    const savedA = vi.fn();
    const closeB = vi.fn();
    const complete = async () => {
      await mutation;
      savedA();
      if (isCurrent()) closeB();
    };
    const pending = complete();
    scope.leave();
    finish();
    await pending;
    expect(savedA).toHaveBeenCalledOnce();
    expect(closeB).not.toHaveBeenCalled();
  });

  it('invalidates an old response on card switch and same-card reopen', () => {
    const scope = createCardDialogActionScope();
    scope.enter();
    const beforeSwitch = scope.capture();
    scope.leave(); scope.enter();
    expect(beforeSwitch()).toBe(false);
    const beforeReopen = scope.capture();
    scope.leave(); scope.enter();
    expect(beforeReopen()).toBe(false);
    expect(scope.capture()()).toBe(true);
  });

  it('does not let stale errors or finally reset the new dialog busy state', async () => {
    const scope = createCardDialogActionScope();
    scope.enter();
    const isCurrent = scope.capture();
    scope.leave(); scope.enter();
    let busy = true;
    let error: unknown = null;
    try { await Promise.reject(new Error('old request failed')); }
    catch (failure) { if (isCurrent()) error = failure; }
    finally { if (isCurrent()) busy = false; }
    expect(error).toBeNull();
    expect(busy).toBe(true);
  });

  it('guards all parent-changing async handlers in the actual dialog', () => {
    const source = readFileSync(new URL('./card-edit-dialog.tsx', import.meta.url), 'utf8');
    for (const handler of ['handleSave', 'handleComplete', 'handleTakeReview', 'handleDelete', 'handleReview']) {
      const body = source.split('  const ' + handler + ' =')[1].split('\n  };')[0];
      expect(body, handler).toContain('actionScope.capture()');
      expect(body, handler).toContain('isCurrent()');
    }
    expect(source).toContain('return () => actionScope.leave()');
    expect(source).toContain('[card.id, open, actionScope]');
    expect(source).toContain('await onUpdate(card.id, updates, baseline.version)');
    expect(source).toContain('<ResultVerification key={card.id}');
    const verification = readFileSync(new URL('./result-verification.tsx', import.meta.url), 'utf8');
    expect(verification).toContain('actionScope.capture()');
    expect(verification).toContain('if (!isCurrent()) return;');
    expect(verification.indexOf('if (!isCurrent()) return;')).toBeLessThan(verification.indexOf('onSaved(data.card)'));
    expect(verification).toContain('return () => actionScope.leave()');

  });
});

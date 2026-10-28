import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertion: { current: { userId: 'owner-id' } as { userId: string } | null },
  verify: vi.fn(),
  human: vi.fn(),
}));

vi.mock('./airlock-native-identity', () => ({
  AIRLOCK_TODO_NATIVE_IDENTITY_HEADER: 'X-Airlock-Todo-Native-Identity',
  verifyAirlockTodoNativeIdentity: mocks.verify,
}));
vi.mock('./board-human', () => ({ boardHumanIdentityFromRequest: mocks.human }));

import { ownerBrowserReadAllowed } from './owner-browser-read';

function request(assertion = true): NextRequest {
  return new NextRequest('https://todo-board.airlock.bezrabotnyi.com/api/kanban/cards', {
    headers: assertion ? { 'X-Airlock-Todo-Native-Identity': 'signed-assertion' } : {},
  });
}

describe('ownerBrowserReadAllowed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('AIRLOCK_TODO_NATIVE_IDENTITY_PUBLIC_KEY', 'test-public-key');
    vi.stubEnv('KANBAN_AIRLOCK_ACCOUNT_MAP', JSON.stringify({ 'owner-id': 'nikita', 'other-id': 'qa_exmanager_a' }));
    mocks.assertion.current = { userId: 'owner-id' };
    mocks.verify.mockImplementation(async () => mocks.assertion.current);
    mocks.human.mockResolvedValue({ username: 'nikita', scope: 'work' });
  });

  it('allows only matching signed owner and verified Board owner identities', async () => {
    await expect(ownerBrowserReadAllowed(request())).resolves.toBe(true);
    expect(mocks.verify).toHaveBeenCalledWith(expect.anything(), 'test-public-key');
    expect(mocks.human).toHaveBeenCalledOnce();
  });

  it('does not invoke a project grant when the native assertion is absent', async () => {
    await expect(ownerBrowserReadAllowed(request(false))).resolves.toBe(false);
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(mocks.human).not.toHaveBeenCalled();
  });

  it('rejects a present invalid or stale assertion before consulting the Board session', async () => {
    mocks.verify.mockRejectedValueOnce(new Error('native_identity_invalid'));
    await expect(ownerBrowserReadAllowed(request())).rejects.toThrow('native_identity_invalid');
    expect(mocks.human).not.toHaveBeenCalled();
  });

  it('rejects a non-owner signed caller even when the browser session is the owner', async () => {
    mocks.assertion.current = { userId: 'other-id' };
    await expect(ownerBrowserReadAllowed(request())).rejects.toThrow('native_owner_read_mismatch');
  });

  it('leaves an owner assertion without a Board human session on the native resolver path', async () => {
    mocks.human.mockResolvedValueOnce(null);
    await expect(ownerBrowserReadAllowed(request())).resolves.toBe(false);
  });

  it('rejects an owner assertion paired with a non-owner Board session', async () => {
    mocks.human.mockResolvedValueOnce({ username: 'nikita', scope: 'personal' });
    await expect(ownerBrowserReadAllowed(request())).rejects.toThrow('native_owner_read_mismatch');
    mocks.human.mockResolvedValueOnce({ username: 'oleg', scope: 'work' });
    await expect(ownerBrowserReadAllowed(request())).rejects.toThrow('native_owner_read_mismatch');
  });

  it('does not treat email-only mappings as an owner match', async () => {
    process.env.KANBAN_AIRLOCK_ACCOUNT_MAP = JSON.stringify({ 'owner@example.test': 'nikita' });
    await expect(ownerBrowserReadAllowed(request())).rejects.toThrow('native_owner_read_mismatch');
  });

  it('leaves matching non-owner identities on the existing project resolver path', async () => {
    mocks.assertion.current = { userId: 'other-id' };
    mocks.human.mockResolvedValueOnce({ username: 'qa_exmanager_a', scope: 'work' });
    await expect(ownerBrowserReadAllowed(request())).resolves.toBe(false);
  });

  it('requires the public verifier key when a native assertion is present', async () => {
    vi.stubEnv('AIRLOCK_TODO_NATIVE_IDENTITY_PUBLIC_KEY', '');
    await expect(ownerBrowserReadAllowed(request())).rejects.toThrow('native_identity_unconfigured');
    expect(mocks.verify).not.toHaveBeenCalled();
  });
});

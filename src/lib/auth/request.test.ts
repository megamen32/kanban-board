import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { boardIdentityFromRequest, identityFromRequest, managerRequestAuthorized } from './request';

describe('board request identity', () => {
  const request = () => new NextRequest('http://localhost/api/kanban/cards');

  it('allows anonymous board access in the configured UI scope', () => {
    expect(boardIdentityFromRequest(request())).toEqual({ username: 'anonymous', scope: 'work' });
  });

  it('keeps the strict identity gate for ChatGPT OAuth', () => {
    expect(identityFromRequest(request())).toBeNull();
  });

  it('accepts the dedicated manager credential without turning it into a user session', () => {
    const previous = process.env.KANBAN_MANAGER_TOKEN;
    process.env.KANBAN_MANAGER_TOKEN = 'manager-secret';
    try {
      const managerRequest = new NextRequest('http://localhost/api/kanban/cards', {
        headers: { 'x-kanban-manager-token': 'manager-secret' },
      });
      expect(managerRequestAuthorized(managerRequest)).toBe(true);
      expect(identityFromRequest(managerRequest)).toBeNull();
      expect(managerRequestAuthorized(new NextRequest('http://localhost/api/kanban/cards', {
        headers: { 'x-kanban-manager-token': 'wrong-secret' },
      }))).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.KANBAN_MANAGER_TOKEN;
      else process.env.KANBAN_MANAGER_TOKEN = previous;
    }
  });
});

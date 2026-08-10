import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { boardIdentityFromRequest, identityFromRequest } from './request';

describe('board request identity', () => {
  const request = () => new NextRequest('http://localhost/api/kanban/cards');

  it('allows anonymous board access in the configured UI scope', () => {
    expect(boardIdentityFromRequest(request())).toEqual({ username: 'anonymous', scope: 'work' });
  });

  it('keeps the strict identity gate for ChatGPT OAuth', () => {
    expect(identityFromRequest(request())).toBeNull();
  });
});

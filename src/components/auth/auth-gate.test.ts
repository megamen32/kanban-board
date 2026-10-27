import { describe, expect, it } from 'vitest';
import { unauthenticatedAuthMode } from './auth-gate';

describe('unauthenticated board entry', () => {
  it('keeps production hosts behind verified login and reserves anonymous access for loopback QA', () => {
    expect(unauthenticatedAuthMode('todo-board.airlock.bezrabotnyi.com')).toBe('verified-login-required');
    expect(unauthenticatedAuthMode('todo.bezrabotnyi.com')).toBe('verified-login-required');
  });

  it('keeps isolated loopback QA available without SSO', () => {
    expect(unauthenticatedAuthMode('127.0.0.1')).toBe('loopback-preview');
    expect(unauthenticatedAuthMode('localhost')).toBe('loopback-preview');
    expect(unauthenticatedAuthMode('[::1]')).toBe('loopback-preview');
  });
});

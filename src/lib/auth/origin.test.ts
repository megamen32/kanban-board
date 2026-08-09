import { afterEach, describe, expect, it, vi } from 'vitest';
import { publicOrigin } from './origin';

afterEach(() => vi.unstubAllEnvs());

describe('publicOrigin', () => {
  it('prefers the deployment public origin over internal request URL', () => {
    vi.stubEnv('KANBAN_PUBLIC_ORIGIN', 'https://excode.bezrabotnyi.com/');
    expect(publicOrigin(new Request('http://127.0.0.1:3001/.well-known/oauth-authorization-server'))).toBe('https://excode.bezrabotnyi.com');
  });

  it('uses forwarded host and protocol when no explicit origin is configured', () => {
    expect(publicOrigin(new Request('http://127.0.0.1:3001/oauth/authorize', {
      headers: { 'x-forwarded-host': 'kanban.example.test', 'x-forwarded-proto': 'https' },
    }))).toBe('https://kanban.example.test');
  });
});

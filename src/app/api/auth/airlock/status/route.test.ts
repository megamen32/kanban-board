import { describe, expect, it, vi } from 'vitest';
import { GET } from './route';

const mocks = vi.hoisted(() => ({ enabled: true }));
vi.mock('../../../../../lib/auth/airlock-relay', () => ({
  airlockRelayConfig: () => ({ enabled: mocks.enabled }),
}));

describe('Airlock relay availability', () => {
  it('reports only whether this host can start SSO', async () => {
    mocks.enabled = true;
    expect((await GET()).status).toBe(204);
    mocks.enabled = false;
    const disabled = await GET();
    expect(disabled.status).toBe(404);
    expect(await disabled.json()).toEqual({ enabled: false });
  });
});

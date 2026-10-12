import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { localIdentity } = vi.hoisted(() => ({ localIdentity: vi.fn(() => null) }));
vi.mock('./request', () => ({ identityFromRequest: localIdentity }));
import { boardHumanIdentityFromRequest } from './board-human';

// Fast unit: reproduce lost outer-cookie identity; expected <1s, maximum 10s.
describe('human board identity from existing shared login', () => {
  const fetchMock = vi.fn();
  const request = (cookie = 'gptadmin_auth=opaque-existing-session') => new NextRequest('https://todo.bezrabotnyi.com/api/kanban/cards/qa', {
    headers: { cookie, 'x-gptadmin-user': 'nikita' },
  });
  beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset(); localIdentity.mockReturnValue(null); });
  afterEach(() => vi.unstubAllGlobals());

  it('verifies the existing outer login before recognizing the configured owner', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204, headers: { 'X-GPTAdmin-User': 'roomhacker' } }));
    expect(await boardHumanIdentityFromRequest(request())).toEqual({ username: 'nikita', scope: 'work' });
    expect(fetchMock).toHaveBeenCalledWith('https://auth.bezrabotnyi.com/check', expect.objectContaining({
      headers: { Cookie: 'gptadmin_auth=opaque-existing-session' }, redirect: 'error', cache: 'no-store',
    }));
  });

  it('does not forward unrelated cookies or authenticate asserted client headers', async () => {
    expect(await boardHumanIdentityFromRequest(request('other=value'))).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards only the existing gateway cookie', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204, headers: { 'X-GPTAdmin-User': 'roomhacker' } }));
    await boardHumanIdentityFromRequest(request('unrelated=private; gptadmin_auth=opaque-existing-session; other=private'));
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ Cookie: 'gptadmin_auth=opaque-existing-session' });
  });

  it.each([401, 500])('does not recognize a rejected or unavailable login (%s)', async status => {
    fetchMock.mockResolvedValue(new Response(null, { status }));
    expect(await boardHumanIdentityFromRequest(request())).toBeNull();
  });

  it('preserves another verified user without granting owner identity', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204, headers: { 'X-GPTAdmin-User': 'oleg' } }));
    expect(await boardHumanIdentityFromRequest(request())).toEqual({ username: 'oleg', scope: 'work' });
  });

  it('preserves an existing native human session without a gateway call', async () => {
    localIdentity.mockReturnValue({ username: 'nikita', scope: 'work' } as never);
    expect(await boardHumanIdentityFromRequest(request())).toEqual({ username: 'nikita', scope: 'work' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not turn a service Bearer identity into a human click', async () => {
    localIdentity.mockReturnValue({ username: 'nikita', scope: 'work', accessToken: { clientId: 'service' } } as never);
    expect(await boardHumanIdentityFromRequest(request())).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('handles network failure without inventing identity', async () => {
    fetchMock.mockRejectedValue(new Error('unavailable'));
    expect(await boardHumanIdentityFromRequest(request())).toBeNull();
  });
});

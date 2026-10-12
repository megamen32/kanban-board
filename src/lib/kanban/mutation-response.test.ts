import { describe, expect, it } from 'vitest';
import { readMutationResponse, mutationErrorMessage } from './mutation-response';

// Fast unit: failed HTTP must never become successful UI mutation; <1s/max5s.
describe('board mutation response', () => {
  it('retains actual successful card data', async () => {
    const body = { card: { id: 'qa', version: 2 } };
    expect(await readMutationResponse(Response.json(body))).toEqual(body);
  });
  it('rejects failed writes with a human message, not raw provider output', async () => {
    await expect(readMutationResponse(Response.json({ error: 'raw private stderr' }, { status: 503 }))).rejects.toThrow('недоступен');
  });
  it('preserves the exact version-conflict response for explicit choice', async () => {
    const body = { conflict: true, serverCard: { id: 'qa', version: 3 } };
    expect(await readMutationResponse(Response.json(body, { status: 409 }), true)).toEqual(body);
  });
  it('does not treat expired-login HTML as a saved mutation', async () => {
    await expect(readMutationResponse(new Response('<html>login</html>'))).rejects.toThrow('Войдите');
  });
  it('does not show arbitrary runtime exceptions to a person', () => {
    expect(mutationErrorMessage(new Error('private details'))).not.toContain('private');
  });
});

import { describe, expect, it } from 'vitest';
import { readBoardSnapshot } from './board-snapshot';

describe('honest native board reads', () => {
  it('accepts an explicitly empty canonical snapshot', async () => {
    await expect(readBoardSnapshot(Response.json({cards: [], projects: []}))).resolves.toEqual({cards: [], projects: []});
  });
  it('retains canonical IDs and versions without inventing project names', async () => {
    const card = {id: 'fixture', version: 7, project: 'Airlock платформа'};
    await expect(readBoardSnapshot(Response.json({cards: [card]}))).resolves.toEqual({cards: [card], projects: []});
  });
  it('rejects expired login, ACL and rate-limit responses instead of showing zero tasks', async () => {
    for (const status of [401, 403, 429, 503]) {
      await expect(readBoardSnapshot(Response.json({error: 'failure'}, {status}))).rejects.toMatchObject({status});
    }
  });
  it('rejects successful login HTML and malformed snapshots', async () => {
    await expect(readBoardSnapshot(new Response('<html>Login</html>'))).rejects.toMatchObject({status: 502});
    for (const body of [{}, {cards: [{}]}, {cards: [], projects: null}]) {
      await expect(readBoardSnapshot(Response.json(body))).rejects.toMatchObject({status: 502});
    }
  });
});

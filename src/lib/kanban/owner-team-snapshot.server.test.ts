import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OWNER_TEAM_SNAPSHOT_RELATIVE_PATH, parseOwnerTeamSnapshot, readOwnerTeamCatalogSnapshot } from './owner-team-snapshot.server';

const observedAt = '2026-01-01T10:00:00.000Z';
const sourceRevision = '1'.repeat(40);
const fixture = () => ({
  schemaVersion: 1,
  sourceAppId: '10000000-0000-4000-8000-000000000001',
  sourceRevision, observedAt,
  teams: [{ id: 'exmanager:Crew A', name: 'Crew A' }, { id: 'exmanager:Crew B', name: 'Crew B' }],
  projectTeams: [{ project: 'Alpha', teamId: 'exmanager:Crew A' }, { project: 'Foreign project', teamId: 'exmanager:Crew B' }],
});
let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'kontur-owner-catalog-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });
function write(value: unknown) {
  const filename = path.join(root, OWNER_TEAM_SNAPSHOT_RELATIVE_PATH);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, JSON.stringify(value), { mode: 0o600 });
  return filename;
}

describe('owner-only observed team metadata', () => {
  it('keeps exact team identities and provenance, filters links to the authorized snapshot, and preserves unknowns', () => {
    write(fixture());
    expect(readOwnerTeamCatalogSnapshot(root, ['Alpha', 'Empty', 'Alpha'])).toEqual({
      status: 'partial', coverage: 'owner-catalog',
      teams: fixture().teams,
      projectTeams: [{ project: 'Alpha', teamId: 'exmanager:Crew A', source: 'exmanager-snapshot' }],
      unknownProjectNames: ['Empty'],
      provenance: { mode: 'snapshot', source: 'exmanager', observedAt, sourceRevision },
    });
  });
  it('does not infer a project relation from a matching team name', () => {
    const value = fixture();
    value.teams.push({ id: 'exmanager:Empty', name: 'Empty' });
    write(value);
    const result = readOwnerTeamCatalogSnapshot(root, ['Empty']);
    expect(result?.teams).toHaveLength(3);
    expect(result?.projectTeams).toEqual([]);
    expect(result?.unknownProjectNames).toEqual(['Empty']);
    expect(result?.status).toBe('partial');
  });
  it('reports a complete observed directory as ready and does not silently restamp an older observation', () => {
    const value = fixture();
    value.teams = value.teams.slice(0, 1); value.projectTeams = value.projectTeams.slice(0, 1);
    write(value);
    const result = readOwnerTeamCatalogSnapshot(root, ['Alpha']);
    expect(result?.status).toBe('ready');
    expect(result?.provenance?.observedAt).toBe(observedAt);
  });
  it('rejects directory members, permission claims and unexpected snapshot fields', () => {
    for (const value of [
      { ...fixture(), owner: 'forged' },
      { ...fixture(), teams: [{ ...fixture().teams[0], members: ['private-user'] }] },
      { ...fixture(), projectTeams: [{ ...fixture().projectTeams[0], readAllowed: true }] },
    ]) expect(parseOwnerTeamSnapshot(value)).toBeNull();
  });
  it('rejects duplicate, dangling, altered-namespace and padded identities', () => {
    for (const value of [
      { ...fixture(), teams: [fixture().teams[0], fixture().teams[0]] },
      { ...fixture(), projectTeams: [fixture().projectTeams[0], fixture().projectTeams[0]] },
      { ...fixture(), projectTeams: [{ project: 'Alpha', teamId: 'exmanager:Absent' }] },
      { ...fixture(), teams: [{ id: 'relay-scope:Crew A', name: 'Crew A' }] },
      { ...fixture(), teams: [{ id: 'exmanager: Crew A', name: ' Crew A' }] },
    ]) expect(parseOwnerTeamSnapshot(value)).toBeNull();
  });
  it('requires an exact source identity, revision and real UTC observation time without a future claim', () => {
    const now = Date.parse('2026-01-02T00:00:00.000Z');
    for (const patch of [
      { sourceAppId: 'not-an-app' }, { sourceRevision: 'main' },
      { observedAt: '2026-01-01T10:00:00+03:00' },
      { observedAt: '2026-02-31T10:00:00.000Z' },
      { observedAt: '2026-01-03T10:00:00.000Z' },
    ]) expect(parseOwnerTeamSnapshot({ ...fixture(), ...patch }, now)).toBeNull();
  });
  it('returns unknown for absent, malformed and oversized files without touching task contents', () => {
    const task = path.join(root, 'existing.md'); fs.writeFileSync(task, 'unchanged synthetic task');
    expect(readOwnerTeamCatalogSnapshot(root, ['Alpha'])).toBeNull();
    const filename = write(fixture());
    fs.writeFileSync(filename, '{broken'); expect(readOwnerTeamCatalogSnapshot(root, ['Alpha'])).toBeNull();
    fs.writeFileSync(filename, ' '.repeat(128 * 1024 + 1)); expect(readOwnerTeamCatalogSnapshot(root, ['Alpha'])).toBeNull();
    expect(fs.readFileSync(task, 'utf8')).toBe('unchanged synthetic task');
  });
  it('does not follow a snapshot leaf symlink', () => {
    const external = path.join(root, 'other.json'); fs.writeFileSync(external, JSON.stringify(fixture()));
    const filename = path.join(root, OWNER_TEAM_SNAPSHOT_RELATIVE_PATH);
    fs.mkdirSync(path.dirname(filename)); fs.symlinkSync(external, filename);
    expect(readOwnerTeamCatalogSnapshot(root, ['Alpha'])).toBeNull();
  });
});

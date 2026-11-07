import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { KeeperCredentialStoreError, keeperCredentialForUser } from './keeper-credentials';

let authDir: string;

function writeCredentials(content: string, mode: number = 0o600): void {
  const filePath = path.join(authDir, 'keeper-credentials.json');
  fs.writeFileSync(filePath, content, { mode });
  fs.chmodSync(filePath, mode);
}

beforeEach(() => {
  authDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-creds-'));
  process.env.KANBAN_AUTH_DIR = authDir;
});

afterEach(() => {
  fs.rmSync(authDir, { recursive: true, force: true });
  delete process.env.KANBAN_AUTH_DIR;
});

describe('per-user Keeper credential store (protected auth root)', () => {
  test('missing file means nobody is connected', async () => {
    expect(await keeperCredentialForUser('nikita')).toBeNull();
  });

  test('resolves the operator-managed per-user entry', async () => {
    writeCredentials(JSON.stringify({
      version: 1,
      credentials: {
        nikita: {
          bearer: 'kpr_nikita_token',
          calendarId: 'cal-nikita',
          projectCalendars: { QA: 'cal-qa-nikita' },
        },
        oleg: { bearer: 'kpr_oleg_token', calendarId: 'cal-oleg' },
      },
    }));
    expect(await keeperCredentialForUser('nikita')).toEqual({
      bearer: 'kpr_nikita_token',
      calendarId: 'cal-nikita',
      projectCalendars: { QA: 'cal-qa-nikita' },
    });
    expect(await keeperCredentialForUser('oleg')).toEqual({ bearer: 'kpr_oleg_token', calendarId: 'cal-oleg' });
    expect(await keeperCredentialForUser('stranger')).toBeNull();
  });

  test('fails closed on malformed per-project calendar mapping', async () => {
    writeCredentials(JSON.stringify({ version: 1, credentials: { nikita: { bearer: 'kpr_x', calendarId: 'cal', projectCalendars: { QA: '' } } } }));
    await expect(keeperCredentialForUser('nikita')).rejects.toBeInstanceOf(KeeperCredentialStoreError);
    writeCredentials(JSON.stringify({ version: 1, credentials: { nikita: { bearer: 'kpr_x', calendarId: 'cal', projectCalendars: [] } } }));
    await expect(keeperCredentialForUser('nikita')).rejects.toBeInstanceOf(KeeperCredentialStoreError);
    writeCredentials(JSON.stringify({ version: 1, credentials: { nikita: { bearer: 'kpr_x', calendarId: 'cal', projectCalendars: 'QA' } } }));
    await expect(keeperCredentialForUser('nikita')).rejects.toBeInstanceOf(KeeperCredentialStoreError);
  });

  test('fails closed on a group/other-readable file instead of serving secrets', async () => {
    writeCredentials(JSON.stringify({ version: 1, credentials: { nikita: { bearer: 'kpr_x', calendarId: 'cal' } } }), 0o644);
    await expect(keeperCredentialForUser('nikita')).rejects.toBeInstanceOf(KeeperCredentialStoreError);
    writeCredentials(JSON.stringify({ version: 1, credentials: { nikita: { bearer: 'kpr_x', calendarId: 'cal' } } }), 0o604);
    await expect(keeperCredentialForUser('nikita')).rejects.toBeInstanceOf(KeeperCredentialStoreError);
  });

  test('fails closed on corrupt or malformed files', async () => {
    writeCredentials('{not json');
    await expect(keeperCredentialForUser('nikita')).rejects.toBeInstanceOf(KeeperCredentialStoreError);

    writeCredentials(JSON.stringify({ version: 2, credentials: {} }));
    await expect(keeperCredentialForUser('nikita')).rejects.toBeInstanceOf(KeeperCredentialStoreError);

    writeCredentials(JSON.stringify({ version: 1, credentials: { nikita: { bearer: 'kpr_x' } } }));
    await expect(keeperCredentialForUser('nikita')).rejects.toBeInstanceOf(KeeperCredentialStoreError);

    writeCredentials(JSON.stringify({ version: 1, credentials: { nikita: { bearer: '', calendarId: 'cal' } } }));
    await expect(keeperCredentialForUser('nikita')).rejects.toBeInstanceOf(KeeperCredentialStoreError);

    writeCredentials(JSON.stringify({ version: 1, credentials: { 'bad\nuser': { bearer: 'kpr_x', calendarId: 'cal' } } }));
    await expect(keeperCredentialForUser('bad\nuser')).rejects.toBeInstanceOf(KeeperCredentialStoreError);
  });
});

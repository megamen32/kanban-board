import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const publicDir = path.join(process.cwd(), 'public');

describe('PWA notification contract', () => {
  test('publishes an installable manifest and a push-capable service worker', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(publicDir, 'manifest.webmanifest'), 'utf8')) as Record<string, unknown>;
    const serviceWorker = fs.readFileSync(path.join(publicDir, 'sw.js'), 'utf8');

    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');
    expect(manifest.icons).toBeTruthy();
    expect(serviceWorker).toContain("addEventListener('push'");
    expect(serviceWorker).toContain('showNotification');
  });
});

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseScope, type BoardScope } from './scopes';
import { verifyTotp } from './totp';

const STATE_VERSION = 1;
const PASSWORD_COST = 16_384;
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const ACCESS_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const AUTH_CODE_TTL_SECONDS = 5 * 60;

interface OwnerRecord {
  username: string;
  passwordHash: string;
  encryptedTotpSecret: string;
}

interface SessionRecord {
  username: string;
  expiresAt: number;
}

interface AuthorizationCodeRecord {
  username: string;
  clientId: string;
  redirectUri: string;
  scope: BoardScope;
  expiresAt: number;
}

interface AccessTokenRecord {
  username: string;
  clientId: string;
  scope: BoardScope;
  expiresAt: number;
}

interface AuthState {
  version: number;
  owner: OwnerRecord | null;
  sessions: Record<string, SessionRecord>;
  authorizationCodes: Record<string, AuthorizationCodeRecord>;
  accessTokens: Record<string, AccessTokenRecord>;
}

export interface OAuthAccess {
  username: string;
  clientId: string;
  scope: BoardScope;
  expiresAt: number;
}

export interface AuthStoreOptions {
  rootDir?: string;
  encryptionKey?: string;
  now?: () => number;
}

function emptyState(): AuthState {
  return { version: STATE_VERSION, owner: null, sessions: {}, authorizationCodes: {}, accessTokens: {} };
}

function tokenHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function deriveEncryptionKey(secret: string): Buffer {
  if (secret.length < 32) throw new Error('KANBAN_AUTH_SECRET must be at least 32 characters');
  return scryptSync(secret, 'kanban-auth-state-v1', 32, { N: PASSWORD_COST, r: 8, p: 1 });
}

function encryptSecret(value: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveEncryptionKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64url')).join('.');
}

function decryptSecret(value: string, secret: string): string {
  const [ivText, tagText, ciphertextText] = value.split('.');
  if (!ivText || !tagText || !ciphertextText) throw new Error('invalid encrypted auth secret');
  const decipher = createDecipheriv('aes-256-gcm', deriveEncryptionKey(secret), Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextText, 'base64url')), decipher.final()]).toString('utf8');
}

export function hashPassword(password: string): string {
  if (password.length < 12) throw new Error('password must be at least 12 characters');
  const salt = randomBytes(16);
  const digest = scryptSync(password, salt, 32, { N: PASSWORD_COST, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64url')}$${digest.toString('base64url')}`;
}

export function verifyPassword(password: string, encoded: string): boolean {
  const [, saltText, digestText] = encoded.split('$');
  if (!saltText || !digestText) return false;
  const expected = Buffer.from(digestText, 'base64url');
  const actual = scryptSync(password, Buffer.from(saltText, 'base64url'), expected.length, { N: PASSWORD_COST, r: 8, p: 1 });
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export class AuthStore {
  private readonly statePath: string;
  private readonly encryptionKey: string;
  private readonly now: () => number;

  constructor(options: AuthStoreOptions = {}) {
    this.statePath = path.join(options.rootDir ?? process.env.KANBAN_AUTH_DIR ?? path.join(process.cwd(), 'data', 'auth'), 'state.json');
    this.encryptionKey = options.encryptionKey ?? process.env.KANBAN_AUTH_SECRET ?? '';
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
  }

  isConfigured(): boolean {
    return this.load().owner !== null;
  }

  bootstrap(username: string, password: string, totpSecret: string): void {
    const state = this.load();
    if (state.owner) throw new Error('auth is already configured');
    if (!this.encryptionKey) throw new Error('KANBAN_AUTH_SECRET is required');
    state.owner = { username, passwordHash: hashPassword(password), encryptedTotpSecret: encryptSecret(totpSecret, this.encryptionKey) };
    this.save(state);
  }

  authenticate(username: string, password: string, totpCode: string): string | null {
    const state = this.load();
    if (!state.owner || !this.encryptionKey || username !== state.owner.username) return null;
    let secret: string;
    try {
      secret = decryptSecret(state.owner.encryptedTotpSecret, this.encryptionKey);
    } catch {
      return null;
    }
    if (!verifyPassword(password, state.owner.passwordHash) || !verifyTotp(secret, totpCode, this.now() * 1000)) return null;
    const raw = randomBytes(32).toString('base64url');
    state.sessions[tokenHash(raw)] = { username, expiresAt: this.now() + SESSION_TTL_SECONDS };
    this.save(state);
    return raw;
  }

  validateSession(raw: string): string | null {
    const state = this.load();
    const record = state.sessions[tokenHash(raw)];
    if (!record || record.expiresAt <= this.now()) return null;
    return record.username;
  }

  createAuthorizationCode(username: string, clientId: string, redirectUri: string, scopeText?: string): string {
    const state = this.load();
    const raw = randomBytes(32).toString('base64url');
    state.authorizationCodes[tokenHash(raw)] = {
      username,
      clientId,
      redirectUri,
      scope: parseScope(scopeText),
      expiresAt: this.now() + AUTH_CODE_TTL_SECONDS,
    };
    this.save(state);
    return raw;
  }

  exchangeAuthorizationCode(code: string, clientId: string, redirectUri: string): { accessToken: string; tokenType: 'Bearer'; scope: BoardScope; expiresIn: number } | null {
    const state = this.load();
    const hash = tokenHash(code);
    const record = state.authorizationCodes[hash];
    if (!record || record.expiresAt <= this.now() || record.clientId !== clientId || record.redirectUri !== redirectUri) return null;
    delete state.authorizationCodes[hash];
    const accessToken = randomBytes(32).toString('base64url');
    state.accessTokens[tokenHash(accessToken)] = {
      username: record.username,
      clientId,
      scope: record.scope,
      expiresAt: this.now() + ACCESS_TOKEN_TTL_SECONDS,
    };
    this.save(state);
    return { accessToken, tokenType: 'Bearer', scope: record.scope, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
  }

  validateAccessToken(raw: string): OAuthAccess | null {
    const state = this.load();
    const record = state.accessTokens[tokenHash(raw)];
    if (!record || record.expiresAt <= this.now()) return null;
    return record;
  }

  revokeAccessToken(raw: string): void {
    const state = this.load();
    delete state.accessTokens[tokenHash(raw)];
    this.save(state);
  }

  private load(): AuthState {
    if (!fs.existsSync(this.statePath)) return emptyState();
    const parsed = JSON.parse(fs.readFileSync(this.statePath, 'utf8')) as Partial<AuthState>;
    return {
      version: parsed.version ?? STATE_VERSION,
      owner: parsed.owner ?? null,
      sessions: parsed.sessions ?? {},
      authorizationCodes: parsed.authorizationCodes ?? {},
      accessTokens: parsed.accessTokens ?? {},
    };
  }

  private save(state: AuthState): void {
    fs.mkdirSync(path.dirname(this.statePath), { recursive: true, mode: 0o700 });
    const temporary = `${this.statePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(state), { mode: 0o600 });
    fs.renameSync(temporary, this.statePath);
    fs.chmodSync(this.statePath, 0o600);
  }
}

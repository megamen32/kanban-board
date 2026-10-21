import { describe, expect, it } from 'vitest';
import { createTodoMcpProjectEnsureVerifier, createTodoMcpReadScopeVerifier, createTodoMcpWriteScopeVerifier } from './todo-caller-scope';

describe('ExManager Todo MCP read-scope verifier', () => {
  it('accepts the producer Go fake-key vector and binds the exact tool and arguments', () => {
    const publicKey = 'CQEvln90W80bE4u60NKYo-uqkhyfXOomNWeffFgXfq0';
    const envelope = {
      payload: 'eyJ2IjoxLCJwdXJwb3NlIjoidG9kby1ib2FyZC1tY3AtcmVhZCIsInVzZXJJZCI6InFhLXVzZXItNDIiLCJ0b29sIjoia2FuYmFuLmxpc3QiLCJhcmdzU2hhMjU2IjoiYXJzQ1hKTEItejVFRm1zUzYxN2syWGFSZm1peWdSUnR3RWRYV3NCTm9GYyIsInByb2plY3RzIjpbImFscGhhIl0sIm93bmVyIjpmYWxzZSwiaXNzdWVkQXRNcyI6MTcwMDAwMDAwMDAwMCwiZXhwaXJlc0F0TXMiOjE3MDAwMDAxMjAwMDB9',
      signature: 'K0jkdmoHLhHAiRhTmyUMKy5Gi3nzfHUCJuFqtkiOcDhqL8L1J_wq3BUau5cvjrCHOxrcFhS42ATAOX7GUCUYBw',
    };
    const verifyScope = createTodoMcpReadScopeVerifier(publicKey, { now: () => 1_700_000_001_000 });
    expect(verifyScope).toBeDefined();
    expect(verifyScope!(envelope, 'kanban.list', { project: 'alpha', limit: 1000 })).toMatchObject({
      userId: 'qa-user-42', tool: 'kanban.list', projects: ['alpha'], owner: false,
    });
    expect(() => verifyScope!(envelope, 'kanban.read', { project: 'alpha', limit: 1000 })).toThrow();
    expect(() => verifyScope!(envelope, 'kanban.list', { project: 'beta', limit: 1000 })).toThrow();
    expect(() => verifyScope!({ ...envelope, signature: `${envelope.signature.slice(0, -1)}A` }, 'kanban.list', { project: 'alpha', limit: 1000 })).toThrow();
  });

  it('fails closed when no public-key pin exists and rejects expired signatures', () => {
    expect(createTodoMcpReadScopeVerifier(undefined)).toBeUndefined();
    const verifyScope = createTodoMcpReadScopeVerifier('CQEvln90W80bE4u60NKYo-uqkhyfXOomNWeffFgXfq0', { now: () => 1_700_000_121_000 });
    const envelope = {
      payload: 'eyJ2IjoxLCJwdXJwb3NlIjoidG9kby1ib2FyZC1tY3AtcmVhZCIsInVzZXJJZCI6InFhLXVzZXItNDIiLCJ0b29sIjoia2FuYmFuLmxpc3QiLCJhcmdzU2hhMjU2IjoiYXJzQ1hKTEItejVFRm1zUzYxN2syWGFSZm1peWdSUnR3RWRYV3NCTm9GYyIsInByb2plY3RzIjpbImFscGhhIl0sIm93bmVyIjpmYWxzZSwiaXNzdWVkQXRNcyI6MTcwMDAwMDAwMDAwMCwiZXhwaXJlc0F0TXMiOjE3MDAwMDAxMjAwMDB9',
      signature: 'K0jkdmoHLhHAiRhTmyUMKy5Gi3nzfHUCJuFqtkiOcDhqL8L1J_wq3BUau5cvjrCHOxrcFhS42ATAOX7GUCUYBw',
    };
    expect(() => verifyScope!(envelope, 'kanban.list', { project: 'alpha', limit: 1000 })).toThrow(/expired/);
  });

  it('accepts the producer Go fake-key write vector and binds the exact mutation arguments', () => {
    const verifyWrite = createTodoMcpWriteScopeVerifier('CQEvln90W80bE4u60NKYo-uqkhyfXOomNWeffFgXfq0', { now: () => 1_700_000_001_000 });
    const envelope = {
      payload: 'eyJ2IjoxLCJwdXJwb3NlIjoidG9kby1ib2FyZC1tY3Atd3JpdGUiLCJ1c2VySWQiOiJxYS11c2VyLTQyIiwidG9vbCI6ImthbmJhbi5jaGFuZ2UiLCJhcmdzU2hhMjU2IjoiTEUxWVoyMHJuUkNOVVlLOUgwU2phb2VyRjZ4QmI5S0FfRUNiSG00dk1YSSIsInByb2plY3RzIjpbImFscGhhIl0sIm93bmVyIjpmYWxzZSwiaXNzdWVkQXRNcyI6MTcwMDAwMDAwMDAwMCwiZXhwaXJlc0F0TXMiOjE3MDAwMDAxMjAwMDB9',
      signature: 'a_-bNLFirhbcdt6Smdml9RgyamPJUefqbm-1WeAkyWhXCkJDo8hlljAIx2ZN8OeopFwBRN1XjGKA3WKqr49HDw',
    };
    const args = { mode: 'edit', cardId: '39e04120-97e5-4302-9756-5072de10c84c', expectedVersion: 11, title: 'Rename task' };
    expect(verifyWrite).toBeDefined();
    expect(verifyWrite!(envelope, args)).toMatchObject({ userId: 'qa-user-42', tool: 'kanban.change', projects: ['alpha'] });
    expect(() => verifyWrite!(envelope, { ...args, title: 'Different mutation' })).toThrow(/different arguments/);
  });

  it('accepts only the admin project-ensure callback arguments under its own purpose', () => {
    const verifyEnsure = createTodoMcpProjectEnsureVerifier('CQEvln90W80bE4u60NKYo-uqkhyfXOomNWeffFgXfq0', { now: () => 1_700_000_001_000 });
    const envelope = {
      payload: 'eyJ2IjoxLCJwdXJwb3NlIjoidG9kby1ib2FyZC1tY3AtcHJvamVjdC1lbnN1cmUiLCJ1c2VySWQiOiJxYS1hZG1pbi00MiIsInRvb2wiOiJrYW5iYW4ucHJvamVjdC5lbnN1cmUiLCJhcmdzU2hhMjU2Ijoia0xVT0xVbl9GNWwxejI1Y3JoNEhoZTZIXzJpdE9vR1NJSzJsTElxaGlOQSIsImlzc3VlZEF0TXMiOjE3MDAwMDAwMDAwMDAsImV4cGlyZXNBdE1zIjoxNzAwMDAwMTIwMDAwfQ',
      signature: 'tKhpgB42VEwKJco-J8u4htAglJAwJ3VuSSyAyJw3BcmgcYANL4YYJ9ITHWqx3XpYInhHNuPDlGopfiJFwtoPAg',
    };
    const args = { externalKey: 'exmanager:fixture:binding', name: 'Empty fixture' };
    expect(verifyEnsure).toBeDefined();
    expect(verifyEnsure!(envelope, args)).toMatchObject({ userId: 'qa-admin-42', tool: 'kanban.project.ensure' });
    expect(() => verifyEnsure!(envelope, { ...args, name: 'Changed name' })).toThrow(/different arguments/);
  });
});

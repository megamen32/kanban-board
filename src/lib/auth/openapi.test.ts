import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('ChatGPT action schema', () => {
  it('publishes the scoped OAuth Kanban contract', () => {
    const schema = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public', 'openapi.json'), 'utf8')) as {
      paths: Record<string, Record<string, { operationId?: string }>>;
      components: { securitySchemes: Record<string, { flows: { authorizationCode: { scopes: Record<string, string> } } }> };
    };

    expect(schema.paths['/api/kanban/cards'].get.operationId).toBe('listCards');
    expect(schema.paths['/api/kanban/cards'].post.operationId).toBe('createCard');
    expect(schema.paths['/api/kanban/cards/{id}'].patch.operationId).toBe('updateCard');
    expect(schema.components.securitySchemes.kanbanOAuth.flows.authorizationCode.scopes).toEqual({
      'kanban:work': 'Read and manage work tasks (default)',
      'kanban:personal': 'Read and manage personal tasks (explicit choice only)',
    });
  });
});

import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { NextRequest, NextResponse } from 'next/server';
import { identityFromRequest } from '../../lib/auth/request';
import { createKanbanMcpServer } from '../../lib/mcp/kanban-server';
import { configuredSourceAdmissionVerifier } from '../../lib/mcp/source-resolver';
import {
  configuredTodoMcpProjectEnsureVerifier,
  configuredTodoMcpReadScopeVerifier,
  configuredTodoMcpWriteScopeVerifier,
} from '../../lib/mcp/todo-caller-scope';

export const dynamic = 'force-dynamic';

function unauthorized() {
  return NextResponse.json(
    { error: 'authentication required' },
    { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } },
  );
}

function methodNotAllowed() {
  return NextResponse.json({ error: 'MCP uses POST for JSON-RPC requests' }, { status: 405 });
}

export async function POST(request: NextRequest) {
  const identity = identityFromRequest(request);
  if (!identity) return unauthorized();

  const service = identity.accessToken;
  const trustedWorkService = service?.clientId === 'exmanager-airlock-service'
    && service.username === 'exmanager-service' && service.scope === 'work';
  const verifySourceAdmission = trustedWorkService && identity.scope === 'work'
    ? configuredSourceAdmissionVerifier()
    : undefined;
  const requireExManagerReadScope = trustedWorkService && identity.scope === 'work';
  const verifyExManagerReadScope = requireExManagerReadScope
    ? configuredTodoMcpReadScopeVerifier()
    : undefined;
  const requireExManagerWriteScope = trustedWorkService && identity.scope === 'work';
  const verifyExManagerWriteScope = requireExManagerWriteScope
    ? configuredTodoMcpWriteScopeVerifier()
    : undefined;
  const requireExManagerProjectEnsureScope = trustedWorkService && identity.scope === 'work';
  const verifyExManagerProjectEnsureScope = requireExManagerProjectEnsureScope
    ? configuredTodoMcpProjectEnsureVerifier()
    : undefined;
  const server = createKanbanMcpServer(identity.scope, {
    allowConfirmedOwnerCommands: trustedWorkService,
    allowInternalTeamCommands: trustedWorkService,
    requireExManagerReadScope,
    ...(verifyExManagerReadScope ? { verifyExManagerReadScope } : {}),
    requireExManagerWriteScope,
    ...(verifyExManagerWriteScope ? { verifyExManagerWriteScope } : {}),
    requireExManagerProjectEnsureScope,
    ...(verifyExManagerProjectEnsureScope ? { verifyExManagerProjectEnsureScope } : {}),
    ...(verifySourceAdmission ? { verifySourceAdmission } : {}),
  });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  try {
    await server.connect(transport);
    return await transport.handleRequest(request);
  } catch (error) {
    console.error('[mcp] request failed:', error);
    return NextResponse.json({ error: 'MCP request failed' }, { status: 500 });
  } finally {
    await transport.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
}

export async function GET(request: NextRequest) {
  if (!identityFromRequest(request)) return unauthorized();
  return methodNotAllowed();
}

export async function DELETE(request: NextRequest) {
  if (!identityFromRequest(request)) return unauthorized();
  return methodNotAllowed();
}

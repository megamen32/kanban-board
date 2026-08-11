import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { NextRequest, NextResponse } from 'next/server';
import { identityFromRequest } from '../../lib/auth/request';
import { createKanbanMcpServer } from '../../lib/mcp/kanban-server';

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

  const server = createKanbanMcpServer(identity.scope);
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

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const HERDER_MCP_URL = 'https://agent.bezrabotnyi.com/airlock-mcp';
const MAX_RESPONSE_BYTES = 1_000_000;

export type HerderToolName = 'fleet_node_info' | 'fleet_create_session' | 'fleet_session_view' | 'agent_info' | 'send_message' | 'todo_task_direct' | 'todo_task_stop';
export interface HerderToolResult {
  content: Array<{ type: string; text?: string }>;
  structuredContent?: unknown;
  isError?: boolean;
}

/** Call only the existing protected owner MCP; the token never leaves server memory. */
export async function callOwnerHerderTool(name: HerderToolName, args: Record<string, unknown>, timeoutMs = 30_000): Promise<HerderToolResult> {
  const token = process.env.AGENT_HERDER_HTTP_TOKEN?.trim();
  if (!token) throw new Error('task_execution_transport_unconfigured');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const transport = new StreamableHTTPClientTransport(new URL(HERDER_MCP_URL), {
    requestInit: { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal },
    fetch: async (input, init) => fetch(input, { ...init, redirect: 'error' }),
  });
  const client = new Client({ name: 'excode-task-execution', version: '1.0.0' });
  try {
    await client.connect(transport);
    const result = await client.callTool({ name, arguments: args });
    const bytes = Buffer.byteLength(JSON.stringify(result));
    if (bytes > MAX_RESPONSE_BYTES) throw new Error('task_execution_response_limit');
    return result as HerderToolResult;
  } catch {
    // MCP failures can happen after native admission. Callers must record UNKNOWN
    // and reconcile the same operation; never infer that the action did not run.
    throw new Error('task_execution_transport_unknown');
  } finally {
    clearTimeout(timer);
    await client.close().catch(() => undefined);
  }
}

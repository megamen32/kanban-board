import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  readResource: vi.fn(),
  close: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class {
    connect = mocks.connect;
    readResource = mocks.readResource;
    close = mocks.close;
  },
}));
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: class {},
}));

import { readOwnerHerderResource } from './task-execution-client';

describe('readOwnerHerderResource', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('AGENT_HERDER_HTTP_TOKEN', 'test-only-token');
    mocks.connect.mockResolvedValue(undefined);
    mocks.close.mockResolvedValue(undefined);
    mocks.readResource.mockResolvedValue({ contents: [] });
  });

  afterEach(() => vi.unstubAllEnvs());

  it('reads the exact OpenCode first-user resource needed to recover an accepted input', async () => {
    const uri = 'herder://sessions/opencode/ses_bound-session/first-user-message';

    await expect(readOwnerHerderResource(uri)).resolves.toEqual({ contents: [] });

    expect(mocks.readResource).toHaveBeenCalledWith({ uri });
  });

  it('does not widen first-user reads to other harnesses or unrelated session resources', async () => {
    await expect(readOwnerHerderResource('herder://sessions/codex/session-1/first-user-message'))
      .rejects.toThrow('task_execution_resource_out_of_scope');
    await expect(readOwnerHerderResource('herder://sessions/opencode/session-1/profile'))
      .rejects.toThrow('task_execution_resource_out_of_scope');

    expect(mocks.readResource).not.toHaveBeenCalled();
  });
});

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { POST as mcpPost } from '../app/api/mcp/route';

const TEST_TOKEN = 'test-mcp-secret-token-123456';

function makeMcpRequest(body: unknown, options: { token?: string; origin?: string } = {}) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
  };
  if (options.token !== undefined) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  if (options.origin !== undefined) {
    headers.Origin = options.origin;
  }
  return new Request('http://localhost:3000/api/mcp', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

async function withAuthToken<T>(fn: () => Promise<T>): Promise<T> {
  const previousToken = process.env.MCP_AUTH_TOKEN;
  process.env.MCP_AUTH_TOKEN = TEST_TOKEN;
  try {
    return await fn();
  } finally {
    if (previousToken === undefined) delete process.env.MCP_AUTH_TOKEN;
    else process.env.MCP_AUTH_TOKEN = previousToken;
  }
}

describe('mcp route', { concurrency: false }, () => {
  test('unauthorized rejection without token or with invalid token', async () => {
    await withAuthToken(async () => {
      const noTokenRes = await mcpPost(makeMcpRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }));
      assert.equal(noTokenRes.status, 401);
      assert.equal((await noTokenRes.json()).error, 'Unauthorized.');

      const wrongTokenRes = await mcpPost(makeMcpRequest(
        { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
        { token: 'wrong-token' },
      ));
      assert.equal(wrongTokenRes.status, 401);
      assert.equal((await wrongTokenRes.json()).error, 'Unauthorized.');
    });
  });

  test('rejects when production lacks MCP_AUTH_TOKEN', async () => {
    const previousEnv = process.env.NODE_ENV;
    const previousToken = process.env.MCP_AUTH_TOKEN;
    Reflect.set(process.env, 'NODE_ENV', 'production');
    delete process.env.MCP_AUTH_TOKEN;
    try {
      const res = await mcpPost(makeMcpRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }));
      assert.equal(res.status, 503);
      assert.equal((await res.json()).error, 'MCP authentication is not configured.');
    } finally {
      if (previousEnv === undefined) Reflect.deleteProperty(process.env, 'NODE_ENV');
      else Reflect.set(process.env, 'NODE_ENV', previousEnv);
      if (previousToken === undefined) delete process.env.MCP_AUTH_TOKEN;
      else process.env.MCP_AUTH_TOKEN = previousToken;
    }
  });

  test('rejects cross-origin requests', async () => {
    await withAuthToken(async () => {
      const res = await mcpPost(makeMcpRequest(
        { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
        { token: TEST_TOKEN, origin: 'https://evil.example.com' },
      ));
      assert.equal(res.status, 403);
      assert.equal((await res.json()).error, 'Cross-origin request rejected.');
    });
  });

  test('handles initialization', async () => {
    await withAuthToken(async () => {
      const res = await mcpPost(makeMcpRequest({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'route-test-client', version: '1.0.0' },
        },
      }, { token: TEST_TOKEN }));

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.jsonrpc, '2.0');
      assert.equal(data.id, 1);
      assert.ok(data.result);
      assert.equal(data.result.serverInfo?.name, 'homeflow-household');
      assert.equal(data.result.protocolVersion, '2025-11-25');
    });
  });

  test('lists tools', async () => {
    await withAuthToken(async () => {
      const res = await mcpPost(makeMcpRequest({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      }, { token: TEST_TOKEN }));

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.jsonrpc, '2.0');
      assert.equal(data.id, 2);
      assert.ok(Array.isArray(data.result?.tools));
      const toolNames = data.result.tools.map((tool: { name: string }) => tool.name);
      assert.ok(toolNames.includes('get_household_context'));
      assert.ok(toolNames.includes('create_household_plan'));
      assert.ok(toolNames.includes('approve_household_plan'));
      assert.ok(toolNames.includes('execute_household_plan'));
    });
  });

  test('executes authenticated tool call', async () => {
    await withAuthToken(async () => {
      const res = await mcpPost(makeMcpRequest({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'get_household_context',
          arguments: {},
        },
      }, { token: TEST_TOKEN }));

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.jsonrpc, '2.0');
      assert.equal(data.id, 3);
      assert.ok(Array.isArray(data.result?.content));
      assert.ok(data.result.content.some((item: { type: string; text?: string }) => item.text?.includes('household_demo')));
    });
  });
});

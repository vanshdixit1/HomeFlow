import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';

const endpoint = new URL(process.env.MCP_URL || 'http://127.0.0.1:3001/mcp');
const transport = new StreamableHTTPClientTransport(endpoint, {
  requestInit: {
    headers: process.env.MCP_AUTH_TOKEN ? { Authorization: `Bearer ${process.env.MCP_AUTH_TOKEN}` } : undefined,
  },
});
const client = new Client({ name: 'homeflow-qualification-smoke', version: '1.0.0' });

async function main() {
  try {
    await client.connect(transport);
    const result = await client.listTools();
    const toolNames = new Set(result.tools.map(tool => tool.name));

    assert.equal(transport.protocolVersion, LATEST_PROTOCOL_VERSION, 'MCP protocol version must match the SDK latest version');
    for (const requiredTool of ['get_household_context', 'create_household_plan', 'approve_household_plan', 'execute_household_plan']) {
      assert.ok(toolNames.has(requiredTool), `Missing required MCP tool: ${requiredTool}`);
    }
    const context = await client.callTool({ name: 'get_household_context', arguments: {} });
    assert.equal(context.isError, undefined, 'Household context tool should complete successfully');
    const content = context.content as Array<{ type: string; text?: string }>;
    assert.ok(content.some(item => item.type === 'text' && item.text?.includes('household_demo')));

    console.log(`MCP smoke check passed: ${transport.protocolVersion}, ${result.tools.length} tools, household context read, ${client.getServerVersion()?.name}`);
  } finally {
    await client.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
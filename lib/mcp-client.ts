import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
export async function mcpCall(tool: string, args: Record<string, unknown> = {}) {
  const client = new Client({ name: 'homeflow-web', version: '0.1.0' });
  const transport = new StreamableHTTPClientTransport(
    new URL(process.env.MCP_URL || 'http://127.0.0.1:3001/mcp'),
    {
      requestInit: {
        signal: AbortSignal.timeout(15_000),
        headers: process.env.MCP_AUTH_TOKEN ? { Authorization: `Bearer ${process.env.MCP_AUTH_TOKEN}` } : undefined,
      },
    },
  );
  try {
    await client.connect(transport);
    const result = await client.request({ method: 'tools/call', params: { name: tool, arguments: args } }, CallToolResultSchema);
    const text = result.content.find(item => item.type === 'text')?.text;
    if (result.isError) throw new Error(text || `MCP tool ${tool} failed.`);
    if (!text) return result;
    try {
      return JSON.parse(text);
    } catch {
      return { message: text };
    }
  } finally {
    await client.close().catch(() => undefined);
  }
}
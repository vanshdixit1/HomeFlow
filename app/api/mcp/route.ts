import { NextResponse } from 'next/server';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { constantTimeEqual } from '../../../lib/auth';
import { getServer } from '../../../server/index';

export const runtime = 'nodejs';
export const maxDuration = 15;

async function handle(request: Request): Promise<Response> {
  const configuredToken = process.env.MCP_AUTH_TOKEN;
  if (process.env.NODE_ENV === 'production' && !configuredToken) {
    return NextResponse.json({ error: 'MCP authentication is not configured.' }, { status: 503 });
  }
  if (configuredToken) {
    const authorization = request.headers.get('authorization') || '';
    const supplied = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!constantTimeEqual(supplied, configuredToken)) {
      return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
    }
  }
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) {
    return NextResponse.json({ error: 'Cross-origin request rejected.' }, { status: 403 });
  }

  try {
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      maxRequestBodySize: 64 * 1024,
      keepAliveMs: 0,
    });
    await getServer().connect(transport);
    const response = await transport.handleRequest(request);
    const headers = new Headers(response.headers);
    headers.set('Cache-Control', 'no-store');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  } catch {
    return NextResponse.json({ error: 'MCP request failed.' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;

import { NextResponse } from 'next/server';
import { z } from 'zod/v4';
import { mcpCall } from '../../../../lib/mcp-client';
import { requireApiSession } from '../../../../lib/auth';

const schema = z.object({ planId: z.string().min(1).max(64), version: z.number().int().positive(), token: z.string().min(1).max(512) });

export async function POST(req: Request) {
  const authFailure = requireApiSession(req);
  if (authFailure) return authFailure;
  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Send a valid execution request.' }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'planId, version, and token are required.' }, { status: 400 });
  try {
    const result = await mcpCall('execute_household_plan', parsed.data);
    return NextResponse.json({ ok: true, ...result });
  } catch (error: unknown) {
    const message = process.env.NODE_ENV === 'production' ? 'Execution failed.' : error instanceof Error ? error.message : 'Execution failed.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
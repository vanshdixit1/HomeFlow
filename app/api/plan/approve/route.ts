import { NextResponse } from 'next/server';
import { z } from 'zod/v4';
import { mcpCall } from '../../../../lib/mcp-client';
import { requireApiSession } from '../../../../lib/auth';

const schema = z.object({ planId: z.string().min(1).max(64), version: z.number().int().positive() });

export async function POST(req: Request) {
  const authFailure = requireApiSession(req);
  if (authFailure) return authFailure;
  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Send a valid approval request.' }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'planId and version are required.' }, { status: 400 });
  try {
    const result = await mcpCall('approve_household_plan', parsed.data);
    return NextResponse.json({ ok: true, ...result });
  } catch (error: unknown) {
    const message = process.env.NODE_ENV === 'production' ? 'Approval failed.' : error instanceof Error ? error.message : 'Approval failed.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
import { NextResponse } from 'next/server';
import { z } from 'zod/v4';
import { mcpCall } from '../../../../lib/mcp-client';
import { requireApiSession } from '../../../../lib/auth';

const schema = z.object({ planId: z.string().min(1).max(64) });

export async function POST(req: Request) {
  const authFailure = requireApiSession(req);
  if (authFailure) return authFailure;
  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Send a valid cancellation request.' }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'planId is required.' }, { status: 400 });
  try {
    await mcpCall('cancel_household_plan', parsed.data);
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const message = process.env.NODE_ENV === 'production' ? 'Cancel failed.' : error instanceof Error ? error.message : 'Cancel failed.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
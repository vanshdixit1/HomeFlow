import { NextResponse } from 'next/server';
import { z } from 'zod/v4';
import { mcpCall } from '../../../../lib/mcp-client';
import { requireApiSession } from '../../../../lib/auth';

const schema = z.object({
  id: z.string().min(1),
  status: z.enum(['open', 'completed']),
});

export async function POST(request: Request) {
  const authFailure = requireApiSession(request);
  if (authFailure) return authFailure;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Send a valid task update.' }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'A task id and valid status are required.' }, { status: 400 });

  try {
    const task = await mcpCall('update_task', parsed.data);
    if (task.status === 'not_found') return NextResponse.json({ error: 'Task was not found.' }, { status: 404 });
    return NextResponse.json({ ok: true, task });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not update task.' }, { status: 502 });
  }
}
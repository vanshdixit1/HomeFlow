import { NextResponse } from 'next/server';
import { z } from 'zod/v4';
import { authConfigurationError, constantTimeEqual, createSessionToken, sessionCookie } from '../../../../lib/auth';

const schema = z.object({ password: z.string().min(1).max(256) });
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const attemptsByAddress = new Map<string, { windowStartedAt: number; failedAttempts: number }>();

function getAttemptWindow(request: Request, now: number) {
  const forwardedAddress = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const address = request.headers.get('x-real-ip')?.trim() || forwardedAddress || 'unknown';
  let attempt = attemptsByAddress.get(address);
  if (!attempt || now - attempt.windowStartedAt >= WINDOW_MS) {
    attempt = { windowStartedAt: now, failedAttempts: 0 };
    attemptsByAddress.set(address, attempt);
  }
  if (attemptsByAddress.size > 2048) {
    for (const [key, entry] of attemptsByAddress) {
      if (now - entry.windowStartedAt >= WINDOW_MS) attemptsByAddress.delete(key);
    }
    while (attemptsByAddress.size > 2048) attemptsByAddress.delete(attemptsByAddress.keys().next().value!);
  }
  return attempt;
}

export async function POST(request: Request) {
  const configurationError = authConfigurationError();
  if (configurationError) return NextResponse.json({ error: 'Production access is not configured.' }, { status: 503 });

  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: 'Cross-origin request rejected.' }, { status: 403 });

  const now = Date.now();
  const attempt = getAttemptWindow(request, now);
  if (attempt.failedAttempts >= MAX_ATTEMPTS) return NextResponse.json({ error: 'Too many login attempts. Try again later.' }, { status: 429 });

  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Send a valid login request.' }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success || !constantTimeEqual(parsed.data.password, process.env.HOMEFLOW_ACCESS_PASSWORD!)) {
    attempt.failedAttempts++;
    return NextResponse.json({ error: 'Incorrect password.' }, { status: 401 });
  }

  attempt.failedAttempts = 0;
  const response = NextResponse.json({ ok: true });
  response.headers.set('Set-Cookie', sessionCookie(createSessionToken(process.env.HOMEFLOW_SESSION_SECRET!), process.env.NODE_ENV === 'production'));
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
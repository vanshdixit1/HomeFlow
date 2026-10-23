import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';

export const SESSION_COOKIE_NAME = 'homeflow_session';
export const SESSION_TTL_SECONDS = 4 * 60 * 60;

export function authConfigurationError(): string | null {
  if (!process.env.HOMEFLOW_ACCESS_PASSWORD || process.env.HOMEFLOW_ACCESS_PASSWORD.length < 16) {
    return 'HOMEFLOW_ACCESS_PASSWORD must contain at least 16 characters.';
  }
  if (!process.env.HOMEFLOW_SESSION_SECRET || process.env.HOMEFLOW_SESSION_SECRET.length < 32) {
    return 'HOMEFLOW_SESSION_SECRET must contain at least 32 characters.';
  }
  return null;
}

export function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function createSessionToken(secret: string, now = Date.now()): string {
  const payload = `v1.${Math.floor(now / 1000) + SESSION_TTL_SECONDS}`;
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function isValidSessionToken(token: string | undefined, secret: string, now = Date.now()): boolean {
  if (!token) return false;
  const [version, expiryValue, signature, extra] = token.split('.');
  if (version !== 'v1' || !expiryValue || !signature || extra !== undefined) return false;
  const expiry = Number(expiryValue);
  if (!Number.isSafeInteger(expiry) || expiry <= Math.floor(now / 1000)) return false;
  const expected = createHmac('sha256', secret).update(`${version}.${expiryValue}`).digest('base64url');
  return constantTimeEqual(signature, expected);
}

function readCookie(request: Request, name: string): string | undefined {
  const cookieHeader = request.headers.get('cookie');
  if (!cookieHeader) return undefined;
  for (const entry of cookieHeader.split(';')) {
    const separator = entry.indexOf('=');
    if (separator < 0 || entry.slice(0, separator).trim() !== name) continue;
    return entry.slice(separator + 1).trim();
  }
  return undefined;
}

export function requireApiSession(request: Request): NextResponse | null {
  if (process.env.NODE_ENV !== 'production') return null;
  const configurationError = authConfigurationError();
  if (configurationError) return NextResponse.json({ error: 'Production authentication is not configured.' }, { status: 503 });

  const secret = process.env.HOMEFLOW_SESSION_SECRET!;
  if (!isValidSessionToken(readCookie(request, SESSION_COOKIE_NAME), secret)) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) {
    return NextResponse.json({ error: 'Cross-origin request rejected.' }, { status: 403 });
  }
  return null;
}

export function sessionCookie(token: string, secure: boolean): string {
  return `${SESSION_COOKIE_NAME}=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}${secure ? '; Secure' : ''}`;
}
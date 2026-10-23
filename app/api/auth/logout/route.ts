import { NextResponse } from 'next/server';
import { SESSION_COOKIE_NAME } from '../../../../lib/auth';

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.headers.set('Set-Cookie', `${SESSION_COOKIE_NAME}=; HttpOnly; Secure; Path=/; SameSite=Strict; Max-Age=0`);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
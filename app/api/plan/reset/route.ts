import { NextResponse } from 'next/server';
import { getStore } from '../../../../lib/store';
import { requireApiSession } from '../../../../lib/auth';

export async function POST(request: Request) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Demo reset is unavailable in production.' }, { status: 404 });
  }
  const authFailure = requireApiSession(request);
  if (authFailure) return authFailure;
  try {
    const state = getStore().reset();
    return NextResponse.json({ ok: true, household: state });
  } catch (error) {
    console.error('Failed to reset household:', error);
    return NextResponse.json({ error: 'Failed to reset household.' }, { status: 500 });
  }
}
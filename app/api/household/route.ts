import { NextResponse } from 'next/server';
import { mcpCall } from '../../../lib/mcp-client';
import { requireApiSession } from '../../../lib/auth';

export async function GET(request: Request) {
  const authFailure = requireApiSession(request);
  if (authFailure) return authFailure;
  try {
    const body = await mcpCall('get_household_context');
    const household = body.household;
    return NextResponse.json({
      id: household.id,
      name: household.name,
      timezone: household.timezone,
      members: household.members,
      preferences: household.preferences,
      inventory: body.inventory,
      tasks: body.tasks,
      shopping: body.shopping,
      reminders: body.reminders,
      plans: body.plans ?? body.upcomingEvents,
      events: body.events ?? [],
      history: body.history,
    });
  } catch {
    return NextResponse.json({ error: 'Failed to load household context.' }, { status: 502 });
  }
}
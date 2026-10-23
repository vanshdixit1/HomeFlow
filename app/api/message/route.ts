import { NextResponse } from 'next/server';
import { z } from 'zod/v4';
import { parseReminderRequest, parseRequest } from '../../../lib/planner';
import { analyzeIntent, generateHelpfulResponse } from '../../../lib/enhanced-planner';
import { mcpCall } from '../../../lib/mcp-client';
import { requireApiSession } from '../../../lib/auth';

const schema = z.object({ message: z.string().trim().min(1).max(4000) });

export async function POST(req: Request) {
  const authFailure = requireApiSession(req);
  if (authFailure) return authFailure;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Send a valid JSON request with a message.' }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Message is required.' }, { status: 400 });

  try {
    const message = parsed.data.message.trim();
    if (!message) return NextResponse.json({ error: 'Message is required.' }, { status: 400 });
    const intent = analyzeIntent(message);

    switch (intent.type) {
      case 'create_plan': {
        let request: Awaited<ReturnType<typeof parseRequest>>;
        try {
          request = await parseRequest(message);
        } catch (error) {
          return NextResponse.json({
            ok: true,
            type: 'clarification',
            message: error instanceof Error ? error.message : 'Please provide the guest count, date, and time for your event.',
          });
        }
        const { guestCount, startsAt, eventType } = request;
        const plan = await mcpCall('create_household_plan', { guestCount, startsAt, eventType });
        const normalizedPlan = {
          ...plan,
          id: plan.id ?? plan.planId,
          results: plan.results ?? [],
          conflictWarnings: plan.conflictWarnings ?? [],
          reasoning: plan.reasoning ?? '',
        };
        return NextResponse.json({
          ok: true,
          type: 'plan',
          plan: normalizedPlan,
          explanation: normalizedPlan.explanation || 'Checked household context and prepared a draft plan.'
        });
      }

      case 'add_task':
        if (intent.entities.taskTitle) {
          const task = await mcpCall('create_task', {
            title: intent.entities.taskTitle,
            detail: intent.entities.taskDetail || '',
          });
          return NextResponse.json({
            ok: true,
            type: 'task',
            message: task.status === 'already_exists' ? `That task is already on your list: ${intent.entities.taskTitle}` : `Added task: ${intent.entities.taskTitle}`,
            task,
          });
        }
        return NextResponse.json({
          ok: true,
          type: 'clarification',
          message: intent.clarification || 'What task would you like to add?',
        });

      case 'update_task': {
        const household = await mcpCall('get_household_context');
        const oldTitle = intent.entities.taskDetail?.trim().toLowerCase();
        const matches = (household.tasks || []).filter((task: { title: string }) => task.title.trim().toLowerCase() === oldTitle);
        if (matches.length !== 1) {
          return NextResponse.json({
            ok: true,
            type: 'clarification',
            message: matches.length ? `I found multiple tasks named ${intent.entities.taskDetail}. Please be more specific.` : `I couldn't find a task named ${intent.entities.taskDetail}. Nothing was changed.`,
          });
        }
        const result = await mcpCall('update_task', { id: matches[0].id, title: intent.entities.taskTitle });
        return NextResponse.json({
          ok: true,
          type: result.status === 'updated' ? 'task' : 'clarification',
          message: result.status === 'updated' ? `Renamed task to ${result.title}.` : 'I could not update that task. Nothing was changed.',
          task: result,
        });
      }

      case 'add_shopping':
        if (intent.entities.shoppingItem) {
          const item = await mcpCall('add_shopping_item', {
            name: intent.entities.shoppingItem,
            quantity: 1,
          });
          return NextResponse.json({
            ok: true,
            type: 'shopping',
            message: item.status === 'already_exists' ? `${intent.entities.shoppingItem} is already on your shopping list.` : `Added to shopping list: ${intent.entities.shoppingItem}`,
            item,
          });
        }
        return NextResponse.json({
          ok: true,
          type: 'clarification',
          message: intent.clarification || 'What would you like to add to your shopping list?',
        });

      case 'delete_item': {
        const household = await mcpCall('get_household_context');
        const match = (household.shopping || []).filter((item: { title: string }) => item.title.trim().toLowerCase() === intent.entities.shoppingItem?.trim().toLowerCase());
        if (match.length !== 1) {
          return NextResponse.json({
            ok: true,
            type: 'clarification',
            message: match.length ? `I found more than one matching item. Which one did you mean: ${match.map((item: { title: string }) => item.title).join(', ')}?` : `I couldn't find ${intent.entities.shoppingItem} on your shopping list. Nothing was removed.`,
          });
        }
        const result = await mcpCall('delete_shopping_item', { id: match[0].id });
        return NextResponse.json({ ok: true, type: 'shopping', message: result.status === 'deleted' ? `Removed ${match[0].title} from your shopping list.` : `I couldn't remove ${match[0].title}; the list may have changed.`, item: result });
      }

      case 'reminder': {
        let reminder: ReturnType<typeof parseReminderRequest>;
        try {
          reminder = parseReminderRequest(message);
        } catch (error) {
          return NextResponse.json({ ok: true, type: 'clarification', message: error instanceof Error ? error.message : 'Include what to remind you about and a future time.' });
        }
        const result = await mcpCall('schedule_reminder', { title: reminder.title, at: reminder.at });
        return NextResponse.json({ ok: true, type: 'reminder', message: result.status === 'already_exists' ? `That reminder is already scheduled for ${new Date(result.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}.` : `Reminder scheduled: ${reminder.title} for ${new Date(result.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}.`, reminder: result });
      }

      case 'check_status': {
        const household = await mcpCall('get_household_context');
        return NextResponse.json({
          ok: true,
          type: 'status',
          message: generateHelpfulResponse(intent, household),
          household,
        });
      }

      case 'general_query':
        return NextResponse.json({
          ok: true,
          type: 'help',
          message: generateHelpfulResponse(intent),
        });

      default:
        return NextResponse.json({
          ok: true,
          type: 'help',
          message: generateHelpfulResponse(intent),
        });
    }
  } catch (error: unknown) {
    console.error('Message processing error:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unable to process your request.',
      type: 'error',
    }, { status: 502 });
  }
}

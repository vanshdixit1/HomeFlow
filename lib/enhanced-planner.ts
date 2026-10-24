export interface EnhancedIntent {
  type: 'create_plan' | 'add_task' | 'add_shopping' | 'check_status' | 'general_query' | 'reminder' | 'update_task' | 'delete_item';
  confidence: number;
  entities: {
    guestCount?: number;
    startsAt?: string;
    eventType?: 'dinner' | 'birthday' | 'party' | 'meeting' | 'other';
    taskTitle?: string;
    shoppingItem?: string;
    taskDetail?: string;
    reminderTime?: string;
    reminderTitle?: string;
    taskId?: string;
  };
  clarification?: string;
}

export function analyzeIntent(message: string): EnhancedIntent {
  const lower = message.toLowerCase();

  const listDelete = message.match(/^(?:please\s+)?(?:delete|remove|take off)\s+(?:the\s+)?shopping\s+list\s*[:,-]\s*(.+)$/i)
    ?? message.match(/^(?:please\s+)?(?:delete|remove|take off)\s+(.+?)\s+from\s+(?:my\s+)?shopping\s+list[.!?]*$/i)
    ?? message.match(/^(?:please\s+)?(?:delete|remove)\s+(.+?)[.!?]*$/i);
  if (listDelete) {
    const shoppingItem = listDelete[1].trim().replace(/[.!?]+$/, '');
    if (shoppingItem) return { type: 'delete_item', confidence: 0.95, entities: { shoppingItem } };
  }

  const explicitTask = message.match(/^(?:please\s+)?(?:add|create|make|new)\s+(?:a\s+)?(?:task|chore|todo)\b\s*[:,-]?\s*(.*)$/i);
  if (explicitTask) {
    const taskTitle = explicitTask[1].trim().replace(/^[:,-]\s*/, '').replace(/[.!?]+$/, '').trim();
    return taskTitle
      ? { type: 'add_task', confidence: 0.95, entities: { taskTitle } }
      : { type: 'add_task', confidence: 0.7, entities: {}, clarification: 'What task would you like me to add?' };
  }

  const taskUpdate = message.match(/^(?:please\s+)?(?:rename|update|change)\s+(?:the\s+)?(?:task\s+)?(.+?)\s+(?:to|as)\s+(.+)$/i);
  if (taskUpdate) {
    return {
      type: 'update_task',
      confidence: 0.9,
      entities: {
        taskDetail: taskUpdate[1].trim().replace(/[.!?]+$/, ''),
        taskTitle: taskUpdate[2].trim().replace(/[.!?]+$/, ''),
      },
    };
  }

  if (/^(?:please\s+)?(?:remind me|set (?:a )?reminder|schedule (?:a )?reminder)\b/i.test(message)) {
    return { type: 'reminder', confidence: 0.9, entities: {} };
  }

  const directTask = message.match(/^(?:please\s+)?(?:(?:(?:i|we)\s+)?(?:need|have)\s+to\s+)?(clean|take out|wash|vacuum|mop|organize|tidy|repair|fix|water|feed|set up|put away|do)\s+(.+)$/i);
  if (directTask) {
    const taskTitle = `${directTask[1]} ${directTask[2]}`.trim().replace(/[.!?]+$/, '');
    return { type: 'add_task', confidence: 0.85, entities: { taskTitle } };
  }

  if (/^(?:please\s+)?get\s+(?:the\s+)?(?:house|home)\s+ready\b/i.test(message)) {
    return { type: 'create_plan', confidence: 0.8, entities: {} };
  }

  const shoppingNoItem = /^(?:please\s+)?(?:add|put)\s+(?:to|on|in)\s+(?:(?:my|the)\s+)?(?:shopping|grocery)\s+list[.!?]*$/i.test(message);
  const shoppingMatch = message.match(/^(?:please\s+)?(?:(?:i|we)\s+)?(?:buy|get|purchase|pick up|add|put)\s+(.+)$/i)
    ?? message.match(/^(?:please\s+)?(?:(?:i|we)\s+)?need\s+(.+)$/i);
  if (shoppingNoItem) {
    return { type: 'add_shopping', confidence: 0.7, entities: {}, clarification: 'What item should I add to your shopping list?' };
  }
  if (shoppingMatch) {
    const shoppingItem = shoppingMatch[1]
      .replace(/^to\s+(?:buy|get|pick up)\s+/i, '')
      .replace(/\s+(?:to|onto|on)\s+(?:(?:my|the)\s+)?(?:shopping|grocery)\s+list.*$/i, '')
      .replace(/\s+(?:please|thanks)[.!?]*$/i, '')
      .replace(/[.!?,]+$/, '')
      .trim();
    if (!shoppingItem || /^(?:something|an? item)$/i.test(shoppingItem) || shoppingItem.length > 80) {
      return { type: 'add_shopping', confidence: 0.7, entities: {}, clarification: 'What item should I add to your shopping list?' };
    }
    return { type: 'add_shopping', confidence: 0.9, entities: { shoppingItem } };
  }

  // Add shopping item - check FIRST with common items
  const shoppingItems = /\b(milk|eggs|bread|butter|cheese|rice|oil|sugar|salt|flour|vegetables|fruits|meat|chicken|fish|toilet paper|soap|detergent|water|juice|soda|beer|wine|snacks|chips|cookies|candy|chocolate|coffee|tea)\b/i;
  const shoppingVerbs = /\b(add|buy|get|need|pick up|purchase)\b/i;

  if (shoppingVerbs.test(lower) && shoppingItems.test(lower)) {
    const itemMatch = message.match(shoppingItems);
    if (itemMatch) {
      return {
        type: 'add_shopping',
        confidence: 0.95,
        entities: {
          shoppingItem: itemMatch[0].trim(),
        },
      };
    }
  }

  // Generic add shopping (after specific items)
  if (shoppingVerbs.test(lower) && /\b(shopping|grocery|list|store)\b/i.test(lower)) {
    const genericMatch = message.match(/(?:add|buy|get|need|pick up|purchase)\s+(?:to\s+)?(?:the\s+)?(?:shopping\s+list)?\s*(.+?)(?:\s+(?:to|for|please|$))/i);
    if (genericMatch && genericMatch[1]) {
      const item = genericMatch[1].trim().replace(/[.!?,]$/, '');
      if (item.length > 0 && item.length < 50) {
        return {
          type: 'add_shopping',
          confidence: 0.85,
          entities: {
            shoppingItem: item,
          },
        };
      }
    }
    return {
      type: 'add_shopping',
      confidence: 0.7,
      entities: {},
      clarification: 'What item would you like to add to the shopping list?',
    };
  }

  // Add task
  if (/\b(add|create|new|need|make)\s+(task|chore|todo|something|to do)\b/i.test(lower)) {
    const taskMatch = message.match(/(?:add|create|new|need|make)\s+(?:task|chore|todo|something|to do)(?:\s+(?:to|for|called|named)?)?\s*["']?([^"'\.]+)["']?/i);

    if (taskMatch) {
      return {
        type: 'add_task',
        confidence: 0.9,
        entities: {
          taskTitle: taskMatch[1].trim().replace(/^[:,-]\s*/, ''),
        },
      };
    }

    return {
      type: 'add_task',
      confidence: 0.7,
      entities: {},
      clarification: 'What task would you like me to add?',
    };
  }

  // Event/Plan creation
  if (/\b(guest|host|prepare|plan|get ready|event|party|birthday|meeting|dinner|lunch|celebration|gathering)\b/i.test(lower)) {
    const guestMatch = message.match(/(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\s*(guests?|people|attendees|coming|over)/i);
    const timeMatch = message.match(/(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|in\s+\d+\s+(days?|hours?))/i);

    if (!guestMatch || !timeMatch) {
      return {
        type: 'create_plan',
        confidence: 0.5,
        entities: {},
        clarification: 'I can help you plan an event. How many people are coming, and when should it be?',
      };
    }

    return {
      type: 'create_plan',
      confidence: 0.9,
      entities: {},
    };
  }

  // Set reminder
  if (/\b(remind|reminder|set reminder|schedule)\b/i.test(lower)) {
    const timeMatch = message.match(/(?:at|for|on|in)\s+([^,.]+)/i);

    return {
      type: 'reminder',
      confidence: 0.8,
      entities: {
        reminderTime: timeMatch ? timeMatch[1].trim() : undefined,
      },
      clarification: !timeMatch ? 'When should I remind you?' : undefined,
    };
  }

  // Check status
  if (/\b(status|what|how|show|list|pending|open|tasks?|shopping|reminders?|inventory)\b/i.test(lower)) {
    return {
      type: 'check_status',
      confidence: 0.85,
      entities: {},
    };
  }

  // General query
  return {
    type: 'general_query',
    confidence: 0.5,
    entities: {},
    clarification: 'I can help you with planning events, adding tasks, managing shopping lists, and setting reminders. What would you like to do?',
  };
}

type HouseholdSummary = {
  members?: readonly unknown[];
  tasks?: readonly { title: string; status?: string }[];
  shopping?: readonly { title: string }[];
  reminders?: readonly { title: string }[];
};

export function generateHelpfulResponse(intent: EnhancedIntent, household?: HouseholdSummary): string {
  switch (intent.type) {
    case 'create_plan':
      return intent.clarification
        ? intent.clarification
        : "I'll help you plan this event. Let me check your household context and create a plan.";

    case 'add_task':
      return intent.clarification
        ? intent.clarification
        : `I'll add that task to your household list. ${household?.members?.length ? `I'll assign it based on your household preferences.` : ''}`;

    case 'add_shopping':
      return intent.clarification
        ? intent.clarification
        : "I'll add that to your shopping list. I'll check for duplicates first.";

    case 'reminder':
      return intent.clarification
        ? intent.clarification
        : "I'll set up that reminder for you.";

    case 'check_status':
      const tasks = (household?.tasks || []).filter(task => task.status !== 'completed');
      const shopping = household?.shopping || [];
      const reminders = household?.reminders || [];
      const describe = (items: readonly { title: string }[]) => items.length ? items.map(item => item.title).join(', ') : 'none';
      return `Household status: ${tasks.length} open task${tasks.length === 1 ? '' : 's'} (${describe(tasks)}); ${shopping.length} shopping item${shopping.length === 1 ? '' : 's'} (${describe(shopping)}); ${reminders.length} reminder${reminders.length === 1 ? '' : 's'} (${describe(reminders)}).`;

    case 'general_query':
      return intent.clarification || "I'm here to help coordinate your household. Try asking me to plan an event, add a task, or check your shopping list.";

    default:
      return "I'm not sure what you need. Try asking me to plan an event, add a task, or check your household status.";
  }
}

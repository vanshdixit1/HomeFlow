import type { Plan } from './types';
import { getBedrockClient, type IntentExtractionResult } from './aws/bedrock';

export interface ParsedRequest {
  guestCount: number;
  startsAt: string;
  eventType: 'dinner' | 'birthday' | 'party' | 'meeting' | 'other';
  title?: string;
  description?: string;
}

export interface ParsedReminder {
  title: string;
  at: string;
}

export function parseReminderRequest(message: string, now = new Date(), timeZone = 'Asia/Kolkata'): ParsedReminder {
  const timeMatch = message.match(/\b(?:at\s+)?(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(am|pm)\b/i)
    ?? message.match(/\b(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)\b/i);
  if (!timeMatch) throw new Error('What time should I remind you? Include a time such as 5 PM or 17:00.');

  const prefixMatch = message.match(/(?:remind me(?: to)?|set (?:a )?reminder(?: to)?|schedule (?:a )?reminder(?: to)?)\s+(.+)/i);
  if (!prefixMatch) throw new Error('What should I remind you about?');
  const title = prefixMatch[1]
    .replace(/\b(?:at\s+)?(?:1[0-2]|0?[1-9])(?::[0-5]\d)?\s*(?:am|pm)\b/i, '')
    .replace(/\b(?:at\s+)?(?:[01]?\d|2[0-3]):[0-5]\d\b/i, '')
    .replace(/\b(?:today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|in\s+\d+\s+days?)\b/i, '')
    .replace(/^\s*(?:to|about)\s+/i, '')
    .replace(/\s+(?:at|on)\s*$/i, '')
    .replace(/[,.!?]+$/, '')
    .trim();
  if (!title) throw new Error('What should I remind you about?');

  let hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2] || 0);
  if (timeMatch[3]) hour = hour % 12 + (timeMatch[3].toLowerCase() === 'pm' ? 12 : 0);

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type: string) => parts.find(item => item.type === type)?.value;
  const year = Number(part('year'));
  const month = Number(part('month'));
  const day = Number(part('day'));
  const currentHour = Number(part('hour'));
  const currentMinute = Number(part('minute'));
  const requestedDay = message.match(/\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|in\s+(\d+)\s+days?)\b/i);
  const localDate = new Date(Date.UTC(year, month - 1, day));
  const weekdayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  let daysToAdd = 0;
  if (requestedDay) {
    const dayText = requestedDay[1].toLowerCase();
    if (dayText === 'tomorrow') daysToAdd = 1;
    else if (dayText.startsWith('in ')) daysToAdd = Number(requestedDay[2]);
    else if (dayText !== 'today') {
      const currentWeekday = weekdayNames.indexOf(part('weekday')!.toLowerCase());
      daysToAdd = (weekdayNames.indexOf(dayText) - currentWeekday + 7) % 7;
      if (daysToAdd === 0 && (hour < currentHour || (hour === currentHour && minute <= currentMinute))) daysToAdd = 7;
    }
  } else if (hour < currentHour || (hour === currentHour && minute <= currentMinute)) {
    daysToAdd = 1;
  }
  localDate.setUTCDate(localDate.getUTCDate() + daysToAdd);

  const utcGuess = Date.UTC(localDate.getUTCFullYear(), localDate.getUTCMonth(), localDate.getUTCDate(), hour, minute);
  let targetTime = utcGuess;
  for (let attempt = 0; attempt < 2; attempt++) {
    const zonedParts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(targetTime));
    const zonedPart = (type: string) => Number(zonedParts.find(item => item.type === type)!.value);
    const representedUtc = Date.UTC(zonedPart('year'), zonedPart('month') - 1, zonedPart('day'), zonedPart('hour'), zonedPart('minute'), zonedPart('second'));
    targetTime = utcGuess - (representedUtc - targetTime);
  }
  if (targetTime <= now.getTime()) throw new Error('That reminder time has passed. Choose a future time.');
  return { title, at: new Date(targetTime).toISOString() };
}

export async function parseRequest(message: string, now = new Date()): Promise<ParsedRequest> {
  // Try Bedrock first if available
  const bedrock = getBedrockClient();
  if (bedrock.isEnabled()) {
    const bedrockResult = await bedrock.extractIntent(message);
    if (bedrockResult && bedrockResult.confidence > 0.7 && Date.parse(bedrockResult.startsAt) >= now.getTime() + 3 * 60 * 60 * 1000) {
      return {
        guestCount: bedrockResult.guestCount,
        startsAt: bedrockResult.startsAt,
        eventType: bedrockResult.eventType,
        title: bedrockResult.title,
        description: bedrockResult.description,
      };
    }
  }

  // Fallback to deterministic parser
  return parseRequestDeterministic(message, now);
}

function parseRequestDeterministic(message: string, now = new Date()): ParsedRequest {
  // Detect event type
  let eventType: 'dinner' | 'birthday' | 'party' | 'meeting' | 'other' = 'dinner';
  if (/\b(birthday|bday|b-day)\b/i.test(message)) {
    eventType = 'birthday';
  } else if (/\b(party|celebration|gathering)\b/i.test(message)) {
    eventType = 'party';
  } else if (/\b(meeting|conference|discussion|presentation)\b/i.test(message)) {
    eventType = 'meeting';
  } else if (/\b(dinner|lunch|breakfast|meal|food|eat)\b/i.test(message)) {
    eventType = 'dinner';
  }

  // Extract guest count
  const count = message.match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\s+(?:guests?|people|attendees)\b/i)?.[1]?.toLowerCase();
  const words = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];

  if (!count) {
    throw new Error('How many people are coming? Include the count, such as "six guests" or "10 people".');
  }

  const guestCount = words.includes(count) ? words.indexOf(count) + 1 : Number(count);
  if (guestCount < 1 || guestCount > 20) {
    throw new Error('Supports 1–20 guests; please choose a count in that range.');
  }

  // Extract date/time
  const dateParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const datePart = (type: string) => dateParts.find(part => part.type === type)!.value;
  const currentLocalDate = new Date(Date.UTC(Number(datePart('year')), Number(datePart('month')) - 1, Number(datePart('day'))));
  let targetDate = new Date(currentLocalDate);

  const relativeDays = message.match(/\bin\s+(\d+)\s+(days?|hours?)\b/i);
  const specificDate = message.match(/\b(?:on\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
  if (/\btomorrow\b/i.test(message)) {
    targetDate.setUTCDate(targetDate.getUTCDate() + 1);
  } else if (specificDate) {
    const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const currentWeekday = weekdays.indexOf(datePart('weekday').toLowerCase());
    const requestedWeekday = weekdays.indexOf(specificDate[1].toLowerCase());
    const daysUntil = (requestedWeekday - currentWeekday + 7) % 7 || 7;
    targetDate.setUTCDate(targetDate.getUTCDate() + daysUntil);
  } else if (relativeDays) {
    const amount = Number(relativeDays[1]);
    if (relativeDays[2].toLowerCase().startsWith('day')) {
      targetDate.setUTCDate(targetDate.getUTCDate() + amount);
    } else {
      const futureLocalDate = new Date(now.getTime() + amount * 60 * 60 * 1000);
      const futureParts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', hourCycle: 'h23',
      }).formatToParts(futureLocalDate);
      const value = (type: string) => Number(futureParts.find(part => part.type === type)!.value);
      targetDate = new Date(Date.UTC(value('year'), value('month') - 1, value('day')));
    }
  } else if (!/\btoday\b/i.test(message)) {
    throw new Error('When is the event? Include "today", "tomorrow", a day of the week, or "in X days".');
  }

  // Extract time
  const time = message.match(/\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(am|pm|a\.m\.|p\.m\.)\b/i);
  if (!time) {
    throw new Error('What time? Include a time such as 7 PM, 7:30 PM, or 3:00 PM.');
  }

  const hours = Number(time[1]) % 12 + (time[3].toLowerCase().startsWith('p') ? 12 : 0);
  const minutes = time[2] ? parseInt(time[2], 10) : 0;

  targetDate.setUTCHours(hours, minutes, 0, 0);

  // Validate time is in the future
  const startsAt = `${targetDate.toISOString().slice(0, 10)}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00+05:30`;
  if (Date.parse(startsAt) < now.getTime() + 3 * 60 * 60 * 1000) {
    throw new Error('Event must be at least 3 hours in the future.');
  }

  // Extract optional title/description
  const titleMatch = message.match(/(?:called|named|titled)\s+["']?([^"'\.]+)["']?/i);
  const title = titleMatch ? titleMatch[1].trim() : undefined;

  return {
    guestCount,
    startsAt,
    eventType,
    title,
  };
}

export function extractIntent(message: string): {
  primaryIntent: 'create_plan' | 'add_task' | 'add_shopping' | 'check_status' | 'query';
  confidence: number;
  entities: Record<string, unknown>;
} {
  const lower = message.toLowerCase();

  if (/\b(guest|host|prepare|plan|get ready|event|party|birthday|meeting|dinner)\b/.test(lower)) {
    return {
      primaryIntent: 'create_plan',
      confidence: 0.9,
      entities: {},
    };
  }

  if (/\b(add|create|new)\s+(task|chore|todo|reminder)\b/.test(lower)) {
    return {
      primaryIntent: 'add_task',
      confidence: 0.85,
      entities: {},
    };
  }

  if (/\b(add|buy|get|need)\s+(shopping|grocery|item|food)\b/.test(lower)) {
    return {
      primaryIntent: 'add_shopping',
      confidence: 0.85,
      entities: {},
    };
  }

  if (/\b(status|what|how|show|list|pending|open)\b/.test(lower)) {
    return {
      primaryIntent: 'check_status',
      confidence: 0.8,
      entities: {},
    };
  }

  return {
    primaryIntent: 'query',
    confidence: 0.5,
    entities: {},
  };
}

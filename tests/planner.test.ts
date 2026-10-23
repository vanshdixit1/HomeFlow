import { test } from 'node:test';
import assert from 'node:assert';
import { parseReminderRequest, parseRequest } from '../lib/planner';
import { BedrockClient, IntentExtractionSchema } from '../lib/aws/bedrock';

const tomorrow = new Date();
tomorrow.setDate(tomorrow.getDate() + 1);

test('parseRequest accepts a valid guest request', async () => {
  const out = await parseRequest("We're hosting six guests tomorrow at 7 PM. Help me get the house ready.", tomorrow);
  assert.equal(out.guestCount, 6);
  assert.ok(out.startsAt.endsWith('+05:30'));
  assert.ok(out.startsAt.includes('T19:00:00'));
});

test('parseRequest accepts numeric guest count without word guests', async () => {
  const out = await parseRequest('Four guests coming tomorrow at 8 PM.', tomorrow);
  assert.equal(out.guestCount, 4);
  assert.ok(out.startsAt.includes('T20:00:00'));
});

test('parseRequest interprets dates in the household timezone, not the server timezone', async () => {
  const previousTimezone = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';
  const now = new Date('2026-10-23T08:00:00.000Z');
  try {
    const out = await parseRequest('Six guests tomorrow at 7 PM', now);
    assert.equal(out.startsAt, '2026-10-24T19:00:00+05:30');
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  }
});

test('parseRequest rejects missing count', async () => {
  await assert.rejects(() => parseRequest('Guests tomorrow at 7 PM.', tomorrow), /count/);
});

test('parseRequest rejects missing tomorrow', async () => {
  await assert.rejects(() => parseRequest('Six guests at 7 PM.', tomorrow), /tomorrow/);
});

test('parseRequest rejects missing time', async () => {
  await assert.rejects(() => parseRequest('Six guests tomorrow.', tomorrow), /time/);
});

test('parseRequest rejects unsupported event type', async () => {
  await assert.rejects(() => parseRequest('Book a flight tomorrow at 7 PM.', tomorrow), /count/);
});

test('parseReminderRequest extracts a title and future local time', () => {
  const now = new Date('2026-10-23T08:00:00.000Z');
  const reminder = parseReminderRequest('Remind me to call mom at 5 PM', now);
  assert.equal(reminder.title, 'call mom');
  assert.equal(reminder.at, '2026-10-23T11:30:00.000Z');
});

test('parseReminderRequest asks for missing time or title', () => {
  assert.throws(() => parseReminderRequest('Remind me to call mom'), /What time/);
  assert.throws(() => parseReminderRequest('Remind me at 5 PM'), /What should/);
});

test('Bedrock remains disabled unless explicitly enabled', () => {
  const client = new BedrockClient({ accessKeyId: 'local-test', secretAccessKey: 'local-test' });
  assert.equal(client.isEnabled(), false);
});

test('Bedrock extraction schema rejects malformed or unsafe output', () => {
  const valid = {
    guestCount: 6,
    startsAt: '2026-10-24T19:00:00+05:30',
    eventType: 'dinner',
    confidence: 0.9,
  };
  assert.equal(IntentExtractionSchema.safeParse(valid).success, true);
  assert.equal(IntentExtractionSchema.safeParse({ ...valid, guestCount: 0 }).success, false);
  assert.equal(IntentExtractionSchema.safeParse({ ...valid, confidence: 2 }).success, false);
  assert.equal(IntentExtractionSchema.safeParse({ ...valid, eventType: 'flight' }).success, false);
  assert.equal(IntentExtractionSchema.safeParse({ ...valid, startsAt: 'tomorrow evening' }).success, false);
});

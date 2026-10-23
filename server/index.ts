import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import cors from 'cors';
import { z } from 'zod';
import { timingSafeEqual } from 'node:crypto';
import { APPROVAL_TOKEN_TTL_MS, getStore } from '../lib/store';

const store = getStore();
const PORT = Number(process.env.MCP_PORT || 3001);
const HOST = process.env.MCP_HOST || '127.0.0.1';
const MCP_AUTH_TOKEN = process.env.MCP_AUTH_TOKEN;

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) throw new Error('MCP_PORT must be an integer between 1 and 65535.');
if (process.env.NODE_ENV === 'production' && !MCP_AUTH_TOKEN) throw new Error('MCP_AUTH_TOKEN is required in production.');

const toolSchemas = {
  getInventory: z.object({}),
  getHouseholdContext: z.object({}),
  getOpenTasks: z.object({}),
  getShoppingList: z.object({}),
  getUpcomingEvents: z.object({}),
  createHouseholdPlan: z.object({
    guestCount: z.number().int().min(1).max(20).describe('Number of guests for the event.'),
    startsAt: z.string().describe('ISO-8601 event start time in Asia/Kolkata. Must be at least three hours in the future.'),
    eventType: z.enum(['dinner', 'birthday', 'party', 'meeting', 'other']).optional().describe('Type of event. Defaults to dinner.'),
  }),
  approveHouseholdPlan: z.object({
    planId: z.string().describe('Id of a pending plan created by createHouseholdPlan.'),
    version: z.number().int().positive().describe('Exact plan version returned by createHouseholdPlan.'),
  }),
  executeHouseholdPlan: z.object({
    planId: z.string().describe('Id of an approved plan.'),
    version: z.number().int().positive().describe('Exact plan version returned by createHouseholdPlan.'),
    token: z.string().describe('Approval token returned by approveHouseholdPlan.'),
  }),
  cancelHouseholdPlan: z.object({
    planId: z.string().describe('Id of a pending plan.'),
  }),
  createTask: z.object({
    title: z.string().min(1).describe('Title of the task.'),
    detail: z.string().optional().describe('Optional detail (e.g. assignee).'),
    assignedTo: z.string().optional().describe('Person assigned to the task.'),
  }),
  updateTask: z.object({
    id: z.string().describe('Id of the task to update.'),
    title: z.string().optional().describe('New title.'),
    detail: z.string().optional().describe('New detail.'),
    assignedTo: z.string().optional().describe('New assignee.'),
    status: z.enum(['open', 'completed']).optional().describe('Open or completed task status.'),
  }),
  addShoppingItem: z.object({
    name: z.string().min(1).describe('Name of the shopping item.'),
    quantity: z.number().int().positive().optional().describe('Available quantity.'),
    detail: z.string().optional().describe('Optional detail.'),
  }),
  deleteShoppingItem: z.object({
    id: z.string().min(1).describe('Exact id of a shopping item to remove.'),
  }),
  scheduleReminder: z.object({
    title: z.string().min(1).describe('Reminder title.'),
    detail: z.string().optional().describe('Reminder detail.'),
    at: z.string().describe('ISO-8601 reminder time in Asia/Kolkata. Must be in the future.'),
  }),
  requestMemberConfirmation: z.object({
    member: z.string().describe('Household member to ask.'),
    message: z.string().describe('What to confirm with the member.'),
  }),
  getActionHistory: z.object({
    limit: z.number().int().positive().max(100).optional().describe('Max entries to return (default 20).'),
  }),
  createEvent: z.object({
    title: z.string().trim().min(1).max(120).describe('Event title.'),
    description: z.string().max(1000).optional().describe('Event description.'),
    startsAt: z.string().datetime({ offset: true }).describe('ISO-8601 event start time.'),
    endsAt: z.string().datetime({ offset: true }).optional().describe('ISO-8601 event end time.'),
    guestCount: z.number().int().min(1).describe('Number of guests.'),
    eventType: z.enum(['dinner', 'birthday', 'party', 'meeting', 'other']).describe('Type of event.'),
    location: z.string().optional().describe('Event location.'),
    notes: z.string().optional().describe('Additional notes.'),
  }),
  updateEvent: z.object({
    id: z.string().describe('Event ID to update.'),
    title: z.string().trim().min(1).max(120).optional().describe('New event title.'),
    description: z.string().max(1000).optional().describe('New event description.'),
    startsAt: z.string().datetime({ offset: true }).optional().describe('New start time.'),
    endsAt: z.string().datetime({ offset: true }).optional().describe('New end time.'),
    guestCount: z.number().int().min(1).max(1000).optional().describe('New guest count.'),
    location: z.string().max(200).optional().describe('New location.'),
    notes: z.string().max(2000).optional().describe('New notes.'),
  }),
  deleteEvent: z.object({
    id: z.string().describe('Event ID to delete.'),
  }),
  addPreference: z.object({
    category: z.enum(['dietary', 'scheduling', 'assignment', 'other']).describe('Preference category.'),
    key: z.string().describe('Preference key.'),
    value: z.string().describe('Preference value.'),
    appliesTo: z.array(z.string()).optional().describe('Members this applies to.'),
  }),
  updateMember: z.object({
    id: z.string().describe('Member ID to update.'),
    name: z.string().optional().describe('New name.'),
    role: z.enum(['organizer', 'member', 'guest']).optional().describe('New role.'),
    availability: z.array(z.string()).optional().describe('Availability schedule.'),
    preferredTasks: z.array(z.string()).optional().describe('Preferred task types.'),
    email: z.string().optional().describe('Email address.'),
    phone: z.string().optional().describe('Phone number.'),
  }),
};


function getServer() {
  const server = new McpServer({ name: 'homeflow-household', version: '1.0.0' }, { capabilities: { logging: {} } });

  server.registerTool('get_household_context', { description: 'Returns the household context: members, preferences, inventory, tasks, shopping, reminders, plans, events, and history.', inputSchema: toolSchemas.getHouseholdContext }, async () => {
    const state = store.read();
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          household: { id: state.id, name: state.name, timezone: state.timezone, members: state.members, preferences: state.preferences },
          inventory: state.inventory,
          tasks: state.tasks,
          shopping: state.shopping,
          reminders: state.reminders,
          plans: state.plans,
          events: state.events,
          upcomingEvents: state.plans.filter(p => p.status !== 'cancelled' && Date.parse(p.startsAt) > Date.now()).map(p => ({ id: p.id, title: p.title, startsAt: p.startsAt, guestCount: p.guestCount, status: p.status, eventType: p.eventType })),
          history: state.history,
        }, null, 2),
      }],
    };
  });

  server.registerTool('get_open_tasks', { description: 'Lists open household tasks.', inputSchema: toolSchemas.getOpenTasks }, async () => {
    const state = store.read();
    return { content: [{ type: 'text', text: JSON.stringify({ tasks: state.tasks.filter(t => t.status !== 'completed') }, null, 2) }] };
  });

  server.registerTool('get_shopping_list', { description: 'Lists items on the household shopping list.', inputSchema: toolSchemas.getShoppingList }, async () => {
    const state = store.read();
    return { content: [{ type: 'text', text: JSON.stringify({ shopping: state.shopping }, null, 2) }] };
  });

  server.registerTool('get_upcoming_events', { description: 'Lists non-cancelled household plans and events whose time is still in the future.', inputSchema: toolSchemas.getUpcomingEvents }, async () => {
    const state = store.read();
    const plans = state.plans.filter(p => p.status !== 'cancelled' && Date.parse(p.startsAt) > Date.now()).map(p => ({ id: p.id, title: p.title, startsAt: p.startsAt, guestCount: p.guestCount, status: p.status, eventType: p.eventType }));
    const events = state.events.filter(e => e.status !== 'cancelled' && Date.parse(e.startsAt) > Date.now()).map(e => ({ id: e.id, title: e.title, startsAt: e.startsAt, guestCount: e.guestCount, status: e.status, eventType: e.eventType }));
    return { content: [{ type: 'text', text: JSON.stringify({ plans, events }, null, 2) }] };
  });

  server.registerTool('create_household_plan', { description: 'Drafts a preparation plan for an event. Requires approval before execution.', inputSchema: toolSchemas.createHouseholdPlan }, async ({ guestCount, startsAt, eventType = 'dinner' }) => {
    const plan = store.draft(guestCount, startsAt, eventType);
    store.log('create_household_plan', 'success', `Draft plan ${plan.title} for ${guestCount} guests at ${plan.startsAt}, version ${plan.version}.`);
    return { content: [{ type: 'text', text: JSON.stringify({ id: plan.id, planId: plan.id, version: plan.version, title: plan.title, startsAt: plan.startsAt, guestCount: plan.guestCount, eventType: plan.eventType, status: plan.status, steps: plan.steps, explanation: plan.explanation, results: plan.results, conflictWarnings: plan.conflictWarnings, reasoning: plan.reasoning }, null, 2) }] };
  });

  server.registerTool('approve_household_plan', { description: 'Grants an approval token for a specific draft plan version.', inputSchema: toolSchemas.approveHouseholdPlan }, async ({ planId, version }) => {
    const token = store.approve(planId, version);
    store.log('approve_household_plan', 'success', `Plan ${planId} version ${version} approved.`);
    return { content: [{ type: 'text', text: JSON.stringify({ planId, version, approved: true, token, expiresAt: new Date(Date.now() + APPROVAL_TOKEN_TTL_MS).toISOString() }, null, 2) }] };
  });


  server.registerTool('execute_household_plan', { description: 'Executes an approved plan. Rejected without a valid approval token.', inputSchema: toolSchemas.executeHouseholdPlan }, async ({ planId, version, token }) => {
    const plan = store.execute(planId, version, token);
    const remaining = plan.steps.filter(step => !plan.results.includes(`Created: ${step.title}`) && !plan.results.includes(`Already exists: ${step.title}`));
    return { content: [{ type: 'text', text: JSON.stringify({ planId, version, status: plan.status, results: plan.results, remainingSteps: remaining }, null, 2) }] };
  });

  server.registerTool('cancel_household_plan', { description: 'Cancels an unexecuted pending or approved plan.', inputSchema: toolSchemas.cancelHouseholdPlan }, async ({ planId }) => {
    const plan = store.cancel(planId);
    store.log('cancel_household_plan', 'success', `Cancelled plan ${planId}.`);
    return { content: [{ type: 'text', text: JSON.stringify({ planId, status: 'cancelled' }, null, 2) }] };
  });

  server.registerTool('get_inventory', { description: 'Lists the household inventory.', inputSchema: toolSchemas.getInventory }, async () => {
    const state = store.read();
    return { content: [{ type: 'text', text: JSON.stringify({ inventory: state.inventory }, null, 2) }] };
  });

  server.registerTool('create_task', { description: 'Creates a household task. Rejects duplicates.', inputSchema: toolSchemas.createTask }, async ({ title, detail, assignedTo }) => {
    const alreadyExists = store.read().tasks.some(item => item.title.trim().toLowerCase() === title.trim().toLowerCase());
    const item = store.createTask(title, detail || '', assignedTo || '');
    return { content: [{ type: 'text', text: JSON.stringify({ id: item.id, title: item.title, detail: item.detail, status: alreadyExists ? 'already_exists' : 'created' }, null, 2) }] };
  });

  server.registerTool('update_task', { description: 'Updates an existing household task, including its open/completed status.', inputSchema: toolSchemas.updateTask }, async ({ id, title, detail, assignedTo, status }) => {
    const item = store.updateTask(id, { title, detail, assignedTo, status });
    if (!item) return { content: [{ type: 'text', text: JSON.stringify({ id, status: 'not_found' }, null, 2) }] };
    return { content: [{ type: 'text', text: JSON.stringify({ id: item.id, title: item.title, detail: item.detail, taskStatus: item.status || 'open', status: 'updated' }, null, 2) }] };
  });

  server.registerTool('add_shopping_item', { description: 'Adds an item to the household shopping list. Dedupes by name.', inputSchema: toolSchemas.addShoppingItem }, async ({ name, quantity, detail }) => {
    const alreadyExists = store.read().shopping.some(item => item.title.trim().toLowerCase() === name.trim().toLowerCase());
    const item = store.addShoppingItem(name, quantity ?? 1, detail || '');
    return { content: [{ type: 'text', text: JSON.stringify({ id: item.id, title: item.title, detail: item.detail, status: alreadyExists ? 'already_exists' : 'added' }, null, 2) }] };
  });

  server.registerTool('delete_shopping_item', { description: 'Removes a specific shopping item by id.', inputSchema: toolSchemas.deleteShoppingItem }, async ({ id }) => {
    const item = store.deleteShoppingItem(id);
    return { content: [{ type: 'text', text: JSON.stringify({ id, title: item?.title, status: item ? 'deleted' : 'not_found' }, null, 2) }] };
  });

  server.registerTool('schedule_reminder', { description: 'Schedules a reminder. Rejects past times.', inputSchema: toolSchemas.scheduleReminder }, async ({ title, detail, at }) => {
    const result = store.scheduleReminder(title, detail || '', at);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });

  server.registerTool('request_member_confirmation', { description: 'Requests confirmation from a household member. Demo: returns a confirmation request object.', inputSchema: toolSchemas.requestMemberConfirmation }, async ({ member, message }) => {
    store.log('request_member_confirmation', 'success', `Confirmation requested from ${member}: ${message}`);
    return { content: [{ type: 'text', text: JSON.stringify({ member, message, requestedAt: new Date().toISOString(), status: 'requested' }, null, 2) }] };
  });

  server.registerTool('get_action_history', { description: 'Returns the action audit log (last N entries).', inputSchema: toolSchemas.getActionHistory }, async ({ limit = 20 }) => {
    const history = store.getActionHistory(limit);
    return { content: [{ type: 'text', text: JSON.stringify({ history }, null, 2) }] };
  });

  server.registerTool('create_event', { description: 'Creates a new household event with conflict detection.', inputSchema: toolSchemas.createEvent }, async ({ title, description, startsAt, endsAt, guestCount, eventType, location, notes }) => {
    const event = store.createEvent({
      title,
      description,
      startsAt,
      endsAt,
      guestCount,
      eventType,
      location,
      notes,
      createdBy: 'homeflow',
    });
    return { content: [{ type: 'text', text: JSON.stringify({ id: event.id, title: event.title, status: event.status }, null, 2) }] };
  });

  server.registerTool('update_event', { description: 'Updates an existing event.', inputSchema: toolSchemas.updateEvent }, async ({ id, title, description, startsAt, endsAt, guestCount, location, notes }) => {
    const event = store.updateEvent(id, Object.fromEntries(Object.entries({ title, description, startsAt, endsAt, guestCount, location, notes }).filter(([, value]) => value !== undefined)));
    if (!event) return { content: [{ type: 'text', text: JSON.stringify({ id, status: 'not_found' }, null, 2) }] };
    return { content: [{ type: 'text', text: JSON.stringify({ id: event.id, title: event.title, status: 'updated' }, null, 2) }] };
  });

  server.registerTool('delete_event', { description: 'Deletes an event.', inputSchema: toolSchemas.deleteEvent }, async ({ id }) => {
    const success = store.deleteEvent(id);
    return { content: [{ type: 'text', text: JSON.stringify({ id, status: success ? 'deleted' : 'not_found' }, null, 2) }] };
  });

  server.registerTool('add_preference', { description: 'Adds a household preference.', inputSchema: toolSchemas.addPreference }, async ({ category, key, value, appliesTo }) => {
    const pref = store.addPreference({ category, key, value, appliesTo: appliesTo || [] });
    return { content: [{ type: 'text', text: JSON.stringify({ category: pref.category, key: pref.key, value: pref.value, status: 'added' }, null, 2) }] };
  });

  server.registerTool('update_member', { description: 'Updates a household member.', inputSchema: toolSchemas.updateMember }, async ({ id, name, role, availability, preferredTasks, email, phone }) => {
    const member = store.updateMember(id, { name, role, availability, preferredTasks, email, phone });
    if (!member) return { content: [{ type: 'text', text: JSON.stringify({ id, status: 'not_found' }, null, 2) }] };
    return { content: [{ type: 'text', text: JSON.stringify({ id: member.id, name: member.name, status: 'updated' }, null, 2) }] };
  });

  return server;
}


const app = express();
app.disable('x-powered-by');
const defaultOrigins = process.env.NODE_ENV === 'production'
  ? []
  : ['http://localhost:3000', 'http://127.0.0.1:3000'];
const allowedOrigins = new Set((process.env.MCP_ALLOWED_ORIGINS || defaultOrigins.join(','))
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean));
app.use(cors({
  origin(origin, callback) {
    callback(null, !origin || allowedOrigins.has(origin));
  },
  optionsSuccessStatus: 204,
}));
app.use(express.json({ limit: '64kb' }));
app.use('/mcp', (req, res, next) => {
  if (!MCP_AUTH_TOKEN || req.method === 'OPTIONS') return next();
  const authorization = req.get('authorization') || '';
  const supplied = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const suppliedBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(MCP_AUTH_TOKEN);
  if (suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }
  next();
});

app.get('/healthz', (_req, res) => res.json({ ok: true }));
app.get('/readyz', (_req, res) => {
  try {
    store.read();
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
});

app.post('/mcp', async (req, res) => {
  const server = getServer();
  try {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on('close', () => { transport.close(); server.close(); });
  } catch (error) {
    console.error('MCP request error:', error);
    if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
  }
});

app.get('/mcp', async (req, res) => {
  res.writeHead(405).end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null }));
});

app.delete('/mcp', async (req, res) => {
  res.writeHead(405).end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null }));
});

const httpServer = app.listen(PORT, HOST, () => console.log(`HomeFlow MCP server listening on http://${HOST}:${PORT}/mcp`));
let shuttingDown = false;
const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('Shutting down...');
  httpServer.close(() => {
    store.close();
    process.exit(0);
  });
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

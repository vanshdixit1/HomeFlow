import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import type { Household, Plan, Step, Item, Activity, Member, Event, Preference } from './types';

export const APPROVAL_TOKEN_TTL_MS = 15 * 60 * 1000;

export function seed(): Household {
  const now = new Date().toISOString();
  return {
    id: 'household_demo',
    name: "Vansh's home",
    timezone: 'Asia/Kolkata',
    members: [
      { id: 'vansh', name: 'Vansh', role: 'organizer', availability: [], preferredTasks: ['shopping', 'cooking'] },
      { id: 'anika', name: 'Anika', role: 'member', availability: [], preferredTasks: ['cleaning', 'decorating'] },
    ],
    preferences: [
      { category: 'dietary', key: 'vegetarian', value: 'Vegetarian menu preferred', appliesTo: ['all'] },
      { category: 'dietary', key: 'allergies', value: 'No peanuts', appliesTo: ['all'] },
      { category: 'assignment', key: 'shopping', value: 'Vansh handles shopping', appliesTo: ['vansh'] },
      { category: 'assignment', key: 'cleaning', value: 'Anika handles cleaning', appliesTo: ['anika'] },
    ],
    inventory: [
      { id: 'plates', title: 'Dinner plates', detail: '12 available', key: 'plates' },
      { id: 'water', title: 'Sparkling water', detail: '8 bottles', key: 'water' },
    ],
    tasks: [{ id: 'menu', title: 'Confirm vegetarian menu', detail: 'Vansh · open', key: 'menu', status: 'open' }],
    shopping: [],
    reminders: [],
    plans: [],
    events: [],
    history: [],
    createdAt: now,
    updatedAt: now,
  };
}

export class Store {
  private db: DatabaseSync;
  // Vercel sets VERCEL=1 and tmpdir() is /tmp; that SQLite file is ephemeral and not shared across instances.
  constructor(path = process.env.HOMEFLOW_DB || (process.env.VERCEL === '1' ? resolve(tmpdir(), 'homeflow-demo.sqlite') : resolve(process.cwd(), 'data/homeflow.sqlite'))) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS household (id INTEGER PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS approvals (plan_id TEXT PRIMARY KEY, version INTEGER NOT NULL, token_hash TEXT NOT NULL, expires_at INTEGER NOT NULL DEFAULT 0);');
    const approvalColumns = this.db.prepare('PRAGMA table_info(approvals)').all() as Array<{ name: string }>;
    if (!approvalColumns.some(column => column.name === 'expires_at')) {
      this.db.exec('ALTER TABLE approvals ADD COLUMN expires_at INTEGER NOT NULL DEFAULT 0');
    }
    this.db.prepare('INSERT OR IGNORE INTO household VALUES (1, ?)').run(JSON.stringify(seed()));
  }
  close() { this.db.close(); }
  read(): Household {
    const row = this.db.prepare('SELECT body FROM household WHERE id=1').get() as { body: string };
    return JSON.parse(row.body);
  }
  private transaction<T>(fn: (state: Household) => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const state = this.read();
      const result = fn(state);
      state.updatedAt = new Date().toISOString();
      this.db.prepare('UPDATE household SET body=? WHERE id=1').run(JSON.stringify(state));
      this.db.exec('COMMIT');
      return result;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  log(tool: string, status: 'success' | 'error', summary: string, userId?: string) {
    this.transaction(state => {
      this.appendLog(state, tool, status, summary, userId);
    });
  }
  private appendLog(state: Household, tool: string, status: 'success' | 'error', summary: string, userId?: string) {
    state.history.unshift({ id: randomUUID(), tool, status, summary, at: new Date().toISOString(), userId });
    state.history = state.history.slice(0, 100);
  }
  reset() {
    this.transaction(state => {
      Object.assign(state, seed());
      this.db.exec('DELETE FROM approvals');
    });
    return this.read();
  }

  detectConflicts(guestCount: number, startsAt: string, endsAt?: string, excludedEventId?: string): string[] {
    const conflicts: string[] = [];
    const state = this.read();
    const startTime = new Date(startsAt);
    const endTime = endsAt ? new Date(endsAt) : new Date(startTime.getTime() + 3 * 60 * 60 * 1000);

    // Check for time conflicts with existing events
    for (const event of state.events) {
      if (event.id === excludedEventId) continue;
      if (event.status === 'cancelled') continue;
      const eventStart = new Date(event.startsAt);
      const eventEnd = event.endsAt ? new Date(event.endsAt) : new Date(eventStart.getTime() + 3 * 60 * 60 * 1000);

      if (startTime < eventEnd && endTime > eventStart) {
        conflicts.push(`Time overlap with existing event: ${event.title} at ${eventStart.toLocaleString()}`);
      }
    }

    // Check for plan conflicts
    for (const plan of state.plans) {
      if (plan.status === 'cancelled' || plan.status === 'completed') continue;
      const planStart = new Date(plan.startsAt);
      const planEnd = new Date(planStart.getTime() + 3 * 60 * 60 * 1000);

      if (startTime < planEnd && endTime > planStart) {
        conflicts.push(`Time overlap with existing plan: ${plan.title} at ${planStart.toLocaleString()}`);
      }
    }

    // Check member availability (simplified - would need real availability data)
    if (state.members.length < 2 && guestCount > 6) {
      conflicts.push('Limited household members for large guest count');
    }

    return conflicts;
  }

  assignTaskToMember(taskTitle: string): string {
    const state = this.read();
    const taskLower = taskTitle.toLowerCase();

    // Check preferences for assignment
    for (const pref of state.preferences) {
      if (pref.category === 'assignment') {
        if (taskLower.includes(pref.key.toLowerCase()) || taskLower.includes('shopping') && pref.key === 'shopping') {
          const memberId = pref.appliesTo?.[0];
          if (memberId) {
            const member = state.members.find(m => m.id === memberId);
            if (member) return member.name;
          }
        }
      }
    }

    // Fallback to preferred tasks
    for (const member of state.members) {
      if (member.preferredTasks.some(pt => taskLower.includes(pt.toLowerCase()))) {
        return member.name;
      }
    }

    // Default to organizer
    const organizer = state.members.find(m => m.role === 'organizer');
    return organizer?.name || 'unassigned';
  }

  draft(guestCount: number, startsAt: string, eventType: 'dinner' | 'birthday' | 'party' | 'meeting' | 'other' = 'dinner'): Plan {
    if (!Number.isInteger(guestCount) || guestCount < 1 || guestCount > 20) throw new Error('Supports 1–20 guests.');
    if (!Number.isFinite(Date.parse(startsAt)) || Date.parse(startsAt) < Date.now() + 3 * 3600000) throw new Error('Choose an event more than three hours in the future.');

    const instant = new Date(startsAt).toISOString();
    const conflicts = this.detectConflicts(guestCount, startsAt);

    return this.transaction(state => {
      const existing = state.plans.find(p => p.startsAt === instant && p.guestCount === guestCount && p.eventType === eventType && p.status !== 'cancelled');
      if (existing) return existing;

      const dateKey = instant;
      const assignedTo = this.assignTaskToMember('shopping');

      // Generate shopping based on event type
      const shoppingItems = this.getShoppingItemsForEvent(eventType);
      const shopping: Step[] = shoppingItems.map(title => ({
        kind: 'shopping' as const, title, detail: `Enough for ${guestCount} guests · ${assignedTo}`, key: `${dateKey}:shopping:${title.toLowerCase()}`,
      }));

      // Generate tasks based on event type
      const taskItems = this.getTasksForEvent(eventType);
      const cleaningAssignee = this.assignTaskToMember('cleaning');
      const tasks: Step[] = taskItems.map(title => ({
        kind: 'task' as const, title, detail: `${cleaningAssignee} · before ${instant}`, key: `${dateKey}:task:${title.toLowerCase()}`, assignedTo: cleaningAssignee,
      }));

      const steps: Step[] = [...shopping, ...tasks, {
        kind: 'reminder', title: 'Start event preparation', detail: new Date(Date.parse(instant) - 3 * 3600000).toISOString(), key: `${dateKey}:reminder:prepare`,
      }];

      const explanation = this.generateExplanation(eventType, guestCount, instant, state, conflicts);

      const plan: Plan = {
        id: randomUUID(),
        version: 1,
        title: this.getEventTitle(eventType, guestCount),
        startsAt: instant,
        guestCount,
        eventType,
        status: 'pending',
        steps: steps.filter(step => ![...state.shopping, ...state.tasks, ...state.reminders].some(item => item.key === step.key)),
        explanation,
        results: [],
        conflictWarnings: conflicts.length > 0 ? conflicts : undefined,
        reasoning: conflicts.length > 0 ? 'Plan created with conflict warnings. Review before approving.' : 'Plan created based on household context, preferences, and availability.',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      state.plans.unshift(plan);
      return plan;
    });
  }

  private getShoppingItemsForEvent(eventType: Event['eventType']): string[] {
    const baseItems = ['Pasta', 'Tomato sauce', 'Salad ingredients', 'Peanut-free dessert'];

    switch (eventType) {
      case 'birthday':
        return [...baseItems, 'Birthday cake', 'Candles', 'Balloons', 'Party decorations'];
      case 'party':
        return [...baseItems, 'Snacks', 'Beverages', 'Ice', 'Disposable plates/cups'];
      case 'meeting':
        return ['Coffee', 'Tea', 'Light snacks', 'Water', 'Notebooks/pens'];
      default:
        return baseItems;
    }
  }

  private getTasksForEvent(eventType: Event['eventType']): string[] {
    const baseTasks = ['Clean living room', 'Prepare dining table', 'Check guest bathroom'];

    switch (eventType) {
      case 'birthday':
        return [...baseTasks, 'Set up decorations', 'Prepare cake area', 'Arrange music'];
      case 'party':
        return [...baseTasks, 'Set up lighting', 'Prepare entertainment area', 'Arrange seating'];
      case 'meeting':
        return ['Clean meeting area', 'Set up chairs', 'Prepare refreshments', 'Test audio/video'];
      default:
        return baseTasks;
    }
  }

  private getEventTitle(eventType: Event['eventType'], guestCount: number): string {
    switch (eventType) {
      case 'birthday':
        return `Birthday celebration for ${guestCount} guests`;
      case 'party':
        return `Party with ${guestCount} guests`;
      case 'meeting':
        return `Meeting with ${guestCount} attendees`;
      case 'other':
        return `Event with ${guestCount} guests`;
      case 'dinner':
        return `Dinner with ${guestCount} guests`;
      default:
        return `Event with ${guestCount} guests`;
    }
  }

  private generateExplanation(eventType: string, guestCount: number, instant: string, state: Household, conflicts: string[]): string {
    const dietaryPrefs = state.preferences.filter(p => p.category === 'dietary').map(p => p.value).join(', ');
    const inventoryAvailable = state.inventory.length > 0 ? `Available: ${state.inventory.map(i => i.title).join(', ')}` : 'No specific inventory noted';

    let explanation = `Checked household context for ${eventType} with ${guestCount} guests at ${new Date(instant).toLocaleString()}. `;
    explanation += `Dietary preferences: ${dietaryPrefs || 'None specified'}. ${inventoryAvailable}. `;

    if (conflicts.length > 0) {
      explanation += `Conflicts detected: ${conflicts.join('; ')}. `;
    }

    explanation += 'Reminder is stored locally, not delivered. Verify food labels yourself for allergies.';

    return explanation;
  }

  approve(id: string, version: number, now = Date.now()): string {
    return this.transaction(state => {
      const plan = state.plans.find(p => p.id === id);
      if (!plan || plan.version !== version) throw new Error('Plan missing or version changed. Refresh and review again.');
      if (plan.status === 'cancelled') throw new Error('Cancelled plans cannot be approved.');
      if (plan.status === 'completed') throw new Error('Completed plans cannot be approved again.');
      const token = randomUUID();
      this.db.prepare('INSERT OR REPLACE INTO approvals (plan_id, version, token_hash, expires_at) VALUES (?, ?, ?, ?)').run(id, version, hash(token), now + APPROVAL_TOKEN_TTL_MS);
      plan.status = 'approved';
      plan.updatedAt = new Date().toISOString();
      return token;
    });
  }

  execute(id: string, version: number, token: string, now = Date.now()): Plan {
    const plan = this.transaction(state => {
      const plan = state.plans.find(p => p.id === id);
      const approval = this.db.prepare('SELECT version, token_hash, expires_at FROM approvals WHERE plan_id=?').get(id) as { version: number; token_hash: string; expires_at: number } | undefined;
      if (!plan || plan.version !== version || !approval || approval.version !== version || approval.token_hash !== hash(token)) throw new Error('Execution requires explicit approval for this exact plan version.');
      if (plan.status === 'completed') return plan;
      if (approval.expires_at <= now) throw new Error('Approval token expired. Review and approve the plan again.');
      if (plan.status !== 'approved') throw new Error('Plan is not approved.');
      if (plan.steps.some(s => s.kind === 'reminder' && Date.parse(s.detail) <= Date.now())) throw new Error('Reminder time is in the past. Cancel this plan and create a new one. No actions were applied.');

      for (const step of plan.steps) {
        const list = step.kind === 'shopping' ? state.shopping : step.kind === 'task' ? state.tasks : state.reminders;
        const normalizedTitle = step.title.trim().toLowerCase();
        const alreadyExists = list.some(item => item.key === step.key
          || ((step.kind === 'shopping' || step.kind === 'task') && item.title.trim().toLowerCase() === normalizedTitle));
        if (alreadyExists) {
          plan.results.push(`Already exists: ${step.title}`);
          continue;
        }
        list.push({ id: randomUUID(), title: step.title, detail: step.detail, key: step.key });
        plan.results.push(`${step.kind === 'reminder' ? 'Stored locally' : 'Created'}: ${step.title}`);
      }

      // Create event from plan
      const event: Event = {
        id: randomUUID(),
        title: plan.title,
        startsAt: plan.startsAt,
        endsAt: new Date(Date.parse(plan.startsAt) + 3 * 60 * 60 * 1000).toISOString(),
        guestCount: plan.guestCount,
        eventType: plan.eventType,
        status: 'confirmed',
        createdBy: 'homeflow',
        notes: `Created from plan ${plan.id}`,
      };
      state.events.push(event);

      plan.status = 'completed';
      plan.updatedAt = new Date().toISOString();
      return plan;
    });
    this.log('execute_household_plan', 'success', `Executed plan ${id} version ${version}: ${plan.results.join('; ') || 'no new changes'}.`);
    return plan;
  }

  createTask(title: string, detail = '', assignedTo = ''): Item {
    return this.transaction(state => {
      const normalizedTitle = title.trim();
      if (!normalizedTitle) throw new Error('Task title is required.');
      const existing = state.tasks.find(task => task.title.trim().toLowerCase() === normalizedTitle.toLowerCase());
      if (existing) {
        this.appendLog(state, 'create_task', 'error', `Already exists: ${existing.title}`);
        return existing;
      }
      const assignee = assignedTo || this.assignTaskToMember(normalizedTitle);
      const task: Item = { id: randomUUID(), title: normalizedTitle, detail: detail || `${assignee} · open`, key: `task:${normalizedTitle.toLowerCase()}`, status: 'open' };
      state.tasks.push(task);
      this.appendLog(state, 'create_task', 'success', `Task created: ${title}${assignee ? ' · assigned to ' + assignee : ''}`);
      return task;
    });
  }

  updateTask(id: string, patch: { title?: string; detail?: string; assignedTo?: string; status?: 'open' | 'completed' }): Item | undefined {
    return this.transaction(state => {
      const task = state.tasks.find(t => t.id === id);
      if (!task) {
        this.appendLog(state, 'update_task', 'error', `Task not found: ${id}`);
        return task;
      }
      if (patch.title !== undefined) {
        const title = patch.title.trim();
        if (!title) throw new Error('Task title is required.');
        const duplicate = state.tasks.some(item => item.id !== id && item.title.trim().toLowerCase() === title.toLowerCase());
        if (duplicate) throw new Error('A task with that title already exists.');
        task.title = title;
      }
      if (patch.detail !== undefined) task.detail = patch.detail;
      if (patch.assignedTo !== undefined) task.detail = `${patch.assignedTo} · ${task.detail.split(' · ').slice(1).join(' · ') || 'open'}`;
      if (patch.status !== undefined) task.status = patch.status;
      const change = patch.status ? `Marked task ${patch.status}: ${task.title}` : `Updated task: ${task.title}`;
      this.appendLog(state, 'update_task', 'success', change);
      return task;
    });
  }

  addShoppingItem(name: string, quantity = 1, detail = ''): Item {
    return this.transaction(state => {
      const normalizedName = name.trim();
      if (!normalizedName) throw new Error('Shopping item name is required.');
      const existing = state.shopping.find(item => item.title.trim().toLowerCase() === normalizedName.toLowerCase());
      if (existing) {
        this.appendLog(state, 'add_shopping_item', 'error', `Already exists: ${existing.title}`);
        return existing;
      }
      const assignee = this.assignTaskToMember('shopping');
      const item: Item = { id: randomUUID(), title: normalizedName, detail: `${detail || quantity} · ${assignee}`, key: `shopping:${normalizedName.toLowerCase()}` };
      state.shopping.push(item);
      this.appendLog(state, 'add_shopping_item', 'success', `Shopping item added: ${name}`);
      return item;
    });
  }

  deleteShoppingItem(id: string): Item | undefined {
    return this.transaction(state => {
      const index = state.shopping.findIndex(item => item.id === id);
      if (index === -1) {
        this.appendLog(state, 'delete_shopping_item', 'error', `Shopping item not found: ${id}`);
        return undefined;
      }
      const [item] = state.shopping.splice(index, 1);
      this.appendLog(state, 'delete_shopping_item', 'success', `Shopping item removed: ${item.title}`);
      return item;
    });
  }

  scheduleReminder(title: string, detail: string, at: string) {
    const normalizedTitle = title.trim();
    if (!normalizedTitle) throw new Error('Reminder title is required.');
    const time = Date.parse(at);
    if (!Number.isFinite(time) || time <= Date.now()) throw new Error('Reminder time must be in the future.');
    return this.transaction(state => {
      const scheduledAt = new Date(time).toISOString();
      const key = `reminder:${normalizedTitle.toLowerCase()}:${scheduledAt}`;
      const existing = state.reminders.find(reminder => reminder.key === key);
      if (existing) return { id: existing.id, title: existing.title, at: existing.scheduledAt || scheduledAt, status: 'already_exists' as const };
      const item: Item = { id: randomUUID(), title: normalizedTitle, detail, key, scheduledAt };
      state.reminders.push(item);
      this.appendLog(state, 'schedule_reminder', 'success', `Reminder scheduled: ${normalizedTitle} at ${new Date(time).toLocaleString('en-US', { hour: '2-digit', minute: '2-digit' })}`);
      return { id: item.id, title: normalizedTitle, at: scheduledAt, status: 'scheduled' as const };
    });
  }

  getActionHistory(limit = 50): Activity[] {
    return this.read().history.slice(0, limit);
  }

  cancel(id: string): Plan {
    return this.transaction(state => {
      const plan = state.plans.find(p => p.id === id);
      if (!plan || plan.status === 'completed') throw new Error('Only unexecuted plans can be cancelled.');
      plan.status = 'cancelled';
      plan.updatedAt = new Date().toISOString();
      this.db.prepare('DELETE FROM approvals WHERE plan_id=?').run(id);
      return plan;
    });
  }

  createEvent(event: Omit<Event, 'id' | 'status' | 'createdAt'>): Event {
    const startsAt = Date.parse(event.startsAt);
    const title = event.title.trim();
    if (!title) throw new Error('Event title is required.');
    if (!Number.isFinite(startsAt)) throw new Error('Event start time must be a valid ISO-8601 date.');
    if (!Number.isInteger(event.guestCount) || event.guestCount < 1 || event.guestCount > 1000) throw new Error('Event guest count must be between 1 and 1000.');
    if (event.endsAt) {
      const endsAt = Date.parse(event.endsAt);
      if (!Number.isFinite(endsAt) || endsAt <= startsAt) throw new Error('Event end time must be after its start time.');
    }
    return this.transaction(state => {
      const conflicts = this.detectConflicts(event.guestCount, event.startsAt, event.endsAt);
      if (conflicts.length > 0) {
        throw new Error(`Event conflicts: ${conflicts.join('; ')}`);
      }

      const newEvent: Event = {
        ...event,
        title,
        id: randomUUID(),
        status: 'planned',
      };
      state.events.push(newEvent);
      this.appendLog(state, 'create_event', 'success', `Event created: ${event.title}`);
      return newEvent;
    });
  }

  updateEvent(id: string, updates: Partial<Event>): Event | undefined {
    return this.transaction(state => {
      const event = state.events.find(e => e.id === id);
      if (!event) {
        this.appendLog(state, 'update_event', 'error', `Event not found: ${id}`);
        return undefined;
      }

      if (updates.title !== undefined && !updates.title.trim()) throw new Error('Event title is required.');
      if (updates.startsAt !== undefined && !Number.isFinite(Date.parse(updates.startsAt))) throw new Error('Event start time must be valid.');
      if (updates.endsAt !== undefined && !Number.isFinite(Date.parse(updates.endsAt))) throw new Error('Event end time must be valid.');
      const nextStartsAt = updates.startsAt ?? event.startsAt;
      const nextEndsAt = updates.endsAt ?? event.endsAt;
      const nextGuestCount = updates.guestCount ?? event.guestCount;
      if (!Number.isInteger(nextGuestCount) || nextGuestCount < 1 || nextGuestCount > 1000) throw new Error('Event guest count must be between 1 and 1000.');
      if (nextEndsAt && Date.parse(nextEndsAt) <= Date.parse(nextStartsAt)) throw new Error('Event end time must be after its start time.');
      const conflicts = this.detectConflicts(nextGuestCount, nextStartsAt, nextEndsAt, id);
      if (conflicts.length > 0) throw new Error(`Event conflicts: ${conflicts.join('; ')}`);
      for (const [key, value] of Object.entries(updates)) {
        if (value !== undefined) Object.assign(event, { [key]: key === 'title' && typeof value === 'string' ? value.trim() : value });
      }
      this.appendLog(state, 'update_event', 'success', `Event updated: ${event.title}`);
      return event;
    });
  }

  deleteEvent(id: string): boolean {
    return this.transaction(state => {
      const index = state.events.findIndex(e => e.id === id);
      if (index === -1) {
        this.appendLog(state, 'delete_event', 'error', `Event not found: ${id}`);
        return false;
      }

      const event = state.events[index];
      state.events.splice(index, 1);
      this.appendLog(state, 'delete_event', 'success', `Event deleted: ${event.title}`);
      return true;
    });
  }

  addPreference(preference: Omit<Preference, 'id'>): Preference {
    return this.transaction(state => {
      const newPref: Preference = preference;
      state.preferences.push(newPref);
      this.appendLog(state, 'add_preference', 'success', `Preference added: ${preference.category} - ${preference.key}`);
      return newPref;
    });
  }

  updateMember(memberId: string, updates: Partial<Member>): Member | undefined {
    return this.transaction(state => {
      const member = state.members.find(m => m.id === memberId);
      if (!member) {
        this.appendLog(state, 'update_member', 'error', `Member not found: ${memberId}`);
        return undefined;
      }

      for (const [key, value] of Object.entries(updates)) {
        if (value !== undefined) Object.assign(member, { [key]: value });
      }
      this.appendLog(state, 'update_member', 'success', `Member updated: ${member.name}`);
      return member;
    });
  }
}
function hash(value: string) { return createHash('sha256').update(value).digest('hex'); }
let instance: Store | undefined;
export function getStore() { return instance ??= new Store(); }

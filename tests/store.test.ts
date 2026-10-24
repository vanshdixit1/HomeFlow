import { test } from 'node:test';
import assert from 'node:assert';
import { Store } from '../lib/store';

test('store seed data loads', () => {
  const store = new Store(':memory:');
  const state = store.read();
  assert.ok(state.name.includes('Vansh'));
  assert.ok(state.tasks.length > 0);
  assert.equal(state.plans.length, 0);
  store.close();
});

test('create draft plan and duplicate prevention', () => {
  const store = new Store(':memory:');
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(19, 0, 0, 0);
  const p1 = store.draft(6, tomorrow.toISOString());
  assert.equal(p1.status, 'pending');
  assert.ok(p1.steps.length > 0);
  const p2 = store.draft(6, tomorrow.toISOString());
  assert.equal(p2.id, p1.id);
  assert.equal(p2.version, 1);
  store.close();
});

test('draft deduplication keeps different event types separate', () => {
  const store = new Store(':memory:');
  const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const dinner = store.draft(6, startsAt, 'dinner');
  const birthday = store.draft(6, startsAt, 'birthday');
  const duplicateBirthday = store.draft(6, startsAt, 'birthday');

  assert.notEqual(dinner.id, birthday.id);
  assert.equal(birthday.eventType, 'birthday');
  assert.equal(duplicateBirthday.id, birthday.id);
  store.close();
});

test('approve then execute persists actions', () => {
  const store = new Store(':memory:');
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(19, 0, 0, 0);
  const plan = store.draft(6, tomorrow.toISOString());
  store.createTask('Clean living room');
  const token = store.approve(plan.id, plan.version);
  assert.equal(typeof token, 'string');
  const executed = store.execute(plan.id, plan.version, token);
  assert.equal(executed.status, 'completed');
  const retried = store.execute(plan.id, plan.version, token);
  assert.equal(retried.status, 'completed');
  const state = store.read();
  assert.ok(state.shopping.some(s => s.title === 'Pasta'));
  assert.ok(state.tasks.some(s => s.title === 'Clean living room'));
  assert.equal(state.tasks.filter(s => s.title === 'Clean living room').length, 1);
  assert.ok(state.history.some(h => h.tool === 'execute_household_plan'));
  assert.equal(state.events.length, 1);
  store.close();
});

test('execution without approval is rejected', () => {
  const store = new Store(':memory:');
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(19, 0, 0, 0);
  const plan = store.draft(6, tomorrow.toISOString());
  assert.throws(() => store.execute(plan.id, plan.version, 'bad-token'), /explicit approval/);
  store.close();
});

test('expired approval tokens cannot execute plans', () => {
  const store = new Store(':memory:');
  const plan = store.draft(6, new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString());
  const token = store.approve(plan.id, plan.version, 0);
  assert.throws(() => store.execute(plan.id, plan.version, token), /expired/i);
  assert.equal(store.read().plans[0].status, 'approved');
  store.close();
});

test('cancel prevents execution', () => {
  const store = new Store(':memory:');
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(19, 0, 0, 0);
  const plan = store.draft(6, tomorrow.toISOString());
  store.cancel(plan.id);
  assert.throws(() => store.approve(plan.id, plan.version), /cancelled/i);
  store.close();
});

test('reset restores seed data', () => {
  const store = new Store(':memory:');
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(19, 0, 0, 0);
  store.draft(6, tomorrow.toISOString());
  const state = store.reset();
  assert.equal(state.plans.length, 0);
  assert.equal(state.shopping.length, 0);
  assert.ok(state.tasks.length > 0);
  store.close();
});

test('past reminder time is rejected at execution', () => {
  const store = new Store(':memory:');
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(19, 0, 0, 0);
  assert.throws(() => store.draft(6, yesterday.toISOString()), /three hours/);
  store.close();
});

test('delete shopping item removes only the requested item and logs it', () => {
  const store = new Store(':memory:');
  const item = store.addShoppingItem('Milk');
  assert.equal(store.deleteShoppingItem('missing'), undefined);
  assert.equal(store.read().shopping.length, 1);
  assert.equal(store.deleteShoppingItem(item.id)?.title, 'Milk');
  assert.equal(store.read().shopping.length, 0);
  assert.equal(store.read().history[0].tool, 'delete_shopping_item');
  store.close();
});

test('task and shopping duplicates are detected without regard to case', () => {
  const store = new Store(':memory:');
  const task = store.createTask('Clean the garage');
  const duplicateTask = store.createTask(' clean THE garage ');
  const item = store.addShoppingItem('Cold drink');
  const duplicateItem = store.addShoppingItem('COLD DRINK');
  assert.equal(duplicateTask.id, task.id);
  assert.equal(duplicateItem.id, item.id);
  assert.equal(store.read().tasks.filter(entry => entry.title.toLowerCase() === 'clean the garage').length, 1);
  assert.equal(store.read().shopping.filter(entry => entry.title.toLowerCase() === 'cold drink').length, 1);
  store.close();
});

test('updateTask changes a matched task and leaves missing tasks untouched', () => {
  const store = new Store(':memory:');
  const task = store.createTask('Clean the garage');
  assert.equal(store.updateTask(task.id, { status: 'completed' })?.status, 'completed');
  assert.equal(store.updateTask(task.id, { status: 'open' })?.status, 'open');
  assert.equal(store.updateTask(task.id, { title: 'Clean the shed' })?.title, 'Clean the shed');
  assert.equal(store.updateTask('missing-task', { title: 'No change' }), undefined);
  const otherTask = store.createTask('Wash dishes');
  assert.throws(() => store.updateTask(otherTask.id, { title: 'Clean the shed' }), /already exists/);
  assert.throws(() => store.updateTask(otherTask.id, { title: '  ' }), /title is required/);
  assert.ok(store.read().history.some(entry => entry.tool === 'update_task' && entry.status === 'success'));
  store.close();
});

test('scheduleReminder stores future reminders', () => {
  const store = new Store(':memory:');
  const at = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const reminder = store.scheduleReminder('Call mom', '', at);
  assert.equal(reminder.title, 'Call mom');
  assert.equal(store.read().reminders[0].title, 'Call mom');
  assert.equal(store.read().reminders[0].scheduledAt, new Date(at).toISOString());
  assert.equal(store.read().history[0].tool, 'schedule_reminder');
  assert.equal(store.scheduleReminder('Call mom', '', at).status, 'already_exists');
  assert.equal(store.read().reminders.length, 1);
  store.close();
});

test('event updates preserve omitted fields and reject invalid time ranges', () => {
  const store = new Store(':memory:');
  const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const event = store.createEvent({ title: 'Dinner', startsAt, guestCount: 4, eventType: 'dinner', createdBy: 'test' });
  const updated = store.updateEvent(event.id, { title: 'Family dinner' });
  assert.equal(updated?.title, 'Family dinner');
  assert.equal(updated?.startsAt, startsAt);
  assert.equal(updated?.guestCount, 4);
  assert.throws(() => store.updateEvent(event.id, { endsAt: startsAt }), /after its start/);
  assert.throws(() => store.createEvent({ title: 'Invalid', startsAt: 'not a date', guestCount: 2, eventType: 'dinner', createdBy: 'test' }), /valid ISO/);
  store.close();
});

test('event creation and updates honor actual durations and reject invalid conflicts', () => {
  const store = new Store(':memory:');
  const firstStart = Date.now() + 24 * 60 * 60 * 1000;
  const first = store.createEvent({
    title: '  Short event  ',
    startsAt: new Date(firstStart).toISOString(),
    endsAt: new Date(firstStart + 60 * 60 * 1000).toISOString(),
    guestCount: 4,
    eventType: 'dinner',
    createdBy: 'test',
  });
  assert.equal(first.title, 'Short event');

  const secondStart = firstStart + 90 * 60 * 1000;
  const second = store.createEvent({
    title: 'Second event',
    startsAt: new Date(secondStart).toISOString(),
    guestCount: 2,
    eventType: 'meeting',
    createdBy: 'test',
  });

  assert.throws(
    () => store.updateEvent(second.id, { startsAt: new Date(firstStart + 30 * 60 * 1000).toISOString() }),
    /Event conflicts/,
  );
  assert.equal(store.read().events.find(event => event.id === second.id)?.startsAt, new Date(secondStart).toISOString());
  assert.throws(() => store.updateEvent(second.id, { guestCount: 0 }), /guest count/);
  assert.throws(() => store.updateEvent(second.id, { title: '   ' }), /title is required/);

  store.close();
});

test('member updates preserve omitted profile fields', () => {
  const store = new Store(':memory:');
  const member = store.updateMember('anika', { name: 'Anika Rao' });
  assert.equal(member?.name, 'Anika Rao');
  assert.deepEqual(member?.preferredTasks, ['cleaning', 'decorating']);
  assert.equal(member?.role, 'member');
  store.close();
});

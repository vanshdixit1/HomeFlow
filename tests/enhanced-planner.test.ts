import { test } from 'node:test';
import assert from 'node:assert';
import { analyzeIntent, generateHelpfulResponse } from '../lib/enhanced-planner';

test('analyzeIntent strips punctuation from task prompt titles', () => {
  const intent = analyzeIntent('Add task: Clean the garage');
  assert.equal(intent.type, 'add_task');
  assert.equal(intent.entities.taskTitle, 'Clean the garage');
});

test('analyzeIntent asks for missing event details', () => {
  const intent = analyzeIntent('Plan an event for tomorrow');
  assert.equal(intent.type, 'create_plan');
  assert.ok(intent.clarification);
});

test('analyzeIntent extracts a common shopping item', () => {
  const intent = analyzeIntent('Add milk to the shopping list');
  assert.equal(intent.type, 'add_shopping');
  assert.equal(intent.entities.shoppingItem, 'milk');
});

test('analyzeIntent understands the screenshot requests', () => {
  const task = analyzeIntent('clean the garbage');
  assert.equal(task.type, 'add_task');
  assert.equal(task.entities.taskTitle, 'clean the garbage');
  const shopping = analyzeIntent('buy colddrink');
  assert.equal(shopping.type, 'add_shopping');
  assert.equal(shopping.entities.shoppingItem, 'colddrink');
  const removal = analyzeIntent('delete shopping list:milk');
  assert.equal(removal.type, 'delete_item');
  assert.equal(removal.entities.shoppingItem, 'milk');
  const shortRemoval = analyzeIntent('delete milk');
  assert.equal(shortRemoval.type, 'delete_item');
  assert.equal(shortRemoval.entities.shoppingItem, 'milk');
  assert.equal(analyzeIntent('Remind me to call mom at 5 PM').type, 'reminder');
});

test('analyzeIntent asks for a shopping item when none is supplied', () => {
  const intent = analyzeIntent('add to shopping list');
  assert.equal(intent.type, 'add_shopping');
  assert.ok(intent.clarification);
});

test('analyzeIntent separates household chores from shopping needs', () => {
  const chore = analyzeIntent('I need to clean the garage');
  assert.equal(chore.type, 'add_task');
  assert.equal(chore.entities.taskTitle, 'clean the garage');
  const shopping = analyzeIntent('I need milk');
  assert.equal(shopping.type, 'add_shopping');
  assert.equal(shopping.entities.shoppingItem, 'milk');
});

test('analyzeIntent keeps event preparation out of chores and supports task renames', () => {
  const event = analyzeIntent('Prepare dinner for 6 guests tomorrow at 7 PM');
  assert.equal(event.type, 'create_plan');
  const ready = analyzeIntent('Get the house ready for tomorrow');
  assert.equal(ready.type, 'create_plan');
  const update = analyzeIntent('Rename task Clean the garage to Clean the shed');
  assert.equal(update.type, 'update_task');
  assert.equal(update.entities.taskDetail, 'Clean the garage');
  assert.equal(update.entities.taskTitle, 'Clean the shed');
});

test('status response includes useful household list details', () => {
  const intent = analyzeIntent('What is on my shopping list?');
  const response = generateHelpfulResponse(intent, {
    tasks: [{ title: 'Clean the garage', status: 'open' }],
    shopping: [{ title: 'Cold drink' }],
    reminders: [],
  });
  assert.match(response, /Clean the garage/);
  assert.match(response, /Cold drink/);
  assert.match(response, /0 reminders/);
});
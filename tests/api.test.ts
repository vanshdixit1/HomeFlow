import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POST as approvePlan } from '../app/api/plan/approve/route';
import { POST as updateTaskStatus } from '../app/api/task/status/route';
import { POST as resetHousehold } from '../app/api/plan/reset/route';
import { POST as login } from '../app/api/auth/login/route';
import { GET as getHousehold } from '../app/api/household/route';
import { createSessionToken, isValidSessionToken, requireApiSession, SESSION_COOKIE_NAME } from '../lib/auth';

const invalidJsonRequest = () => new Request('http://localhost/api/test', { method: 'POST', body: '{' });

test('signed sessions reject tampering and expiration', () => {
  const token = createSessionToken('test-session-secret-that-is-long-enough', 1_000_000);
  assert.equal(isValidSessionToken(token, 'test-session-secret-that-is-long-enough', 1_001_000), true);
  assert.equal(isValidSessionToken(`${token}x`, 'test-session-secret-that-is-long-enough', 1_001_000), false);
  assert.equal(isValidSessionToken(token, 'a-different-test-session-secret', 1_001_000), false);
  assert.equal(isValidSessionToken(token, 'test-session-secret-that-is-long-enough', 20_000_000), false);
});

test('plan approval rejects malformed JSON without calling MCP', async () => {
  const response = await approvePlan(invalidJsonRequest());
  assert.equal(response.status, 400);
});

test('task status rejects malformed and invalid input', async () => {
  const malformed = await updateTaskStatus(invalidJsonRequest());
  assert.equal(malformed.status, 400);

  const invalid = await updateTaskStatus(new Request('http://localhost/api/task/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: '', status: 'cancelled' }),
  }));
  assert.equal(invalid.status, 400);
});

test('demo reset is disabled in production', async () => {
  const previousEnvironment = process.env.NODE_ENV;
  Reflect.set(process.env, 'NODE_ENV', 'production');
  try {
    const response = await resetHousehold(new Request('http://localhost/api/plan/reset', { method: 'POST' }));
    assert.equal(response.status, 404);
  } finally {
    if (previousEnvironment === undefined) Reflect.deleteProperty(process.env, 'NODE_ENV');
    else Reflect.set(process.env, 'NODE_ENV', previousEnvironment);
  }
});

test('production login issues a secure session and rejects an incorrect password', async () => {
  const previous = {
    nodeEnv: process.env.NODE_ENV,
    password: process.env.HOMEFLOW_ACCESS_PASSWORD,
    secret: process.env.HOMEFLOW_SESSION_SECRET,
  };
  Reflect.set(process.env, 'NODE_ENV', 'production');
  Reflect.set(process.env, 'HOMEFLOW_ACCESS_PASSWORD', 'a sufficiently long test password');
  Reflect.set(process.env, 'HOMEFLOW_SESSION_SECRET', 'a sufficiently long test session secret 123');
  try {
    for (let attempt = 0; attempt < 10; attempt++) {
      const failure = await login(new Request('https://homeflow.test/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-real-ip': '198.51.100.10' },
        body: JSON.stringify({ password: 'incorrect password' }),
      }));
      assert.equal(failure.status, 401);
    }
    const blocked = await login(new Request('https://homeflow.test/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-real-ip': '198.51.100.10' },
      body: JSON.stringify({ password: 'a sufficiently long test password' }),
    }));
    assert.equal(blocked.status, 429);

    const success = await login(new Request('https://homeflow.test/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-real-ip': '198.51.100.11' },
      body: JSON.stringify({ password: 'a sufficiently long test password' }),
    }));
    assert.equal(success.status, 200);
    assert.match(success.headers.get('set-cookie') || '', /HttpOnly/);
    assert.match(success.headers.get('set-cookie') || '', /Secure/);
    assert.match(success.headers.get('set-cookie') || '', /SameSite=Strict/);
    const sessionToken = createSessionToken(process.env.HOMEFLOW_SESSION_SECRET!);
    const authenticatedRequest = new Request('https://homeflow.test/api/household', {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionToken}` },
    });
    assert.equal(requireApiSession(authenticatedRequest), null);

    const failure = await login(new Request('https://homeflow.test/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'incorrect password' }),
    }));
    assert.equal(failure.status, 401);

    const protectedResponse = await getHousehold(new Request('https://homeflow.test/api/household'));
    assert.equal(protectedResponse.status, 401);
  } finally {
    if (previous.nodeEnv === undefined) Reflect.deleteProperty(process.env, 'NODE_ENV');
    else Reflect.set(process.env, 'NODE_ENV', previous.nodeEnv);
    if (previous.password === undefined) Reflect.deleteProperty(process.env, 'HOMEFLOW_ACCESS_PASSWORD');
    else Reflect.set(process.env, 'HOMEFLOW_ACCESS_PASSWORD', previous.password);
    if (previous.secret === undefined) Reflect.deleteProperty(process.env, 'HOMEFLOW_SESSION_SECRET');
    else Reflect.set(process.env, 'HOMEFLOW_SESSION_SECRET', previous.secret);
  }
});

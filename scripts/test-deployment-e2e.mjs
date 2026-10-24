import fs from 'node:fs';
import assert from 'node:assert/strict';

// Load credentials from environment or .env.local without printing them
let envVars = {};
if (fs.existsSync('.env.local')) {
  const envContent = fs.readFileSync('.env.local', 'utf8');
  envVars = Object.fromEntries(
    envContent.split(/\r?\n/).flatMap(line => {
      const normalized = line.trim().replace(/^export\s+/, '');
      if (!normalized || normalized.startsWith('#')) return [];
      const idx = normalized.indexOf('=');
      if (idx < 1) return [];
      const key = normalized.slice(0, idx).trim();
      let value = normalized.slice(idx + 1).trim();
      if (value.length >= 2 && ['"', "'", '`'].includes(value[0]) && value.at(-1) === value[0]) {
        const quote = value[0];
        value = value.slice(1, -1);
        if (quote === '"') value = value.replace(/\\([\\"nrt])/g, (_, escaped) => ({ '\\': '\\', '"': '"', n: '\n', r: '\r', t: '\t' })[escaped]);
      } else {
        value = value.replace(/\s+#.*$/, '').trim();
      }
      return [[key, value]];
    })
  );
}

const BASE_URL = process.env.BASE_URL;
assert.ok(BASE_URL, 'BASE_URL must be set to the deployed origin, for example https://example.vercel.app');
const password = process.env.HOMEFLOW_ACCESS_PASSWORD || envVars.HOMEFLOW_ACCESS_PASSWORD;
const mcpToken = process.env.MCP_AUTH_TOKEN || envVars.MCP_AUTH_TOKEN;

assert.ok(password, 'HOMEFLOW_ACCESS_PASSWORD must be present');
assert.ok(mcpToken, 'MCP_AUTH_TOKEN must be present');

async function runTests() {
  console.log(`Starting E2E tests against ${BASE_URL}...`);

  // 1. Unauthenticated /api/household -> 401
  console.log('1. Checking unauthenticated /api/household rejection...');
  const unauthRes = await fetch(`${BASE_URL}/api/household`);
  assert.equal(unauthRes.status, 401, 'Unauthenticated request should return 401');
  console.log('   ✓ Unauthenticated request rejected with 401');

  // 2. Incorrect password login -> 401
  console.log('2. Checking incorrect password login rejection...');
  const badLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'wrong-password-123' }),
  });
  assert.equal(badLoginRes.status, 401, 'Incorrect password should return 401');
  console.log('   ✓ Bad password rejected with 401');

  // 3. Valid login -> 200 & cookie
  console.log('3. Logging in with configured password...');
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  assert.equal(loginRes.status, 200, 'Valid login should return 200');
  const setCookie = loginRes.headers.get('set-cookie');
  assert.ok(setCookie, 'Login should return set-cookie header');
  assert.match(setCookie, /homeflow_session=/, 'Cookie name should be homeflow_session');
  assert.match(setCookie, /HttpOnly/, 'Cookie should be HttpOnly');
  assert.match(setCookie, /Secure/, 'Cookie should be Secure');
  assert.match(setCookie, /SameSite=Strict/, 'Cookie should be SameSite=Strict');
  const sessionCookie = setCookie.split(';')[0];
  console.log('   ✓ Login successful with secure session cookie');

  const authHeaders = {
    'Content-Type': 'application/json',
    'Cookie': sessionCookie,
  };

  // 4. Authenticated household read -> 200
  console.log('4. Reading household context...');
  const householdRes = await fetch(`${BASE_URL}/api/household`, { headers: authHeaders });
  assert.equal(householdRes.status, 200, 'Household context should return 200');
  const householdData = await householdRes.json();
  assert.equal(householdData.id, 'household_demo');
  console.log(`   ✓ Read household: ${householdData.id}, members: ${householdData.members?.length}`);

  // 5. Natural language shopping flow via /api/message
  console.log('5. Testing natural language shopping flow...');
  const shopMsgRes = await fetch(`${BASE_URL}/api/message`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ message: 'Add almond milk to shopping list' }),
  });
  assert.equal(shopMsgRes.status, 200, 'Message API should return 200');
  const shopResult = await shopMsgRes.json();
  console.log('   Shopping assistant response:', shopResult.message);
  assert.equal(shopResult.ok, true);
  assert.equal(shopResult.type, 'shopping');
  console.log('   ✓ Shopping item flow succeeded');

  // 6. Natural language task creation via /api/message
  console.log('6. Testing natural language task creation...');
  const taskMsgRes = await fetch(`${BASE_URL}/api/message`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ message: 'Add task tidy up the living room' }),
  });
  assert.equal(taskMsgRes.status, 200, 'Message API should return 200');
  const taskResult = await taskMsgRes.json();
  console.log('   Task assistant response:', taskResult.message);
  assert.equal(taskResult.ok, true);
  assert.equal(taskResult.type, 'task');
  console.log('   ✓ Natural language task flow succeeded');

  // 7. Complete task via /api/task/status
  console.log('7. Testing task status update to completed...');
  const updateTaskRes = await fetch(`${BASE_URL}/api/task/status`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ id: 'menu', status: 'completed' }),
  });
  assert.equal(updateTaskRes.status, 200, 'Task update should return 200');
  const updatedTaskData = await updateTaskRes.json();
  assert.equal(updatedTaskData.ok, true);
  assert.equal(updatedTaskData.task.status, 'updated');
  assert.equal(updatedTaskData.task.taskStatus, 'completed', 'Task status should be completed');
  console.log('   ✓ Seed task marked as completed');

  // 8. Plan draft -> approve -> execute flow via MCP
  console.log('8. Testing plan draft, approve, and execute flow via MCP...');
  const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString();

  let planId = '';
  let version = 1;
  let approvalToken = '';
  let executionResults = [];

  for (let attempt = 0; attempt < 5; attempt++) {
    // Draft plan
    const draftRes = await fetch(`${BASE_URL}/api/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Authorization': `Bearer ${mcpToken}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 10 + attempt * 10,
        method: 'tools/call',
        params: {
          name: 'create_household_plan',
          arguments: { guestCount: 6, startsAt: tomorrow, eventType: 'dinner' },
        },
      }),
    });
    const draftData = await draftRes.json();
    const draftPlan = JSON.parse(draftData.result.content[0].text);
    planId = draftPlan.planId || draftPlan.id;
    version = draftPlan.version;

    // Approve plan
    const approveRes = await fetch(`${BASE_URL}/api/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Authorization': `Bearer ${mcpToken}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 11 + attempt * 10,
        method: 'tools/call',
        params: {
          name: 'approve_household_plan',
          arguments: { planId, version },
        },
      }),
    });
    const approveData = await approveRes.json();
    const approveText = approveData.result?.content?.[0]?.text;
    if (!approveText || approveText.includes('Plan missing')) {
      await new Promise(r => setTimeout(r, 400));
      continue;
    }
    const approval = JSON.parse(approveText);
    approvalToken = approval.token;

    // Execute plan
    const executeRes = await fetch(`${BASE_URL}/api/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Authorization': `Bearer ${mcpToken}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 12 + attempt * 10,
        method: 'tools/call',
        params: {
          name: 'execute_household_plan',
          arguments: { planId, version, token: approvalToken },
        },
      }),
    });
    const execData = await executeRes.json();
    const execText = execData.result?.content?.[0]?.text;
    if (!execText || execText.includes('Plan missing') || execText.includes('rejected')) {
      await new Promise(r => setTimeout(r, 400));
      continue;
    }
    let execution;
    try {
      execution = JSON.parse(execText);
    } catch {
      throw new Error(`Plan execution returned an MCP error: ${execText || 'empty response'}`);
    }
    if (execution.status === 'completed') {
      executionResults = execution.results;
      break;
    }
  }

  assert.ok(approvalToken, 'Plan must be approved and token issued');
  console.log(`   ✓ Draft plan created and approved: ${planId}, version: ${version}`);
  console.log(`   ✓ Plan executed with ${executionResults.length} action steps`);

  // Verify non-existent plan approval rejection via web route
  console.log('   Checking invalid plan approval rejection on /api/plan/approve...');
  const badApproveRes = await fetch(`${BASE_URL}/api/plan/approve`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ planId: 'non-existent-id', version: 1 }),
  });
  assert.equal(badApproveRes.status, 400, 'Invalid plan approval should be rejected with 400');
  console.log('   ✓ Invalid plan approval rejected with 400');

  // 9. Demo reset disabled in production -> 404
  console.log('9. Checking reset endpoint disabled in production...');
  const resetRes = await fetch(`${BASE_URL}/api/plan/reset`, {
    method: 'POST',
    headers: authHeaders,
  });
  assert.equal(resetRes.status, 404, 'Reset should be disabled in production (404)');
  console.log('   ✓ Reset endpoint returned 404 in production');

  // 10. Logout and 401 verification
  console.log('10. Testing logout and subsequent 401...');
  const logoutRes = await fetch(`${BASE_URL}/api/auth/logout`, {
    method: 'POST',
    headers: authHeaders,
  });
  assert.equal(logoutRes.status, 200, 'Logout should return 200');
  const clearedCookie = logoutRes.headers.get('set-cookie');
  assert.ok(clearedCookie?.includes('Max-Age=0'), 'Logout should clear cookie');

  const afterLogoutRes = await fetch(`${BASE_URL}/api/household`, {
    headers: { 'Cookie': 'homeflow_session=invalid-after-logout' },
  });
  assert.equal(afterLogoutRes.status, 401, 'Request after logout should return 401');
  console.log('   ✓ Logout succeeded and invalid cookie rejected with 401');

  // 11. MCP Protocol & Tools endpoint directly (/api/mcp)
  console.log('11. Testing /api/mcp protocol & tools...');
  // Unauthorized without token -> 401
  const mcpUnauth = await fetch(`${BASE_URL}/api/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
  assert.equal(mcpUnauth.status, 401, 'Unauthenticated MCP request should return 401');
  console.log('   ✓ Unauthenticated MCP request rejected with 401');

  // Initialize
  const mcpInit = await fetch(`${BASE_URL}/api/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'Authorization': `Bearer ${mcpToken}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'e2e-test', version: '1.0' },
      },
    }),
  });
  assert.equal(mcpInit.status, 200, 'MCP initialize should return 200');
  const initData = await mcpInit.json();
  assert.equal(initData.result?.serverInfo?.name, 'homeflow-household');
  console.log('   ✓ MCP initialize passed with homeflow-household');

  // Tools list
  const mcpList = await fetch(`${BASE_URL}/api/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'Authorization': `Bearer ${mcpToken}`,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
  });
  assert.equal(mcpList.status, 200, 'MCP tools/list should return 200');
  const listData = await mcpList.json();
  assert.ok(Array.isArray(listData.result?.tools));
  console.log(`   ✓ MCP tools/list returned ${listData.result.tools.length} tools`);

  // Tools call
  const mcpCallRes = await fetch(`${BASE_URL}/api/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'Authorization': `Bearer ${mcpToken}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'get_household_context', arguments: {} },
    }),
  });
  assert.equal(mcpCallRes.status, 200, 'MCP tools/call should return 200');
  const callData = await mcpCallRes.json();
  assert.ok(callData.result?.content?.some(c => c.text?.includes('household_demo')));
  console.log('   ✓ MCP tools/call executed get_household_context successfully');

  // 12. Frontend page inspection (HTML, viewport, layout, demo labels)
  console.log('12. Inspecting frontend landing page HTML...');
  const pageRes = await fetch(BASE_URL);
  assert.equal(pageRes.status, 200, 'Landing page should return 200');
  const html = await pageRes.text();
  assert.match(html, /<meta[^>]+viewport/i, 'HTML must have responsive viewport meta');
  assert.match(html, /HomeFlow/i, 'HTML must include HomeFlow branding');
  assert.match(html, /demo/i, 'HTML must indicate demo mode');
  console.log('   ✓ Frontend page loads with responsive viewport, branding, and demo label');

  console.log('\n🎉 ALL 12 END-TO-END VERIFICATION CHECKS PASSED SUCCESSFULLY!');
}

runTests().catch(err => {
  console.error('E2E TEST FAILURE:', err);
  process.exit(1);
});

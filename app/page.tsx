'use client';

import { useCallback, useEffect, useState } from 'react';

type Item = { id: string; title: string; detail: string; key: string; status?: string; scheduledAt?: string };
type Step = { kind: 'shopping' | 'task' | 'reminder' | 'message' | 'inventory_check'; title: string; detail: string; key: string; assignedTo?: string; priority?: string };
type Plan = { id: string; version: number; title: string; startsAt: string; guestCount: number; status: string; steps: Step[]; explanation: string; results: string[]; conflictWarnings?: string[]; reasoning?: string; eventType?: string };
type Activity = { id: string; tool: string; status: string; summary: string; at: string };
type Member = { id: string; name: string; role: string; preferredTasks: string[] };
type Preference = { category: string; key: string; value: string };
type Household = { id: string; name: string; timezone: string; members: Member[]; preferences: Preference[]; inventory: Item[]; tasks: Item[]; shopping: Item[]; reminders: Item[]; plans: Plan[]; events: any[]; history: Activity[] };
type Message = { role: 'user' | 'assistant'; text: string; type?: string };

const EXAMPLES = [
  "We're hosting six guests tomorrow at 7 PM",
  "Add milk to the shopping list",
  "Add task: Clean the garage",
  "What's on my shopping list?",
  "Remind me to call mom at 5 PM",
];

const QUICK_ACTIONS = [
  { label: '🎉 Plan Event', prompt: 'Plan an event for tomorrow' },
  { label: '🛒 Add Shopping', prompt: 'Add to shopping list' },
  { label: '✓ Add Task', prompt: 'Add a task' },
  { label: '📋 Check Status', prompt: 'What is my household status?' },
];

export default function Home() {
  const [household, setHousehold] = useState<Household | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [updatingTaskId, setUpdatingTaskId] = useState<string | null>(null);
  const [authenticated, setAuthenticated] = useState<boolean | null>(process.env.NODE_ENV !== 'production');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(true);

  const fetchHousehold = useCallback(async () => {
    const res = await fetch('/api/household');
    if (res.status === 401) {
      setAuthenticated(false);
      setHousehold(null);
      return;
    }
    if (!res.ok) throw new Error('Could not load your household.');
    setHousehold(await res.json());
    setAuthenticated(true);
  }, []);

  useEffect(() => {
    fetchHousehold().catch(err => {
      setError(err.message);
      setAuthenticated(false);
      setAuthError('Unable to load the household service. Check your server configuration.');
    });
    // Check if user has seen onboarding
    try {
      const hasSeenOnboarding = localStorage.getItem('homeflow-onboarding-seen');
      if (hasSeenOnboarding) {
        setShowOnboarding(false);
      }
    } catch (e) {
      // localStorage not available during SSR
      console.warn('localStorage not available:', e);
    }
  }, [fetchHousehold]);

  const post = async (path: string, body: unknown) => {
    const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== '/api/auth/login') setAuthenticated(false);
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  };

  const handleLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthLoading(true); setAuthError(null);
    try {
      await post('/api/auth/login', { password });
      setPassword('');
      await fetchHousehold();
      setAuthenticated(true);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Sign in failed.');
    } finally { setAuthLoading(false); }
  };

  const handleLogout = async () => {
    try {
      await post('/api/auth/logout', {});
      setHousehold(null);
      setAuthenticated(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign out failed.');
    }
  };

  const handleSend = async (suggestion?: string) => {
    const text = (suggestion ?? input).trim();
    if (!text || loading) return;
    setLoading(true); setError(null); setStatus('Processing your request…');
    setMessages(prev => [...prev, { role: 'user', text }]); setInput('');
    try {
      const data = await post('/api/message', { message: text });

      if (data.type === 'plan') {
        setPlan({ ...data.plan, results: data.plan.results ?? [] }); setToken(null);
        setMessages(prev => [...prev, { role: 'assistant', text: data.explanation || 'I prepared a draft plan for your review.', type: 'plan' }]);
        setStatus('Draft ready · nothing changes until you approve it.');
      } else if (data.type === 'clarification') {
        setMessages(prev => [...prev, { role: 'assistant', text: data.message, type: 'clarification' }]);
        setStatus('');
      } else if (data.type === 'status') {
        setMessages(prev => [...prev, { role: 'assistant', text: data.message, type: 'status' }]);
        setStatus('');
      } else if (data.type === 'help') {
        setMessages(prev => [...prev, { role: 'assistant', text: data.message, type: 'help' }]);
        setStatus('');
      } else {
        setMessages(prev => [...prev, { role: 'assistant', text: data.message || 'Done!' }]);
        setStatus('');
        await fetchHousehold();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong.';
      setError(message);
      setMessages(prev => [...prev, { role: 'assistant', text: message, type: 'error' }]);
      setStatus('Request could not be completed.');
    } finally { setLoading(false); }
  };

  const handleApprove = async () => {
    if (!plan) return;
    setLoading(true); setError(null); setStatus('Securing your approval…');
    try {
      const data = await post('/api/plan/approve', { planId: plan.id, version: plan.version });
      setToken(data.token); setPlan(prev => prev ? { ...prev, status: 'approved' } : null);
      setStatus(`Approved · token expires at ${formatDate(data.expiresAt)}.`);
      setMessages(prev => [...prev, { role: 'assistant', text: `Approved. ${plan.steps.length} actions are ready when you are.`, type: 'success' }]);
    } catch (err) { setError(err instanceof Error ? err.message : 'Approval failed.'); setStatus('Approval failed.'); }
    finally { setLoading(false); }
  };

  const handleExecute = async () => {
    if (!plan || !token) return;
    setLoading(true); setError(null); setStatus('Applying approved actions through MCP…');
    try {
      const data = await post('/api/plan/execute', { planId: plan.id, version: plan.version, token });
      setPlan(prev => prev ? { ...prev, status: 'completed', results: data.results || [] } : null);
      setStatus('All approved actions were applied.');
      setMessages(prev => [...prev, { role: 'assistant', text: `Done. ${data.results?.length || 0} household updates are complete.`, type: 'success' }]);
      await fetchHousehold();
    } catch (err) { setError(err instanceof Error ? err.message : 'Execution failed.'); setStatus('Execution failed · no changes were applied.'); }
    finally { setLoading(false); }
  };

  const handleCancel = async () => {
    if (!plan) return;
    setLoading(true);
    try { await post('/api/plan/cancel', { planId: plan.id }); setPlan(null); setToken(null); setStatus('Draft cancelled · no actions were applied.'); }
    catch (err) { setError(err instanceof Error ? err.message : 'Cancel failed.'); }
    finally { setLoading(false); }
  };

  const handleReset = async () => {
    if (!confirm('Reset the demo household? Current plans and changes will be cleared.')) return;
    setLoading(true);
    try { await post('/api/plan/reset', {}); setPlan(null); setToken(null); setMessages([]); setStatus('Demo household restored.'); setError(null); await fetchHousehold(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Reset failed.'); }
    finally { setLoading(false); }
  };

  const handleToggleTask = async (task: Item) => {
    setUpdatingTaskId(task.id); setError(null);
    try {
      await post('/api/task/status', { id: task.id, status: task.status === 'completed' ? 'open' : 'completed' });
      await fetchHousehold();
      setStatus(task.status === 'completed' ? 'Task reopened.' : 'Task completed.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update task.');
    } finally { setUpdatingTaskId(null); }
  };

  const dismissOnboarding = () => {
    try {
      localStorage.setItem('homeflow-onboarding-seen', 'true');
    } catch (e) {
      console.warn('localStorage not available:', e);
    }
    setShowOnboarding(false);
  };

  const formatDate = (date: string) => new Date(date).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const kindIcon = (kind: Step['kind']) => kind === 'shopping' ? '🛒' : kind === 'task' ? '✓' : kind === 'reminder' ? '◷' : kind === 'message' ? '💬' : '📦';
  const completedPlans = household?.plans.filter(item => item.status === 'completed').length ?? 0;

  if (authenticated === null) {
    return <main className="home-shell auth-screen"><div className="auth-panel">Loading your household…</div></main>;
  }

  if (!authenticated) {
    return (
      <main className="home-shell auth-screen">
        <section className="auth-panel">
          <div className="brand"><div className="brand-mark">H</div><div className="brand-name">Home<span>Flow</span></div></div>
          <h1>Welcome back</h1>
          <p>Sign in to your household.</p>
          {authError && <div className="status-banner error" role="alert">{authError}</div>}
          <form className="auth-form" onSubmit={handleLogin}>
            <label htmlFor="household-password">Household password</label>
            <input id="household-password" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required maxLength={256} />
            <button className="primary-btn" type="submit" disabled={authLoading || !password}>{authLoading ? 'Signing in…' : 'Sign in'}</button>
          </form>
        </section>
      </main>
    );
  }

  if (showOnboarding) {
    return (
      <main className="home-shell">
        <div className="onboarding-overlay">
          <div className="onboarding-card">
            <div className="onboarding-icon">🏠</div>
            <h1>Welcome to HomeFlow</h1>
            <p className="onboarding-subtitle">Your household, coordinated with AI</p>

            <div className="onboarding-features">
              <div className="feature">
                <span className="feature-icon">🎉</span>
                <strong>Plan Events</strong>
                <p>Describe any event and I'll create a complete preparation plan</p>
              </div>
              <div className="feature">
                <span className="feature-icon">🛒</span>
                <strong>Manage Shopping</strong>
                <p>Add items to your shopping list with natural language</p>
              </div>
              <div className="feature">
                <span className="feature-icon">✓</span>
                <strong>Track Tasks</strong>
                <p>Create and assign household tasks automatically</p>
              </div>
              <div className="feature">
                <span className="feature-icon">🔒</span>
                  <strong>Plan Approval</strong>
                  <p>Event plans need approval; direct task and shopping requests apply immediately</p>
              </div>
            </div>

            <div className="onboarding-examples">
              <p className="examples-title">Try saying:</p>
              {EXAMPLES.slice(0, 3).map((example, i) => (
                <div key={i} className="example-bubble">"{example}"</div>
              ))}
            </div>

            <button className="onboarding-button" onClick={dismissOnboarding}>
              Get Started →
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="home-shell">
      <div className="app-frame">
        <header className="topbar">
          <div className="brand"><div className="brand-mark">H</div><div className="brand-name">Home<span>Flow</span></div></div>
          <div className="top-actions">
            <button className="text-btn" onClick={() => setShowOnboarding(true)}>Help</button>
            <span className="live-dot">MCP connected</span>
            {process.env.NODE_ENV === 'production' && <button className="text-btn" onClick={handleLogout}>Sign out</button>}
            {process.env.NODE_ENV !== 'production' && <button className="outline-btn" onClick={handleReset} disabled={loading}>Reset demo</button>}
          </div>
        </header>

        <section className="hero">
          <div><p className="eyebrow">Household command center</p><h1>Your home, one step ahead.</h1><p className="hero-copy">Turn a simple request into a thoughtful plan for the people, tasks, and details that keep your household moving.</p></div>
          <div className="hero-badge"><strong>{household?.tasks.length ?? '—'}</strong><span>open household tasks</span></div>
        </section>

        {error && <div className="status-banner error">{error}</div>}
        {status && !error && <div className="status-banner info">{status}</div>}

        <div className="dashboard-grid">
          <section className="panel conversation">
            <div className="panel-head"><div><h2 className="panel-title">Talk to HomeFlow</h2><div className="panel-subtitle">Describe what you need in your own words</div></div><span className="pill approved">AI-ready</span></div>
            <div className="chat-scroll">
              {messages.length === 0 ? (
                <div className="empty-chat">
                  <div className="empty-icon">✦</div>
                  <strong>What can I help you with?</strong>
                  <div className="quick-actions">
                    {QUICK_ACTIONS.map((action, i) => (
                      <button key={i} className="quick-action" onClick={() => handleSend(action.prompt)} disabled={loading}>
                        {action.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : messages.map((message, index) => (
                <div key={index} className={`bubble ${message.role} ${message.type || ''}`}>
                  <span className="bubble-label">{message.role === 'user' ? 'You' : 'HomeFlow'}</span>
                  {message.text}
                </div>
              ))}
              {loading && <div className="bubble assistant"><span className="bubble-label">HomeFlow</span>Thinking through your household context…</div>}
            </div>
            <div className="composer">
              <input
                value={input}
                onChange={event => setInput(event.target.value)}
                onKeyDown={event => event.key === 'Enter' && handleSend()}
                disabled={loading}
                placeholder="e.g. Plan a dinner for 6 guests tomorrow at 7 PM, Add milk to shopping list..."
              />
              <button className="send-btn" onClick={() => handleSend()} disabled={loading || !input.trim()}>Send</button>
            </div>
            <div className="suggestions">
              {EXAMPLES.map(example => (
                <button className="suggestion" key={example} onClick={() => handleSend(example)} disabled={loading}>
                  {example}
                </button>
              ))}
            </div>
          </section>

          <section className="panel plan-card">
            <div className="panel-head"><div><h2 className="panel-title">Your plan</h2><div className="panel-subtitle">Review every action before it happens</div></div>{plan && <span className={`pill ${plan.status}`}>{plan.status}</span>}</div>
            {!plan ? <div className="empty-chat"><div className="empty-icon">◌</div><strong>Your next plan will appear here</strong><br />HomeFlow will check your lists, preferences, and existing tasks first.</div> :
              <div className="plan-content">
                <div className="plan-heading">
                  <div>
                    <h3>{plan.title}</h3>
                    <div className="plan-meta">{formatDate(plan.startsAt)} · {plan.guestCount} guests · {plan.eventType || 'dinner'} · v{plan.version}</div>
                  </div>
                </div>
                {plan.conflictWarnings && plan.conflictWarnings.length > 0 && (
                  <div className="conflict-warnings">
                    <strong>⚠️ Conflicts detected:</strong>
                    {plan.conflictWarnings.map((warning, idx) => <div key={idx} className="conflict-item">{warning}</div>)}
                  </div>
                )}
                <p className="explanation">{plan.explanation}</p>
                {plan.reasoning && <p className="reasoning"><em>{plan.reasoning}</em></p>}
                <div className="step-list">{plan.steps.map(step => <div className="step" key={step.key}><div className="step-icon">{kindIcon(step.kind)}</div><div className="step-copy"><div className="step-title">{step.title}{step.assignedTo && <span className="assignee"> · {step.assignedTo}</span>}</div><div className="step-detail">{step.detail}</div></div></div>)}</div>
                <div className="actions">{plan.status === 'pending' && <><button className="primary-btn" onClick={handleApprove} disabled={loading}>Approve plan</button><button className="secondary-btn" onClick={handleCancel} disabled={loading}>Cancel</button></>}{plan.status === 'approved' && <><button className="success-btn" onClick={handleExecute} disabled={loading || !token}>Execute plan</button><button className="secondary-btn" onClick={handleCancel} disabled={loading}>Cancel</button></>}{plan.status === 'completed' && <button className="secondary-btn" onClick={handleReset}>Start a new plan</button>}</div>{(plan.results ?? []).length > 0 && <div className="result-box">{(plan.results ?? []).map((result, idx) => <div key={idx}>✓ {result}</div>)}</div>}
              </div>}
          </section>

          <div className="side-stack">
            <section className="panel"><div className="panel-head"><div><h2 className="panel-title">Household pulse</h2><div className="panel-subtitle">A quick view of what is happening</div></div></div><div className="household-info"><div className="household-name">{household?.name || 'Loading household…'}</div><div className="household-meta">{household?.timezone} · {household?.members.map(m => m.name).join(' & ')}</div></div><div className="stats"><div className="stat"><strong>{household?.shopping.length ?? '—'}</strong><span>shopping items</span></div><div className="stat"><strong>{household?.reminders.length ?? '—'}</strong><span>reminders</span></div><div className="stat"><strong>{completedPlans}</strong><span>plans completed</span></div><div className="stat"><strong>{household?.inventory.length ?? '—'}</strong><span>in inventory</span></div></div></section>
            <section className="panel"><div className="panel-head"><div><h2 className="panel-title">Recent activity</h2><div className="panel-subtitle">A transparent record of actions</div></div></div><div className="activity-list">{(household?.history || []).slice(0, 8).map(activity => <div className={`activity ${activity.status === 'error' ? 'error' : ''}`} key={activity.id}><span className="activity-mark">{activity.status === 'error' ? '!' : '✓'}</span><div><div className="activity-tool">{activity.tool}</div><div className="activity-summary">{activity.summary}</div></div></div>)}{!(household?.history?.length) && <div className="activity-summary">No activity yet.</div>}</div></section>
          </div>
        </div>

        <section className="lists"><ListCard title="Shopping list" items={household?.shopping || []} /><ListCard title="Open tasks" items={household?.tasks || []} onToggleTask={handleToggleTask} updatingTaskId={updatingTaskId} /><ListCard title="Reminders" items={household?.reminders || []} /></section>
        <footer className="footer">HomeFlow · Event plans require approval; direct list requests apply immediately.</footer>
      </div>
    </main>
  );
}

function ListCard({ title, items, onToggleTask, updatingTaskId }: { title: string; items: Item[]; onToggleTask?: (item: Item) => void; updatingTaskId?: string | null }) {
  const isTaskList = title === 'Open tasks';
  const openItems = isTaskList ? items.filter(item => item.status !== 'completed' && item.status !== 'cancelled') : items;
  const completedItems = isTaskList ? items.filter(item => item.status === 'completed') : [];
  const renderItem = (item: Item) => onToggleTask ? (
    <label className={`list-item task-list-item ${item.status === 'completed' ? 'completed' : ''}`} key={item.id}>
      <input type="checkbox" checked={item.status === 'completed'} disabled={updatingTaskId === item.id} onChange={() => onToggleTask(item)} aria-label={`${item.status === 'completed' ? 'Reopen' : 'Complete'} ${item.title}`} />
      <span className="task-item-copy"><strong>{item.title}</strong><span>{`${item.detail.replace(/\s*[·•]\s*(?:open|completed)$/i, '').trim()} · ${item.status || 'open'}`}</span></span>
    </label>
  ) : <div className="list-item" key={item.id}><strong>{item.title}</strong><span>{item.scheduledAt ? new Date(item.scheduledAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : item.detail}</span></div>;

  return (
    <section className="panel list-card">
      <div className="list-head"><h3>{title}</h3><span className="count">{openItems.length}</span></div>
      <div className="list-items">
        {openItems.length ? openItems.map(renderItem) : <div className="activity-summary">Nothing here yet.</div>}
        {completedItems.length > 0 && (
          <details className="completed-tasks">
            <summary>Completed ({completedItems.length})</summary>
            {completedItems.map(renderItem)}
          </details>
        )}
      </div>
    </section>
  );
}

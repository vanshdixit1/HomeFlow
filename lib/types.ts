export type Item = { id: string; title: string; detail: string; key: string; status?: 'open' | 'completed' | 'cancelled'; scheduledAt?: string };
export type Step = {
  kind: 'shopping' | 'task' | 'reminder' | 'message' | 'inventory_check';
  title: string;
  detail: string;
  key: string;
  assignedTo?: string;
  priority?: 'low' | 'medium' | 'high';
  estimatedDuration?: number;
};
export type Plan = {
  id: string;
  version: number;
  title: string;
  startsAt: string;
  guestCount: number;
  eventType: 'dinner' | 'birthday' | 'party' | 'meeting' | 'other';
  status: 'pending' | 'approved' | 'completed' | 'cancelled';
  steps: Step[];
  explanation: string;
  results: string[];
  conflictWarnings?: string[];
  reasoning?: string;
  createdAt: string;
  updatedAt: string;
};
export type Activity = {
  id: string;
  tool: string;
  status: 'success' | 'error';
  summary: string;
  at: string;
  userId?: string;
  metadata?: Record<string, unknown>;
};
export type Member = {
  id: string;
  name: string;
  role: 'organizer' | 'member' | 'guest';
  availability: string[];
  preferredTasks: string[];
  email?: string;
  phone?: string;
};
export type Event = {
  id: string;
  title: string;
  description?: string;
  startsAt: string;
  endsAt?: string;
  guestCount: number;
  eventType: 'dinner' | 'birthday' | 'party' | 'meeting' | 'other';
  status: 'planned' | 'confirmed' | 'cancelled' | 'completed';
  location?: string;
  createdBy: string;
  notes?: string;
};
export type Preference = {
  category: 'dietary' | 'scheduling' | 'assignment' | 'other';
  key: string;
  value: string;
  appliesTo?: string[];
};
export type Household = {
  id: string;
  name: string;
  timezone: string;
  members: Member[];
  preferences: Preference[];
  inventory: Item[];
  tasks: Item[];
  shopping: Item[];
  reminders: Item[];
  plans: Plan[];
  events: Event[];
  history: Activity[];
  createdAt: string;
  updatedAt: string;
};
export type Trace = { tool: string; status: 'success' | 'error'; summary: string };
export type Conflict = {
  type: 'time_overlap' | 'resource_conflict' | 'member_overload' | 'duplicate_event';
  description: string;
  affectedItems: string[];
  severity: 'low' | 'medium' | 'high';
};
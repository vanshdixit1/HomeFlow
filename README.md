# HomeFlow

**Your household, coordinated.**

HomeFlow is a self-hosted household coordination app. It turns natural-language requests into event plans, tasks, shopping-list updates, and reminders, with explicit approval before multi-action event plans are executed.

## 🎯 Features

- **Natural Language Planning**: Describe events in plain English (e.g., "We're hosting six guests tomorrow at 7 PM")
- **Multi-Event Support**: Handle dinners, birthday parties, meetings, and custom events
- **Intelligent Task Assignment**: Automatically assign tasks based on household preferences
- **Conflict Detection**: Identify scheduling conflicts and resource limitations
- **Approval-Gated Event Plans**: Event plans require explicit approval; direct task and shopping requests apply immediately
- **Interactive Tasks**: Complete and reopen household tasks from the dashboard
- **Scheduled Reminders**: Store future reminder times and prevent duplicates (delivery is not included)
- **Household Memory**: Remembers preferences, assignments, and dietary restrictions
- **MCP Integration**: Full Model Context Protocol server with Streamable HTTP transport
- **No-cloud default**: Local SQLite and deterministic planning require no AWS account or service charges
- **Local Fallback**: Works completely offline with SQLite and deterministic planning

## 🏗️ Architecture

```
┌─────────────────────────┐
│   Web Dashboard (Next.js)│
│   - Conversation UI     │
│   - Plan Review         │
│   - Household Dashboard │
└────────────┬────────────┘
             │
             │ HTTP API
             ▼
┌─────────────────────────┐
│   MCP Client            │
│   Streamable HTTP       │
└────────────┬────────────┘
             │
             │ MCP Protocol
             ▼
┌─────────────────────────┐
│   HomeFlow MCP Server   │
│   - Express + MCP SDK   │
│   - Tool Registration   │
│   - Approval System     │
└────────────┬────────────┘
             │
     ┌───────┴────────┐
     ▼                ▼
┌──────────┐   ┌──────────────┐
│ SQLite   │   │ AWS (Optional)│
│ Store    │   │ - Bedrock    │
│          │   │ - InvokeModel│
└──────────┘   └──────────────┘
```

## Screenshots

> Screenshot placeholder: add a dashboard image under `docs/screenshots/` before publishing a live demo.

> Demo GIF placeholder: add a short event-planning and approval walkthrough under `docs/screenshots/` when captured.

## 📦 Installation

```bash
# Clone the repository
git clone <repository-url>
cd alexa+

# Install the locked dependency tree
npm ci

# Copy environment configuration (PowerShell)
Copy-Item .env.example .env

# No AWS setup is required for the local demo.
```

## 🚀 Running the Application

### Development Mode

```bash
# Start both Next.js web app and MCP server
npm run dev

# The web app will be available at http://localhost:3000
# The MCP server will be available at http://localhost:3001/mcp

# In a second terminal, verify the protocol version and required tools
npm run mcp:smoke
```

### Production Mode

```bash
# Build the Next.js app
npm run build

# Start the production server
npm start

# Start the MCP server separately
npm run mcp
```

### MCP Server Only

```bash
npm run mcp
```

## 🔧 Environment Variables

Create a `.env` file in the project root:

```bash
# MCP Configuration
MCP_PORT=3001
MCP_URL=http://127.0.0.1:3001/mcp

# Database (Optional - defaults to data/homeflow.sqlite)
HOMEFLOW_DB=/path/to/database.sqlite

# Keep cloud services disabled for the no-cost local demo.
HOMEFLOW_BEDROCK_ENABLED=false
```

## 🛠️ MCP Tools

The HomeFlow MCP server exposes the following tools:

### Context Tools
- `get_household_context` - Full household state (members, preferences, inventory, tasks, shopping, reminders, plans, events, history)
- `get_open_tasks` - List open household tasks
- `get_shopping_list` - List shopping items
- `get_upcoming_events` - List future events and plans
- `get_inventory` - List household inventory
- `get_action_history` - Audit log of recent actions

### Planning Tools
- `create_household_plan` - Draft a preparation plan (guest count, start time, event type)
- `approve_household_plan` - Approve a draft plan (returns execution token)
- `execute_household_plan` - Execute an approved plan (requires token)
- `cancel_household_plan` - Cancel a pending plan

### Action Tools
- `create_task` - Create a household task (with duplicate detection)
- `update_task` - Update an existing task
- `add_shopping_item` - Add shopping item (with duplicate detection)
- `delete_shopping_item` - Remove a specific shopping item by id
- `schedule_reminder` - Schedule a future reminder
- `request_member_confirmation` - Request confirmation from a household member

### Management Tools
- `create_event` - Create a new event (with conflict detection)
- `update_event` - Update an existing event
- `delete_event` - Delete an event
- `add_preference` - Add a household preference
- `update_member` - Update a household member

## HTTP API

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/household` | Read household state; production requires a session |
| `POST` | `/api/message` | Parse and handle a natural-language request |
| `POST` | `/api/task/status` | Complete or reopen a task |
| `POST` | `/api/plan/approve` | Approve a plan version |
| `POST` | `/api/plan/execute` | Execute an approved plan with its token |
| `POST` | `/api/plan/cancel` | Cancel a pending/approved plan |
| `POST` | `/api/plan/reset` | Reset demo data; unavailable in production |
| `POST` | `/api/auth/login` | Create a production session |
| `POST` | `/api/auth/logout` | End the current session |

The MCP server is also available at `/mcp` over Streamable HTTP. Its required tools and protocol version can be checked with `npm run mcp:smoke`.

## 📖 Usage Examples

### Example 1: Dinner Preparation

**Request**: "We're hosting six guests tomorrow at 7 PM. Help me get the house ready."

**HomeFlow Response**:
```
I checked your household context and prepared a draft plan.

Event: Dinner with 6 guests
Time: Tomorrow at 7:00 PM
Type: dinner

Shopping items (4):
- Pasta (enough for 6 guests · Vansh)
- Tomato sauce (enough for 6 guests · Vansh)
- Salad ingredients (enough for 6 guests · Vansh)
- Peanut-free dessert (enough for 6 guests · Vansh)

Tasks (3):
- Clean living room (Anika · before event)
- Prepare dining table (Anika · before event)
- Check guest bathroom (Anika · before event)

Reminder:
- Start guest preparation (3 hours before event)

Checked household preferences: Vegetarian menu preferred, No peanuts.
Available: Dinner plates (12 available), Sparkling water (8 bottles).

[Approve plan] [Cancel]
```

### Example 2: Birthday Party

**Request**: "We're having a birthday party for 8 guests tomorrow at 5 PM."

**HomeFlow Response**:
```
Event: Birthday celebration for 8 guests
Time: Tomorrow at 5:00 PM
Type: birthday

Shopping items (7):
- Pasta (enough for 8 guests · Vansh)
- Tomato sauce (enough for 8 guests · Vansh)
- Salad ingredients (enough for 8 guests · Vansh)
- Peanut-free dessert (enough for 8 guests · Vansh)
- Birthday cake (enough for 8 guests · Vansh)
- Candles (enough for 8 guests · Vansh)
- Balloons (enough for 8 guests · Vansh)

Tasks (6):
- Clean living room (Anika · before event)
- Prepare dining table (Anika · before event)
- Check guest bathroom (Anika · before event)
- Set up decorations (Anika · before event)
- Prepare cake area (Anika · before event)
- Arrange music (Anika · before event)

[Approve plan] [Cancel]
```

### Example 3: Meeting Setup

**Request**: "We need a meeting with 5 attendees tomorrow at 2 PM."

**HomeFlow Response**:
```
Event: Meeting with 5 attendees
Time: Tomorrow at 2:00 PM
Type: meeting

Shopping items (5):
- Coffee (enough for 5 attendees · Vansh)
- Tea (enough for 5 attendees · Vansh)
- Light snacks (enough for 5 attendees · Vansh)
- Water (enough for 5 attendees · Vansh)
- Notebooks/pens (enough for 5 attendees · Vansh)

Tasks (4):
- Clean meeting area (Anika · before event)
- Set up chairs (Anika · before event)
- Prepare refreshments (Anika · before event)
- Test audio/video (Anika · before event)

[Approve plan] [Cancel]
```

## 🔒 Security and Approval Model

### Approval Flow
1. **Draft**: Create a plan with proposed actions (no changes made)
2. **Review**: User reviews the plan, conflict warnings, and reasoning
3. **Approve**: User approves the plan, server issues a time-bound token
4. **Execute**: Plan is executed with the token, changes are applied
5. **Audit**: All actions are logged in the action history

### Safety Rules
- Event plan actions are not applied until explicitly approved
- Direct task, shopping, and reminder requests apply immediately after validation
- Execution tokens are bound to specific plan versions
- Expired or invalid tokens are rejected
- All actions are logged for audit
- Duplicate items are detected and skipped
- Past-time reminders are rejected
- Conflicts are detected and shown before approval

## 🧪 Testing

```bash
# Run unit tests
npm test

# Type checking
npm run typecheck

# MCP endpoint qualification check (requires `npm run dev` in another terminal)
npm run mcp:smoke
```

## Alexa+ Qualification Demo

HomeFlow uses the self-hosted MCP server track. Start the web app and server with `npm run dev`; the MCP endpoint is `http://127.0.0.1:3001/mcp`. The server uses `@modelcontextprotocol/sdk` 1.32.1 and negotiates Streamable HTTP protocol `2025-11-25`. Run `npm run mcp:smoke` to verify the negotiated version and required household, planning, and approval tools.

The web app also provides the simulated-experience path; its source code and working workflows are included in this repository.

## Production Deployment Status

This repository is a self-hosted, single-household deployment—not a multi-tenant SaaS. In production, set `HOMEFLOW_ACCESS_PASSWORD` (at least 16 characters), `HOMEFLOW_SESSION_SECRET` (at least 32 characters), and `MCP_AUTH_TOKEN`. Use a TLS reverse proxy and inject these as deployment secrets; never commit them. The web app uses an HttpOnly, Secure, SameSite session cookie and the MCP endpoint requires bearer authentication. Configure the reverse proxy to overwrite client-supplied `X-Real-IP`/`X-Forwarded-For`; the included login throttle is process-local and must be replaced with a shared limiter for multiple instances. Before serving multiple homes, add individual accounts, tenant-scoped authorization/storage, managed relational persistence, backups/migrations, and a production deployment/monitoring pipeline. SQLite remains single-node and household state is not tenant-isolated.

Generate random secrets locally without sending them anywhere:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

### Vercel

The Next.js app can be built for Vercel, but the Express MCP server is a separate long-running service and must be deployed separately with a stable HTTPS endpoint. Set `MCP_URL` to that endpoint and configure the same `MCP_AUTH_TOKEN` on both services, plus `HOMEFLOW_ACCESS_PASSWORD` and `HOMEFLOW_SESSION_SECRET` for the web deployment. Do not use the default SQLite file on Vercel serverless storage: its filesystem is not a durable shared database. Use persistent single-instance hosting for this SQLite demo, or complete a managed-database migration before scaling. This project has not been deployed to Vercel; no live URL is claimed.

## 📊 Project Structure

```
homeflow/
├── app/                      # Next.js App Router
│   ├── page.tsx             # Main dashboard UI
│   ├── layout.tsx           # Root layout
│   ├── globals.css          # Global styles
│   └── api/                 # API routes
│       ├── household/       # Household context endpoint
│       ├── message/         # Message parsing endpoint
│       └── plan/            # Plan lifecycle endpoints
├── lib/                     # Core business logic
│   ├── types.ts             # TypeScript type definitions
│   ├── store.ts             # SQLite data store
│   ├── planner.ts           # Natural language parser
│   ├── mcp-client.ts        # MCP client wrapper
│   └── aws/                 # AWS integrations
│       ├── bedrock.ts       # Amazon Bedrock client
│       └── dynamodb.ts      # DynamoDB adapter
├── server/                  # MCP Server
│   └── index.ts             # Express + MCP SDK server
├── skills/                  # Agent Skills
│   └── household-operations/
│       └── SKILL.md         # Household operations skill
├── tests/                   # Test files
├── data/                    # SQLite database (created at runtime)
├── .env.example             # Environment template
├── package.json             # Dependencies
└── README.md                # This file
```

## 🌐 AWS Integration

### Amazon Bedrock
Bedrock is disabled by default and is not needed for the Alexa+ MCP or simulated-experience tracks. Setting `HOMEFLOW_BEDROCK_ENABLED=true` explicitly enables `InvokeModel` and may incur AWS charges. The no-cost demo uses the deterministic local parser.

### Amazon DynamoDB
`lib/aws/dynamodb.ts` is an adapter prototype only. The running application stores household data in SQLite; DynamoDB persistence is not wired into the app and is not claimed as a working integration.

No AWS credentials, IAM Identity Center, or cloud account setup is needed for the local demo. Do not set `HOMEFLOW_BEDROCK_ENABLED=true` unless you intentionally want to use AWS and have reviewed its pricing.

## 🎨 Customization

### Adding New Event Types
Edit `lib/store.ts` and add new event types to the `getShoppingItemsForEvent` and `getTasksForEvent` methods.

### Modifying Assignment Logic
Edit the `assignTaskToMember` method in `lib/store.ts` to customize task assignment rules.

### Adding New Preferences
Add new preference categories in `lib/types.ts` and update the assignment logic accordingly.

## 🚧 Known Limitations

- Reminders are stored locally, not delivered
- Shopping items are not automatically purchased
- Member availability is not actively managed (preference-based only)
- Conflict detection is time-based (doesn't check member schedules)
- Event end times are estimated (3 hours by default)

## 🔮 Future Roadmap

- [ ] Real reminder delivery (email, SMS, push notifications)
- [ ] Integration with shopping services
- [ ] Calendar synchronization
- [ ] Member availability management
- [ ] Advanced conflict resolution suggestions
- [ ] Multi-household support
- [ ] Mobile app
- [ ] Voice integration (Alexa)
- [ ] Smart home device integration
- [ ] Expense tracking

## 📄 License

MIT. See [LICENSE](LICENSE).

## Contributors

Vansh Dixit — project owner and maintainer.

## 🤝 Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) for setup and checks, and [SECURITY.md](SECURITY.md) to report vulnerabilities privately.

---

Built for the Alexa+ hackathon.

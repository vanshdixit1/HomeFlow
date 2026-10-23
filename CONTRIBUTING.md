# Contributing

Thanks for considering a contribution to HomeFlow.

## Development setup

- Node.js 24 or newer
- npm (use the committed `package-lock.json`)

```powershell
npm ci
Copy-Item .env.example .env
npm run dev
```

The local application uses SQLite and deterministic planning by default. Do not enable Bedrock unless you intentionally want AWS requests that may incur charges.

## Before opening a change

Run the relevant checks:

```powershell
npm test
npm run typecheck
npm run build
```

For MCP protocol changes, start the MCP server and run `npm run mcp:smoke`.

Keep changes focused, add regression tests for behavior changes, and do not commit `.env`, database files, credentials, generated output, or local IDE settings. Report security issues privately as described in [SECURITY.md](SECURITY.md).

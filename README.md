# RAMCO MCP (amsmcp)

Monorepo for the **RAMCO MCP Server**: a remote [Model Context Protocol](https://modelcontextprotocol.io) server that lets Claude (Claude Code, Claude Desktop, claude.ai) query a [RAMCO AMS](https://www.ramcoams.com) association database in natural language.

Production: **https://ramco.amsmcp.dev**. MCP endpoint `https://ramco.amsmcp.dev/http`, documentation at `https://ramco.amsmcp.dev/docs`.

## What's in this repo

```
turbo-mcp/
├── apps/
│   └── ramco/                           # The MCP server + docs site (Astro SSR, deployed to Vercel)
│       ├── src/pages/http.ts            # MCP endpoint (Streamable HTTP)
│       ├── src/pages/http-v1.ts         # Legacy v1 endpoint
│       ├── src/pages/sse-v1.ts          # Legacy SSE endpoint
│       ├── src/lib/ramco-client-v2.ts   # RAMCO API client: retry, cache, StreamToken paging
│       ├── src/lib/mcp/                 # Protocol handler, tool registry, tool definitions, header helpers
│       ├── src/lib/tools/               # One file per tool group (search, analytics, payment, ...)
│       ├── src/lib/validation/          # Zod input schemas for every tool
│       ├── src/content/docs/            # Starlight docs served at /docs
│       ├── tests/integration/           # Live-API integration tests
│       └── examples/                    # Standalone usage examples
├── packages/                            # Shared ESLint / TypeScript config and a UI stub
│                                        # (Turborepo starter leftovers; apps/ramco does not import them)
├── turbo.json                           # Turborepo task pipeline
└── vercel.json                          # Points Vercel at apps/ramco's build output
```

Only `apps/ramco` is deployed.

## How it works

1. A Claude client sends MCP requests to `/http` with a RAMCO API key and an optional association ID.
   - Key: `Key`, `Authorization: Bearer <key>`, `x-api-key`, or `X-RAMCO-API-Key` header
   - Association: `ramco-association-id` header, or `?association=<guid>` on the URL for clients that cannot send custom headers
2. The protocol handler validates input with Zod, builds a `RamcoClient` for that key, and dispatches to the tool.
3. Tools call the RAMCO v2 API (form-encoded POST to `https://api.ramcoams.com/api/v2/`). Searches page through RAMCO's `StreamToken` mechanism, so `search_records` returns complete lists with a `nextCursor` rather than a sample.
4. Results come back as Markdown the model reads directly.

No API keys are stored server-side. Every request carries its own credentials.

### Tools

18 tools, defined in `apps/ramco/src/lib/mcp/tool-definitions.ts`:

- **Core data**: `test_connection`, `get_association_info`, `search_records`, `get_record`, `get_related_records`, `get_entity_types`, `get_schema`, `get_entity_info`
- **Analytics**: `analyze_membership_health`, `get_churn_risk_report`, `generate_membership_snapshot`, `analyze_payment_health`, `calculate_member_engagement`, `calculate_engagement_distribution`
- **Bulk / segmentation**: `search_members_bulk`, `segment_all_members`, `find_all_at_risk_members`, `identify_member_patterns`

The server is read-only. Create, update and delete exist in the client but are not exposed as tools.

## Connecting a Claude client

**Claude Code**

```bash
claude mcp add ramco https://ramco.amsmcp.dev/http -t http \
  -H "Key: YOUR_RAMCO_API_KEY" \
  -H "ramco-association-id: YOUR_ASSOCIATION_GUID"
```

**Claude Desktop / claude.ai**: add `https://ramco.amsmcp.dev/http?association=YOUR_ASSOCIATION_GUID` as a custom connector (Customize > Connectors > Add custom connector), choose **No sign-in**, and add an `authorization` request header with the value `Bearer YOUR_RAMCO_API_KEY`. If the Request headers section is not available on your account yet, use the `mcp-remote` bridge instead. Note that `claude_desktop_config.json` does not accept `url` / `headers` entries.

Step-by-step instructions for every client, including `mcp-remote`: https://ramco.amsmcp.dev/docs/installation

## Development

Requirements: Node.js 18+ (22 recommended) and [Bun](https://bun.sh), the repo's package manager.

```bash
bun install

# Server + docs site on http://localhost:3001
bun run dev                     # all workspaces via turbo
cd apps/ramco && bun run dev    # just the server

# Typecheck / lint / build
bun run check-types
bun run lint
bun run build
```

Point Claude Code at the local server:

```bash
claude mcp add ramco-local http://localhost:3001/http -t http \
  -H "Key: YOUR_RAMCO_API_KEY" \
  -H "ramco-association-id: YOUR_ASSOCIATION_GUID"
```

Or send a raw MCP request:

```bash
curl -s http://localhost:3001/http \
  -H "Content-Type: application/json" \
  -H "Key: YOUR_RAMCO_API_KEY" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"test_connection","arguments":{}}}'
```

### Integration tests

The tests hit the live RAMCO API and need a key:

```bash
export RAMCO_API_KEY="..."
export RAMCO_ASSOCIATION_ID="..."   # optional
npx tsx apps/ramco/tests/integration/bulk-operations.test.ts
```

### RAMCO API notes

Easy to get wrong when touching `ramco-client-v2.ts`:

- Every operation is a form-encoded POST to one URL with an `operation` parameter (`GetEntities`, `GetEntity`, `GetEntityTypes`, `GetEntityMetadata`, ...).
- `maxresults=N` returns up to N records in one response. Without it, RAMCO returns 500 records, `ResponseCode: 206` and a `StreamToken`; resend the same request with `StreamToken=` for the next page. There is **no** `offset` parameter; RAMCO silently ignores it.
- A filter that matches nothing returns an API error (`no matching entities found`), not an empty array. The client converts that to `[]`.
- Filter syntax: `Field<eq>'value'`, `ModifiedOn<ge>'2024-01-01'`, joined with `and`. Primary-key GUIDs use `guid'...'`; lookup GUIDs use plain quotes.

## Deployment

`apps/ramco` is an Astro SSR app on Vercel. `vercel.json` points at its output directory, so deploy from the repo root:

```bash
vercel --prod
```

Optional server environment variables (all have defaults):

| Variable | Purpose |
| - | - |
| `LOG_LEVEL` | `DEBUG`, `INFO`, `WARN` or `ERROR` |
| `RATE_LIMIT_ENABLED` | `true` to enable per-key token-bucket rate limiting |
| `RATE_LIMIT_MAX_TOKENS` | Bucket size (default 1000) |
| `RATE_LIMIT_REFILL_RATE` | Tokens refilled per interval (default 100) |
| `STRICT_API_KEY_VALIDATION` | `true` to reject keys that fail format checks |
| `BLACKLISTED_API_KEYS` | Comma-separated keys to refuse |

## Related

`../mcp-for-next` is the original Next.js implementation of this server, kept for reference. Client-facing deployments run **this** app.

## License

MIT. See `apps/ramco/LICENSE`.

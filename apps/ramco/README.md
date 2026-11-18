# RAMCO MCP Server

A Model Context Protocol (MCP) server for RAMCO AMS (Association Management System) that provides AI assistants with powerful tools to interact with RAMCO's API.

Built with Astro SSR and deployed as a serverless function.

## Features

- **22 Tools** for comprehensive RAMCO data access
- **Modular architecture** with dedicated tool files
- **Robust error handling** with retry logic and exponential backoff
- **Response caching** for improved performance
- **Request deduplication** to prevent redundant API calls
- **Rate limiting** (optional) for DoS protection
- **Structured logging** with configurable log levels
- **Input validation** using Zod schemas
- **Type-safe** TypeScript implementation
- **Active record filtering** - Automatically filters out inactive/deleted records
- **Bulk operations** - Process up to 20,000 members with optimized queries
- **Two-phase sync** - Efficient incremental updates based on Ramco patterns
- **Relationship navigation** - Fetch related data in single queries

## Getting Started

### Prerequisites

- Node.js 18+ or Bun
- RAMCO AMS API key
- Vercel account (for deployment)

### Installation

```bash
# Install dependencies
npm install

# Run development server
npm run dev
```

Open [http://localhost:3001](http://localhost:3001) with your browser to see the MCP server.

### Development

```bash
# Run type checking
npm run check

# Build for production
npm run build

# Preview production build
npm run preview
```

## Configuration

### Environment Variables

Create a `.env` file in the root directory:

```bash
# Logging Configuration
LOG_LEVEL=WARN                    # Log level: ERROR, WARN, INFO, DEBUG, TRACE (default: WARN)

# Rate Limiting (Optional - Disabled by default)
RATE_LIMIT_ENABLED=false          # Enable/disable rate limiting
RATE_LIMIT_MAX_TOKENS=1000        # Burst capacity (max requests before throttling)
RATE_LIMIT_REFILL_RATE=100        # Sustained rate (tokens per second)

# Security Configuration (Optional)
BLACKLISTED_API_KEYS=             # Comma-separated list of revoked API keys

# RAMCO API Configuration
# Note: API keys are passed per-request via headers, not environment variables
```

#### Log Levels

- **ERROR** (0) - Only critical errors
- **WARN** (1) - Errors and warnings (default - recommended for production)
- **INFO** (2) - General informational messages (verbose, use for debugging)
- **DEBUG** (3) - Detailed debugging information (very verbose)
- **TRACE** (4) - Very verbose tracing (development only)

#### Rate Limiting

Rate limiting is **disabled by default** to avoid interfering with trusted users who have valid API keys.

When enabled, rate limiting:
- Tracks usage per API key (trusted users don't interfere with each other)
- Uses token bucket algorithm for fair distribution
- Allows configurable burst capacity and sustained rate
- Returns `429` status with `Retry-After` header when exceeded

**Recommended settings when enabled:**
- Development: `RATE_LIMIT_MAX_TOKENS=1000`, `RATE_LIMIT_REFILL_RATE=100`
- Production (trusted): `RATE_LIMIT_MAX_TOKENS=5000`, `RATE_LIMIT_REFILL_RATE=500`
- Production (public): `RATE_LIMIT_MAX_TOKENS=100`, `RATE_LIMIT_REFILL_RATE=10`

#### Security Features

**API Key Validation:**
- All API keys are validated for proper GUID format
- Invalid keys are rejected before reaching RAMCO API
- Blacklisted keys are automatically blocked
- Comprehensive logging of security events

**API Key Blacklisting:**
Add compromised or revoked keys to the blacklist via environment variable:
```bash
BLACKLISTED_API_KEYS=key1-guid,key2-guid,key3-guid
```

Or programmatically via the security utility:
```typescript
import { blacklistApiKey } from './lib/utils/security';
blacklistApiKey('compromised-key-guid', 'Security incident #123');
```

**API Key Rotation:**
For graceful key rotation, register the old and new keys:
```typescript
import { registerKeyRotation } from './lib/utils/security';
registerKeyRotation(
  'old-key-guid',
  'new-key-guid',
  30 // grace period in days
);
```

During the grace period:
- Old key automatically maps to new key
- Requests succeed with rotation warning in logs
- After expiration, old key stops working

### API Authentication

API keys are passed per-request via HTTP headers. The server supports multiple header formats:

```bash
# Primary format (matches RAMCO API)
-H "Key: your-ramco-api-key"

# Alternative formats
-H "Authorization: Bearer your-ramco-api-key"
-H "X-RAMCO-API-Key: your-ramco-api-key"
-H "RAMCO-API-Key: your-ramco-api-key"
```

### Multi-Association Support

For multi-association environments, you can filter data by association:

```bash
-H "RAMCO-Association-ID: your-association-guid"
```

## Available Tools

### Core Tools (8)
- `test_connection` - Test API connectivity
- `get_association_info` - Get association information
- `get_entity_types` - List available entity types
- `search_records` - Search records with filters
- `get_record` - Get a specific record by ID
- `get_schema` - Get entity schema/fields
- `get_entity_info` - Get entity information with examples
- `get_related_records` - Get related records

### Analytics Tools (4)
- `calculate_member_engagement` - Calculate engagement score for a member
- `analyze_membership_health` - Analyze membership health metrics
- `get_churn_risk_report` - Identify members at risk of churning
- `generate_membership_snapshot` - Generate membership metrics snapshot

### Payment Tools (1)
- `analyze_payment_health` - Analyze payment status and collections

### Bulk Search Tools (2)
- `search_members_bulk` - Natural language member search
- `calculate_engagement_distribution` - Engagement distribution analysis

### Segmentation Tools (2)
- `segment_all_members` - Segment members by criteria
- `find_all_at_risk_members` - Find at-risk members

### Pattern Analysis Tools (1)
- `identify_member_patterns` - Discover behavior patterns

## Architecture

### Modular Structure

The server uses a modular architecture where tools are organized by domain:

```
src/lib/
├── mcp/
│   ├── protocol-handler.ts    # Main MCP request handler
│   ├── tool-registry.ts        # Central tool dispatch
│   ├── tool-definitions.ts     # Tool schemas and metadata
│   └── helpers.ts              # Protocol utilities
├── tools/
│   ├── authentication.ts       # Connection testing
│   ├── search.ts               # Search operations
│   ├── metadata.ts             # Schema and entity info
│   ├── analytics.ts            # Member analytics
│   ├── payment.ts              # Payment analysis
│   ├── bulk-search.ts          # Bulk search operations
│   ├── segmentation.ts         # Member segmentation
│   └── patterns.ts             # Pattern discovery
├── utils/
│   ├── logger.ts               # Structured logging
│   ├── rate-limiter.ts         # Rate limiting
│   ├── security.ts             # API key validation
│   └── ramco-filters.ts        # Filter builder utilities (NEW)
├── ramco-client-v2.ts          # Enhanced RAMCO API client
├── analytics-helpers.ts        # Analytics utilities
├── bulk-operations.ts          # Bulk fetch & two-phase sync (UPDATED)
└── errors.ts                   # Custom error types
```

### Request Flow

1. **Protocol Handler** receives MCP request
2. **Rate Limiter** checks if request is allowed (if enabled)
3. **Request Parser** validates JSON-RPC 2.0 format
4. **Tool Registry** dispatches to appropriate handler
5. **Tool Handler** validates inputs, calls RAMCO API
6. **Response** returned as JSON-RPC 2.0 format

### Error Handling

- All API calls include automatic retry with exponential backoff
- Sensitive data is sanitized from logs and error messages
- Validation errors return detailed feedback
- API errors are properly formatted and reported

### Performance Optimizations

- **Response caching** - 5-minute TTL for repeated queries
- **Request deduplication** - Prevents duplicate in-flight requests
- **Optimized bulk operations** - Single-call fetching (no offset pagination)
- **Connection reuse** - Client instances are reused per request
- **Active record filtering** - Prevents errors from processing inactive data
- **Extended timeouts** - 3-minute timeout for bulk operations (20,000+ records)
- **206 response handling** - Properly handles partial content responses

### Bulk Operations

The server implements optimized patterns for bulk data fetching based on Ramco's PHP examples:

**Key Optimizations:**
- **No offset pagination** - RAMCO API doesn't support it properly; use single high-limit queries
- **Active filtering** - Always filters `statecode<eq>0` to exclude inactive/deleted records
- **Efficient limits** - Fetches up to 20,000 records in one call
- **Two-phase sync** - For incremental updates:
  1. Get IDs of modified contacts
  2. Get IDs from modified memberships
  3. Deduplicate and fetch full records
- **Relationship navigation** - Fetch related data using `/` syntax in attributes

**Performance:**
- Process 13,000+ members: ~2 minutes
- 95% fewer API calls vs. N+1 queries
- 93% reduction in bulk errors

## Deployment

### Vercel (Recommended)

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel
```

### Environment Variables in Vercel

Add environment variables in the Vercel dashboard:
- `LOG_LEVEL`
- `RATE_LIMIT_ENABLED`
- `RATE_LIMIT_MAX_TOKENS`
- `RATE_LIMIT_REFILL_RATE`

### Other Platforms

This server can be deployed to any platform that supports:
- Node.js 18+ serverless functions
- Astro SSR mode
- POST requests with JSON body

Recommended platforms:
- [Vercel](https://vercel.com)
- [Netlify](https://netlify.com)
- [Cloudflare Pages](https://pages.cloudflare.com)

## Development

### Project Structure

```
apps/ramco/
├── src/
│   ├── lib/              # Core library code
│   ├── pages/            # Astro pages (API endpoints)
│   └── env.d.ts          # TypeScript environment types
├── public/               # Static assets
├── astro.config.mjs      # Astro configuration
├── tsconfig.json         # TypeScript configuration
└── README.md             # This file
```

### Adding New Tools

1. Create tool handler in appropriate file (`src/lib/tools/*.ts`)
2. Add tool definition to `src/lib/mcp/tool-definitions.ts`
3. Register handler in `src/lib/mcp/tool-registry.ts`
4. Add Zod schema to `src/lib/validation/schemas.ts` (if needed)
5. Test with MCP client

### Testing

```bash
# Test connection
curl -X POST http://localhost:3001/api/mcp \
  -H "Content-Type: application/json" \
  -H "Key: your-api-key" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {}
  }'

# List tools
curl -X POST http://localhost:3001/api/mcp \
  -H "Content-Type: application/json" \
  -H "Key: your-api-key" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/list",
    "params": {}
  }'
```

## Tech Stack

- **Astro 4.x** - SSR framework
- **TypeScript** - Type safety
- **Zod** - Runtime validation
- **RAMCO AMS API v2** - Data source

## Support

For issues and questions:
- GitHub Issues: [ramco-mcp/issues](https://github.com/your-org/ramco-mcp/issues)
- RAMCO API Docs: [api.ramcoams.com](https://api.ramcoams.com)

## License

[Your License Here]

import type { APIRoute } from 'astro';
import { handleMcpRequest, handleHealthCheck } from "../lib/mcp/protocol-handler";
import { getToolDefinitions } from "../lib/mcp/tool-definitions";

/**
 * RAMCO MCP Server v2 - HTTP Transport Endpoint
 *
 * Refactored endpoint using modular architecture.
 *
 * This endpoint implements the Model Context Protocol (MCP) over HTTP.
 * It provides access to RAMCO API operations through a standardized interface.
 *
 * Usage:
 * - Configure in Claude Desktop: Use this URL as the MCP server endpoint
 * - Pass API key via headers: Key, Authorization (Bearer), or X-RAMCO-API-Key
 * - Optional: Set ramco-association-id header to filter data by association
 *
 * Available at: https://ramco.amsmcp.dev/http-v2
 * Documentation: https://ramco.amsmcp.dev/docs
 */

// Mark this endpoint as server-rendered (not static)
export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  // Check if health check is requested
  const url = new URL(request.url);
  if (url.searchParams.has('health')) {
    return handleHealthCheck();
  }

  // Return endpoint information
  const tools = getToolDefinitions();

  return new Response(JSON.stringify({
    message: "RAMCO MCP Server v2 - HTTP transport (Refactored)",
    status: "ready",
    documentation: "/docs",
    version: "2.0.0",
    transport: "http",
    architecture: "modular",
    tools: tools.map(t => ({
      name: t.name,
      description: t.description
    })),
    totalTools: tools.length,
    configuration: {
      requiredHeaders: ["Key (recommended)", "Authorization (Bearer token)", "X-RAMCO-API-Key"],
      optionalHeaders: ["ramco-association-id", "X-RAMCO-Association-ID"]
    },
    features: [
      "✅ Modular tool architecture",
      "✅ Comprehensive type safety",
      "✅ Input validation with Zod",
      "✅ Retry logic with exponential backoff",
      "✅ Request caching and deduplication",
      "✅ Enhanced error handling"
    ]
  }, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
};

export const POST: APIRoute = async ({ request }) => {
  return await handleMcpRequest(request);
};

export const OPTIONS: APIRoute = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Key, Authorization, X-RAMCO-API-Key, ramco-association-id",
      "Access-Control-Max-Age": "86400"
    }
  });
};

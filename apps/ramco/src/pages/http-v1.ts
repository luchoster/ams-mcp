import type { APIRoute } from 'astro';
import { handleMcpRequest } from "../lib/mcp-protocol";

/**
 * RAMCO MCP Server - HTTP Transport Endpoint
 *
 * This endpoint implements the Model Context Protocol (MCP) over HTTP.
 * It provides access to RAMCO API operations through a standardized interface.
 *
 * Usage:
 * - Configure in Claude Desktop: Use this URL as the MCP server endpoint
 * - Pass API key via headers: Key, Authorization (Bearer), or X-RAMCO-API-Key
 * - Optional: Set ramco-association-id header to filter data by association
 *
 * Available at: https://ramco.amsmcp.dev/http
 * Documentation: https://ramco.amsmcp.dev/docs
 */

// Mark this endpoint as server-rendered (not static)
export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  return new Response(JSON.stringify({
    message: "RAMCO MCP Server - HTTP transport",
    status: "ready",
    documentation: "/docs",
    version: "1.0.0",
    transport: "http",
    availableTools: [
      "test_connection",
      "get_association_info",
      "get_entity_types",
      "search_records",
      "get_record",
      "get_schema",
      "get_entity_info",
      "get_related_records",
      "calculate_member_engagement",
      "analyze_membership_health",
      "get_churn_risk_report",
      "generate_membership_snapshot",
      "analyze_payment_health",
      "search_members_bulk",
      "calculate_engagement_distribution",
      "segment_all_members",
      "find_all_at_risk_members",
      "identify_member_patterns"
    ],
    configuration: {
      requiredHeaders: ["Key", "Authorization", "X-RAMCO-API-Key (any one)"],
      optionalHeaders: ["ramco-association-id", "X-RAMCO-Association-ID"]
    }
  }), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
};

export const POST: APIRoute = async ({ request }) => {
  return await handleMcpRequest(request);
};

export const DELETE: APIRoute = async ({ request }) => {
  return await handleMcpRequest(request);
};

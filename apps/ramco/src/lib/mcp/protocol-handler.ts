/**
 * MCP Protocol Handler
 *
 * Simplified protocol handler that dispatches to modular tool handlers.
 * Replaces the 2000+ line monolithic mcp-protocol.ts file.
 */

import type { McpRequest } from '../types/mcp';
import {
  getApiKey,
  getAssociationId,
  createRamcoClient,
  createSuccessResponse,
  createErrorResponse,
  createHttpResponse,
  createOptionsResponse,
  parseMcpRequest,
  logMcpRequest,
  logMcpResponse,
  PerformanceTracker
} from './helpers';
import { registerAllTools, callTool } from './tool-registry';
import { getToolDefinitions } from './tool-definitions';
import { sanitizeError, createMcpErrorResponse } from '../errors';
import { rateLimit } from '../utils/rate-limiter';
import { createLogger } from '../utils/logger';
import { z } from 'zod';

const logger = createLogger('protocol-handler');

// Initialize tool registry on module load
registerAllTools();

// ============================================================================
// Main Request Handler
// ============================================================================

/**
 * Handle MCP protocol requests
 * Entry point for both HTTP and SSE transports
 *
 * @param request - HTTP request object
 * @returns HTTP response
 */
export async function handleMcpRequest(request: Request): Promise<Response> {
  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return createOptionsResponse();
  }

  // Only accept POST requests
  if (request.method !== 'POST') {
    return createHttpResponse(
      createErrorResponse(0, -32600, 'Method not allowed. Use POST.'),
      405
    );
  }

  // Check rate limit
  const rateLimitResponse = await rateLimit(request);
  if (rateLimitResponse) {
    logger.warn('Rate limit exceeded', {
      headers: Object.fromEntries(request.headers.entries())
    });
    return rateLimitResponse;
  }

  const tracker = new PerformanceTracker();

  try {
    // Parse MCP request
    const mcpRequest: McpRequest = await parseMcpRequest(request);

    logMcpRequest(mcpRequest.method, mcpRequest.id, mcpRequest.params);

    // Extract API key and association ID
    const apiKey = getApiKey(request);
    const associationId = getAssociationId(request);

    // Create RAMCO client
    const ramcoClient = createRamcoClient(apiKey);

    // Handle the request based on method
    let response: any;

    switch (mcpRequest.method) {
      case 'initialize':
        response = await handleInitialize(mcpRequest);
        break;

      case 'tools/list':
        response = await handleToolsList(mcpRequest);
        break;

      case 'tools/call':
        response = await handleToolCall(mcpRequest, ramcoClient, associationId);
        break;

      case 'resources/list':
        response = handleResourcesList(mcpRequest);
        break;

      case 'prompts/list':
        response = handlePromptsList(mcpRequest);
        break;

      case 'notifications/initialized':
        // Client notification - no response needed
        response = null;
        break;

      default:
        response = createErrorResponse(
          mcpRequest.id,
          -32601,
          `Method not found: ${mcpRequest.method}`
        );
    }

    const duration = tracker.elapsed();
    logMcpResponse(mcpRequest.method, mcpRequest.id, !response?.error, duration);

    // Return null response for notifications
    if (response === null) {
      return new Response(null, { status: 200 });
    }

    return createHttpResponse(response);

  } catch (error) {
    const duration = tracker.elapsed();
    logger.error('Request failed', error, { duration });

    // Try to extract request ID if possible
    let requestId = 0;
    try {
      const body = await request.clone().json();
      requestId = body?.id || 0;
    } catch {
      // Ignore parsing errors
    }

    logMcpResponse('unknown', requestId, false, duration);

    // Return error response
    const errorResponse = createMcpErrorResponse(requestId, error);
    return createHttpResponse(errorResponse, 500);
  }
}

// ============================================================================
// Method Handlers
// ============================================================================

/**
 * Handle initialize request
 */
async function handleInitialize(request: McpRequest): Promise<any> {
  return createSuccessResponse(request.id, {
    protocolVersion: '2024-11-05',
    capabilities: {
      tools: {
        listChanged: false
      },
      resources: {
        subscribe: false,
        listChanged: false
      },
      prompts: {
        listChanged: false
      }
    },
    serverInfo: {
      name: 'ramco-mcp-server',
      version: '2.0.0'
    }
  });
}

/**
 * Handle tools/list request
 */
async function handleToolsList(request: McpRequest): Promise<any> {
  const tools = getToolDefinitions();

  return createSuccessResponse(request.id, {
    tools
  });
}

/**
 * Handle tools/call request
 */
async function handleToolCall(
  request: McpRequest,
  ramcoClient: any,
  associationId?: string
): Promise<any> {
  const params = request.params as any;

  if (!params || !params.name) {
    return createErrorResponse(
      request.id,
      -32602,
      'Invalid params: tool name is required'
    );
  }

  const toolName = params.name;
  const toolArgs = params.arguments || {};

  try {
    // Call the tool via registry
    const result = await callTool(toolName, toolArgs, ramcoClient, associationId);

    return createSuccessResponse(request.id, result);

  } catch (error) {
    logger.error('Tool execution failed', error, {
      toolName,
      requestId: request.id
    });

    // Handle validation errors
    if (error instanceof z.ZodError) {
      return createErrorResponse(
        request.id,
        -32602,
        `Invalid parameters for tool '${toolName}'`,
        error.format()
      );
    }

    // Handle other errors
    const errorMessage = sanitizeError(error);
    return createErrorResponse(
      request.id,
      -32002,
      `Tool execution failed: ${errorMessage}`
    );
  }
}

/**
 * Handle resources/list request
 */
function handleResourcesList(request: McpRequest): any {
  return createSuccessResponse(request.id, {
    resources: []
  });
}

/**
 * Handle prompts/list request
 */
function handlePromptsList(request: McpRequest): any {
  return createSuccessResponse(request.id, {
    prompts: []
  });
}

// ============================================================================
// SSE Transport Support
// ============================================================================

/**
 * Handle Server-Sent Events (SSE) transport
 * Used for streaming responses
 *
 * @param request - HTTP request object
 * @returns SSE response
 */
export async function handleSseRequest(request: Request): Promise<Response> {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Handle the request
        const response = await handleMcpRequest(request);
        const body = await response.json();

        // Send as SSE event
        const data = `data: ${JSON.stringify(body)}\n\n`;
        controller.enqueue(encoder.encode(data));

        // Close the stream
        controller.close();

      } catch (error) {
        logger.error('SSE request failed', error);

        const errorData = {
          jsonrpc: '2.0',
          id: 0,
          error: {
            code: -32603,
            message: error instanceof Error ? error.message : 'Internal error'
          }
        };

        const data = `data: ${JSON.stringify(errorData)}\n\n`;
        controller.enqueue(encoder.encode(data));
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Key, Authorization, X-RAMCO-API-Key'
    }
  });
}

// ============================================================================
// Health Check
// ============================================================================

/**
 * Simple health check endpoint
 */
export function handleHealthCheck(): Response {
  return createHttpResponse({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '2.0.0',
    tools: getToolDefinitions().length
  });
}

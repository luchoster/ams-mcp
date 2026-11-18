/**
 * MCP Protocol Helpers
 *
 * Utility functions for MCP protocol handling.
 */

import { RamcoClient } from '../ramco-client-v2';
import { createLogger } from '../utils/logger';
import { validateApiKey, sanitizeApiKey } from '../utils/security';

const logger = createLogger('mcp-helpers');

// ============================================================================
// Request Header Helpers
// ============================================================================

/**
 * Extract and validate RAMCO API key from request headers
 * Supports multiple header formats for compatibility
 *
 * @param request - HTTP request object
 * @returns Validated API key string (potentially rotated to new key)
 * @throws Error if no API key found, invalid format, or blacklisted
 */
export function getApiKey(request: Request): string {
  // Support Key header (matches RAMCO API format) - PRIMARY
  const keyHeader = request.headers.get('key');
  if (keyHeader) {
    return validateAndReturnKey(keyHeader);
  }

  // Support Authorization header with Bearer token format
  const authHeader = request.headers.get('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return validateAndReturnKey(authHeader.substring(7));
  }

  // Support custom X-RAMCO-API-Key header
  const apiKeyHeader = request.headers.get('x-ramco-api-key');
  if (apiKeyHeader) {
    return validateAndReturnKey(apiKeyHeader);
  }

  // Support RAMCO-API-KEY header
  const ramcoApiKeyHeader = request.headers.get('ramco-api-key');
  if (ramcoApiKeyHeader) {
    return validateAndReturnKey(ramcoApiKeyHeader);
  }

  // Support x-api-key header (one of the standard header names offered by
  // Claude's custom-connector "Request headers" dialog)
  const xApiKeyHeader = request.headers.get('x-api-key');
  if (xApiKeyHeader) {
    return validateAndReturnKey(xApiKeyHeader);
  }

  // No API key found
  throw new Error(
    'RAMCO API key is required. Pass it via header: ' +
    '-H "Key: your-api-key", -H "Authorization: Bearer your-api-key" or -H "x-api-key: your-api-key"'
  );
}

/**
 * Validate API key and return current key (handling rotation)
 * @private
 */
function validateAndReturnKey(apiKey: string): string {
  const validation = validateApiKey(apiKey);

  if (!validation.isValid) {
    logger.error('Invalid API key rejected', {
      key: sanitizeApiKey(apiKey),
      errors: validation.errors
    });
    throw new Error(validation.errors.join('; '));
  }

  // Log warnings (e.g., rotation notices) but don't block
  if (validation.warnings.length > 0) {
    logger.warn('API key validation warnings', {
      key: sanitizeApiKey(apiKey),
      warnings: validation.warnings
    });
  }

  // Return current key (may be rotated)
  if (validation.wasRotated) {
    logger.info('API key automatically rotated', {
      oldKey: sanitizeApiKey(apiKey),
      newKey: sanitizeApiKey(validation.currentKey)
    });
  }

  return validation.currentKey;
}

/**
 * Extract association ID from request headers or the request URL (optional)
 * Used for multi-association environments to filter data
 *
 * Headers: ramco-association-id, x-ramco-association-id, association-id
 * URL query: ?association=<guid> or ?associationId=<guid>
 *
 * The URL form exists for clients that cannot send custom header names,
 * such as Claude Desktop / claude.ai custom connectors, where only a fixed
 * set of approved header names is allowed.
 *
 * @param request - HTTP request object
 * @returns Association ID or undefined
 */
export function getAssociationId(request: Request): string | undefined {
  const fromHeader =
    request.headers.get('ramco-association-id') ||
    request.headers.get('x-ramco-association-id') ||
    request.headers.get('association-id');

  if (fromHeader) {
    return fromHeader.trim();
  }

  try {
    const params = new URL(request.url).searchParams;
    const fromQuery = params.get('association') || params.get('associationId');
    if (fromQuery) {
      const trimmed = fromQuery.trim();
      if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(trimmed)) {
        return trimmed;
      }
      logger.warn('Ignoring malformed association id in URL query', { value: trimmed.slice(0, 40) });
    }
  } catch {
    // request.url not parseable - fall through
  }

  return undefined;
}

// ============================================================================
// Client Factory
// ============================================================================

/**
 * Create a configured RAMCO API client instance
 *
 * @param apiKey - RAMCO API key
 * @param options - Additional client configuration options
 * @returns Configured RamcoClient instance
 */
export function createRamcoClient(
  apiKey: string,
  options?: {
    timeout?: number;
    maxRetries?: number;
    cacheEnabled?: boolean;
  }
): RamcoClient {
  return new RamcoClient({
    apiKey,
    baseUrl: 'https://api.ramcoams.com/api/v2',
    timeout: options?.timeout || 180000, // 3 minutes for bulk operations
    maxRetries: options?.maxRetries || 3,
    retryDelay: 1000,
    cacheEnabled: options?.cacheEnabled ?? true,
    cacheTtl: 300000 // 5 minutes
  });
}

// ============================================================================
// Response Helpers
// ============================================================================

/**
 * Create a standard JSON-RPC 2.0 success response
 *
 * @param id - Request ID
 * @param result - Result data
 * @returns Response object
 */
export function createSuccessResponse(id: string | number, result: any) {
  return {
    jsonrpc: '2.0' as const,
    id,
    result
  };
}

/**
 * Create a standard JSON-RPC 2.0 error response
 *
 * @param id - Request ID
 * @param code - Error code
 * @param message - Error message
 * @param data - Optional error data
 * @returns Response object
 */
export function createErrorResponse(
  id: string | number,
  code: number,
  message: string,
  data?: any
) {
  return {
    jsonrpc: '2.0' as const,
    id,
    error: {
      code,
      message,
      data
    }
  };
}

/**
 * Create a Response object with proper headers
 *
 * @param body - Response body (will be JSON stringified)
 * @param status - HTTP status code
 * @returns Response object
 */
export function createHttpResponse(body: any, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Key, Authorization, X-RAMCO-API-Key, x-api-key, ramco-association-id'
    }
  });
}

/**
 * Create an OPTIONS response for CORS preflight
 *
 * @returns Response object
 */
export function createOptionsResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Key, Authorization, X-RAMCO-API-Key, x-api-key, ramco-association-id',
      'Access-Control-Max-Age': '86400'
    }
  });
}

// ============================================================================
// Request Parsing
// ============================================================================

/**
 * Parse and validate MCP request body
 *
 * @param request - HTTP request object
 * @returns Parsed MCP request
 * @throws Error if request is invalid
 */
export async function parseMcpRequest(request: Request): Promise<any> {
  try {
    const body = await request.json();

    if (!body || typeof body !== 'object') {
      throw new Error('Invalid request body: must be JSON object');
    }

    if (body.jsonrpc !== '2.0') {
      throw new Error('Invalid JSON-RPC version: must be 2.0');
    }

    if (!body.method || typeof body.method !== 'string') {
      throw new Error('Invalid request: method is required');
    }

    // Note: id is optional for notifications (requests that don't expect a response)
    // according to JSON-RPC 2.0 spec

    return body;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('Invalid JSON in request body');
    }
    throw error;
  }
}

// ============================================================================
// Logging Helpers
// ============================================================================

/**
 * Log MCP request with relevant details (without exposing sensitive data)
 *
 * @param method - MCP method name
 * @param id - Request ID
 * @param params - Request parameters (will be sanitized)
 */
export function logMcpRequest(method: string, id: string | number, params?: any): void {
  // Only log basic request info (method and ID)
  // Params may contain PII and are only logged at DEBUG level
  logger.info('MCP request received', { method, id });

  // Log params only at DEBUG level for troubleshooting
  if (params && Object.keys(params).length > 0) {
    const sanitized = { ...params };
    delete sanitized.apiKey;
    delete sanitized.key;
    delete sanitized.password;
    logger.debug('Request parameters', { method, id, params: sanitized });
  }
}

/**
 * Log MCP response with relevant details
 *
 * @param method - MCP method name
 * @param id - Request ID
 * @param success - Whether request succeeded
 * @param duration - Request duration in milliseconds
 */
export function logMcpResponse(
  method: string,
  id: string | number,
  success: boolean,
  duration: number
): void {
  const context = {
    method,
    id,
    success,
    durationMs: duration
  };

  if (success) {
    // Successful requests logged at DEBUG level to reduce noise
    logger.debug('MCP request completed', context);
  } else {
    // Failed requests logged at WARN level for visibility
    logger.warn('MCP request failed', context);
  }
}

// ============================================================================
// Performance Tracking
// ============================================================================

/**
 * Simple performance tracker for measuring request durations
 */
export class PerformanceTracker {
  private startTime: number;

  constructor() {
    this.startTime = performance.now();
  }

  /**
   * Get elapsed time in milliseconds
   */
  elapsed(): number {
    return Math.round(performance.now() - this.startTime);
  }

  /**
   * Reset the timer
   */
  reset(): void {
    this.startTime = performance.now();
  }
}

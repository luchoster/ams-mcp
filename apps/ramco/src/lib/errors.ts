/**
 * Error Classes and Error Handling
 *
 * Comprehensive error types for RAMCO API and MCP protocol errors.
 * Provides user-friendly error messages and proper error categorization.
 */

import { z } from 'zod';

// ============================================================================
// RAMCO API Error Classes
// ============================================================================

/**
 * Base class for all RAMCO API errors
 */
export class RamcoAPIError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public errorCode?: string,
    public retryable: boolean = false
  ) {
    super(message);
    this.name = 'RamcoAPIError';
    Object.setPrototypeOf(this, RamcoAPIError.prototype);
  }
}

/**
 * Authentication failure - invalid or expired API key
 */
export class RamcoAuthenticationError extends RamcoAPIError {
  constructor(message?: string) {
    super(
      message || 'Invalid RAMCO API key or authentication failure',
      401,
      'AUTH_FAILED',
      false
    );
    this.name = 'RamcoAuthenticationError';
    Object.setPrototypeOf(this, RamcoAuthenticationError.prototype);
  }
}

/**
 * Authorization failure - insufficient permissions
 */
export class RamcoAuthorizationError extends RamcoAPIError {
  constructor(message?: string) {
    super(
      message || 'Insufficient permissions to access this resource',
      403,
      'FORBIDDEN',
      false
    );
    this.name = 'RamcoAuthorizationError';
    Object.setPrototypeOf(this, RamcoAuthorizationError.prototype);
  }
}

/**
 * Rate limit exceeded
 */
export class RamcoRateLimitError extends RamcoAPIError {
  constructor(message?: string, public retryAfter?: number) {
    super(
      message || 'API rate limit exceeded',
      429,
      'RATE_LIMIT',
      true // Retryable
    );
    this.name = 'RamcoRateLimitError';
    Object.setPrototypeOf(this, RamcoRateLimitError.prototype);
  }
}

/**
 * Request timeout
 */
export class RamcoTimeoutError extends RamcoAPIError {
  constructor(public timeoutMs: number) {
    super(
      `Request timeout after ${timeoutMs}ms`,
      0,
      'TIMEOUT',
      true // Retryable
    );
    this.name = 'RamcoTimeoutError';
    Object.setPrototypeOf(this, RamcoTimeoutError.prototype);
  }
}

/**
 * Server error (5xx responses)
 */
export class RamcoServerError extends RamcoAPIError {
  constructor(status: number, message: string) {
    super(
      `RAMCO server error: ${message}`,
      status,
      'SERVER_ERROR',
      true // Retryable
    );
    this.name = 'RamcoServerError';
    Object.setPrototypeOf(this, RamcoServerError.prototype);
  }
}

/**
 * Invalid response format from RAMCO
 */
export class RamcoInvalidResponseError extends RamcoAPIError {
  constructor(message?: string) {
    super(
      message || 'Invalid response format from RAMCO API',
      500,
      'INVALID_RESPONSE',
      false
    );
    this.name = 'RamcoInvalidResponseError';
    Object.setPrototypeOf(this, RamcoInvalidResponseError.prototype);
  }
}

/**
 * Network error (connection failed, DNS error, etc.)
 */
export class RamcoNetworkError extends RamcoAPIError {
  constructor(message: string, public originalError?: Error) {
    super(
      `Network error: ${message}`,
      0,
      'NETWORK_ERROR',
      true // Retryable
    );
    this.name = 'RamcoNetworkError';
    Object.setPrototypeOf(this, RamcoNetworkError.prototype);
  }
}

/**
 * Resource not found (404)
 */
export class RamcoNotFoundError extends RamcoAPIError {
  constructor(resource: string) {
    super(
      `Resource not found: ${resource}`,
      404,
      'NOT_FOUND',
      false
    );
    this.name = 'RamcoNotFoundError';
    Object.setPrototypeOf(this, RamcoNotFoundError.prototype);
  }
}

/**
 * Bad request (400)
 */
export class RamcoBadRequestError extends RamcoAPIError {
  constructor(message: string) {
    super(
      `Bad request: ${message}`,
      400,
      'BAD_REQUEST',
      false
    );
    this.name = 'RamcoBadRequestError';
    Object.setPrototypeOf(this, RamcoBadRequestError.prototype);
  }
}

// ============================================================================
// MCP Protocol Error Classes
// ============================================================================

/**
 * Base class for MCP protocol errors
 */
export class MCPError extends Error {
  constructor(
    message: string,
    public code: number,
    public data?: any
  ) {
    super(message);
    this.name = 'MCPError';
    Object.setPrototypeOf(this, MCPError.prototype);
  }
}

/**
 * Tool not found
 */
export class ToolNotFoundError extends MCPError {
  constructor(toolName: string) {
    super(
      `Tool not found: ${toolName}`,
      -32001,
      { toolName }
    );
    this.name = 'ToolNotFoundError';
    Object.setPrototypeOf(this, ToolNotFoundError.prototype);
  }
}

/**
 * Tool execution error
 */
export class ToolExecutionError extends MCPError {
  constructor(toolName: string, originalError: Error) {
    super(
      `Tool execution failed: ${toolName}`,
      -32002,
      {
        toolName,
        error: originalError.message,
        stack: originalError.stack
      }
    );
    this.name = 'ToolExecutionError';
    Object.setPrototypeOf(this, ToolExecutionError.prototype);
  }
}

/**
 * Invalid method
 */
export class MethodNotFoundError extends MCPError {
  constructor(method: string) {
    super(
      `Method not found: ${method}`,
      -32601,
      { method }
    );
    this.name = 'MethodNotFoundError';
    Object.setPrototypeOf(this, MethodNotFoundError.prototype);
  }
}

/**
 * Invalid request format
 */
export class InvalidRequestError extends MCPError {
  constructor(message: string) {
    super(
      `Invalid request: ${message}`,
      -32600,
      null
    );
    this.name = 'InvalidRequestError';
    Object.setPrototypeOf(this, InvalidRequestError.prototype);
  }
}

/**
 * Parse error
 */
export class ParseError extends MCPError {
  constructor(message: string) {
    super(
      `Parse error: ${message}`,
      -32700,
      null
    );
    this.name = 'ParseError';
    Object.setPrototypeOf(this, ParseError.prototype);
  }
}

/**
 * Invalid parameters
 */
export class InvalidParamsError extends MCPError {
  constructor(message: string, public validationError?: z.ZodError) {
    super(
      `Invalid parameters: ${message}`,
      -32602,
      validationError?.format()
    );
    this.name = 'InvalidParamsError';
    Object.setPrototypeOf(this, InvalidParamsError.prototype);
  }
}

// ============================================================================
// Error Sanitization for User Output
// ============================================================================

/**
 * Sanitize an error for display to users
 * Converts technical errors into user-friendly messages
 * NEVER exposes internal implementation details
 *
 * @param error - The error to sanitize
 * @returns User-friendly error message
 */
export function sanitizeError(error: unknown): string {
  // RAMCO API errors
  if (error instanceof RamcoAuthenticationError) {
    return '🔐 Authentication failed. Please check that your RAMCO API key is correct and has not expired.';
  }

  if (error instanceof RamcoAuthorizationError) {
    return '🚫 Access denied. Your API key does not have permission to access this resource. Please contact your RAMCO administrator.';
  }

  if (error instanceof RamcoRateLimitError) {
    return '⏱️ Rate limit exceeded. Please wait a moment and try again. If this persists, contact your RAMCO administrator.';
  }

  if (error instanceof RamcoTimeoutError) {
    return '⏰ Request timeout. The operation took too long to complete. Try reducing the dataset size, adding more specific filters, or try again later.';
  }

  if (error instanceof RamcoServerError) {
    return '🔧 RAMCO API is experiencing technical difficulties. Please try again in a few moments. If the problem persists, contact support.';
  }

  if (error instanceof RamcoNetworkError) {
    return '🌐 Network connection error. Please check your internet connection and try again.';
  }

  if (error instanceof RamcoNotFoundError) {
    return '❓ The requested resource was not found. Please check that the ID is correct and the resource exists.';
  }

  if (error instanceof RamcoBadRequestError) {
    return `❌ Invalid request: ${error.message}`;
  }

  if (error instanceof RamcoAPIError) {
    return `❌ RAMCO API error: ${error.message}`;
  }

  // Validation errors (Zod)
  if (error instanceof z.ZodError) {
    const firstError = error.errors[0];
    const path = firstError.path.join('.');
    return `❌ Invalid input${path ? ` for "${path}"` : ''}: ${firstError.message}`;
  }

  // MCP protocol errors
  if (error instanceof ToolNotFoundError) {
    return `❌ Tool not found. The requested tool is not available.`;
  }

  if (error instanceof MethodNotFoundError) {
    return `❌ Method not supported. The requested operation is not available.`;
  }

  if (error instanceof InvalidParamsError) {
    if (error.validationError) {
      const firstError = error.validationError.errors[0];
      const path = firstError.path.join('.');
      return `❌ Invalid parameter${path ? ` "${path}"` : ''}: ${firstError.message}`;
    }
    return `❌ Invalid parameters: ${error.message}`;
  }

  if (error instanceof MCPError) {
    return `❌ Protocol error: ${error.message}`;
  }

  // Generic Error objects
  if (error instanceof Error) {
    // Log the full error for debugging but don't expose to user
    console.error('Internal error:', error);
    return '❌ An unexpected error occurred. Please try again or contact support if the issue persists.';
  }

  // Unknown error types
  console.error('Unknown error type:', error);
  return '❌ An unexpected error occurred. Please try again or contact support if the issue persists.';
}

/**
 * Create an MCP error response
 *
 * @param id - Request ID
 * @param error - The error to convert
 * @returns MCP error response object
 */
export function createMcpErrorResponse(id: string | number, error: unknown) {
  if (error instanceof MCPError) {
    return {
      jsonrpc: '2.0' as const,
      id,
      error: {
        code: error.code,
        message: error.message,
        data: error.data
      }
    };
  }

  if (error instanceof z.ZodError) {
    return {
      jsonrpc: '2.0' as const,
      id,
      error: {
        code: -32602,
        message: 'Invalid parameters',
        data: error.format()
      }
    };
  }

  // Generic error
  return {
    jsonrpc: '2.0' as const,
    id,
    error: {
      code: -32603,
      message: error instanceof Error ? error.message : 'Internal error',
      data: null
    }
  };
}

/**
 * Check if an error is retryable
 *
 * @param error - The error to check
 * @returns true if the error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof RamcoAPIError) {
    return error.retryable;
  }
  return false;
}

/**
 * Get retry delay in milliseconds based on attempt number
 * Uses exponential backoff: 1s, 2s, 4s, 8s, 16s
 *
 * @param attempt - Current attempt number (0-indexed)
 * @param baseDelay - Base delay in milliseconds (default: 1000)
 * @returns Delay in milliseconds
 */
export function getRetryDelay(attempt: number, baseDelay: number = 1000): number {
  return baseDelay * Math.pow(2, attempt);
}

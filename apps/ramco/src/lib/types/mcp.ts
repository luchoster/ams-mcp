/**
 * Model Context Protocol (MCP) Type Definitions
 *
 * Types for MCP protocol messages, responses, and tool definitions.
 * Based on MCP specification.
 */

import type { RamcoClient } from '../ramco-client-v2';

// ============================================================================
// Core MCP Protocol Types
// ============================================================================

/**
 * JSON-RPC 2.0 request structure
 */
export interface McpRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, any>;
}

/**
 * JSON-RPC 2.0 response structure
 */
export interface McpResponse<T = any> {
  jsonrpc: '2.0';
  id: string | number;
  result?: T;
  error?: McpError;
}

/**
 * JSON-RPC 2.0 error object
 */
export interface McpError {
  code: number;
  message: string;
  data?: any;
}

/**
 * MCP initialization request parameters
 */
export interface InitializeParams {
  protocolVersion: string;
  capabilities: {
    roots?: {
      listChanged?: boolean;
    };
    sampling?: Record<string, any>;
    experimental?: Record<string, any>;
  };
  clientInfo: {
    name: string;
    version: string;
  };
}

/**
 * MCP initialization response
 */
export interface InitializeResult {
  protocolVersion: string;
  capabilities: {
    logging?: Record<string, any>;
    prompts?: {
      listChanged?: boolean;
    };
    resources?: {
      subscribe?: boolean;
      listChanged?: boolean;
    };
    tools?: {
      listChanged?: boolean;
    };
    experimental?: Record<string, any>;
  };
  serverInfo: {
    name: string;
    version: string;
  };
}

// ============================================================================
// Tool Types
// ============================================================================

/**
 * MCP tool result content block
 */
export interface ToolResultContent {
  type: 'text' | 'resource' | 'image';
  text?: string;
  resource?: string;
  data?: string;
  mimeType?: string;
}

/**
 * MCP tool execution result
 */
export interface ToolResult {
  content: ToolResultContent[];
  isError?: boolean;
}

/**
 * JSON Schema for tool input validation
 */
export interface ToolInputSchema {
  type: 'object';
  properties: Record<string, any>;
  required?: string[];
  additionalProperties?: boolean;
}

/**
 * MCP tool definition
 */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
}

/**
 * Tool list response
 */
export interface ListToolsResult {
  tools: ToolDefinition[];
}

/**
 * Tool call request parameters
 */
export interface CallToolParams {
  name: string;
  arguments: Record<string, any>;
}

/**
 * Tool handler function type
 * All tool implementations must conform to this signature
 */
export type ToolHandler = (
  args: any,
  ramcoClient: RamcoClient,
  associationId?: string
) => Promise<ToolResult>;

/**
 * Tool registration entry
 */
export interface ToolRegistration {
  definition: ToolDefinition;
  handler: ToolHandler;
}

// ============================================================================
// Resource Types
// ============================================================================

/**
 * MCP resource definition
 */
export interface Resource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

/**
 * Resource list response
 */
export interface ListResourcesResult {
  resources: Resource[];
}

/**
 * Read resource request parameters
 */
export interface ReadResourceParams {
  uri: string;
}

/**
 * Resource content
 */
export interface ResourceContent {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string;
}

/**
 * Read resource result
 */
export interface ReadResourceResult {
  contents: ResourceContent[];
}

// ============================================================================
// Prompt Types
// ============================================================================

/**
 * MCP prompt definition
 */
export interface Prompt {
  name: string;
  description?: string;
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;
}

/**
 * Prompt list response
 */
export interface ListPromptsResult {
  prompts: Prompt[];
}

/**
 * Get prompt request parameters
 */
export interface GetPromptParams {
  name: string;
  arguments?: Record<string, string>;
}

/**
 * Prompt message
 */
export interface PromptMessage {
  role: 'user' | 'assistant';
  content: {
    type: 'text' | 'image' | 'resource';
    text?: string;
    data?: string;
    resource?: string;
    mimeType?: string;
  };
}

/**
 * Get prompt result
 */
export interface GetPromptResult {
  description?: string;
  messages: PromptMessage[];
}

// ============================================================================
// Logging Types
// ============================================================================

/**
 * Log levels
 */
export type LogLevel = 'debug' | 'info' | 'notice' | 'warning' | 'error' | 'critical' | 'alert' | 'emergency';

/**
 * Logging notification parameters
 */
export interface LoggingMessageParams {
  level: LogLevel;
  logger?: string;
  data?: any;
}

// ============================================================================
// Notification Types
// ============================================================================

/**
 * MCP notification structure (no response expected)
 */
export interface McpNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, any>;
}

/**
 * Progress notification parameters
 */
export interface ProgressParams {
  progressToken: string | number;
  progress: number;
  total?: number;
}

/**
 * Cancelled notification parameters
 */
export interface CancelledParams {
  requestId: string | number;
  reason?: string;
}

// ============================================================================
// Transport Types
// ============================================================================

/**
 * Transport method
 */
export type TransportMethod = 'http' | 'sse' | 'stdio';

/**
 * Transport configuration
 */
export interface TransportConfig {
  method: TransportMethod;
  url?: string;
  apiKey?: string;
  associationId?: string;
}

// ============================================================================
// Context Types
// ============================================================================

/**
 * Request context passed through middleware
 */
export interface RequestContext {
  request: Request;
  apiKey: string;
  associationId?: string;
  ramcoClient: RamcoClient;
  startTime: number;
}

/**
 * Tool execution context
 */
export interface ToolContext {
  ramcoClient: RamcoClient;
  associationId?: string;
  requestId?: string | number;
}

// ============================================================================
// Error Codes (JSON-RPC 2.0 + MCP extensions)
// ============================================================================

export const ErrorCodes = {
  // JSON-RPC 2.0 standard errors
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,

  // MCP-specific errors
  TOOL_NOT_FOUND: -32001,
  TOOL_EXECUTION_ERROR: -32002,
  RESOURCE_NOT_FOUND: -32003,
  PROMPT_NOT_FOUND: -32004,
  AUTHENTICATION_REQUIRED: -32005,
  RATE_LIMIT_EXCEEDED: -32006,
} as const;

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Extract parameter types from tool definition
 */
export type ExtractToolParams<T extends ToolDefinition> = T['inputSchema']['properties'];

/**
 * Make a type match the tool input schema
 */
export type ToolInput<T extends Record<string, any>> = T;

/**
 * Type-safe tool handler with validated inputs
 */
export type TypedToolHandler<TInput extends Record<string, any>> = (
  args: TInput,
  ramcoClient: RamcoClient,
  associationId?: string
) => Promise<ToolResult>;

/**
 * Tool Registry
 *
 * Central registry for all MCP tools.
 * Manages tool registration, lookup, and dispatching.
 */

import type { ToolHandler, ToolDefinition, ToolResult } from '../types/mcp';
import type { RamcoClient } from '../ramco-client-v2';

// Import tool handlers
import * as authTools from '../tools/authentication';
import * as searchTools from '../tools/search';
import * as metadataTools from '../tools/metadata';
import * as analyticsTools from '../tools/analytics';
import * as paymentTools from '../tools/payment';
import * as bulkSearchTools from '../tools/bulk-search';
import * as segmentationTools from '../tools/segmentation';
import * as patternsTools from '../tools/patterns';

// ============================================================================
// Tool Registry
// ============================================================================

/**
 * Global tool registry
 * Maps tool names to their handler functions
 */
export const toolRegistry = new Map<string, ToolHandler>();

/**
 * Register all available tools
 * Call this once at server startup
 */
export function registerAllTools(): void {
  console.log('[tool-registry] Registering tools...');

  // Authentication tools
  toolRegistry.set('test_connection', authTools.testConnection);
  toolRegistry.set('get_association_info', authTools.getAssociationInfo);

  // Search tools
  toolRegistry.set('search_records', searchTools.searchRecords);
  toolRegistry.set('get_record', searchTools.getRecord);
  toolRegistry.set('get_related_records', searchTools.getRelatedRecords);

  // Metadata tools
  toolRegistry.set('get_entity_types', metadataTools.getEntityTypes);
  toolRegistry.set('get_schema', metadataTools.getSchema);
  toolRegistry.set('get_entity_info', metadataTools.getEntityInfo);

  // Analytics tools
  toolRegistry.set('calculate_member_engagement', analyticsTools.calculateMemberEngagementTool);
  toolRegistry.set('analyze_membership_health', analyticsTools.analyzeMembershipHealthTool);
  toolRegistry.set('get_churn_risk_report', analyticsTools.getChurnRiskReportTool);
  toolRegistry.set('generate_membership_snapshot', analyticsTools.generateMembershipSnapshotTool);

  // Payment tools
  toolRegistry.set('analyze_payment_health', paymentTools.analyzePaymentHealthTool);

  // Bulk search tools
  toolRegistry.set('search_members_bulk', bulkSearchTools.searchMembersBulkTool);
  toolRegistry.set('calculate_engagement_distribution', bulkSearchTools.calculateEngagementDistributionTool);

  // Segmentation tools
  toolRegistry.set('segment_all_members', segmentationTools.segmentAllMembersTool);
  toolRegistry.set('find_all_at_risk_members', segmentationTools.findAllAtRiskMembersTool);

  // Pattern analysis tools
  toolRegistry.set('identify_member_patterns', patternsTools.identifyMemberPatternsTool);

  console.log(`[tool-registry] Registered ${toolRegistry.size} tools`);
}

/**
 * Call a tool by name
 *
 * @param name - Tool name
 * @param args - Tool arguments
 * @param ramcoClient - RAMCO API client instance
 * @param associationId - Optional association ID for filtering
 * @returns Tool execution result
 * @throws Error if tool not found
 */
export async function callTool(
  name: string,
  args: any,
  ramcoClient: RamcoClient,
  associationId?: string
): Promise<ToolResult> {
  const handler = toolRegistry.get(name);

  if (!handler) {
    throw new Error(`Tool not found: ${name}`);
  }

  // Execute tool with performance tracking
  const startTime = performance.now();
  try {
    const result = await handler(args, ramcoClient, associationId);
    const duration = Math.round(performance.now() - startTime);

    console.log(`[tool-registry] Tool '${name}' executed in ${duration}ms`);

    return result;
  } catch (error) {
    const duration = Math.round(performance.now() - startTime);
    console.error(`[tool-registry] Tool '${name}' failed after ${duration}ms:`, error);
    throw error;
  }
}

/**
 * Check if a tool exists
 *
 * @param name - Tool name
 * @returns true if tool is registered
 */
export function hasTool(name: string): boolean {
  return toolRegistry.has(name);
}

/**
 * Get list of all registered tool names
 *
 * @returns Array of tool names
 */
export function listToolNames(): string[] {
  return Array.from(toolRegistry.keys());
}

/**
 * Get tool registry statistics
 */
export function getRegistryStats() {
  return {
    totalTools: toolRegistry.size,
    tools: listToolNames()
  };
}

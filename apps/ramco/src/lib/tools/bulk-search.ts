/**
 * Bulk Search Tools
 *
 * Tools for bulk member searches and engagement distribution analysis.
 */

import type { ToolHandler, ToolResult } from '../types/mcp';
import type { RamcoClient } from '../ramco-client-v2';
import { parseNaturalLanguageQuery } from '../natural-language';
import { calculateMemberEngagement } from '../analytics-helpers';
import {
  fetchAllRecords,
  fetchBulkRelationships,
  groupBy,
  calculateStatistics,
  calculatePercentiles
} from '../bulk-operations';

// ============================================================================
// Tool Handlers
// ============================================================================

/**
 * Search members using natural language queries
 */
export const searchMembersBulkTool: ToolHandler = async (
  args: any,
  ramcoClient: RamcoClient,
  associationId?: string
): Promise<ToolResult> => {
  const query = args.query;
  const limit = args?.limit || 100;
  const exportFormat = args?.exportFormat || 'summary';

  if (!query) {
    throw new Error('query is required');
  }

  // Parse natural language query
  const parsedQuery = parseNaturalLanguageQuery(query);

  // Build filter with StatusCode check and association filter
  let finalFilter = parsedQuery.filter;

  // For contacts, always filter for active records (statecode = 0)
  if ((parsedQuery.entity || 'contact') === 'contact') {
    const statusFilter = `statecode<eq>0`;
    finalFilter = finalFilter
      ? `(${parsedQuery.filter}) and ${statusFilter}`
      : statusFilter;

    // Skip association filter for name searches to find members across all associations
    // For other queries, add association filter if configured
    if (associationId && !parsedQuery.isNameSearch) {
      finalFilter = `${finalFilter} and ramco_primaryassociationid<eq>'${associationId}'`;
    }
  }

  // Fetch members matching the query
  const members = await ramcoClient.searchRecords({
    module: parsedQuery.entity || 'contact',
    filter: finalFilter,
    fields: parsedQuery.fields,
    limit: limit
  });

  let responseText = `🔍 **Search Results**\n\n`;
  responseText += `**Query:** "${query}"\n`;
  responseText += `**Interpretation:** ${parsedQuery.interpretation}\n`;
  responseText += `**Results Found:** ${members?.length || 0}\n\n`;

  if (exportFormat === 'summary' && members?.length > 0) {
    responseText += `**Sample Results (First 10):**\n`;
    members.slice(0, 10).forEach((member: any) => {
      const name = `${member.FirstName || ''} ${member.LastName || ''}`.trim();
      const email = member.EmailAddress1 || member.emailaddress1 || 'No email';
      responseText += `• ${name} - ${email}\n`;
    });

    if (members.length > 10) {
      responseText += `\n*... and ${members.length - 10} more results*\n`;
    }
  } else if (exportFormat === 'json') {
    responseText += `\`\`\`json\n${JSON.stringify(members, null, 2)}\n\`\`\``;
  } else if (exportFormat === 'csv') {
    // Generate CSV format
    const headers = Object.keys(members[0] || {}).join(',');
    const rows = members.map((m: any) =>
      Object.values(m).map(v => `"${v}"`).join(',')
    ).join('\n');
    responseText += `\`\`\`csv\n${headers}\n${rows}\n\`\`\``;
  }

  responseText += `\n**Filter Applied:** \`${parsedQuery.filter}\``;

  return {
    content: [{
      type: "text",
      text: responseText
    }]
  };
};

/**
 * Analyze engagement patterns across entire membership with percentiles
 */
export const calculateEngagementDistributionTool: ToolHandler = async (
  args: any,
  ramcoClient: RamcoClient,
  associationId?: string
): Promise<ToolResult> => {
  // Build filter - query cobalt_membership (not contact) for actual members
  let filterParts = [];

  // Filter for active memberships only
  filterParts.push(`StatusCode<eq>1`);

  if (associationId) {
    filterParts.push(`ramco_associationid<eq>'${associationId}'`);
  }

  const filter = filterParts.length > 0 ? filterParts.join(' and ') : undefined;

  // Fetch all membership records for engagement analysis
  const members = await fetchAllRecords(ramcoClient, {
    entity: 'cobalt_membership',
    filter,
    fields: [
      'cobalt_membershipId', 'cobalt_contactid', 'cobalt_name', 'statuscode', 'CreatedOn',
      'cobalt_membertypeid'
    ],
    maxRecords: 20000
  });

  if (members.length === 0) {
    return {
      content: [{
        type: "text",
        text: `⚠️ No members found for engagement distribution analysis.`
      }]
    };
  }

  // Extract contact IDs and enrich with relationship data
  const contactIds = members.map(m => {
    const ref = (m.cobalt_ContactId || m.cobalt_contactid) as any;
    return ref?.Value || ref;
  }).filter(Boolean);
  const bulkRelationships = await fetchBulkRelationships(ramcoClient, contactIds);

  // Enrich members and calculate engagement
  const memberEngagement = members.map(member => {
    const contactRef = (member.cobalt_ContactId || member.cobalt_contactid) as any;
    const contactId = contactRef?.Value || contactRef;
    const enrichedMember = {
      ...member,
      eventRegistrations: bulkRelationships.events.get(contactId) || [],
      committees: bulkRelationships.committees.get(contactId) || [],
      classRegistrations: bulkRelationships.classes.get(contactId) || []
    };
    return {
      ...enrichedMember,
      engagement: calculateMemberEngagement(enrichedMember)
    };
  });

  // Group by engagement level
  const engagementGroups = groupBy(memberEngagement, 'engagement.level');

  // Calculate statistics
  const engagementScores = memberEngagement.map(m => m.engagement.overall);
  const stats = calculateStatistics(engagementScores);
  const percentiles = calculatePercentiles(memberEngagement, 'engagement.overall');

  let responseText = `📊 **Engagement Distribution Analysis**\n\n`;
  responseText += `**Total Members:** ${members.length}\n\n`;

  responseText += `**Engagement Levels:**\n`;
  Object.entries(engagementGroups).forEach(([level, levelMembers]) => {
    const percentage = (levelMembers.length / members.length * 100).toFixed(1);
    responseText += `• ${level}: ${levelMembers.length} members (${percentage}%)\n`;
  });

  responseText += `\n**Score Distribution:**\n`;
  responseText += `• Mean: ${stats?.mean || 0}/100\n`;
  responseText += `• Median: ${stats?.median || 0}/100\n`;
  responseText += `• 25th Percentile: ${percentiles[25]}/100\n`;
  responseText += `• 75th Percentile: ${percentiles[75]}/100\n`;
  responseText += `• 90th Percentile: ${percentiles[90]}/100\n`;

  // Group by requested dimension if provided
  if (args?.groupBy) {
    responseText += `\n**Grouped by ${args.groupBy}:**\n`;
    // Note: chapter and memberType grouping not available without valid fields
    // Default to engagement level grouping
    const grouped = groupBy(memberEngagement, 'engagement.level');
    Object.entries(grouped).slice(0, 10).forEach(([group, groupMembers]) => {
      const avgEngagement = groupMembers.reduce((sum: number, m: any) => sum + m.engagement.overall, 0) / groupMembers.length;
      responseText += `• ${group || 'Unknown'}: ${groupMembers.length} members (avg: ${avgEngagement.toFixed(1)})\n`;
    });
  }

  return {
    content: [{
      type: "text",
      text: responseText
    }]
  };
};

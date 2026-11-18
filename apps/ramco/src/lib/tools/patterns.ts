/**
 * Pattern Analysis Tools
 *
 * Tools for discovering patterns in member behavior, success factors, and churn triggers.
 */

import type { ToolHandler, ToolResult } from '../types/mcp';
import type { RamcoClient } from '../ramco-client-v2';
import {
  calculateMemberEngagement,
  identifyPatterns
} from '../analytics-helpers';
import { fetchAllRecords, fetchBulkRelationships } from '../bulk-operations';

// ============================================================================
// Tool Handlers
// ============================================================================

/**
 * Discover patterns in member behavior, success factors, and churn triggers
 */
export const identifyMemberPatternsTool: ToolHandler = async (
  args: any,
  ramcoClient: RamcoClient,
  associationId?: string
): Promise<ToolResult> => {
  const analysisType = args?.analysisType || 'all';
  const minSampleSize = args?.minimumSampleSize || 10;

  // Build filter - query cobalt_membership (not contact) for actual members
  let filterParts = ['StatusCode<eq>1']; // Active memberships only
  if (associationId) {
    filterParts.push(`ramco_associationid<eq>'${associationId}'`);
  }

  const filter = filterParts.length > 0 ? filterParts.join(' and ') : undefined;

  // Fetch all membership records with extended data
  const allMembers = await fetchAllRecords(ramcoClient, {
    entity: 'cobalt_membership',
    filter,
    fields: [
      'cobalt_membershipId', 'cobalt_contactid', 'cobalt_name', 'statuscode', 'CreatedOn',
      'cobalt_membertypeid', 'ramco_memberstatusdate'
    ],
    maxRecords: 20000
  });

  if (allMembers.length === 0) {
    return {
      content: [{
        type: "text",
        text: `⚠️ No members found for pattern analysis.`
      }]
    };
  }

  // Extract contact IDs and enrich with relationship data
  const contactIds = allMembers.map(m => {
    const ref = (m.cobalt_ContactId || m.cobalt_contactid) as any;
    return ref?.Value || ref;
  }).filter(Boolean);
  const bulkRelationships = await fetchBulkRelationships(ramcoClient, contactIds);

  // Enrich all members with relationship data
  const enrichedMembers = allMembers.map(member => {
    const contactRef = (member.cobalt_ContactId || member.cobalt_contactid) as any;
    const contactId = contactRef?.Value || contactRef;
    return {
      ...member,
      eventRegistrations: bulkRelationships.events.get(contactId) || [],
      committees: bulkRelationships.committees.get(contactId) || [],
      classRegistrations: bulkRelationships.classes.get(contactId) || []
    };
  });

  const patterns = identifyPatterns(enrichedMembers);

  let responseText = `🔍 **Member Pattern Analysis**\n\n`;
  responseText += `**Analysis Type:** ${analysisType}\n`;
  responseText += `**Members Analyzed:** ${enrichedMembers.length}\n`;
  responseText += `**Minimum Sample Size:** ${minSampleSize}\n\n`;

  if (analysisType === 'all' || analysisType === 'retention') {
    responseText += `**RETENTION PATTERNS:**\n`;
    if (patterns.successPatterns.length > 0) {
      responseText += `*High-retention member characteristics:*\n`;
      patterns.successPatterns.forEach((trait: any) => {
        responseText += `• ${trait.trait}: ${trait.value} (${trait.percentage}% of successful members)\n`;
      });
    } else {
      responseText += `*Insufficient data for high-retention patterns*\n`;
    }

    if (patterns.churnPatterns.length > 0) {
      responseText += `\n*Common churn indicators:*\n`;
      patterns.churnPatterns.forEach((trait: any) => {
        responseText += `• ${trait.trait}: ${trait.value} (${trait.percentage}% of churned members)\n`;
      });
    } else {
      responseText += `\n*No churned members found for pattern analysis*\n`;
    }
    responseText += `\n`;
  }

  if (analysisType === 'all' || analysisType === 'growth') {
    responseText += `**GROWTH OPPORTUNITIES:**\n`;
    if (patterns.growthOpportunities.length > 0) {
      patterns.growthOpportunities.forEach((opp: any) => {
        responseText += `• **${opp.opportunity}**\n`;
        responseText += `  Members: ${opp.count}\n`;
        responseText += `  Revenue Potential: $${opp.potentialRevenue.toLocaleString()}\n`;
        responseText += `  Recommendation: ${opp.recommendation}\n\n`;
      });
    } else {
      responseText += `*No significant growth opportunities identified*\n\n`;
    }
  }

  if (analysisType === 'all' || analysisType === 'engagement') {
    responseText += `**ENGAGEMENT PATTERNS:**\n`;
    const engagementAnalysis = enrichedMembers.map(m => calculateMemberEngagement(m));
    const avgEngagement = engagementAnalysis.reduce((sum, e) => sum + e.overall, 0) / engagementAnalysis.length;
    responseText += `• Average engagement score: ${avgEngagement.toFixed(1)}/100\n`;

    const highEngaged = engagementAnalysis.filter(e => e.overall > 70).length;
    responseText += `• Highly engaged members: ${highEngaged} (${(highEngaged/enrichedMembers.length*100).toFixed(1)}%)\n`;

    const atRiskEngagement = engagementAnalysis.filter(e => e.overall < 30).length;
    responseText += `• At-risk (low engagement): ${atRiskEngagement} (${(atRiskEngagement/enrichedMembers.length*100).toFixed(1)}%)\n\n`;
  }

  responseText += `**DATA QUALITY ISSUES:**\n`;
  if (patterns.dataQualityIssues.length > 0) {
    patterns.dataQualityIssues.forEach((issue: any) => {
      responseText += `• **${issue.issue}**: ${issue.count} members (${issue.percentage}%)\n`;
      responseText += `  Impact: ${issue.impact}\n\n`;
    });
  } else {
    responseText += `*No significant data quality issues detected*\n`;
  }

  return {
    content: [{
      type: "text",
      text: responseText
    }]
  };
};

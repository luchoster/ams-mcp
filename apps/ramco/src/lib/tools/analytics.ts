/**
 * Analytics Tools
 *
 * Tools for member engagement analysis, membership health reporting,
 * churn risk assessment, and membership snapshots.
 */

import type { ToolHandler, ToolResult } from '../types/mcp';
import type { RamcoClient } from '../ramco-client-v2';
import {
  calculateMemberEngagement,
  assessChurnRisk,
  calculateLifetimeValue
} from '../analytics-helpers';
import {
  fetchAllRecords,
  fetchBulkRelationships,
  groupBy,
  calculateStatistics,
  calculatePercentiles
} from '../bulk-operations';
import { createLogger } from '../utils/logger';

const logger = createLogger('analytics-tools');

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Calculate comprehensive member engagement score
 */
async function calculateMemberEngagementScore(
  contactId: string,
  ramcoClient: RamcoClient
): Promise<any> {
  // Fetch contact data
  const contact = await ramcoClient.getRecord(contactId, 'contact');

  if (!contact) {
    throw new Error(`Contact ${contactId} not found`);
  }

  // Fetch event registrations
  const events = await ramcoClient.searchRecords({
    module: 'cobalt_meetingregistration',
    filter: `cobalt_contactid<eq>'${contactId}'`,
    fields: ['cobalt_name', 'createdon'],
    limit: 100
  });

  // Fetch committee memberships
  const committees = await ramcoClient.searchRecords({
    module: 'cobalt_committeemembership',
    filter: `cobalt_contactid<eq>'${contactId}'`,
    fields: ['cobalt_name', 'statecode', 'createdon'],
    limit: 100
  });

  // Fetch class registrations
  const classes = await ramcoClient.searchRecords({
    module: 'cobalt_classregistration',
    filter: `cobalt_contactid<eq>'${contactId}'`,
    fields: ['cobalt_name', 'createdon', 'cobalt_attended'],
    limit: 100
  });

  // Enrich contact data with related records
  const enrichedContact = {
    ...contact,
    eventRegistrations: Array.isArray(events) ? events : [],
    committees: Array.isArray(committees) ? committees : [],
    classRegistrations: Array.isArray(classes) ? classes : []
  };

  // Calculate engagement
  const engagement = calculateMemberEngagement(enrichedContact);

  return {
    scores: {
      overall: engagement.overall,
      committees: engagement.components.committees,
      events: engagement.components.events,
      education: engagement.components.education
    },
    level: engagement.level,
    riskFactors: engagement.riskFactors,
    recommendations: engagement.recommendations,
    details: {
      committees: enrichedContact.committees,
      events: enrichedContact.eventRegistrations,
      classes: enrichedContact.classRegistrations
    }
  };
}

// ============================================================================
// Tool Handlers
// ============================================================================

/**
 * Calculate comprehensive engagement score and renewal risk for a member
 */
export const calculateMemberEngagementTool: ToolHandler = async (
  args: any,
  ramcoClient: RamcoClient,
  associationId?: string
): Promise<ToolResult> => {
  // Validate contact ID
  if (!args.contactId) {
    throw new Error('contactId is required');
  }

  // Verify contact belongs to configured association if set
  if (associationId) {
    const contact = await ramcoClient.getRecord(args.contactId, 'contact');
    const contactAssocId = contact?.ramco_primaryassociationid?.Value || contact?.ramco_primaryassociationid;
    if (contactAssocId !== associationId) {
      return {
        content: [{
          type: "text",
          text: `⚠️ Contact ${args.contactId} does not belong to the configured association`
        }]
      };
    }
  }

  // Calculate engagement score
  const engagementScore = await calculateMemberEngagementScore(
    args.contactId,
    ramcoClient
  );

  // Determine risk level
  let riskLevel = "🟢 Low Risk";
  if (engagementScore.scores.overall < 20) {
    riskLevel = "🔴 High Risk";
  } else if (engagementScore.scores.overall < 40) {
    riskLevel = "🟡 Moderate Risk";
  }

  // Build report
  let reportText = `📊 **Member Engagement Analysis**\n\n`;
  reportText += `**Contact ID:** ${args.contactId}\n`;
  reportText += `**Renewal Risk:** ${riskLevel}\n\n`;

  reportText += `**Engagement Scores:**\n`;
  reportText += `• Overall: ${engagementScore.scores.overall}/100\n`;
  reportText += `• Committee Involvement: ${engagementScore.scores.committees}/100\n`;
  reportText += `• Event Attendance: ${engagementScore.scores.events}/100\n`;
  reportText += `• Education Participation: ${engagementScore.scores.education}/100\n\n`;

  if (engagementScore.riskFactors.length > 0) {
    reportText += `**Risk Factors:**\n`;
    engagementScore.riskFactors.forEach((factor: string) => {
      reportText += `⚠️ ${factor}\n`;
    });
    reportText += `\n`;
  }

  if (engagementScore.recommendations.length > 0) {
    reportText += `**Recommendations:**\n`;
    engagementScore.recommendations.forEach((rec: string) => {
      reportText += `💡 ${rec}\n`;
    });
    reportText += `\n`;
  }

  reportText += `**Activity Summary:**\n`;
  reportText += `• Active Committees: ${engagementScore.details.committees.filter((c: any) => c.statecode?.Value === 0).length}\n`;
  reportText += `• Total Events Attended: ${engagementScore.details.events.length}\n`;
  reportText += `• Classes Completed: ${engagementScore.details.classes.length}\n`;

  return {
    content: [{
      type: "text",
      text: reportText
    }]
  };
};

/**
 * Analyze health of entire membership with engagement scores and risk levels
 */
export const analyzeMembershipHealthTool: ToolHandler = async (
  args: any,
  ramcoClient: RamcoClient,
  associationId?: string
): Promise<ToolResult> => {
  // Build filter with association constraint
  // Query cobalt_membership (not contact) to get actual members only
  let filterParts = ['StatusCode<eq>1']; // Active memberships only

  if (associationId) {
    filterParts.push(`ramco_associationid<eq>'${associationId}'`);
  }

  if (args?.filters?.memberType) {
    filterParts.push(`cobalt_membertypeid<eq>'${args.filters.memberType}'`);
  }

  const memberFilter = filterParts.join(' and ');

  logger.debug('Starting membership health analysis', {
    filter: memberFilter,
    associationId: associationId || 'none'
  });

  // Fetch all membership records with basic data
  const allMembers = await fetchAllRecords(ramcoClient, {
    entity: 'cobalt_membership',
    filter: memberFilter,
    fields: ['cobalt_membershipId', 'cobalt_contactid', 'cobalt_name', 'CreatedOn', 'cobalt_membertypeid'],
    maxRecords: 20000
  });

  if (allMembers.length === 0) {
    return {
      content: [{
        type: "text",
        text: `⚠️ No active members found with the current filters.\n\nFilter applied: ${memberFilter}\n\nThis could mean:\n• No members match the StatusCode=1 (Active) criteria\n• The association filter is excluding all members\n• There are no members in the system\n\nTry running without filters or check the association configuration.`
      }]
    };
  }

  // Extract contact IDs from membership records for bulk fetching
  const contactIds = allMembers.map(m => {
    const ref = (m.cobalt_ContactId || m.cobalt_contactid) as any;
    return ref?.Value || ref;
  }).filter(Boolean);

  // Fetch all relationship data in bulk
  const bulkRelationships = await fetchBulkRelationships(ramcoClient, contactIds);

  // Enrich all members with their relationship data
  const memberAnalytics = allMembers.map((member) => {
    try {
      // Get the contact ID from the membership's EntityReference
      const contactRef = (member.cobalt_ContactId || member.cobalt_contactid) as any;
      const contactId = contactRef?.Value || contactRef;
      // Get relationship data from bulk fetch results
      const events = bulkRelationships.events.get(contactId) || [];
      const committees = bulkRelationships.committees.get(contactId) || [];
      const classes = bulkRelationships.classes.get(contactId) || [];

      // Enrich member data
      const enrichedMember = {
        ...member,
        eventRegistrations: events,
        committees: committees,
        classRegistrations: classes
      };

      return {
        member: enrichedMember,
        engagement: calculateMemberEngagement(enrichedMember),
        risk: assessChurnRisk(enrichedMember)
      };
    } catch (error) {
      // If individual member processing fails, return with zero engagement
      return {
        member,
        engagement: calculateMemberEngagement(member),
        risk: assessChurnRisk(member)
      };
    }
  });

  // Group by engagement level
  const engagementGroups = groupBy(memberAnalytics, 'engagement.level');

  // Calculate statistics
  const engagementScores = memberAnalytics.map(m => m.engagement.overall);
  const stats = calculateStatistics(engagementScores);
  const percentiles = calculatePercentiles(memberAnalytics, 'engagement.overall');

  // Identify top risk factors
  const allRiskFactors = memberAnalytics.flatMap(m => m.engagement.riskFactors);
  const riskFactorCounts = allRiskFactors.reduce((acc, factor) => {
    acc[factor] = (acc[factor] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // Format response
  let responseText = `📊 **Association Health Analysis**\n\n`;
  responseText += `**Total Members:** ${allMembers.length}\n`;
  responseText += `**Members Analyzed:** ${memberAnalytics.length}\n\n`;

  responseText += `**Engagement Distribution:**\n`;
  Object.entries(engagementGroups).forEach(([level, members]) => {
    const percentage = ((members.length / memberAnalytics.length) * 100).toFixed(1);
    responseText += `• ${level}: ${members.length} members (${percentage}%)\n`;
  });

  responseText += `\n**Engagement Statistics:**\n`;
  responseText += `• Average Score: ${stats?.mean || 0}/100\n`;
  responseText += `• Median Score: ${stats?.median || 0}/100\n`;
  responseText += `• Top 10%: ${percentiles[90]}/100 or higher\n`;
  responseText += `• Bottom 25%: ${percentiles[25]}/100 or lower\n`;

  responseText += `\n**Top Risk Factors:**\n`;
  Object.entries(riskFactorCounts)
    .sort(([,a], [,b]) => (b as number) - (a as number))
    .slice(0, 5)
    .forEach(([factor, count]) => {
      responseText += `• ${factor}: ${count} members\n`;
    });

  responseText += `\n**Immediate Actions Needed:**\n`;
  const criticalMembers = memberAnalytics.filter(m => m.risk.riskLevel === 'critical');
  responseText += `• ${criticalMembers.length} members need immediate attention\n`;
  responseText += `• Estimated revenue at risk: $${(criticalMembers.length * 500).toLocaleString()}\n`;

  if (args?.includeDetails && criticalMembers.length > 0) {
    responseText += `\n**Critical Members (Top 10):**\n`;
    criticalMembers.slice(0, 10).forEach(m => {
      const mem = m.member as any;
      const memberName = mem.cobalt_name || mem.cobalt_ContactId?.Display || 'Unknown';
      responseText += `• ${memberName} - Risk: ${m.risk.riskScore}/100\n`;
    });
  }

  return {
    content: [{
      type: "text",
      text: responseText
    }]
  };
};

/**
 * Identify all members at risk of churning with predictive scoring
 */
export const getChurnRiskReportTool: ToolHandler = async (
  args: any,
  ramcoClient: RamcoClient,
  associationId?: string
): Promise<ToolResult> => {
  const renewalWindow = args?.renewalWindow || 90;
  const limit = args?.limit || 100;
  const minRiskScore = args?.minRiskScore || 50;

  // Build filter - query cobalt_membership (not contact) for actual members
  let filterParts = ['StatusCode<eq>1']; // Active memberships only
  if (associationId) {
    filterParts.push(`ramco_associationid<eq>'${associationId}'`);
  }

  // Fetch all active membership records
  const members = await fetchAllRecords(ramcoClient, {
    entity: 'cobalt_membership',
    filter: filterParts.join(' and '),
    fields: ['cobalt_membershipId', 'cobalt_contactid', 'cobalt_name', 'CreatedOn', 'cobalt_membertypeid', 'ramco_memberstatusdate'],
    maxRecords: 20000
  });

  if (members.length === 0) {
    return {
      content: [{
        type: "text",
        text: `⚠️ No active members found for churn risk analysis.`
      }]
    };
  }

  // Extract contact IDs and enrich with relationship data
  const contactIds = members.map(m => {
    const ref = (m.cobalt_ContactId || m.cobalt_contactid) as any;
    return ref?.Value || ref;
  }).filter(Boolean);
  const bulkRelationships = await fetchBulkRelationships(ramcoClient, contactIds);

  // Enrich members and assess churn risk
  const riskAssessments = members
    .map(member => {
      const contactRef = (member.cobalt_ContactId || member.cobalt_contactid) as any;
      const contactId = contactRef?.Value || contactRef;
      const enrichedMember = {
        ...member,
        eventRegistrations: bulkRelationships.events.get(contactId) || [],
        committees: bulkRelationships.committees.get(contactId) || [],
        classRegistrations: bulkRelationships.classes.get(contactId) || []
      };
      return assessChurnRisk(enrichedMember);
    })
    .filter(assessment => assessment.riskScore >= minRiskScore)
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, limit);

  // Group by risk level
  const riskGroups = groupBy(riskAssessments, 'riskLevel');

  // Format response
  let responseText = `🚨 **Churn Risk Report**\n\n`;
  responseText += `**Analysis Period:** Next ${renewalWindow} days\n`;
  responseText += `**Members Analyzed:** ${members.length}\n\n`;

  responseText += `**Risk Distribution:**\n`;
  ['critical', 'high', 'medium', 'low'].forEach(level => {
    const count = riskGroups[level]?.length || 0;
    if (count > 0) {
      responseText += `• ${level.toUpperCase()}: ${count} members\n`;
    }
  });

  const totalAtRisk = (riskGroups['critical']?.length || 0) + (riskGroups['high']?.length || 0);
  const predictedChurnRate = (totalAtRisk / members.length * 100).toFixed(1);
  responseText += `\n**Predicted Churn Rate:** ${predictedChurnRate}%\n`;
  responseText += `**Revenue at Risk:** $${(totalAtRisk * 500).toLocaleString()}\n`;

  responseText += `\n**Top 10 At-Risk Members:**\n`;
  riskAssessments.slice(0, 10).forEach(assessment => {
    responseText += `\n**${assessment.name}**\n`;
    responseText += `• Risk Score: ${assessment.riskScore}/100 (${assessment.riskLevel})\n`;
    responseText += `• Days Until Renewal: ${assessment.daysUntilRenewal || 'Unknown'}\n`;
    responseText += `• Key Intervention: ${assessment.interventions[0]}\n`;
  });

  return {
    content: [{
      type: "text",
      text: responseText
    }]
  };
};

/**
 * Generate comprehensive membership snapshot with totals and growth metrics
 */
export const generateMembershipSnapshotTool: ToolHandler = async (
  args: any,
  ramcoClient: RamcoClient,
  associationId?: string
): Promise<ToolResult> => {
  const asOfDate = args?.asOfDate ? new Date(args.asOfDate) : new Date();

  // Build filter with association constraint
  // Query cobalt_membership (not contact) to get actual members only
  let filterParts = ['StatusCode<eq>1']; // Active memberships only
  if (associationId) {
    filterParts.push(`ramco_associationid<eq>'${associationId}'`);
  }

  // Fetch all current membership records
  const currentMembers = await fetchAllRecords(ramcoClient, {
    entity: 'cobalt_membership',
    filter: filterParts.join(' and '),
    fields: ['cobalt_membershipId', 'cobalt_contactid', 'cobalt_name', 'CreatedOn', 'cobalt_membertypeid', 'statuscode'],
    maxRecords: 20000
  });

  if (currentMembers.length === 0) {
    return {
      content: [{
        type: "text",
        text: `⚠️ No active members found for snapshot generation.`
      }]
    };
  }

  // Calculate basic metrics
  const totalMembers = currentMembers.length;

  // Group by member type if requested
  let groupedData: Record<string, any> = {};
  if (args?.groupBy?.includes('memberType')) {
    groupedData.byMemberType = currentMembers.reduce((acc, m) => {
      const type = m.cobalt_MemberTypeId?.Display || 'Unknown';
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }

  // Build response
  let responseText = `📊 **Membership Snapshot**\n\n`;
  responseText += `**As of:** ${asOfDate.toLocaleDateString()}\n`;
  responseText += `**Total Active Members:** ${totalMembers}\n\n`;

  if (groupedData.byMemberType) {
    responseText += `**By Member Type:**\n`;
    Object.entries(groupedData.byMemberType)
      .sort(([,a], [,b]) => (b as number) - (a as number))
      .forEach(([type, count]) => {
        const percentage = ((count as number) / totalMembers * 100).toFixed(1);
        responseText += `• ${type}: ${count} (${percentage}%)\n`;
      });
  }

  return {
    content: [{
      type: "text",
      text: responseText
    }]
  };
};

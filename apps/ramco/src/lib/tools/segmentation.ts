/**
 * Segmentation Tools
 *
 * Tools for automatic member segmentation and at-risk member identification.
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
  daysSince
} from '../bulk-operations';

// ============================================================================
// Tool Handlers
// ============================================================================

/**
 * Automatically segment entire membership based on multiple criteria
 */
export const segmentAllMembersTool: ToolHandler = async (
  args: any,
  ramcoClient: RamcoClient,
  associationId?: string
): Promise<ToolResult> => {
  const strategy = args.segmentationStrategy;

  if (!strategy) {
    throw new Error('segmentationStrategy is required');
  }

  // Build filter - query cobalt_membership (not contact) for actual members
  let filterParts = ['StatusCode<eq>1']; // Active memberships only
  if (associationId) {
    filterParts.push(`ramco_associationid<eq>'${associationId}'`);
  }

  const filter = filterParts.length > 0 ? filterParts.join(' and ') : undefined;

  // Fetch all membership records
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
        text: `⚠️ No members found for segmentation analysis.`
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

  let segments: Record<string, any[]> = {};
  let responseText = `🎯 **Member Segmentation Analysis**\n\n`;
  responseText += `**Strategy:** ${strategy}\n`;
  responseText += `**Total Members:** ${enrichedMembers.length}\n\n`;

  // Apply segmentation strategy
  switch (strategy) {
    case 'engagement':
      const memberEngagement = enrichedMembers.map(member => ({
        ...member,
        engagement: calculateMemberEngagement(member)
      }));
      segments = groupBy(memberEngagement, 'engagement.level');
      break;

    case 'lifecycle':
      segments = enrichedMembers.reduce((acc, member) => {
        const daysSinceJoin = member.CreatedOn ? daysSince(member.CreatedOn) : 9999;
        let stage = 'unknown';
        if (daysSinceJoin < 30) stage = 'new';
        else if (daysSinceJoin < 365) stage = 'developing';
        else if (daysSinceJoin < 1825) stage = 'established';
        else stage = 'veteran';

        if (!acc[stage]) acc[stage] = [];
        acc[stage].push(member);
        return acc;
      }, {} as Record<string, any[]>);
      break;

    case 'risk':
      const riskAssessments = enrichedMembers.map(member => ({
        ...member,
        risk: assessChurnRisk(member)
      }));
      segments = groupBy(riskAssessments, 'risk.riskLevel');
      break;

    case 'value':
      const memberValues = enrichedMembers.map(member => ({
        ...member,
        ltv: calculateLifetimeValue(member)
      }));
      segments = memberValues.reduce((acc, member) => {
        const ltv = member.ltv;
        let tier = 'unknown';
        if (ltv >= 5000) tier = 'high-value';
        else if (ltv >= 2000) tier = 'medium-value';
        else if (ltv >= 500) tier = 'standard-value';
        else tier = 'low-value';

        if (!acc[tier]) acc[tier] = [];
        acc[tier].push(member);
        return acc;
      }, {} as Record<string, any[]>);
      break;

    case 'custom':
      // Apply custom rules if provided
      if (args.customRules) {
        args.customRules.forEach((rule: any) => {
          segments[rule.name] = enrichedMembers.filter((member: any) => {
            // Simple evaluation - in production would need more robust parsing
            // For now, just return empty segments for custom rules
            return false;
          });
        });
      }
      break;

    default:
      throw new Error(`Unknown segmentation strategy: ${strategy}`);
  }

  responseText += `**Segments Identified:**\n`;
  Object.entries(segments).forEach(([segmentName, segmentMembers]) => {
    const percentage = (segmentMembers.length / enrichedMembers.length * 100).toFixed(1);
    responseText += `• **${segmentName}**: ${segmentMembers.length} members (${percentage}%)\n`;
  });

  // Show overlap analysis
  responseText += `\n**Segment Overview:**\n`;
  const segmentNames = Object.keys(segments);
  if (segmentNames.length > 1) {
    const largest = segmentNames.sort((a, b) => segments[b].length - segments[a].length);
    responseText += `• Largest segment: ${largest[0]} (${segments[largest[0]].length} members)\n`;
    if (largest[1]) {
      responseText += `• Second largest: ${largest[1]} (${segments[largest[1]].length} members)\n`;
    }
  }

  return {
    content: [{
      type: "text",
      text: responseText
    }]
  };
};

/**
 * Identify all at-risk members across multiple risk factors
 */
export const findAllAtRiskMembersTool: ToolHandler = async (
  args: any,
  ramcoClient: RamcoClient,
  associationId?: string
): Promise<ToolResult> => {
  const riskFactors = args?.riskFactors || ['payment', 'engagement', 'tenure', 'communication'];
  const returnLimit = args?.returnLimit || 50;

  // Build filter - query cobalt_membership (not contact) for actual members
  let filterParts = ['StatusCode<eq>1']; // Active memberships only
  if (associationId) {
    filterParts.push(`ramco_associationid<eq>'${associationId}'`);
  }

  const filter = filterParts.length > 0 ? filterParts.join(' and ') : undefined;

  // Fetch all membership records
  const allMembers = await fetchAllRecords(ramcoClient, {
    entity: 'cobalt_membership',
    filter,
    fields: [
      'cobalt_membershipId', 'cobalt_contactid', 'cobalt_name', 'statuscode',
      'CreatedOn', 'cobalt_membertypeid', 'ramco_memberstatusdate'
    ],
    maxRecords: 20000
  });

  if (allMembers.length === 0) {
    return {
      content: [{
        type: "text",
        text: `⚠️ No members found for at-risk analysis.`
      }]
    };
  }

  // Extract contact IDs and enrich with relationship data
  const contactIds = allMembers.map(m => {
    const ref = (m.cobalt_ContactId || m.cobalt_contactid) as any;
    return ref?.Value || ref;
  }).filter(Boolean);
  const bulkRelationships = await fetchBulkRelationships(ramcoClient, contactIds);

  const atRiskMembers: Record<string, any[]> = {};

  // Initialize risk factor arrays
  riskFactors.forEach((factor: string) => {
    atRiskMembers[factor] = [];
  });

  // Analyze each member with enriched data
  allMembers.forEach(member => {
    const contactRef = (member.cobalt_ContactId || member.cobalt_contactid) as any;
    const contactId = contactRef?.Value || contactRef;
    const enrichedMember = {
      ...member,
      eventRegistrations: bulkRelationships.events.get(contactId) || [],
      committees: bulkRelationships.committees.get(contactId) || [],
      classRegistrations: bulkRelationships.classes.get(contactId) || []
    };
    const engagement = calculateMemberEngagement(enrichedMember);
    const churnRisk = assessChurnRisk(enrichedMember);

    // Check each risk factor
    if (riskFactors.includes('payment') && member.outstandingBalance > 0) {
      atRiskMembers['payment'].push({
        ...member,
        riskScore: 75,
        riskReason: 'Outstanding payment balance',
        intervention: 'Payment plan discussion'
      });
    }

    if (riskFactors.includes('engagement') && engagement.overall < 30) {
      atRiskMembers['engagement'].push({
        ...member,
        riskScore: 100 - engagement.overall,
        riskReason: 'Very low engagement score',
        intervention: 'Personal outreach and re-engagement campaign'
      });
    }

    if (riskFactors.includes('tenure') && member.CreatedOn) {
      const membershipDays = daysSince(member.CreatedOn);
      if (membershipDays < 90) {
        atRiskMembers['tenure'].push({
          ...member,
          riskScore: 60,
          riskReason: 'New member - critical onboarding period',
          intervention: 'New member mentoring program'
        });
      }
    }

    if (riskFactors.includes('communication') && !member.EmailAddress1 && !member.emailaddress1) {
      atRiskMembers['communication'].push({
        ...member,
        riskScore: 50,
        riskReason: 'No email address on file (check contact record)',
        intervention: 'Contact information update request'
      });
    }
  });

  let responseText = `⚠️ **At-Risk Members Analysis**\n\n`;
  responseText += `**Risk Factors Analyzed:** ${riskFactors.join(', ')}\n\n`;

  riskFactors.forEach((factor: string) => {
    const riskMembers = atRiskMembers[factor];
    responseText += `**${factor.toUpperCase()} RISK** (${riskMembers.length} members):\n`;

    riskMembers
      .sort((a, b) => b.riskScore - a.riskScore)
      .slice(0, Math.ceil(returnLimit / riskFactors.length))
      .forEach(member => {
        const memberName = member.cobalt_name || member.cobalt_ContactId?.Display || 'Unknown';
        responseText += `• ${memberName} - Risk: ${member.riskScore}/100\n`;
        responseText += `  Reason: ${member.riskReason}\n`;
        responseText += `  Action: ${member.intervention}\n\n`;
      });
  });

  const totalAtRisk = Object.values(atRiskMembers).reduce((sum, members) => sum + members.length, 0);
  responseText += `**Summary:** ${totalAtRisk} total at-risk members identified across all factors\n`;

  return {
    content: [{
      type: "text",
      text: responseText
    }]
  };
};

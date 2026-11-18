import { getNestedValue, daysSince } from './bulk-operations';

export interface EngagementScore {
  overall: number;
  components: {
    events: number;
    committees: number;
    education: number;
    communication: number;
    financial: number;
  };
  level: 'highly-engaged' | 'moderately-engaged' | 'at-risk' | 'inactive';
  riskFactors: string[];
  recommendations: string[];
}

export interface ChurnRiskAssessment {
  contactId: string;
  name: string;
  riskScore: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  renewalDate?: Date;
  daysUntilRenewal?: number;
  factors: {
    engagement: number;
    payment: number;
    tenure: number;
    recency: number;
  };
  interventions: string[];
}

export interface MemberSegment {
  name: string;
  criteria: string;
  count: number;
  percentage: number;
  characteristics: Record<string, any>;
  averageEngagement: number;
  averageLifetimeValue: number;
}

/**
 * Safely extract a timestamp from a RAMCO DateTime field.
 * RAMCO returns DateTime as { Type: "DateTime", Value: 1506963018, Display: "2017-10-02T16:50:18" }
 * or sometimes as a raw number/string.
 */
function extractTimestamp(field: any): number | string | undefined {
  if (!field) return undefined;
  // Handle RAMCO DateTime objects (try Display first for ISO string, then Value for Unix timestamp)
  if (typeof field === 'object' && field !== null) {
    return field.Display || field.Value;
  }
  return field;
}

/**
 * Calculates comprehensive engagement score for a member
 */
export function calculateMemberEngagement(memberData: any): EngagementScore {
  const components = {
    events: 0,
    committees: 0,
    education: 0,
    communication: 0,
    financial: 0
  };

  const riskFactors: string[] = [];
  const recommendations: string[] = [];

  // Event participation (0-100)
  const eventCount = memberData.eventRegistrations?.length || 0;
  const recentEventCount = memberData.eventRegistrations?.filter((e: any) => {
    const ts = extractTimestamp(e.CreatedOn || e.createdon);
    return ts && daysSince(ts) < 365;
  }).length || 0;
  // Score based on both total and recent events
  components.events = Math.min(100, recentEventCount * 20 + Math.min(eventCount, 5) * 4);

  if (eventCount === 0) {
    riskFactors.push('No event attendance');
    recommendations.push('Send personalized event invitations');
  } else if (recentEventCount === 0) {
    riskFactors.push('No event attendance in past year');
    recommendations.push('Send personalized event invitations for upcoming events');
  }

  // Committee involvement (0-100)
  const activeCommittees = memberData.committees?.filter((c: any) => {
    const stateVal = c.statecode?.Value ?? c.StateCode?.Value;
    return stateVal === 0;
  }).length || 0;
  components.committees = Math.min(100, activeCommittees * 35);

  if (activeCommittees === 0) {
    riskFactors.push('No committee involvement');
    recommendations.push('Invite to join relevant committee');
  }

  // Education participation (0-100)
  // Count all class registrations (cobalt_attended may be boolean or OptionSet)
  const classCount = memberData.classRegistrations?.length || 0;
  const attendedClasses = memberData.classRegistrations?.filter((c: any) => {
    const attended = c.cobalt_attended;
    // Handle Boolean OptionSet { Value: true/false } or direct boolean
    if (attended && typeof attended === 'object') return attended.Value;
    return !!attended;
  }).length || 0;
  components.education = Math.min(100, Math.max(attendedClasses, classCount) * 15);

  // Communication engagement (0-100)
  const emailOpens = memberData.emailMetrics?.openRate || 0;
  const surveyResponses = memberData.surveyResponses?.length || 0;
  components.communication = Math.min(100, (emailOpens * 0.5 + surveyResponses * 10));

  // Financial standing (0-100)
  const hasOutstandingBalance = memberData.outstandingBalance > 0;
  const paymentHistory = memberData.paymentHistory || [];
  const onTimePayments = paymentHistory.filter((p: any) => !p.isLate).length;
  const paymentRate = paymentHistory.length > 0 ? onTimePayments / paymentHistory.length : 1;
  components.financial = hasOutstandingBalance ? Math.max(0, paymentRate * 100 - 50) : paymentRate * 100;
  
  if (hasOutstandingBalance) {
    riskFactors.push('Outstanding balance');
    recommendations.push('Send payment reminder');
  }

  // Calculate overall score (weighted average)
  // Communication data not available from RAMCO, so weight redistributed
  // across events, committees, and education
  const overall = (
    components.events * 0.30 +
    components.committees * 0.35 +
    components.education * 0.25 +
    components.financial * 0.10
  );

  // Determine engagement level
  let level: EngagementScore['level'];
  if (overall >= 70) {
    level = 'highly-engaged';
  } else if (overall >= 40) {
    level = 'moderately-engaged';
  } else if (overall >= 20) {
    level = 'at-risk';
    if (riskFactors.length === 0) {
      riskFactors.push('Low overall engagement');
    }
  } else {
    level = 'inactive';
    if (riskFactors.length === 0) {
      riskFactors.push('Very low engagement - immediate attention needed');
    }
  }

  return {
    overall: Math.round(overall),
    components,
    level,
    riskFactors,
    recommendations
  };
}

/**
 * Assesses churn risk for a member
 */
export function assessChurnRisk(member: any): ChurnRiskAssessment {
  const factors = {
    engagement: 0,
    payment: 0,
    tenure: 0,
    recency: 0
  };
  
  const interventions: string[] = [];

  // Engagement factor (0-100, lower = higher risk)
  const engagementScore = calculateMemberEngagement(member);
  factors.engagement = engagementScore.overall;

  // Payment factor (0-100, lower = higher risk)
  if (member.outstandingBalance > 0) {
    factors.payment = 30;
    interventions.push('Resolve outstanding payment issues');
  } else if (member.paymentHistory?.some((p: any) => p.isLate)) {
    factors.payment = 60;
    interventions.push('Set up automatic payment');
  } else {
    factors.payment = 100;
  }

  // Tenure factor (0-100, higher tenure = lower risk)
  const membershipYears = member.membershipStartDate 
    ? daysSince(member.membershipStartDate) / 365 
    : 0;
  factors.tenure = Math.min(100, membershipYears * 20);

  // Recency factor (0-100, more recent activity = lower risk)
  const lastActivityDays = member.lastActivityDate 
    ? daysSince(member.lastActivityDate)
    : 999;
  
  if (lastActivityDays < 30) {
    factors.recency = 100;
  } else if (lastActivityDays < 90) {
    factors.recency = 70;
  } else if (lastActivityDays < 180) {
    factors.recency = 40;
    interventions.push('Re-engagement campaign needed');
  } else {
    factors.recency = 10;
    interventions.push('Immediate personal outreach required');
  }

  // Calculate overall risk score (0-100, higher = higher risk)
  const riskScore = 100 - (
    factors.engagement * 0.35 +
    factors.payment * 0.25 +
    factors.tenure * 0.20 +
    factors.recency * 0.20
  );

  // Determine risk level
  let riskLevel: ChurnRiskAssessment['riskLevel'];
  if (riskScore >= 75) {
    riskLevel = 'critical';
    interventions.unshift('URGENT: Personal call from membership team');
  } else if (riskScore >= 50) {
    riskLevel = 'high';
  } else if (riskScore >= 25) {
    riskLevel = 'medium';
  } else {
    riskLevel = 'low';
  }

  // Add specific interventions based on factors
  if (factors.engagement < 30) {
    interventions.push('Offer complimentary event registration');
  }
  if (factors.tenure < 20) {
    interventions.push('New member buddy program');
  }

  return {
    contactId: member.cobalt_membershipId || member.ContactId || member.contactid,
    name: member.cobalt_name || member.cobalt_ContactId?.Display || `${member.FirstName || ''} ${member.LastName || ''}`.trim(),
    riskScore: Math.round(riskScore),
    riskLevel,
    renewalDate: member.renewalDate ? new Date(member.renewalDate) : undefined,
    daysUntilRenewal: member.renewalDate ? daysSince(Date.now()) - daysSince(member.renewalDate) : undefined,
    factors,
    interventions
  };
}

/**
 * Calculates member lifetime value
 */
export function calculateLifetimeValue(member: any): number {
  const membershipYears = member.membershipStartDate 
    ? daysSince(member.membershipStartDate) / 365 
    : 1;
  
  const annualDues = member.annualDues || 0;
  const eventRevenue = member.eventRegistrations?.reduce((sum: number, e: any) => 
    sum + (e.amount || 0), 0) || 0;
  const educationRevenue = member.classRegistrations?.reduce((sum: number, c: any) => 
    sum + (c.amount || 0), 0) || 0;
  const otherRevenue = member.otherPurchases?.reduce((sum: number, p: any) => 
    sum + (p.amount || 0), 0) || 0;
  
  const totalRevenue = (annualDues * membershipYears) + eventRevenue + educationRevenue + otherRevenue;
  
  // Predict future value based on engagement
  const engagementScore = calculateMemberEngagement(member);
  const retentionProbability = engagementScore.overall / 100;
  const predictedYearsRemaining = retentionProbability * 5; // Assume 5-year horizon
  const predictedFutureValue = annualDues * predictedYearsRemaining * retentionProbability;
  
  return Math.round(totalRevenue + predictedFutureValue);
}

/**
 * Identifies patterns in member data
 */
export function identifyPatterns(members: any[]): Record<string, any> {
  const patterns = {
    churnPatterns: [] as any[],
    successPatterns: [] as any[],
    growthOpportunities: [] as any[],
    dataQualityIssues: [] as any[]
  };

  // Analyze successful members (high engagement, long tenure)
  const successfulMembers = members.filter(m => {
    const engagement = calculateMemberEngagement(m);
    const createdOn = m.CreatedOn?.Display || m.CreatedOn || m.membershipStartDate;
    const tenure = createdOn ? daysSince(createdOn) / 365 : 0;
    return engagement.overall > 70 && tenure > 3;
  });

  if (successfulMembers.length > 0) {
    // Find common characteristics
    const commonTraits = analyzeCommonTraits(successfulMembers);
    patterns.successPatterns = commonTraits;
  }

  // Analyze churned members
  const churnedMembers = members.filter(m => 
    m.statuscode?.Value === 'Inactive' || m.StatusCode?.Display === 'Lapsed'
  );

  if (churnedMembers.length > 0) {
    const churnTraits = analyzeCommonTraits(churnedMembers);
    patterns.churnPatterns = churnTraits;
  }

  // Identify growth opportunities
  const lowEngagedMembers = members.filter(m => {
    const engagement = calculateMemberEngagement(m);
    return engagement.overall < 40 && engagement.overall > 10;
  });

  if (lowEngagedMembers.length > members.length * 0.2) {
    patterns.growthOpportunities.push({
      opportunity: 'Large segment with low engagement',
      count: lowEngagedMembers.length,
      potentialRevenue: lowEngagedMembers.length * 500, // Estimated value
      recommendation: 'Launch targeted re-engagement campaign'
    });
  }

  // Identify data quality issues
  const missingEmails = members.filter(m => !m.emailaddress1 && !m.EmailAddress1).length;
  const missingPhones = members.filter(m => !m.telephone1 && !m.Telephone1).length;
  
  if (missingEmails > members.length * 0.1) {
    patterns.dataQualityIssues.push({
      issue: 'Missing email addresses',
      count: missingEmails,
      percentage: (missingEmails / members.length * 100).toFixed(1),
      impact: 'Cannot send email communications'
    });
  }

  if (missingPhones > members.length * 0.2) {
    patterns.dataQualityIssues.push({
      issue: 'Missing phone numbers',
      count: missingPhones,
      percentage: (missingPhones / members.length * 100).toFixed(1),
      impact: 'Cannot make phone outreach'
    });
  }

  return patterns;
}

/**
 * Analyzes common traits in a group of members
 */
function analyzeCommonTraits(members: any[]): any[] {
  const traits: any[] = [];
  
  if (members.length === 0) return traits;

  // Analyze member types (supports both contact and cobalt_membership field names)
  const memberTypes = members.reduce((acc, m) => {
    const type = m.cobalt_MemberTypeId?.Display || m.memberTypeId?.Display || m.cobalt_membertypeid?.Display || 'Unknown';
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const dominantType = Object.entries(memberTypes)
    .sort(([,a], [,b]) => (b as number) - (a as number))[0] as [string, number] | undefined;
  
  if (dominantType && dominantType[1] > members.length * 0.5) {
    traits.push({
      trait: 'Member Type',
      value: dominantType[0],
      percentage: (dominantType[1] / members.length * 100).toFixed(1)
    });
  }

  // Analyze chapters
  const chapters = members.reduce((acc, m) => {
    const chapter = m.chapterId?.Display || m.cobalt_ChapterId?.Display || 'No Chapter';
    acc[chapter] = (acc[chapter] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const dominantChapter = Object.entries(chapters)
    .sort(([,a], [,b]) => (b as number) - (a as number))[0] as [string, number] | undefined;
  
  if (dominantChapter && dominantChapter[1] > members.length * 0.3) {
    traits.push({
      trait: 'Chapter',
      value: dominantChapter[0],
      percentage: (dominantChapter[1] / members.length * 100).toFixed(1)
    });
  }

  // Analyze join year patterns
  const joinYears = members.reduce((acc, m) => {
    if (m.membershipStartDate) {
      const year = new Date(m.membershipStartDate).getFullYear();
      acc[year] = (acc[year] || 0) + 1;
    }
    return acc;
  }, {} as Record<number, number>);

  if (Object.keys(joinYears).length > 0) {
    const avgYear = Object.entries(joinYears).reduce((sum, [year, count]) => 
      sum + (parseInt(year) * (count as number)), 0) / members.length;
    
    traits.push({
      trait: 'Average Join Year',
      value: Math.round(avgYear),
      insight: avgYear > new Date().getFullYear() - 2 ? 'Mostly new members' : 'Established member base'
    });
  }

  return traits;
}

/**
 * Forecasts future metrics based on historical trends
 */
export function forecastMetrics(
  historicalData: any[],
  months: number = 12
): Record<string, any> {
  // Simple linear regression for forecasting
  // In production, you might want to use more sophisticated methods
  
  const forecast = {
    membershipCount: [] as any[],
    revenue: [] as any[],
    churnRate: [] as any[],
    confidence: 0.7 // Simplified confidence score
  };

  // This is a placeholder for more complex forecasting logic
  // You would typically analyze historical trends and apply
  // statistical models here

  return forecast;
}
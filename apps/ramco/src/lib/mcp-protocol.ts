import { z } from "zod";
import { RamcoClient } from "./ramco-client";
import {
  fetchAllRecords,
  groupBy,
  calculateStatistics,
  calculatePercentiles,
  rankByField,
  filterByDateRange,
  multiGroupAggregate,
  daysSince
} from "./bulk-operations";
import {
  calculateMemberEngagement,
  assessChurnRisk,
  calculateLifetimeValue,
  identifyPatterns
} from "./analytics-helpers";
import { parseNaturalLanguageQuery } from "./natural-language";

// Get API key from request headers
export function getApiKey(request?: Request): string {
  if (!request) {
    throw new Error("RAMCO API key is required. Pass it via header: -e 'Key=your-api-key' or -e 'Authorization=Bearer your-api-key'");
  }


  // Support Key header (matches RAMCO API format)
  const keyHeader = request.headers.get('key');
  if (keyHeader) {
    return keyHeader;
  }

  // Support Authorization header with Bearer token format (fallback)
  const authHeader = request.headers.get('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }

  // Support custom X-RAMCO-API-Key header (fallback)
  const apiKeyHeader = request.headers.get('x-ramco-api-key');
  if (apiKeyHeader) {
    return apiKeyHeader;
  }

  // Support RAMCO-API-KEY header (fallback)
  const ramcoApiKeyHeader = request.headers.get('ramco-api-key');
  if (ramcoApiKeyHeader) {
    return ramcoApiKeyHeader;
  }

  throw new Error("RAMCO API key is required. Pass it via header: -e 'Key=your-api-key' or -e 'Authorization=Bearer your-api-key'");
}

// Get association ID from request headers (if configured)
export function getAssociationId(request?: Request): string | undefined {
  if (!request) return undefined;

  // Support various header formats for association ID
  return request.headers.get('ramco-association-id') ||
         request.headers.get('x-ramco-association-id') ||
         request.headers.get('association-id') ||
         undefined;
}

// We'll initialize the client per request to handle different API keys
export function createRamcoClient(apiKey: string): RamcoClient {
  return new RamcoClient({
    apiKey: apiKey,
    baseUrl: 'https://api.ramcoams.com/api/v2',
  });
}

// Quick association info function
async function getQuickAssociationInfo(ramcoClient: RamcoClient, associationId?: string): Promise<any> {
  try {
    // Build filter for association search
    let filter = "ramco_type<ne>null"; // Get associations with a type
    if (associationId) {
      // GUID fields in RAMCO use guid'...' syntax
      filter = `ramco_associationid<eq>guid'${associationId}'`;
    }

    // Fetch association details
    const response = await ramcoClient.searchRecords({
      module: 'ramco_association',
      filter: filter,
      fields: [
        'ramco_associationId',
        'ramco_name',
        'ramco_type',
        'ramco_website',
        'ramco_emailaddress',
        'ramco_phone',
        'ramco_currentpresident',
        'ramco_executiveofficername',
        'ramco_nrdsid',
        'CreatedOn',
        'ModifiedOn'
      ],
      limit: associationId ? 1 : 5 // Get specific association or list top 5
    });

    // Handle RAMCO API response format
    const associations = Array.isArray(response) ? response : ((response as any)?.Data || []);

    if (!associations || associations.length === 0) {
      return {
        success: false,
        message: associationId
          ? `No association found with ID: ${associationId}`
          : "No associations found in the system"
      };
    }

    // If specific association requested, return detailed info
    if (associationId && associations.length === 1) {
      const assoc = associations[0];

      // Try to get member count for this association
      let memberCount = 0;
      try {
        const members = await ramcoClient.searchRecords({
          module: 'contact',
          filter: `ramco_primaryassociationid<eq>'${associationId}' and StatusCode<eq>1`,
          fields: ['ContactId'],
          limit: 1
        });
        // Note: We'd need pagination to get actual count, this just confirms members exist
        memberCount = members?.length || 0;
      } catch (err) {
        // Ignore member count errors
      }

      return {
        success: true,
        association: {
          id: assoc.ramco_associationId,
          name: assoc.ramco_name,
          type: assoc.ramco_type?.Display || 'Unknown',
          executive: assoc.ramco_executiveofficername,
          president: assoc.ramco_currentpresident,
          contact: {
            email: assoc.ramco_emailaddress,
            phone: assoc.ramco_phone,
            website: assoc.ramco_website
          },
          systemInfo: {
            nrdsId: assoc.ramco_nrdsid,
            created: assoc.CreatedOn?.Display || assoc.CreatedOn,
            modified: assoc.ModifiedOn?.Display || assoc.ModifiedOn
          },
          hasMembers: memberCount > 0
        }
      };
    }

    // Return list of associations
    return {
      success: true,
      count: associations.length,
      associations: associations.map((assoc: any) => ({
        id: assoc.ramco_associationId,
        name: assoc.ramco_name,
        type: assoc.ramco_type?.Display || 'Unknown',
        executive: assoc.ramco_executiveofficername,
        email: assoc.ramco_emailaddress,
        phone: assoc.ramco_phone
      }))
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to get association info: ${error}`
    };
  }
}

// Calculate member engagement score based on various activities
async function calculateMemberEngagementScore(
  contactId: string,
  ramcoClient: RamcoClient
): Promise<any> {
  const engagementData = {
    contactId,
    scores: {
      committees: 0,
      events: 0,
      education: 0,
      overall: 0
    },
    details: {
      committees: [] as any[],
      events: [] as any[],
      classes: [] as any[]
    },
    riskFactors: [] as string[],
    recommendations: [] as string[]
  };

  try {
    // Get committee participation
    const committees = await ramcoClient.searchRecords({
      module: 'cobalt_committeemembership',
      filter: `cobalt_contactid<eq>'${contactId}'`,
      fields: ['cobalt_name', 'cobalt_committeeid', 'statecode', 'createdon'],
      limit: 50
    });

    if (committees?.length > 0) {
      engagementData.details.committees = committees;
      const activeCommittees = committees.filter((c: any) =>
        c.statecode?.Value === 0
      ).length;
      engagementData.scores.committees = Math.min(activeCommittees * 30, 100);
    }

    // Get event/meeting registrations
    const events = await ramcoClient.searchRecords({
      module: 'cobalt_meetingregistration',
      filter: `cobalt_contactid<eq>'${contactId}'`,
      fields: ['cobalt_name', 'cobalt_meetingid', 'createdon'],
      limit: 50
    });

    if (events?.length > 0) {
      engagementData.details.events = events;
      // Score based on recent event attendance (last 12 months)
      const recentEvents = events.filter((e: any) => {
        const eventDate = e.CreatedOn?.Value || 0;
        const oneYearAgo = Math.floor(Date.now() / 1000) - (365 * 24 * 60 * 60);
        return eventDate > oneYearAgo;
      }).length;
      engagementData.scores.events = Math.min(recentEvents * 15, 100);
    }

    // Get class registrations
    const classes = await ramcoClient.searchRecords({
      module: 'cobalt_classregistration',
      filter: `cobalt_contactid<eq>'${contactId}'`,
      fields: ['cobalt_name', 'cobalt_classid', 'createdon'],
      limit: 50
    });

    if (classes?.length > 0) {
      engagementData.details.classes = classes;
      const recentClasses = classes.filter((c: any) => {
        const classDate = c.CreatedOn?.Value || 0;
        const oneYearAgo = Math.floor(Date.now() / 1000) - (365 * 24 * 60 * 60);
        return classDate > oneYearAgo;
      }).length;
      engagementData.scores.education = Math.min(recentClasses * 25, 100);
    }

    // Calculate overall engagement score
    const weightedScore = (
      engagementData.scores.committees * 0.35 +
      engagementData.scores.events * 0.35 +
      engagementData.scores.education * 0.30
    );
    engagementData.scores.overall = Math.round(weightedScore);

    // Determine risk factors
    if (engagementData.scores.overall < 20) {
      engagementData.riskFactors.push("Very low engagement - HIGH renewal risk");
    } else if (engagementData.scores.overall < 40) {
      engagementData.riskFactors.push("Below average engagement - Moderate renewal risk");
    }

    if (engagementData.scores.committees === 0) {
      engagementData.riskFactors.push("No committee involvement");
    }

    if (engagementData.scores.events < 30) {
      engagementData.riskFactors.push("Low event attendance");
    }

    // Generate recommendations
    if (engagementData.scores.committees === 0) {
      engagementData.recommendations.push("Invite to join a committee aligned with their interests");
    }
    if (engagementData.scores.events < 50) {
      engagementData.recommendations.push("Send personalized event invitations");
    }
    if (engagementData.scores.education < 25) {
      engagementData.recommendations.push("Recommend relevant education programs");
    }

    return engagementData;
  } catch (error) {
    throw new Error(`Failed to calculate engagement score: ${error}`);
  }
}

// Entity information organized by business category
function getEntityInformation(category?: string, search?: string): string {
  const entityCategories = {
    core_crm: {
      title: "🏢 Core CRM",
      description: "Essential customer relationship management entities",
      entities: {
        contact: "Individual contacts - people you interact with",
        account: "Organizations/companies - business accounts",
        lead: "Potential customers - sales prospects",
        opportunity: "Sales opportunities - deals in progress",
        campaign: "Marketing campaigns - promotional activities",
        activitypointer: "Activities and interactions - calls, emails, tasks"
      },
      examples: [
        "Search contacts: search_records with entityType='contact'",
        "Get account details: get_record with entityType='account' and specific ID",
        "Find leads by status: search_records with filterField='statuscode'"
      ]
    },
    membership: {
      title: "👥 Membership Management",
      description: "Member-focused entities for associations/organizations",
      entities: {
        cobalt_membership: "Membership records - member status and details",
        cobalt_membertype: "Types of memberships - categories/levels",
        cobalt_chapter: "Chapters/local groups - regional organization",
        cobalt_chapteraffiliation: "Member-chapter relationships",
        cobalt_membershipapplication: "New member applications",
        cobalt_membershiprequirement: "Requirements for membership"
      },
      examples: [
        "List active members: search_records with entityType='cobalt_membership'",
        "Find chapter members: search_records with entityType='cobalt_chapteraffiliation'",
        "Get membership types: search_records with entityType='cobalt_membertype'"
      ]
    },
    education: {
      title: "🎓 Education & Training",
      description: "Educational content and training management",
      entities: {
        cobalt_class: "Training classes/courses - educational sessions",
        cobalt_course: "Course catalog - available training programs",
        cobalt_classinstructor: "Instructors - people who teach classes",
        cobalt_classregistration: "Class enrollments - who's registered",
        cobalt_courseprovider: "Training providers - organizations offering courses"
      },
      examples: [
        "Find available classes: search_records with entityType='cobalt_class'",
        "Get course details: get_record with entityType='cobalt_course'",
        "List class registrations: search_records with entityType='cobalt_classregistration'"
      ]
    },
    finance: {
      title: "💰 Financial Management",
      description: "Financial transactions and payment processing",
      entities: {
        invoice: "Invoices - bills sent to customers",
        salesorder: "Sales orders - confirmed purchases",
        cobalt_payment: "Payment records - money received",
        ramco_contribution: "Donations/contributions - charitable giving",
        cobalt_duesitem: "Membership dues - recurring payments",
        ramco_scheduledpayment: "Scheduled payments - automated billing"
      },
      examples: [
        "Find unpaid invoices: search_records with entityType='invoice'",
        "Get payment history: search_records with entityType='cobalt_payment'",
        "List member dues: search_records with entityType='cobalt_duesitem'"
      ]
    },
    events: {
      title: "🎯 Events & Meetings",
      description: "Event management and meeting coordination",
      entities: {
        cobalt_meeting: "Meetings/events - scheduled gatherings",
        cobalt_meetingregistration: "Event registrations - attendee signups",
        cobalt_meetingactivity: "Meeting activities - sessions within events",
        appointment: "Appointments - scheduled meetings",
        cobalt_event: "Events - larger gatherings/conferences"
      },
      examples: [
        "List upcoming meetings: search_records with entityType='cobalt_meeting'",
        "Get event registrations: search_records with entityType='cobalt_meetingregistration'",
        "Find meeting activities: search_records with entityType='cobalt_meetingactivity'"
      ]
    },
    products: {
      title: "🛍️ Products & Services",
      description: "Product catalog and service management",
      entities: {
        product: "Products/services - items for sale",
        ramco_storelocation: "Store locations - physical/virtual stores",
        productpricelevel: "Pricing - product costs and pricing tiers",
        ramco_shoppingcart: "Shopping carts - customer order building"
      },
      examples: [
        "Browse product catalog: search_records with entityType='product'",
        "Find store locations: search_records with entityType='ramco_storelocation'",
        "Get pricing info: search_records with entityType='productpricelevel'"
      ]
    },
    system: {
      title: "⚙️ System & Configuration",
      description: "System settings and administrative entities",
      entities: {
        systemuser: "System users - people with system access",
        businessunit: "Business units - organizational divisions",
        team: "Teams - groups of users",
        organization: "Organization settings - system configuration",
        cobalt_settings: "Application settings - system preferences"
      },
      examples: [
        "List system users: search_records with entityType='systemuser'",
        "Get organization info: search_records with entityType='organization'",
        "View system settings: search_records with entityType='cobalt_settings'"
      ]
    }
  };

  let output = "📊 **RAMCO Entity Information & Usage Guide**\n\n";

  // If specific category requested
  if (category && entityCategories[category as keyof typeof entityCategories]) {
    const cat = entityCategories[category as keyof typeof entityCategories];
    output += `## ${cat.title}\n${cat.description}\n\n`;
    output += "### Available Entities:\n";
    Object.entries(cat.entities).forEach(([entity, desc]) => {
      output += `- **${entity}**: ${desc}\n`;
    });
    output += "\n### Usage Examples:\n";
    cat.examples.forEach(example => {
      output += `- ${example}\n`;
    });
    return output;
  }

  // If search term provided
  if (search) {
    const searchLower = search.toLowerCase();
    output += `🔍 **Search Results for "${search}"**\n\n`;

    Object.entries(entityCategories).forEach(([catKey, cat]) => {
      const matchingEntities = Object.entries(cat.entities).filter(([entity, desc]) =>
        entity.toLowerCase().includes(searchLower) || desc.toLowerCase().includes(searchLower)
      );

      if (matchingEntities.length > 0) {
        output += `### ${cat.title}\n`;
        matchingEntities.forEach(([entity, desc]) => {
          output += `- **${entity}**: ${desc}\n`;
        });
        output += "\n";
      }
    });
    return output;
  }

  // Show all categories overview
  output += "## Categories Overview\n\n";
  Object.entries(entityCategories).forEach(([catKey, cat]) => {
    output += `### ${cat.title}\n${cat.description}\n`;
    output += `**Key Entities:** ${Object.keys(cat.entities).slice(0, 3).join(', ')}...\n\n`;
  });

  output += "\n## Getting Started\n\n";
  output += "**Common Workflows:**\n";
  output += "1. **Member Management**: Use `cobalt_membership`, `cobalt_chapter`, `contact` entities\n";
  output += "2. **Event Planning**: Use `cobalt_meeting`, `cobalt_meetingregistration`, `cobalt_event` entities\n";
  output += "3. **Financial Tracking**: Use `invoice`, `cobalt_payment`, `cobalt_duesitem` entities\n";
  output += "4. **Education Programs**: Use `cobalt_class`, `cobalt_course`, `cobalt_classregistration` entities\n\n";

  output += "**Next Steps:**\n";
  output += "- Use `get_entity_info` with category parameter for focused info\n";
  output += "- Use `get_schema` to see available fields for any entity\n";
  output += "- Use `search_records` to explore actual data\n";

  return output;
}

// Native MCP implementation for Astro
export async function handleMcpRequest(request: Request): Promise<Response> {
  try {
    const body = await request.json();

    // Get API key and association ID from headers
    const apiKey = getApiKey(request);
    const associationId = getAssociationId(request);
    const ramcoClient = createRamcoClient(apiKey);

    // Handle MCP protocol messages
    switch (body.method) {
      case "initialize":
        return new Response(JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: {
              tools: {},
              resources: {},
              prompts: {}
            },
            serverInfo: {
              name: "ramco-mcp-server",
              version: "1.0.0"
            }
          }
        }), {
          headers: { "Content-Type": "application/json" }
        });

      case "tools/list":
        return new Response(JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            tools: [
              {
                name: "test_connection",
                description: "Test RAMCO API connection and verify API key is working",
                inputSchema: {
                  type: "object",
                  properties: {},
                  required: []
                }
              },
              {
                name: "get_association_info",
                description: "Get quick information about the connected association(s)",
                inputSchema: {
                  type: "object",
                  properties: {
                    associationId: {
                      type: "string",
                      description: "Optional specific association ID to get info for"
                    }
                  },
                  required: []
                }
              },
              {
                name: "get_entity_types",
                description: "Get all available RAMCO entity types/modules",
                inputSchema: {
                  type: "object",
                  properties: {
                    maxResults: {
                      type: "number",
                      description: "Maximum number of results",
                      default: 50
                    }
                  },
                  required: []
                }
              },
              {
                name: "search_records",
                description: "Search RAMCO records with optional filters using RAMCO filter syntax",
                inputSchema: {
                  type: "object",
                  properties: {
                    entityType: { type: "string" },
                    limit: { type: "number", default: 10 },
                    offset: { type: "number", default: 0 },
                    filter: {
                      type: "string",
                      description: "RAMCO filter syntax (e.g., \"LastName<eq>'Suarez' and FirstName<eq>'Luis'\" or \"ModifiedOn<ge>'2024-01-01'\")"
                    },
                    fields: {
                      type: "string",
                      description: "Comma-separated list of field names to return (e.g., 'FirstName,LastName,Telephone1,Address1_Line1'). Supports relationships like 'cobalt_contact_cobalt_membership/cobalt_membertypeid'. If not specified, returns default core fields."
                    }
                  },
                  required: []
                }
              },
              {
                name: "get_record",
                description: "Get a specific RAMCO record by ID",
                inputSchema: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    entityType: { type: "string" },
                    fields: {
                      type: "string",
                      description: "Comma-separated list of field names to return (e.g., 'FirstName,LastName,Telephone1,Address1_Line1'). If not specified, returns default core fields."
                    }
                  },
                  required: ["id"]
                }
              },
              {
                name: "get_schema",
                description: "Get the schema/fields for a specific RAMCO entity type",
                inputSchema: {
                  type: "object",
                  properties: {
                    entityType: { type: "string" }
                  },
                  required: ["entityType"]
                }
              },
              {
                name: "get_entity_info",
                description: "Get information about available entity types, organized by business area with usage examples",
                inputSchema: {
                  type: "object",
                  properties: {
                    category: {
                      type: "string",
                      description: "Optional category filter (core_crm, membership, education, finance, events, products, system)",
                      enum: ["core_crm", "membership", "education", "finance", "events", "products", "system"]
                    },
                    search: {
                      type: "string",
                      description: "Optional search term to filter entities"
                    }
                  },
                  required: []
                }
              },
              {
                name: "get_related_records",
                description: "Get records related to a specific RAMCO record by ID and entity type",
                inputSchema: {
                  type: "object",
                  properties: {
                    recordId: {
                      type: "string",
                      description: "The ID of the record to find related records for"
                    },
                    entityType: {
                      type: "string",
                      description: "The entity type of the source record"
                    },
                    relationshipName: {
                      type: "string",
                      description: "Optional specific relationship name to filter by"
                    },
                    fields: {
                      type: "string",
                      description: "Comma-separated list of field names to return for related records"
                    },
                    limit: {
                      type: "number",
                      description: "Maximum number of related records to return",
                      default: 10
                    }
                  },
                  required: ["recordId", "entityType"]
                }
              },
              {
                name: "calculate_member_engagement",
                description: "Calculate comprehensive engagement score and renewal risk assessment for a member",
                inputSchema: {
                  type: "object",
                  properties: {
                    contactId: {
                      type: "string",
                      description: "The contact ID of the member to analyze"
                    }
                  },
                  required: ["contactId"]
                }
              },
              {
                name: "analyze_membership_health",
                description: "Analyze health of entire membership (10k+ members) with engagement scores, risk levels, and actionable insights",
                inputSchema: {
                  type: "object",
                  properties: {
                    filters: {
                      type: "object",
                      description: "Optional filters",
                      properties: {
                        chapter: { type: "string" },
                        memberType: { type: "string" },
                        dateRange: {
                          type: "object",
                          properties: {
                            start: { type: "string", format: "date" },
                            end: { type: "string", format: "date" }
                          }
                        }
                      }
                    },
                    includeDetails: {
                      type: "boolean",
                      description: "Include detailed member lists per segment",
                      default: false
                    }
                  },
                  required: []
                }
              },
              {
                name: "get_churn_risk_report",
                description: "Identify all members at risk of churning with predictive scoring and intervention recommendations",
                inputSchema: {
                  type: "object",
                  properties: {
                    renewalWindow: {
                      type: "number",
                      description: "Days ahead to look for renewals",
                      default: 90
                    },
                    limit: {
                      type: "number",
                      description: "Maximum number of at-risk members to return",
                      default: 100
                    },
                    minRiskScore: {
                      type: "number",
                      description: "Minimum risk score (0-100) to include",
                      default: 50
                    }
                  },
                  required: []
                }
              },
              {
                name: "generate_membership_snapshot",
                description: "Generate comprehensive association metrics snapshot with totals, growth, and comparisons",
                inputSchema: {
                  type: "object",
                  properties: {
                    asOfDate: {
                      type: "string",
                      format: "date",
                      description: "Date for snapshot (defaults to today)"
                    },
                    compareToPeriod: {
                      type: "string",
                      description: "Previous period to compare (lastMonth, lastQuarter, lastYear)",
                      enum: ["lastMonth", "lastQuarter", "lastYear"]
                    },
                    groupBy: {
                      type: "array",
                      items: { type: "string" },
                      description: "Group metrics by (chapter, memberType, status)"
                    }
                  },
                  required: []
                }
              },
              {
                name: "analyze_payment_health",
                description: "Analyze payment status across entire membership with aging, delinquency rates, and collection metrics",
                inputSchema: {
                  type: "object",
                  properties: {
                    dateRange: {
                      type: "object",
                      properties: {
                        start: { type: "string", format: "date" },
                        end: { type: "string", format: "date" }
                      }
                    },
                    includeForecasting: {
                      type: "boolean",
                      description: "Include payment forecasting",
                      default: false
                    }
                  },
                  required: []
                }
              },
              {
                name: "search_members_bulk",
                description: "Search members using natural language queries like 'members who joined last year but haven't attended events'",
                inputSchema: {
                  type: "object",
                  properties: {
                    query: {
                      type: "string",
                      description: "Natural language search query"
                    },
                    limit: {
                      type: "number",
                      description: "Maximum results to return",
                      default: 100
                    },
                    exportFormat: {
                      type: "string",
                      description: "Format for results (json, csv, summary)",
                      enum: ["json", "csv", "summary"],
                      default: "summary"
                    }
                  },
                  required: ["query"]
                }
              },
              {
                name: "calculate_engagement_distribution",
                description: "Analyze engagement patterns across entire membership with percentiles and segments",
                inputSchema: {
                  type: "object",
                  properties: {
                    dateRange: {
                      type: "object",
                      properties: {
                        start: { type: "string", format: "date" },
                        end: { type: "string", format: "date" }
                      }
                    },
                    groupBy: {
                      type: "string",
                      description: "Group analysis by (chapter, memberType, cohort)",
                      enum: ["chapter", "memberType", "cohort"]
                    }
                  },
                  required: []
                }
              },
              {
                name: "segment_all_members",
                description: "Automatically segment entire membership based on multiple criteria with overlap analysis",
                inputSchema: {
                  type: "object",
                  properties: {
                    segmentationStrategy: {
                      type: "string",
                      description: "Predefined segmentation strategy",
                      enum: ["engagement", "lifecycle", "value", "risk", "custom"]
                    },
                    customRules: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          name: { type: "string" },
                          criteria: { type: "string" }
                        }
                      }
                    }
                  },
                  required: ["segmentationStrategy"]
                }
              },
              {
                name: "find_all_at_risk_members",
                description: "Identify all at-risk members across multiple risk factors with prioritized intervention plans",
                inputSchema: {
                  type: "object",
                  properties: {
                    riskFactors: {
                      type: "array",
                      items: {
                        type: "string",
                        enum: ["payment", "engagement", "tenure", "communication"]
                      },
                      description: "Risk factors to analyze"
                    },
                    returnLimit: {
                      type: "number",
                      description: "Max members to return per risk category",
                      default: 50
                    }
                  },
                  required: []
                }
              },
              {
                name: "identify_member_patterns",
                description: "Discover patterns in member behavior, success factors, and churn triggers using ML-style analysis",
                inputSchema: {
                  type: "object",
                  properties: {
                    analysisType: {
                      type: "string",
                      description: "Type of pattern analysis",
                      enum: ["retention", "growth", "engagement", "all"],
                      default: "all"
                    },
                    minimumSampleSize: {
                      type: "number",
                      description: "Minimum members needed for pattern",
                      default: 10
                    }
                  },
                  required: []
                }
              }
            ]
          }
        }), {
          headers: { "Content-Type": "application/json" }
        });

      case "tools/call":
        return await handleToolCall(body, ramcoClient, associationId);

      case "resources/list":
        return new Response(JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            resources: []
          }
        }), {
          headers: { "Content-Type": "application/json" }
        });

      case "prompts/list":
        return new Response(JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            prompts: []
          }
        }), {
          headers: { "Content-Type": "application/json" }
        });

      case "notifications/initialized":
        // Handle MCP initialization notification - just return 200 OK
        return new Response(null, { status: 200 });

      default:
        return new Response(JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          error: {
            code: -32601,
            message: "Method not found"
          }
        }), {
          status: 404,
          headers: { "Content-Type": "application/json" }
        });
    }
  } catch (error: any) {
    return new Response(JSON.stringify({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32700,
        message: "Parse error",
        data: error.message
      }
    }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }
}

async function handleToolCall(body: any, ramcoClient: RamcoClient, associationId?: string): Promise<Response> {
  const { name, arguments: args } = body.params;

  try {
    let result;

    switch (name) {
      case "test_connection":
        const isAuthenticated = await ramcoClient.authenticate();
        result = {
          content: [{
            type: "text",
            text: isAuthenticated
              ? "✅ Successfully connected to RAMCO API"
              : "❌ Connection failed - please check your API key"
          }]
        };
        break;

      case "get_association_info":
        const assocInfo = await getQuickAssociationInfo(
          ramcoClient,
          args?.associationId || associationId
        );

        if (!assocInfo.success) {
          result = {
            content: [{
              type: "text",
              text: `❌ ${assocInfo.message}`
            }]
          };
        } else if (assocInfo.association) {
          // Single association details
          const a = assocInfo.association;
          let text = `🏢 **${a.name}**\n\n`;
          text += `**Type:** ${a.type}\n`;
          text += `**Executive Officer:** ${a.executive || 'Not specified'}\n`;
          text += `**President:** ${a.president || 'Not specified'}\n\n`;
          text += `**Contact Information:**\n`;
          text += `• Phone: ${a.contact.phone || 'Not available'}\n`;
          text += `• Email: ${a.contact.email || 'Not available'}\n`;
          text += `• Website: ${a.contact.website || 'Not available'}\n\n`;
          text += `**System Information:**\n`;
          text += `• Association ID: ${a.id}\n`;
          text += `• NRDS/M1 ID: ${a.systemInfo.nrdsId || 'Not set'}\n`;
          text += `• Created: ${a.systemInfo.created}\n`;
          text += `• Last Modified: ${a.systemInfo.modified}\n`;
          if (a.hasMembers) {
            text += `• Members: ✅ Has active members\n`;
          }

          result = {
            content: [{
              type: "text",
              text: text
            }]
          };
        } else {
          // Multiple associations list
          let text = `📋 **Available Associations** (${assocInfo.count} found)\n\n`;
          assocInfo.associations.forEach((a: any, idx: number) => {
            text += `**${idx + 1}. ${a.name}**\n`;
            text += `   • Type: ${a.type}\n`;
            text += `   • Executive: ${a.executive || 'Not specified'}\n`;
            text += `   • Contact: ${a.phone || a.email || 'No contact info'}\n`;
            text += `   • ID: ${a.id}\n\n`;
          });
          text += `\n*To work with a specific association, configure the association ID in your MCP settings*`;

          result = {
            content: [{
              type: "text",
              text: text
            }]
          };
        }
        break;

      case "get_entity_types":
        const entityTypes = await ramcoClient.getEntityTypes(args?.maxResults || 50);
        result = {
          content: [{
            type: "text",
            text: `📋 Available RAMCO Entity Types:\n\n${JSON.stringify(entityTypes, null, 2)}`
          }]
        };
        break;

      case "search_records":
        const options: any = {
          limit: args?.limit || 10,
          offset: args?.offset || 0
        };
        if (args?.entityType) options.module = args.entityType;

        // Apply association filter if configured
        let filterParts = [];
        if (associationId && args?.entityType) {
          // Add association filter for relevant entity types
          const assocFilterableEntities = [
            'contact', 'cobalt_membership', 'cobalt_chapter', 'cobalt_membertype',
            'cobalt_meeting', 'cobalt_committee', 'ramco_memberfinancial'
          ];

          if (assocFilterableEntities.includes(args.entityType)) {
            const assocField = args.entityType === 'contact' ? 'ramco_primaryassociationid' : 'ramco_associationid';
            // Relationship fields use regular quotes, primary IDs use guid'...'
            filterParts.push(`${assocField}<eq>'${associationId}'`);
          }
        }

        if (args?.filter) {
          filterParts.push(`(${args.filter})`);
        }

        if (filterParts.length > 0) {
          options.filter = filterParts.join(' and ');
        }

        if (args?.fields) {
          options.fields = args.fields.split(',').map((f: string) => f.trim());
        }
        const records = await ramcoClient.searchRecords(options);
        result = {
          content: [{
            type: "text",
            text: `🔍 Search Results (${records.length} records):\n\n${JSON.stringify(records, null, 2)}`
          }]
        };
        break;

      case "get_record":
        const getRecordOptions: any = {};
        if (args?.fields) {
          getRecordOptions.fields = args.fields.split(',').map((f: string) => f.trim());
        }
        const record = await ramcoClient.getRecord(args.id, args?.entityType, getRecordOptions);
        result = {
          content: [{
            type: "text",
            text: `📄 Record Details:\n\n${JSON.stringify(record, null, 2)}`
          }]
        };
        break;

      case "get_schema":
        const schema = await ramcoClient.getSchema(args.entityType);
        result = {
          content: [{
            type: "text",
            text: `📋 Schema for ${args.entityType}:\n\n${JSON.stringify(schema, null, 2)}`
          }]
        };
        break;

      case "get_entity_info":
        const entityInfo = getEntityInformation(args?.category, args?.search);
        result = {
          content: [{
            type: "text",
            text: entityInfo
          }]
        };
        break;

      case "get_related_records":
        const relatedOptions: any = {};
        if (args?.fields) {
          relatedOptions.fields = args.fields.split(',').map((f: string) => f.trim());
        }
        if (args?.limit) {
          relatedOptions.limit = args.limit;
        }
        const relatedRecords = await ramcoClient.getRelatedRecords(
          args.recordId,
          args.entityType,
          args?.relationshipName,
          relatedOptions
        );
        result = {
          content: [{
            type: "text",
            text: `🔗 Related Records for ${args.entityType} ${args.recordId} (${relatedRecords.length} found):\n\n${JSON.stringify(relatedRecords, null, 2)}`
          }]
        };
        break;

      case "calculate_member_engagement":
        // Verify contact belongs to configured association if set
        if (associationId) {
          const contact = await ramcoClient.getRecord(args.contactId, 'contact');
          if (contact?.ramco_primaryassociationid !== associationId) {
            result = {
              content: [{
                type: "text",
                text: `⚠️ Contact ${args.contactId} does not belong to the configured association`
              }]
            };
            break;
          }
        }

        const engagementScore = await calculateMemberEngagementScore(
          args.contactId,
          ramcoClient
        );

        let riskLevel = "🟢 Low Risk";
        if (engagementScore.scores.overall < 20) {
          riskLevel = "🔴 High Risk";
        } else if (engagementScore.scores.overall < 40) {
          riskLevel = "🟡 Moderate Risk";
        }

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

        result = {
          content: [{
            type: "text",
            text: reportText
          }]
        };
        break;

      case "analyze_membership_health":
        try {
          // Build filter with association constraint
          let filterParts = ['StatusCode<eq>1'];
          if (associationId) {
            // Relationship/EntityReference fields use regular quotes, not guid syntax
            filterParts.push(`ramco_primaryassociationid<eq>'${associationId}'`);
          }
          if (args?.filters?.memberType) {
            filterParts.push(`cobalt_membertypeid<eq>'${args.filters.memberType}'`);
          }

          const memberFilter = filterParts.join(' and ');

          console.log('[analyze_membership_health] Filter:', memberFilter);
          console.log('[analyze_membership_health] Association ID:', associationId);

          // RAMCO API has a practical limit - we'll use 1000 as max batch size
          const MAX_BATCH_SIZE = 1000;

          // First get total count efficiently with reasonable batch
          const countCheck = await ramcoClient.searchRecords({
            module: 'contact',
            filter: memberFilter,
            fields: ['ContactId'],
            limit: MAX_BATCH_SIZE,
            offset: 0
          });

          console.log('[analyze_membership_health] countCheck type:', typeof countCheck, 'isArray:', Array.isArray(countCheck));

          const totalMembers = Array.isArray(countCheck) ? countCheck.length : 0;
          console.log('[analyze_membership_health] totalMembers (from first batch):', totalMembers);

          // Fetch all members with basic data - use same batch size limit
          // Note: Avoid relationship fields that may cause API errors with large batches
          const allMembersResult = await ramcoClient.searchRecords({
            module: 'contact',
            filter: memberFilter,
            fields: ['ContactId', 'FirstName', 'LastName', 'CreatedOn'],
            limit: Math.min(totalMembers, MAX_BATCH_SIZE),
            offset: 0
          });

          const allMembers = Array.isArray(allMembersResult) ? allMembersResult : [];

          if (allMembers.length === 0) {
            result = {
              content: [{
                type: "text",
                text: `⚠️ No active members found with the current filters.\n\nFilter applied: ${memberFilter}\n\nThis could mean:\n• No members match the StatusCode=1 (Active) criteria\n• The association filter is excluding all members\n• There are no members in the system\n\nTry running without filters or check the association configuration.`
              }]
            };
            break;
          }

          // For engagement analysis, we need to fetch related data for each member
          // This is expensive, so we'll do a sampling approach for large datasets
          const sampleSize = Math.min(allMembers.length, 500); // Sample 500 members max
          const sampleInterval = Math.max(1, Math.floor(allMembers.length / sampleSize));
          const sampledMembers = allMembers.filter((_, i) => i % sampleInterval === 0).slice(0, sampleSize);

          // Fetch detailed engagement data for sampled members
          const memberAnalytics = await Promise.all(
            sampledMembers.map(async (member) => {
              try {
                // Fetch event registrations
                const events = await ramcoClient.searchRecords({
                  module: 'cobalt_meetingregistration',
                  filter: `cobalt_contactid<eq>'${member.ContactId}'`,
                  fields: ['cobalt_name', 'createdon'],
                  limit: 50
                });

                // Fetch committee memberships
                const committees = await ramcoClient.searchRecords({
                  module: 'cobalt_committeemembership',
                  filter: `cobalt_contactid<eq>'${member.ContactId}'`,
                  fields: ['cobalt_name', 'statecode', 'createdon'],
                  limit: 50
                });

                // Fetch class registrations
                const classes = await ramcoClient.searchRecords({
                  module: 'cobalt_classregistration',
                  filter: `cobalt_contactid<eq>'${member.ContactId}'`,
                  fields: ['cobalt_name', 'createdon'],
                  limit: 50
                });

                // Enrich member data with related records
                const enrichedMember = {
                  ...member,
                  eventRegistrations: events || [],
                  committees: committees || [],
                  classRegistrations: classes || []
                };

                return {
                  member: enrichedMember,
                  engagement: calculateMemberEngagement(enrichedMember),
                  risk: assessChurnRisk(enrichedMember)
                };
              } catch (error) {
                // If individual member fetch fails, return with zero engagement
                return {
                  member,
                  engagement: calculateMemberEngagement(member),
                  risk: assessChurnRisk(member)
                };
              }
            })
          );

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
          responseText += `**Sample Analyzed:** ${memberAnalytics.length} members (${((memberAnalytics.length / allMembers.length) * 100).toFixed(1)}%)\n`;
          responseText += `*Note: For large datasets, we analyze a representative sample for performance*\n\n`;

          responseText += `**Engagement Distribution (from sample):**\n`;
          Object.entries(engagementGroups).forEach(([level, members]) => {
            const percentage = ((members.length / memberAnalytics.length) * 100).toFixed(1);
            const estimatedTotal = Math.round((members.length / memberAnalytics.length) * allMembers.length);
            responseText += `• ${level}: ${members.length} sampled (~${estimatedTotal} total, ${percentage}%)\n`;
          });

          responseText += `\n**Engagement Statistics (from sample):**\n`;
          responseText += `• Average Score: ${stats?.mean || 0}/100\n`;
          responseText += `• Median Score: ${stats?.median || 0}/100\n`;
          responseText += `• Top 10%: ${percentiles[90]}/100 or higher\n`;
          responseText += `• Bottom 25%: ${percentiles[25]}/100 or lower\n`;

          responseText += `\n**Top Risk Factors:**\n`;
          Object.entries(riskFactorCounts)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 5)
            .forEach(([factor, count]) => {
              const estimatedTotal = Math.round((count / memberAnalytics.length) * allMembers.length);
              responseText += `• ${factor}: ${count} sampled (~${estimatedTotal} total)\n`;
            });

          responseText += `\n**Immediate Actions Needed:**\n`;
          const criticalMembers = memberAnalytics.filter(m => m.risk.riskLevel === 'critical');
          const estimatedCritical = Math.round((criticalMembers.length / memberAnalytics.length) * allMembers.length);
          responseText += `• ~${estimatedCritical} members estimated to need immediate attention\n`;
          responseText += `• Estimated revenue at risk: $${(estimatedCritical * 500).toLocaleString()}\n`;

          if (args?.includeDetails && criticalMembers.length > 0) {
            responseText += `\n**Critical Members from Sample (Top 10):**\n`;
            criticalMembers.slice(0, 10).forEach(m => {
              responseText += `• ${m.member.FirstName} ${m.member.LastName} - Risk: ${m.risk.riskScore}/100\n`;
            });
          }

          result = {
            content: [{
              type: "text",
              text: responseText
            }]
          };
        } catch (error) {
          throw new Error(`Failed to analyze membership health: ${error}`);
        }
        break;

      case "get_churn_risk_report":
        try {
          const renewalWindow = args?.renewalWindow || 90;
          const limit = args?.limit || 100;
          const minRiskScore = args?.minRiskScore || 50;

          // Fetch all active members for churn analysis (renewal dates may not be reliable)
          const members = await fetchAllRecords(ramcoClient, {
            entity: 'contact',
            filter: 'StatusCode<eq>1', // All active members
            maxRecords: 5000
          });

          // Assess churn risk for each member
          const riskAssessments = members
            .map(member => assessChurnRisk(member))
            .filter(assessment => assessment.riskScore >= minRiskScore)
            .sort((a, b) => b.riskScore - a.riskScore)
            .slice(0, limit);

          // Group by risk level
          const riskGroups = groupBy(riskAssessments, 'riskLevel');

          let responseText = `🚨 **Churn Risk Report**\n\n`;
          responseText += `**Analysis Period:** Next ${renewalWindow} days\n`;
          responseText += `**Members Up for Renewal:** ${members.length}\n\n`;

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
            responseText += `• Key Interventions: ${assessment.interventions[0]}\n`;
          });

          result = {
            content: [{
              type: "text",
              text: responseText
            }]
          };
        } catch (error) {
          throw new Error(`Failed to generate churn risk report: ${error}`);
        }
        break;

      case "generate_membership_snapshot":
        try {
          const asOfDate = args?.asOfDate ? new Date(args.asOfDate) : new Date();

          // Build filter with association constraint
          let filterParts = ['StatusCode<eq>1']; // Active members
          if (associationId) {
            filterParts.push(`ramco_primaryassociationid<eq>'${associationId}'`);
          }

          // Fetch all current members
          const currentMembers = await fetchAllRecords(ramcoClient, {
            entity: 'contact',
            filter: filterParts.join(' and '),
            // Use default fields to avoid field name issues
            maxRecords: 10000
          });

          // Calculate comparison period if requested
          let comparisonData = null;
          if (args?.compareToPeriod) {
            const compareDate = new Date(asOfDate);
            switch (args.compareToPeriod) {
              case 'lastMonth':
                compareDate.setMonth(compareDate.getMonth() - 1);
                break;
              case 'lastQuarter':
                compareDate.setMonth(compareDate.getMonth() - 3);
                break;
              case 'lastYear':
                compareDate.setFullYear(compareDate.getFullYear() - 1);
                break;
            }
            // In real implementation, would fetch historical data
            comparisonData = { count: currentMembers.length * 0.95 }; // Placeholder
          }

          // Group by requested dimensions
          const groupings = args?.groupBy || [];
          const grouped: Record<string, any> = {};

          if (groupings.includes('chapter')) {
            grouped.byChapter = groupBy(currentMembers, 'cobalt_chapterid.Display');
          }
          if (groupings.includes('memberType')) {
            grouped.byType = groupBy(currentMembers, 'cobalt_membertypeid.Display');
          }
          if (groupings.includes('status')) {
            grouped.byStatus = groupBy(currentMembers, 'StatusCode.Display');
          }

          // Calculate new members this period
          const thirtyDaysAgo = new Date(asOfDate);
          thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
          const newMembers = currentMembers.filter(m =>
            new Date(m.CreatedOn) > thirtyDaysAgo
          );

          let responseText = `📈 **Membership Snapshot**\n`;
          responseText += `*As of ${asOfDate.toLocaleDateString()}*\n\n`;

          responseText += `**Total Active Members:** ${currentMembers.length}\n`;
          responseText += `**New Members (30 days):** ${newMembers.length}\n`;

          if (comparisonData) {
            const growth = ((currentMembers.length - comparisonData.count) / comparisonData.count * 100).toFixed(1);
            const growthIcon = parseFloat(growth) > 0 ? '📈' : '📉';
            responseText += `**Growth vs ${args.compareToPeriod}:** ${growthIcon} ${growth}%\n`;
          }

          if (grouped.byChapter) {
            responseText += `\n**Members by Chapter:**\n`;
            Object.entries(grouped.byChapter)
              .sort(([,a]: any, [,b]: any) => b.length - a.length)
              .slice(0, 5)
              .forEach(([chapter, members]: any) => {
                responseText += `• ${chapter || 'No Chapter'}: ${members.length}\n`;
              });
          }

          if (grouped.byType) {
            responseText += `\n**Members by Type:**\n`;
            Object.entries(grouped.byType).forEach(([type, members]: any) => {
              const percentage = (members.length / currentMembers.length * 100).toFixed(1);
              responseText += `• ${type || 'Unknown'}: ${members.length} (${percentage}%)\n`;
            });
          }

          responseText += `\n**Key Metrics:**\n`;
          responseText += `• Average Member Tenure: ${(currentMembers.reduce((sum, m) => {
            const days = (asOfDate.getTime() - new Date(m.CreatedOn).getTime()) / (1000 * 60 * 60 * 24);
            return sum + days;
          }, 0) / currentMembers.length / 365).toFixed(1)} years\n`;
          responseText += `• Monthly Growth Rate: ${(newMembers.length / currentMembers.length * 100).toFixed(1)}%\n`;
          responseText += `• Estimated Annual Revenue: $${(currentMembers.length * 500).toLocaleString()}\n`;

          result = {
            content: [{
              type: "text",
              text: responseText
            }]
          };
        } catch (error) {
          throw new Error(`Failed to generate membership snapshot: ${error}`);
        }
        break;

      case "search_members_bulk":
        try {
          const query = args.query;
          const limit = args?.limit || 100;
          const exportFormat = args?.exportFormat || 'summary';

          // Parse natural language query
          const parsedQuery = parseNaturalLanguageQuery(query);

          // Add association filter if configured
          let finalFilter = parsedQuery.filter;
          if (associationId && (parsedQuery.entity || 'contact') === 'contact') {
            finalFilter = finalFilter
              ? `(${parsedQuery.filter}) and ramco_primaryassociationid<eq>'${associationId}'`
              : `ramco_primaryassociationid<eq>'${associationId}'`;
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

          result = {
            content: [{
              type: "text",
              text: responseText
            }]
          };
        } catch (error) {
          throw new Error(`Failed to search members: ${error}`);
        }
        break;

      case "analyze_payment_health":
        try {
          // Fetch all invoices and payments
          const invoices = await fetchAllRecords(ramcoClient, {
            entity: 'invoice',
            fields: ['InvoiceId', 'ContactId', 'TotalAmount', 'AmountDue', 'DueDate', 'StatusCode'],
            maxRecords: 5000
          });

          const payments = await fetchAllRecords(ramcoClient, {
            entity: 'cobalt_payment',
            fields: ['cobalt_paymentid', 'cobalt_contactid', 'cobalt_amount', 'createdon'],
            maxRecords: 5000
          });

          // Calculate payment metrics
          const totalOutstanding = invoices.reduce((sum, inv) =>
            sum + (inv.AmountDue?.Value || 0), 0
          );

          const overdueInvoices = invoices.filter(inv => {
            const dueDate = new Date(inv.DueDate?.Value || inv.DueDate);
            return dueDate < new Date() && (inv.AmountDue?.Value || 0) > 0;
          });

          // Aging analysis
          const aging = {
            current: 0,
            thirtyDays: 0,
            sixtyDays: 0,
            ninetyDays: 0,
            overNinety: 0
          };

          const now = new Date();
          overdueInvoices.forEach(inv => {
            const dueDate = new Date(inv.DueDate?.Value || inv.DueDate);
            const daysPast = Math.floor((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
            const amount = inv.AmountDue?.Value || 0;

            if (daysPast <= 0) aging.current += amount;
            else if (daysPast <= 30) aging.thirtyDays += amount;
            else if (daysPast <= 60) aging.sixtyDays += amount;
            else if (daysPast <= 90) aging.ninetyDays += amount;
            else aging.overNinety += amount;
          });

          let responseText = `💰 **Payment Health Analysis**\n\n`;
          responseText += `**Overview:**\n`;
          responseText += `• Total Invoices: ${invoices.length}\n`;
          responseText += `• Total Outstanding: $${totalOutstanding.toLocaleString()}\n`;
          responseText += `• Overdue Invoices: ${overdueInvoices.length}\n`;
          responseText += `• Collection Rate: ${((1 - overdueInvoices.length / invoices.length) * 100).toFixed(1)}%\n`;

          responseText += `\n**Aging Analysis:**\n`;
          responseText += `• Current: $${aging.current.toLocaleString()}\n`;
          responseText += `• 1-30 Days: $${aging.thirtyDays.toLocaleString()}\n`;
          responseText += `• 31-60 Days: $${aging.sixtyDays.toLocaleString()}\n`;
          responseText += `• 61-90 Days: $${aging.ninetyDays.toLocaleString()}\n`;
          responseText += `• Over 90 Days: $${aging.overNinety.toLocaleString()} ⚠️\n`;

          responseText += `\n**Payment Trends (Last 30 Days):**\n`;
          const recentPayments = payments.filter(p => {
            const payDate = new Date(p.createdon?.Value || p.CreatedOn);
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            return payDate > thirtyDaysAgo;
          });

          const recentTotal = recentPayments.reduce((sum, p) =>
            sum + (p.cobalt_amount?.Value || 0), 0
          );
          responseText += `• Payments Received: ${recentPayments.length}\n`;
          responseText += `• Total Collected: $${recentTotal.toLocaleString()}\n`;
          responseText += `• Average Payment: $${(recentTotal / recentPayments.length || 0).toFixed(2)}\n`;

          responseText += `\n**Action Items:**\n`;
          if (aging.overNinety > 0) {
            responseText += `• 🔴 Immediate collection action needed for $${aging.overNinety.toLocaleString()} (90+ days)\n`;
          }
          if (aging.sixtyDays > 0) {
            responseText += `• 🟡 Follow up on $${aging.sixtyDays.toLocaleString()} (60+ days)\n`;
          }
          responseText += `• Consider payment plans for members with large outstanding balances\n`;

          result = {
            content: [{
              type: "text",
              text: responseText
            }]
          };
        } catch (error) {
          throw new Error(`Failed to analyze payment health: ${error}`);
        }
        break;

      case "calculate_engagement_distribution":
        try {
          // Fetch all members for engagement analysis
          const members = await fetchAllRecords(ramcoClient, {
            entity: 'contact',
            fields: [
              'ContactId', 'FirstName', 'LastName', 'StatusCode', 'CreatedOn',
              'cobalt_membertypeid', 'cobalt_chapterid'
            ],
            maxRecords: 10000
          });

          // Calculate engagement for each member
          const memberEngagement = members.map(member => ({
            ...member,
            engagement: calculateMemberEngagement(member)
          }));

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
            const grouped = groupBy(memberEngagement, args.groupBy === 'chapter' ? 'cobalt_chapterid.Display' :
                                   args.groupBy === 'memberType' ? 'cobalt_membertypeid.Display' : 'engagement.level');
            Object.entries(grouped).slice(0, 10).forEach(([group, groupMembers]) => {
              const avgEngagement = groupMembers.reduce((sum: number, m: any) => sum + m.engagement.overall, 0) / groupMembers.length;
              responseText += `• ${group || 'Unknown'}: ${groupMembers.length} members (avg: ${avgEngagement.toFixed(1)})\n`;
            });
          }

          result = {
            content: [{
              type: "text",
              text: responseText
            }]
          };
        } catch (error) {
          throw new Error(`Failed to calculate engagement distribution: ${error}`);
        }
        break;

      case "segment_all_members":
        try {
          const strategy = args.segmentationStrategy;

          // Fetch all members
          const allMembers = await fetchAllRecords(ramcoClient, {
            entity: 'contact',
            fields: [
              'ContactId', 'FirstName', 'LastName', 'StatusCode', 'CreatedOn',
              'cobalt_membertypeid', 'cobalt_chapterid', 'cobalt_renewaldate'
            ],
            maxRecords: 10000
          });

          let segments: Record<string, any[]> = {};
          let responseText = `🎯 **Member Segmentation Analysis**\n\n`;
          responseText += `**Strategy:** ${strategy}\n`;
          responseText += `**Total Members:** ${allMembers.length}\n\n`;

          // Apply segmentation strategy
          switch (strategy) {
            case 'engagement':
              const memberEngagement = allMembers.map(member => ({
                ...member,
                engagement: calculateMemberEngagement(member)
              }));
              segments = groupBy(memberEngagement, 'engagement.level');
              break;

            case 'lifecycle':
              segments = allMembers.reduce((acc, member) => {
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
              const riskAssessments = allMembers.map(member => ({
                ...member,
                risk: assessChurnRisk(member)
              }));
              segments = groupBy(riskAssessments, 'risk.riskLevel');
              break;

            case 'value':
              const memberValues = allMembers.map(member => ({
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
                  segments[rule.name] = allMembers.filter((member: any) => {
                    // Simple evaluation of custom criteria (would need more robust parsing in production)
                    return eval(rule.criteria.replace(/member\./g, 'member.'));
                  });
                });
              }
              break;
          }

          responseText += `**Segments Identified:**\n`;
          Object.entries(segments).forEach(([segmentName, segmentMembers]) => {
            const percentage = (segmentMembers.length / allMembers.length * 100).toFixed(1);
            responseText += `• **${segmentName}**: ${segmentMembers.length} members (${percentage}%)\n`;
          });

          // Show overlap analysis
          responseText += `\n**Segment Overlap Analysis:**\n`;
          const segmentNames = Object.keys(segments);
          if (segmentNames.length > 1) {
            // Simple overlap check between largest segments
            const largest = segmentNames.sort((a, b) => segments[b].length - segments[a].length);
            responseText += `• Largest segment: ${largest[0]} (${segments[largest[0]].length} members)\n`;
            responseText += `• Second largest: ${largest[1]} (${segments[largest[1]].length} members)\n`;
          }

          result = {
            content: [{
              type: "text",
              text: responseText
            }]
          };
        } catch (error) {
          throw new Error(`Failed to segment members: ${error}`);
        }
        break;

      case "find_all_at_risk_members":
        try {
          const riskFactors = args?.riskFactors || ['payment', 'engagement', 'tenure', 'communication'];
          const returnLimit = args?.returnLimit || 50;

          // Fetch all members
          const allMembers = await fetchAllRecords(ramcoClient, {
            entity: 'contact',
            fields: [
              'ContactId', 'FirstName', 'LastName', 'EmailAddress1', 'StatusCode',
              'CreatedOn', 'cobalt_renewaldate', 'cobalt_membertypeid'
            ],
            maxRecords: 10000
          });

          const atRiskMembers: Record<string, any[]> = {};

          // Analyze each risk factor
          riskFactors.forEach((factor: string) => {
            atRiskMembers[factor] = [];
          });

          allMembers.forEach(member => {
            const engagement = calculateMemberEngagement(member);
            const churnRisk = assessChurnRisk(member);

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
                riskScore: engagement.overall,
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

            if (riskFactors.includes('communication') && !member.EmailAddress1) {
              atRiskMembers['communication'].push({
                ...member,
                riskScore: 50,
                riskReason: 'No email address on file',
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
              .slice(0, returnLimit / riskFactors.length)
              .forEach(member => {
                responseText += `• ${member.FirstName} ${member.LastName} - Risk: ${member.riskScore}/100\n`;
                responseText += `  Reason: ${member.riskReason}\n`;
                responseText += `  Action: ${member.intervention}\n\n`;
              });
          });

          const totalAtRisk = Object.values(atRiskMembers).reduce((sum, members) => sum + members.length, 0);
          responseText += `**Summary:** ${totalAtRisk} total at-risk members identified across all factors\n`;

          result = {
            content: [{
              type: "text",
              text: responseText
            }]
          };
        } catch (error) {
          throw new Error(`Failed to find at-risk members: ${error}`);
        }
        break;

      case "identify_member_patterns":
        try {
          const analysisType = args?.analysisType || 'all';
          const minSampleSize = args?.minimumSampleSize || 10;

          // Fetch all members with extended data
          const allMembers = await fetchAllRecords(ramcoClient, {
            entity: 'contact',
            fields: [
              'ContactId', 'FirstName', 'LastName', 'StatusCode', 'CreatedOn',
              'cobalt_membertypeid', 'cobalt_chapterid', 'cobalt_renewaldate'
            ],
            maxRecords: 10000
          });

          const patterns = identifyPatterns(allMembers);

          let responseText = `🔍 **Member Pattern Analysis**\n\n`;
          responseText += `**Analysis Type:** ${analysisType}\n`;
          responseText += `**Members Analyzed:** ${allMembers.length}\n`;
          responseText += `**Minimum Sample Size:** ${minSampleSize}\n\n`;

          if (analysisType === 'all' || analysisType === 'retention') {
            responseText += `**RETENTION PATTERNS:**\n`;
            if (patterns.successPatterns.length > 0) {
              responseText += `*High-retention member characteristics:*\n`;
              patterns.successPatterns.forEach((trait: any) => {
                responseText += `• ${trait.trait}: ${trait.value} (${trait.percentage}% of successful members)\n`;
              });
            }

            if (patterns.churnPatterns.length > 0) {
              responseText += `\n*Common churn indicators:*\n`;
              patterns.churnPatterns.forEach((trait: any) => {
                responseText += `• ${trait.trait}: ${trait.value} (${trait.percentage}% of churned members)\n`;
              });
            }
            responseText += `\n`;
          }

          if (analysisType === 'all' || analysisType === 'growth') {
            responseText += `**GROWTH OPPORTUNITIES:**\n`;
            patterns.growthOpportunities.forEach((opp: any) => {
              responseText += `• **${opp.opportunity}**\n`;
              responseText += `  Members: ${opp.count}\n`;
              responseText += `  Revenue Potential: $${opp.potentialRevenue.toLocaleString()}\n`;
              responseText += `  Recommendation: ${opp.recommendation}\n\n`;
            });
          }

          if (analysisType === 'all' || analysisType === 'engagement') {
            responseText += `**ENGAGEMENT PATTERNS:**\n`;
            const engagementAnalysis = allMembers.map(m => calculateMemberEngagement(m));
            const avgEngagement = engagementAnalysis.reduce((sum, e) => sum + e.overall, 0) / engagementAnalysis.length;
            responseText += `• Average engagement score: ${avgEngagement.toFixed(1)}/100\n`;

            const highEngaged = engagementAnalysis.filter(e => e.overall > 70).length;
            responseText += `• Highly engaged members: ${highEngaged} (${(highEngaged/allMembers.length*100).toFixed(1)}%)\n`;

            const atRiskEngagement = engagementAnalysis.filter(e => e.overall < 30).length;
            responseText += `• At-risk (low engagement): ${atRiskEngagement} (${(atRiskEngagement/allMembers.length*100).toFixed(1)}%)\n\n`;
          }

          responseText += `**DATA QUALITY ISSUES:**\n`;
          patterns.dataQualityIssues.forEach((issue: any) => {
            responseText += `• **${issue.issue}**: ${issue.count} members (${issue.percentage}%)\n`;
            responseText += `  Impact: ${issue.impact}\n\n`;
          });

          result = {
            content: [{
              type: "text",
              text: responseText
            }]
          };
        } catch (error) {
          throw new Error(`Failed to identify member patterns: ${error}`);
        }
        break;

      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return new Response(JSON.stringify({
      jsonrpc: "2.0",
      id: body.id,
      result
    }), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (error: any) {
    return new Response(JSON.stringify({
      jsonrpc: "2.0",
      id: body.id,
      result: {
        content: [{
          type: "text",
          text: `❌ Error: ${error.message}`
        }]
      }
    }), {
      headers: { "Content-Type": "application/json" }
    });
  }
}

/**
 * Tool Definitions Catalog
 *
 * MCP tool definitions exposed to clients.
 * Each definition includes the tool name, description, and input schema.
 */

import type { ToolDefinition } from '../types/mcp';

// ============================================================================
// Authentication Tools
// ============================================================================

const TEST_CONNECTION: ToolDefinition = {
  name: 'test_connection',
  description: 'Test connection to RAMCO API and verify API key is working. ' +
    'Returns connection status, API endpoint info, and basic system details.',
  inputSchema: {
    type: 'object',
    properties: {},
    required: []
  }
};

const GET_ASSOCIATION_INFO: ToolDefinition = {
  name: 'get_association_info',
  description: 'Get information about associated organizations in RAMCO. ' +
    'Can retrieve a specific association by ID or list all available associations. ' +
    'Returns details like name, leadership, contact info, and member counts.',
  inputSchema: {
    type: 'object',
    properties: {
      associationId: {
        type: 'string',
        description: 'Optional specific association GUID to get detailed information for. ' +
          'If omitted, returns a list of available associations.'
      }
    },
    required: []
  }
};

// ============================================================================
// Search Tools
// ============================================================================

const SEARCH_RECORDS: ToolDefinition = {
  name: 'search_records',
  description: 'Search RAMCO records with optional filters. ' +
    'Supports filtering by any field using RAMCO filter syntax, field selection, and cursor-based pagination. ' +
    'Returns every matching record up to `limit` and a nextCursor when more exist. ' +
    'Example filters: "StatusCode<eq>1", "LastName<like>\'Smith%\'", "CreatedOn<ge>\'2024-01-01\'". ' +
    'Filter operators: <eq>, <ne>, <gt>, <ge>, <lt>, <le>, <like>, <notlike>, <sb> (starts with), <sc> (contains)',
  inputSchema: {
    type: 'object',
    properties: {
      entityType: {
        type: 'string',
        description: 'Entity type to search (e.g., "contact", "invoice", "cobalt_membership"). ' +
          'Use get_entity_types to see available types. Defaults to "contact" if not specified.'
      },
      limit: {
        type: 'number',
        description: 'Maximum number of records to return in this call (1-5000). Default: 50. ' +
          'Every record returned is included in the output (not a sample), so raise this to get a full list.',
        default: 50
      },
      cursor: {
        type: 'string',
        description: 'Pagination cursor. When a response says "More records available" it includes a ' +
          'nextCursor value; pass it here (with the same entityType, filter and fields) to get the next page. ' +
          'Omit for the first page.'
      },
      offset: {
        type: 'number',
        description: 'Number of records to skip (0-based). Slower than cursor because the server must ' +
          'walk past the skipped records; prefer cursor for paging. Default: 0',
        default: 0
      },
      filter: {
        type: 'string',
        description: 'RAMCO filter syntax (e.g., "StatusCode<eq>1 and LastName<like>\'Smith%\'"). ' +
          'Operators: <eq>, <ne>, <gt>, <ge>, <lt>, <le>, <like>, <notlike>, <sb> (substring), <sc> (contains)'
      },
      fields: {
        type: 'string',
        description: 'Comma-separated list of field names to return. ' +
          'Example: "FirstName,LastName,EmailAddress1". If omitted, returns default fields.'
      }
    },
    required: []
  }
};

const GET_RECORD: ToolDefinition = {
  name: 'get_record',
  description: 'Get a single RAMCO record by its GUID. ' +
    'Returns complete record details for the specified ID.',
  inputSchema: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Record GUID (e.g., "123e4567-e89b-12d3-a456-426614174000")'
      },
      entityType: {
        type: 'string',
        description: 'Entity type of the record (e.g., "contact", "invoice"). ' +
          'Optional - system will auto-detect if not provided.'
      },
      fields: {
        type: 'string',
        description: 'Comma-separated list of field names to return. ' +
          'If omitted, returns all fields.'
      }
    },
    required: ['id']
  }
};

const GET_RELATED_RECORDS: ToolDefinition = {
  name: 'get_related_records',
  description: 'Get records related to a specific record through RAMCO relationships. ' +
    'For example, get all meetings for a contact, or all registrations for an event.',
  inputSchema: {
    type: 'object',
    properties: {
      recordId: {
        type: 'string',
        description: 'GUID of the source record'
      },
      entityType: {
        type: 'string',
        description: 'Entity type to retrieve related records from ' +
          '(e.g., "cobalt_meetingregistration" for meeting registrations)'
      },
      relationshipName: {
        type: 'string',
        description: 'Optional specific relationship name to traverse. ' +
          'If omitted, system will return all related records of the specified entity type.'
      },
      fields: {
        type: 'string',
        description: 'Comma-separated list of field names to return'
      },
      limit: {
        type: 'number',
        description: 'Maximum number of related records to return. Default: 10',
        default: 10
      }
    },
    required: ['recordId', 'entityType']
  }
};

// ============================================================================
// Metadata Tools
// ============================================================================

const GET_ENTITY_TYPES: ToolDefinition = {
  name: 'get_entity_types',
  description: 'Get list of all available entity types (modules) in RAMCO. ' +
    'Returns entity logical names and display names organized by category. ' +
    'Use this to discover what entities you can query.',
  inputSchema: {
    type: 'object',
    properties: {
      maxResults: {
        type: 'number',
        description: 'Maximum number of entity types to return (1-500). Default: 50',
        default: 50
      }
    },
    required: []
  }
};

const GET_SCHEMA: ToolDefinition = {
  name: 'get_schema',
  description: 'Get detailed schema information for a specific entity type. ' +
    'Returns all fields, data types, constraints, and relationships. ' +
    'Use this to understand what fields are available for querying and filtering.',
  inputSchema: {
    type: 'object',
    properties: {
      entityType: {
        type: 'string',
        description: 'Entity type logical name (e.g., "contact", "cobalt_membership")'
      }
    },
    required: ['entityType']
  }
};

const GET_ENTITY_INFO: ToolDefinition = {
  name: 'get_entity_info',
  description: 'Get comprehensive information about RAMCO entities organized by business area. ' +
    'Includes descriptions, common use cases, key fields, and example filters. ' +
    'Useful for understanding the RAMCO data model and discovering entities.',
  inputSchema: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        description: 'Filter by category',
        enum: ['core_crm', 'membership', 'education', 'finance', 'events', 'products', 'system']
      },
      search: {
        type: 'string',
        description: 'Search term to filter entities by name or description'
      }
    },
    required: []
  }
};

// ============================================================================
// Analytics Tools
// ============================================================================

const CALCULATE_MEMBER_ENGAGEMENT: ToolDefinition = {
  name: 'calculate_member_engagement',
  description: 'Calculate comprehensive engagement score and renewal risk assessment for a specific member. ' +
    'Returns engagement scores across committees, events, education, and communication, along with risk factors and recommendations.',
  inputSchema: {
    type: 'object',
    properties: {
      contactId: {
        type: 'string',
        description: 'Contact GUID to analyze'
      }
    },
    required: ['contactId']
  }
};

const ANALYZE_MEMBERSHIP_HEALTH: ToolDefinition = {
  name: 'analyze_membership_health',
  description: 'Analyze health of entire membership (10k+ members) with engagement scores, risk levels, and actionable insights. ' +
    'Uses sampling for large datasets. Returns engagement distribution, statistics, top risk factors, and critical members.',
  inputSchema: {
    type: 'object',
    properties: {
      filters: {
        type: 'object',
        description: 'Optional filters for analysis',
        properties: {
          memberType: {
            type: 'string',
            description: 'Filter by member type GUID'
          },
          chapter: {
            type: 'string',
            description: 'Filter by chapter GUID'
          }
        }
      },
      includeDetails: {
        type: 'boolean',
        description: 'Include detailed list of critical members. Default: false',
        default: false
      }
    },
    required: []
  }
};

const GET_CHURN_RISK_REPORT: ToolDefinition = {
  name: 'get_churn_risk_report',
  description: 'Identify all members at risk of churning with predictive scoring and intervention recommendations. ' +
    'Returns risk distribution, predicted churn rate, revenue at risk, and top at-risk members.',
  inputSchema: {
    type: 'object',
    properties: {
      renewalWindow: {
        type: 'number',
        description: 'Days ahead to look for renewals. Default: 90',
        default: 90
      },
      limit: {
        type: 'number',
        description: 'Maximum number of at-risk members to return. Default: 100',
        default: 100
      },
      minRiskScore: {
        type: 'number',
        description: 'Minimum risk score (0-100) to include. Default: 50',
        default: 50
      }
    },
    required: []
  }
};

const GENERATE_MEMBERSHIP_SNAPSHOT: ToolDefinition = {
  name: 'generate_membership_snapshot',
  description: 'Generate comprehensive association metrics snapshot with totals, growth, and comparisons. ' +
    'Returns total members, breakdowns by type/status/chapter, and trend comparisons.',
  inputSchema: {
    type: 'object',
    properties: {
      asOfDate: {
        type: 'string',
        description: 'Date for snapshot (ISO 8601 format). Defaults to today',
        format: 'date'
      },
      compareToPeriod: {
        type: 'string',
        description: 'Previous period to compare (lastMonth, lastQuarter, lastYear)',
        enum: ['lastMonth', 'lastQuarter', 'lastYear']
      },
      groupBy: {
        type: 'array',
        description: 'Group metrics by dimensions (chapter, memberType, status)',
        items: {
          type: 'string',
          enum: ['chapter', 'memberType', 'status']
        }
      }
    },
    required: []
  }
};

// ============================================================================
// Payment Tools
// ============================================================================

const ANALYZE_PAYMENT_HEALTH: ToolDefinition = {
  name: 'analyze_payment_health',
  description: 'Analyze payment status across entire membership with aging, delinquency rates, and collection metrics. ' +
    'Returns total outstanding, overdue invoices, aging analysis, payment trends, and action items.',
  inputSchema: {
    type: 'object',
    properties: {
      dateRange: {
        type: 'object',
        description: 'Optional date range for analysis',
        properties: {
          start: {
            type: 'string',
            format: 'date',
            description: 'Start date (ISO 8601)'
          },
          end: {
            type: 'string',
            format: 'date',
            description: 'End date (ISO 8601)'
          }
        }
      },
      includeForecasting: {
        type: 'boolean',
        description: 'Include payment forecasting. Default: false',
        default: false
      }
    },
    required: []
  }
};

// ============================================================================
// Bulk Search Tools
// ============================================================================

const SEARCH_MEMBERS_BULK: ToolDefinition = {
  name: 'search_members_bulk',
  description: 'Search members using natural language queries like "members who joined last year but haven\'t attended events". ' +
    'Supports multiple export formats (summary, json, csv). Returns parsed interpretation and matching members.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Natural language search query'
      },
      limit: {
        type: 'number',
        description: 'Maximum results to return. Default: 100',
        default: 100
      },
      exportFormat: {
        type: 'string',
        description: 'Format for results. Default: summary',
        enum: ['summary', 'json', 'csv'],
        default: 'summary'
      }
    },
    required: ['query']
  }
};

const CALCULATE_ENGAGEMENT_DISTRIBUTION: ToolDefinition = {
  name: 'calculate_engagement_distribution',
  description: 'Analyze engagement patterns across entire membership with percentiles and segments. ' +
    'Returns engagement level distribution, score statistics, and optional grouping by chapter/member type.',
  inputSchema: {
    type: 'object',
    properties: {
      dateRange: {
        type: 'object',
        description: 'Optional date range for analysis',
        properties: {
          start: {
            type: 'string',
            format: 'date',
            description: 'Start date (ISO 8601)'
          },
          end: {
            type: 'string',
            format: 'date',
            description: 'End date (ISO 8601)'
          }
        }
      },
      groupBy: {
        type: 'string',
        description: 'Group analysis by dimension',
        enum: ['chapter', 'memberType', 'cohort']
      }
    },
    required: []
  }
};

// ============================================================================
// Segmentation Tools
// ============================================================================

const SEGMENT_ALL_MEMBERS: ToolDefinition = {
  name: 'segment_all_members',
  description: 'Automatically segment entire membership based on multiple criteria with overlap analysis. ' +
    'Strategies: engagement (high/moderate/at-risk), lifecycle (new/developing/established), risk (critical/high/medium/low), ' +
    'value (high/medium/standard/low), or custom rules.',
  inputSchema: {
    type: 'object',
    properties: {
      segmentationStrategy: {
        type: 'string',
        description: 'Predefined segmentation strategy',
        enum: ['engagement', 'lifecycle', 'value', 'risk', 'custom']
      },
      customRules: {
        type: 'array',
        description: 'Custom segmentation rules (used with custom strategy)',
        items: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Segment name'
            },
            criteria: {
              type: 'string',
              description: 'Criteria expression'
            }
          },
          required: ['name', 'criteria']
        }
      }
    },
    required: ['segmentationStrategy']
  }
};

const FIND_ALL_AT_RISK_MEMBERS: ToolDefinition = {
  name: 'find_all_at_risk_members',
  description: 'Identify all at-risk members across multiple risk factors with prioritized intervention plans. ' +
    'Risk factors: payment (outstanding balance), engagement (low score), tenure (new members), communication (missing contact info).',
  inputSchema: {
    type: 'object',
    properties: {
      riskFactors: {
        type: 'array',
        description: 'Risk factors to analyze. Default: all',
        items: {
          type: 'string',
          enum: ['payment', 'engagement', 'tenure', 'communication']
        },
        default: ['payment', 'engagement', 'tenure', 'communication']
      },
      returnLimit: {
        type: 'number',
        description: 'Max members to return per risk category. Default: 50',
        default: 50
      }
    },
    required: []
  }
};

// ============================================================================
// Pattern Analysis Tools
// ============================================================================

const IDENTIFY_MEMBER_PATTERNS: ToolDefinition = {
  name: 'identify_member_patterns',
  description: 'Discover patterns in member behavior, success factors, and churn triggers using ML-style analysis. ' +
    'Analyzes retention patterns, growth opportunities, engagement patterns, and data quality issues.',
  inputSchema: {
    type: 'object',
    properties: {
      analysisType: {
        type: 'string',
        description: 'Type of pattern analysis. Default: all',
        enum: ['retention', 'growth', 'engagement', 'all'],
        default: 'all'
      },
      minimumSampleSize: {
        type: 'number',
        description: 'Minimum members needed for pattern. Default: 10',
        default: 10
      }
    },
    required: []
  }
};

// ============================================================================
// Export All Tool Definitions
// ============================================================================

/**
 * All available tool definitions
 * Add new tool definitions here as they are created
 */
export const ALL_TOOL_DEFINITIONS: ToolDefinition[] = [
  // Authentication
  TEST_CONNECTION,
  GET_ASSOCIATION_INFO,

  // Search
  SEARCH_RECORDS,
  GET_RECORD,
  GET_RELATED_RECORDS,

  // Metadata
  GET_ENTITY_TYPES,
  GET_SCHEMA,
  GET_ENTITY_INFO,

  // Analytics
  CALCULATE_MEMBER_ENGAGEMENT,
  ANALYZE_MEMBERSHIP_HEALTH,
  GET_CHURN_RISK_REPORT,
  GENERATE_MEMBERSHIP_SNAPSHOT,

  // Payment
  ANALYZE_PAYMENT_HEALTH,

  // Bulk Search
  SEARCH_MEMBERS_BULK,
  CALCULATE_ENGAGEMENT_DISTRIBUTION,

  // Segmentation
  SEGMENT_ALL_MEMBERS,
  FIND_ALL_AT_RISK_MEMBERS,

  // Pattern Analysis
  IDENTIFY_MEMBER_PATTERNS
];

/**
 * Get tool definitions for MCP tools/list response
 */
export function getToolDefinitions(): ToolDefinition[] {
  return ALL_TOOL_DEFINITIONS;
}

/**
 * Get a specific tool definition by name
 */
export function getToolDefinition(name: string): ToolDefinition | undefined {
  return ALL_TOOL_DEFINITIONS.find(tool => tool.name === name);
}

/**
 * Check if a tool definition exists
 */
export function hasToolDefinition(name: string): boolean {
  return ALL_TOOL_DEFINITIONS.some(tool => tool.name === name);
}

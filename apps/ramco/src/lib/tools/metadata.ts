/**
 * Metadata Tools
 *
 * Tools for discovering RAMCO entity types, schemas, and metadata.
 */

import type { ToolHandler } from '../types/mcp';
import {
  GetEntityTypesSchema,
  GetSchemaSchema,
  GetEntityInfoSchema,
  validateToolInput
} from '../validation/schemas';

// ============================================================================
// get_entity_types
// ============================================================================

/**
 * Get list of available entity types in RAMCO
 * Returns all entity types with their display names
 */
export const getEntityTypes: ToolHandler = async (args, ramcoClient) => {
  // Validate input
  const validatedArgs = validateToolInput(GetEntityTypesSchema, args);

  try {
    const startTime = performance.now();
    const response = await ramcoClient.getEntityTypes(validatedArgs.maxResults);
    const duration = Math.round(performance.now() - startTime);

    // Extract entity types from response
    const entityTypes = response.Data || {};

    if (typeof entityTypes !== 'object' || Object.keys(entityTypes).length === 0) {
      return {
        content: [{
          type: 'text',
          text: `❓ No entity types found\n\n` +
            `This could indicate:\n` +
            `- API connection issues\n` +
            `- Insufficient permissions\n` +
            `- Empty RAMCO instance\n\n` +
            `Please verify your API key and permissions.`
        }]
      };
    }

    const entityList = Object.entries(entityTypes);
    const total = entityList.length;

    // Group entity types by category (based on naming patterns)
    const categorized = categorizeEntityTypes(entityList);

    let resultText = `# Available Entity Types (${total})\n\n` +
      `**Query Time:** ${duration}ms\n\n`;

    // Display by category
    for (const [category, entities] of Object.entries(categorized)) {
      if (entities.length > 0) {
        resultText += `## ${category}\n\n`;

        for (const [logicalName, displayName] of entities) {
          resultText += `- **${logicalName}** - ${displayName}\n`;
        }

        resultText += `\n`;
      }
    }

    resultText += `\n---\n\n` +
      `**💡 Tips:**\n` +
      `- Use \`get_schema\` to see fields for an entity type\n` +
      `- Use \`search_records\` to query records from an entity\n` +
      `- Use \`get_entity_info\` for detailed entity information`;

    return {
      content: [{
        type: 'text',
        text: resultText
      }]
    };

  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: `❌ Failed to retrieve entity types\n\n` +
          `**Error:** ${error instanceof Error ? error.message : 'Unknown error'}\n\n` +
          `This could be due to network issues or API problems.`
      }],
      isError: true
    };
  }
};

// ============================================================================
// get_schema
// ============================================================================

/**
 * Get schema/metadata for a specific entity type
 * Returns all fields, types, and metadata for an entity
 */
export const getSchema: ToolHandler = async (args, ramcoClient) => {
  // Validate input
  const validatedArgs = validateToolInput(GetSchemaSchema, args);

  try {
    const startTime = performance.now();
    const schema = await ramcoClient.getSchema(validatedArgs.entityType);
    const duration = Math.round(performance.now() - startTime);

    if (!schema || !schema.Name) {
      return {
        content: [{
          type: 'text',
          text: `❓ Schema not found for entity type: **${validatedArgs.entityType}**\n\n` +
            `This entity type may not exist. Use \`get_entity_types\` to see available types.`
        }]
      };
    }

    // Extract and categorize fields
    const attributes = schema.Attributes || {};
    const fieldList = Object.entries(attributes);

    const categorizedFields = {
      core: [] as Array<[string, any]>,
      relationships: [] as Array<[string, any]>,
      custom: [] as Array<[string, any]>,
      system: [] as Array<[string, any]>
    };

    for (const [fieldName, fieldDef] of fieldList) {
      const fieldDefObj = fieldDef as any;

      // Categorize based on field name and type
      if (fieldDefObj.Type === 'Lookup' || fieldDefObj.Type === 'EntityReference') {
        categorizedFields.relationships.push([fieldName, fieldDef]);
      } else if (fieldName.startsWith('cobalt_') || fieldName.startsWith('ramco_')) {
        categorizedFields.custom.push([fieldName, fieldDef]);
      } else if (fieldName.toLowerCase().includes('id') || fieldName.toLowerCase().includes('on')) {
        categorizedFields.system.push([fieldName, fieldDef]);
      } else {
        categorizedFields.core.push([fieldName, fieldDef]);
      }
    }

    let resultText = `# Schema for ${schema.Name}\n\n` +
      `**Entity:** ${validatedArgs.entityType}\n` +
      `**Primary Key:** ${schema.PrimaryKey || 'Unknown'}\n` +
      `**Total Fields:** ${fieldList.length}\n` +
      `**Query Time:** ${duration}ms\n\n`;

    // Core Fields
    if (categorizedFields.core.length > 0) {
      resultText += `## Core Fields (${categorizedFields.core.length})\n\n`;
      for (const [fieldName, fieldDef] of categorizedFields.core.slice(0, 15)) {
        const def = fieldDef as any;
        resultText += formatFieldInfo(fieldName, def);
      }
      if (categorizedFields.core.length > 15) {
        resultText += `\n*...and ${categorizedFields.core.length - 15} more core fields*\n`;
      }
      resultText += `\n`;
    }

    // Relationships
    if (categorizedFields.relationships.length > 0) {
      resultText += `## Relationships (${categorizedFields.relationships.length})\n\n`;
      for (const [fieldName, fieldDef] of categorizedFields.relationships.slice(0, 10)) {
        const def = fieldDef as any;
        resultText += formatFieldInfo(fieldName, def);
      }
      if (categorizedFields.relationships.length > 10) {
        resultText += `\n*...and ${categorizedFields.relationships.length - 10} more relationships*\n`;
      }
      resultText += `\n`;
    }

    // Custom Fields
    if (categorizedFields.custom.length > 0) {
      resultText += `## Custom Fields (${categorizedFields.custom.length})\n\n`;
      for (const [fieldName, fieldDef] of categorizedFields.custom.slice(0, 10)) {
        const def = fieldDef as any;
        resultText += formatFieldInfo(fieldName, def);
      }
      if (categorizedFields.custom.length > 10) {
        resultText += `\n*...and ${categorizedFields.custom.length - 10} more custom fields*\n`;
      }
      resultText += `\n`;
    }

    resultText += `\n---\n\n` +
      `**💡 Example Queries:**\n\n` +
      `**Search all records:**\n` +
      `\`\`\`\nsearch_records(entityType="${validatedArgs.entityType}")\n\`\`\`\n\n` +
      `**Filter example:**\n` +
      `\`\`\`\nsearch_records(\n  entityType="${validatedArgs.entityType}",\n  filter="StatusCode<eq>1"\n)\n\`\`\``;

    return {
      content: [{
        type: 'text',
        text: resultText
      }]
    };

  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: `❌ Failed to retrieve schema\n\n` +
          `**Entity Type:** ${validatedArgs.entityType}\n` +
          `**Error:** ${error instanceof Error ? error.message : 'Unknown error'}\n\n` +
          `Verify the entity type name is correct using \`get_entity_types\`.`
      }],
      isError: true
    };
  }
};

// ============================================================================
// get_entity_info
// ============================================================================

/**
 * Get comprehensive information about RAMCO entities
 * Organized by business area with usage examples
 */
export const getEntityInfo: ToolHandler = async (args, ramcoClient) => {
  // Validate input
  const validatedArgs = validateToolInput(GetEntityInfoSchema, args);

  // Define entity categories with descriptions and examples
  const entityInfo = {
    core_crm: {
      title: 'Core CRM Entities',
      description: 'Essential entities for managing contacts and relationships',
      entities: {
        'contact': {
          description: 'Individual people (members, prospects, staff)',
          commonUse: 'Managing member records, contact information',
          keyFields: ['ContactId', 'FirstName', 'LastName', 'EmailAddress1', 'StatusCode'],
          exampleFilter: `StatusCode<eq>1 and LastName<like>'Smith%'`
        },
        'account': {
          description: 'Organizations or companies',
          commonUse: 'Managing business relationships, offices',
          keyFields: ['AccountId', 'Name', 'AccountNumber'],
          exampleFilter: `StatusCode<eq>1`
        }
      }
    },
    membership: {
      title: 'Membership Management',
      description: 'Entities for managing memberships and member types',
      entities: {
        'cobalt_membership': {
          description: 'Membership records linking contacts to membership types',
          commonUse: 'Tracking member subscriptions, renewal dates',
          keyFields: ['cobalt_membershipid', 'cobalt_contactid', 'cobalt_membertypeid', 'cobalt_renewaldate'],
          exampleFilter: `statuscode<eq>1 and cobalt_renewaldate<ge>'2024-01-01'`
        },
        'cobalt_membertype': {
          description: 'Types of memberships available',
          commonUse: 'Defining membership tiers (Regular, Associate, etc.)',
          keyFields: ['cobalt_membertypeid', 'cobalt_name'],
          exampleFilter: `statuscode<eq>1`
        }
      }
    },
    events: {
      title: 'Events & Meetings',
      description: 'Managing events, meetings, and registrations',
      entities: {
        'cobalt_meeting': {
          description: 'Events and meetings',
          commonUse: 'Managing conferences, training sessions, networking events',
          keyFields: ['cobalt_meetingid', 'cobalt_name', 'cobalt_startdate', 'cobalt_enddate'],
          exampleFilter: `cobalt_startdate<ge>'2024-01-01'`
        },
        'cobalt_meetingregistration': {
          description: 'Event registrations',
          commonUse: 'Tracking who registered for events',
          keyFields: ['cobalt_meetingregistrationid', 'cobalt_contactid', 'cobalt_meetingid'],
          exampleFilter: `statuscode<eq>1`
        }
      }
    },
    education: {
      title: 'Education & Training',
      description: 'Managing classes and educational programs',
      entities: {
        'cobalt_class': {
          description: 'Educational classes and courses',
          commonUse: 'CE credits, professional development',
          keyFields: ['cobalt_classid', 'cobalt_name', 'cobalt_startdate'],
          exampleFilter: `statuscode<eq>1`
        },
        'cobalt_classregistration': {
          description: 'Class enrollment records',
          commonUse: 'Tracking class attendance',
          keyFields: ['cobalt_classregistrationid', 'cobalt_contactid', 'cobalt_classid'],
          exampleFilter: `statuscode<eq>1`
        }
      }
    },
    finance: {
      title: 'Financial Management',
      description: 'Invoicing, payments, and transactions',
      entities: {
        'invoice': {
          description: 'Invoices for services or products',
          commonUse: 'Membership dues, event fees',
          keyFields: ['InvoiceId', 'TotalAmount', 'DueDate', 'StatusCode'],
          exampleFilter: `StatusCode<eq>1 and AmountDue<gt>0`
        },
        'cobalt_payment': {
          description: 'Payment records',
          commonUse: 'Tracking received payments',
          keyFields: ['cobalt_paymentid', 'cobalt_amount', 'cobalt_paymentdate'],
          exampleFilter: `statuscode<eq>1`
        }
      }
    },
    system: {
      title: 'System & Administration',
      description: 'System-level entities',
      entities: {
        'ramco_association': {
          description: 'Associations/organizations in the system',
          commonUse: 'Multi-association management',
          keyFields: ['ramco_associationId', 'ramco_name', 'ramco_type'],
          exampleFilter: `ramco_type<ne>null`
        }
      }
    }
  };

  // Filter by category if specified
  const categories = validatedArgs.category
    ? [validatedArgs.category]
    : Object.keys(entityInfo);

  // Filter by search term if specified
  const searchTerm = validatedArgs.search?.toLowerCase();

  let resultText = `# RAMCO Entity Reference\n\n`;

  if (validatedArgs.category) {
    resultText += `**Category:** ${validatedArgs.category}\n`;
  }
  if (searchTerm) {
    resultText += `**Search:** "${validatedArgs.search}"\n`;
  }
  resultText += `\n`;

  for (const categoryKey of categories) {
    const category = entityInfo[categoryKey as keyof typeof entityInfo];
    if (!category) continue;

    let categoryHasMatches = false;
    let categoryText = `## ${category.title}\n\n*${category.description}*\n\n`;

    for (const [entityName, entityData] of Object.entries(category.entities)) {
      // Apply search filter
      if (searchTerm) {
        const searchableText = `${entityName} ${entityData.description} ${entityData.commonUse}`.toLowerCase();
        if (!searchableText.includes(searchTerm)) {
          continue;
        }
      }

      categoryHasMatches = true;

      categoryText += `### \`${entityName}\`\n\n` +
        `**Description:** ${entityData.description}\n\n` +
        `**Common Use:** ${entityData.commonUse}\n\n` +
        `**Key Fields:**\n${entityData.keyFields.map(f => `- \`${f}\``).join('\n')}\n\n` +
        `**Example Filter:**\n\`\`\`\n${entityData.exampleFilter}\n\`\`\`\n\n`;
    }

    if (categoryHasMatches) {
      resultText += categoryText;
    }
  }

  if (resultText === `# RAMCO Entity Reference\n\n`) {
    resultText += `No entities found matching your criteria.\n\n` +
      `Try:\n` +
      `- Removing filters\n` +
      `- Using \`get_entity_types\` to see all available entities\n` +
      `- Adjusting your search term`;
  } else {
    resultText += `\n---\n\n` +
      `**💡 Next Steps:**\n` +
      `- Use \`get_schema\` to see full field definitions\n` +
      `- Use \`search_records\` to query these entities\n` +
      `- Use \`get_entity_types\` to see all available entities`;
  }

  return {
    content: [{
      type: 'text',
      text: resultText
    }]
  };
};

// ============================================================================
// Helper Functions
// ============================================================================

function categorizeEntityTypes(entityList: Array<[string, any]>): Record<string, Array<[string, any]>> {
  const categories: Record<string, Array<[string, any]>> = {
    'Core CRM': [],
    'Membership': [],
    'Events': [],
    'Education': [],
    'Financial': [],
    'Committees': [],
    'Custom': [],
    'System': []
  };

  for (const entity of entityList) {
    const [name] = entity;
    const lowerName = name.toLowerCase();

    if (lowerName.includes('contact') || lowerName.includes('account')) {
      categories['Core CRM'].push(entity);
    } else if (lowerName.includes('member')) {
      categories['Membership'].push(entity);
    } else if (lowerName.includes('meeting') || lowerName.includes('event')) {
      categories['Events'].push(entity);
    } else if (lowerName.includes('class') || lowerName.includes('education')) {
      categories['Education'].push(entity);
    } else if (lowerName.includes('invoice') || lowerName.includes('payment') || lowerName.includes('transaction')) {
      categories['Financial'].push(entity);
    } else if (lowerName.includes('committee')) {
      categories['Committees'].push(entity);
    } else if (lowerName.startsWith('cobalt_') || lowerName.startsWith('ramco_')) {
      categories['Custom'].push(entity);
    } else {
      categories['System'].push(entity);
    }
  }

  return categories;
}

function formatFieldInfo(fieldName: string, fieldDef: any): string {
  let info = `**\`${fieldName}\`**`;

  if (fieldDef.DisplayName && fieldDef.DisplayName !== fieldName) {
    info += ` - ${fieldDef.DisplayName}`;
  }

  info += `\n- Type: ${fieldDef.Type || 'Unknown'}`;

  if (fieldDef.MaxLength) {
    info += `\n- Max Length: ${fieldDef.MaxLength}`;
  }

  if (fieldDef.IsRequired) {
    info += `\n- **Required**`;
  }

  if (fieldDef.Description) {
    info += `\n- Description: ${fieldDef.Description}`;
  }

  info += `\n\n`;

  return info;
}

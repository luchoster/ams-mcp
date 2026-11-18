/**
 * Search Tools
 *
 * Tools for searching and retrieving RAMCO records.
 */

import type { ToolHandler } from '../types/mcp';
import {
  SearchRecordsSchema,
  GetRecordSchema,
  GetRelatedRecordsSchema,
  validateToolInput
} from '../validation/schemas';

// ============================================================================
// search_records
// ============================================================================

/**
 * Search for RAMCO records with optional filters
 * Supports filtering, field selection, pagination, and various entity types
 */
export const searchRecords: ToolHandler = async (args, ramcoClient, associationId) => {
  // Validate input
  const validatedArgs = validateToolInput(SearchRecordsSchema, args);

  try {
    const options: any = {
      limit: validatedArgs.limit,
      offset: validatedArgs.offset,
      cursor: validatedArgs.cursor
    };

    // Set entity/module
    if (validatedArgs.entityType) {
      options.module = validatedArgs.entityType;
    } else {
      options.module = 'contact'; // Default to contacts
    }

    // Add association filter if configured
    if (associationId && options.module === 'contact') {
      const associationFilter = `ramco_primaryassociationid<eq>'${associationId}'`;

      if (validatedArgs.filter) {
        options.filter = `${associationFilter} and ${validatedArgs.filter}`;
      } else {
        options.filter = associationFilter;
      }
    } else if (validatedArgs.filter) {
      options.filter = validatedArgs.filter;
    }

    // Add fields if specified
    if (validatedArgs.fields) {
      options.fields = validatedArgs.fields.split(',').map((f: string) => f.trim());
    }

    // Execute search (one page, with a cursor for the next page when more exist)
    const startTime = performance.now();
    const page = await ramcoClient.searchRecordsPage(options);
    const records = page.records;
    const duration = Math.round(performance.now() - startTime);

    if (!records || records.length === 0) {
      return {
        content: [{
          type: 'text',
          text: `No records found matching your criteria.\n\n` +
            `**Search Details:**\n` +
            `- Entity: ${options.module}\n` +
            `- Filter: ${options.filter || 'None'}\n` +
            `- Limit: ${validatedArgs.limit}\n` +
            (validatedArgs.cursor ? `- Cursor: ${validatedArgs.cursor}\n` : '') +
            (validatedArgs.offset ? `- Offset: ${validatedArgs.offset}\n` : '') +
            `\nTry adjusting your search criteria or filters.`
        }]
      };
    }

    // Format results - every record on this page is included (no sampling)
    const fieldNames = Object.keys(records[0]);

    let resultText = `# Search Results\n\n` +
      `**Records on this page:** ${records.length}\n` +
      `**Entity:** ${options.module}\n` +
      `**Query Time:** ${duration}ms\n`;

    if (options.filter) {
      resultText += `**Filter:** \`${options.filter}\`\n`;
    }
    if (validatedArgs.cursor) {
      resultText += `**Cursor:** continued from previous page\n`;
    } else if (validatedArgs.offset) {
      resultText += `**Offset:** ${validatedArgs.offset}\n`;
    }

    if (page.hasMore && page.nextCursor) {
      resultText += `\n⚠️ **More records available.** This page was capped at limit=${validatedArgs.limit}. ` +
        `To get the next page, call search_records again with the same entityType, filter and fields plus:\n` +
        `\`cursor: "${page.nextCursor}"\`\n` +
        `Or raise \`limit\` (max 5000) to get more records in one call.\n`;
    } else {
      resultText += `\n✅ **Complete:** no more records match this search.\n`;
    }

    resultText += `\n## Records (${records.length})\n\`\`\`json\n[\n` +
      records.map(r => `  ${JSON.stringify(r)}`).join(',\n') +
      `\n]\n\`\`\`\n`;

    resultText += `\n**Fields** (${fieldNames.length}): ` + fieldNames.slice(0, 20).join(', ');
    if (fieldNames.length > 20) {
      resultText += ` ...and ${fieldNames.length - 20} more`;
    }

    if (page.hasMore && page.nextCursor) {
      resultText += `\n\n**nextCursor:** \`${page.nextCursor}\``;
    }

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
        text: `❌ Search failed\n\n` +
          `**Error:** ${error instanceof Error ? error.message : 'Unknown error'}\n\n` +
          `**Troubleshooting:**\n` +
          `- Check that the entity type exists\n` +
          `- Verify your filter syntax is correct\n` +
          `- Ensure field names are valid\n` +
          `- Try reducing the limit if timeout occurred`
      }],
      isError: true
    };
  }
};

// ============================================================================
// get_record
// ============================================================================

/**
 * Get a single RAMCO record by ID
 * Retrieves complete record details for a specific GUID
 */
export const getRecord: ToolHandler = async (args, ramcoClient, associationId) => {
  // Validate input
  const validatedArgs = validateToolInput(GetRecordSchema, args);

  try {
    const options: any = {};

    // Parse fields if provided
    if (validatedArgs.fields) {
      options.fields = validatedArgs.fields.split(',').map((f: string) => f.trim());
    }

    // Execute get record
    const startTime = performance.now();
    const record = await ramcoClient.getRecord(
      validatedArgs.id,
      validatedArgs.entityType,
      options
    );
    const duration = Math.round(performance.now() - startTime);

    if (!record) {
      return {
        content: [{
          type: 'text',
          text: `❓ Record not found\n\n` +
            `**ID:** \`${validatedArgs.id}\`\n` +
            `**Entity Type:** ${validatedArgs.entityType || 'auto-detect'}\n\n` +
            `The record may have been deleted or you may not have permission to view it.`
        }]
      };
    }

    // Determine entity type from record if not provided
    const entityType = validatedArgs.entityType || detectEntityType(record);

    // Format result
    const fieldCount = Object.keys(record).length;
    const resultText = `# Record Details\n\n` +
      `**ID:** \`${validatedArgs.id}\`\n` +
      `**Entity Type:** ${entityType}\n` +
      `**Fields:** ${fieldCount}\n` +
      `**Query Time:** ${duration}ms\n\n` +
      `## Data\n\`\`\`json\n${JSON.stringify(record, null, 2)}\n\`\`\`\n\n` +
      `**💡 Tip:** Use \`get_related_records\` to fetch related data for this record.`;

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
        text: `❌ Failed to retrieve record\n\n` +
          `**ID:** \`${validatedArgs.id}\`\n` +
          `**Error:** ${error instanceof Error ? error.message : 'Unknown error'}\n\n` +
          `**Possible causes:**\n` +
          `- Invalid GUID format\n` +
          `- Record doesn't exist\n` +
          `- Insufficient permissions\n` +
          `- Incorrect entity type`
      }],
      isError: true
    };
  }
};

// ============================================================================
// get_related_records
// ============================================================================

/**
 * Get records related to a specific record
 * Retrieves related entities through RAMCO relationships
 */
export const getRelatedRecords: ToolHandler = async (args, ramcoClient, associationId) => {
  // Validate input
  const validatedArgs = validateToolInput(GetRelatedRecordsSchema, args);

  try {
    const options: any = {
      limit: validatedArgs.limit
    };

    // Parse fields if provided
    if (validatedArgs.fields) {
      options.fields = validatedArgs.fields.split(',').map((f: string) => f.trim());
    }

    // Execute get related records
    const startTime = performance.now();
    const records = await ramcoClient.getRelatedRecords(
      validatedArgs.recordId,
      validatedArgs.entityType,
      validatedArgs.relationshipName,
      options
    );
    const duration = Math.round(performance.now() - startTime);

    if (!records || records.length === 0) {
      return {
        content: [{
          type: 'text',
          text: `No related records found.\n\n` +
            `**Source Record:** \`${validatedArgs.recordId}\`\n` +
            `**Entity Type:** ${validatedArgs.entityType}\n` +
            `**Relationship:** ${validatedArgs.relationshipName || 'auto-detect'}\n\n` +
            `This record may not have any related records of this type, ` +
            `or the relationship name may be incorrect.`
        }]
      };
    }

    // Format results - every record returned is included (no sampling)
    let resultText = `# Related Records\n\n` +
      `**Source Record:** \`${validatedArgs.recordId}\`\n` +
      `**Entity Type:** ${validatedArgs.entityType}\n` +
      `**Relationship:** ${validatedArgs.relationshipName || 'auto-detect'}\n` +
      `**Found:** ${records.length} record(s)\n` +
      `**Query Time:** ${duration}ms\n`;

    if (records.length >= validatedArgs.limit) {
      resultText += `\n⚠️ Result count equals limit=${validatedArgs.limit}; more related records may exist. ` +
        `Raise \`limit\` to see them.\n`;
    }

    resultText += `\n## Records (${records.length})\n\`\`\`json\n[\n` +
      records.map(r => `  ${JSON.stringify(r)}`).join(',\n') +
      `\n]\n\`\`\`\n`;

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
        text: `❌ Failed to retrieve related records\n\n` +
          `**Source Record:** \`${validatedArgs.recordId}\`\n` +
          `**Error:** ${error instanceof Error ? error.message : 'Unknown error'}\n\n` +
          `**Troubleshooting:**\n` +
          `- Verify the record ID is correct\n` +
          `- Check the entity type is valid\n` +
          `- Ensure the relationship name exists\n` +
          `- Confirm you have permission to view related records`
      }],
      isError: true
    };
  }
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Detect entity type from record structure
 * Looks for primary key fields to determine entity type
 */
function detectEntityType(record: any): string {
  const idFields = Object.keys(record);

  // Common entity type patterns
  if (idFields.includes('ContactId')) return 'Contact';
  if (idFields.includes('ramco_associationId')) return 'ramco_association';
  if (idFields.includes('cobalt_membershipid')) return 'cobalt_membership';
  if (idFields.includes('InvoiceId')) return 'Invoice';
  if (idFields.includes('cobalt_meetingid')) return 'cobalt_meeting';
  if (idFields.includes('cobalt_committeeid')) return 'cobalt_committee';

  return 'Unknown';
}

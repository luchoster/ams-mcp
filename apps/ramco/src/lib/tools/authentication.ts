/**
 * Authentication Tools
 *
 * Tools for testing API connectivity and retrieving association information.
 */

import type { ToolHandler, ToolResult } from '../types/mcp';
import type { RamcoClient } from '../ramco-client-v2';
import {
  TestConnectionSchema,
  GetAssociationInfoSchema,
  validateToolInput
} from '../validation/schemas';

// ============================================================================
// test_connection
// ============================================================================

/**
 * Test connection to RAMCO API
 * Validates that the API key is working and can access the RAMCO API
 */
export const testConnection: ToolHandler = async (args, ramcoClient) => {
  // Validate input (empty object for this tool)
  validateToolInput(TestConnectionSchema, args);

  try {
    // Test authentication
    const isAuthenticated = await ramcoClient.authenticate();

    if (isAuthenticated) {
      // Get some basic info to prove connection
      const entityTypes = await ramcoClient.getEntityTypes(5);

      let entityCount = 0;
      if (entityTypes.Data && typeof entityTypes.Data === 'object') {
        entityCount = Object.keys(entityTypes.Data).length;
      }

      return {
        content: [{
          type: 'text',
          text: `✅ Successfully connected to RAMCO API!\n\n` +
            `**Connection Details:**\n` +
            `- API Endpoint: ${ramcoClient.getConfig().baseUrl}\n` +
            `- Authentication: Valid\n` +
            `- Available Entity Types: ${entityCount}\n` +
            `- Timeout: ${ramcoClient.getConfig().timeout}ms\n` +
            `- Cache Enabled: ${ramcoClient.getConfig().cacheEnabled ? 'Yes' : 'No'}\n\n` +
            `Your RAMCO API key is working correctly. You can now use all available tools.`
        }]
      };
    } else {
      return {
        content: [{
          type: 'text',
          text: `❌ Connection failed\n\n` +
            `Unable to connect to RAMCO API. Please check:\n` +
            `- Your API key is correct\n` +
            `- The API key hasn't expired\n` +
            `- You have proper permissions\n` +
            `- Your network connection is working\n\n` +
            `Contact your RAMCO administrator if the problem persists.`
        }],
        isError: true
      };
    }
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: `❌ Connection error: ${error instanceof Error ? error.message : 'Unknown error'}\n\n` +
          `Please check your API key and try again.`
      }],
      isError: true
    };
  }
};

// ============================================================================
// get_association_info
// ============================================================================

/**
 * Get information about associated organizations
 * Can retrieve specific association by ID or list available associations
 */
export const getAssociationInfo: ToolHandler = async (args, ramcoClient, associationId) => {
  // Validate input
  const validatedArgs = validateToolInput(GetAssociationInfoSchema, args);

  // Use provided associationId from args, or fall back to context
  const targetAssociationId = validatedArgs.associationId || associationId;

  try {
    // Build filter for association search
    let filter = 'ramco_type<ne>null'; // Get associations with a type
    let limit = 5; // List mode: show top 5

    if (targetAssociationId) {
      // Specific association mode
      filter = `ramco_associationid<eq>guid'${targetAssociationId}'`;
      limit = 1;
    }

    // Fetch association details
    const associations = await ramcoClient.searchRecords({
      module: 'ramco_association',
      filter,
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
      limit
    });

    if (!associations || associations.length === 0) {
      const message = targetAssociationId
        ? `No association found with ID: ${targetAssociationId}`
        : 'No associations found in the system';

      return {
        content: [{
          type: 'text',
          text: `❓ ${message}\n\n` +
            `This could mean:\n` +
            `- The association ID is incorrect\n` +
            `- You don't have permission to view this association\n` +
            `- The association doesn't exist in RAMCO`
        }],
        isError: false
      };
    }

    // === Single Association Mode ===
    if (targetAssociationId && associations.length === 1) {
      const assoc = associations[0];

      // Try to get member count
      let memberCount = '?';
      let hasMembersCheck = false;
      try {
        const members = await ramcoClient.searchRecords({
          module: 'contact',
          filter: `ramco_primaryassociationid<eq>'${targetAssociationId}' and StatusCode<eq>1`,
          fields: ['ContactId'],
          limit: 10
        });
        memberCount = members?.length > 0 ? `${members.length}+` : '0';
        hasMembersCheck = members?.length > 0;
      } catch {
        // Ignore member count errors
      }

      const result = {
        id: assoc.ramco_associationId,
        name: assoc.ramco_name,
        type: (assoc.ramco_type as any)?.Display || 'Unknown',
        executive: assoc.ramco_executiveofficername || 'Not specified',
        president: assoc.ramco_currentpresident || 'Not specified',
        contact: {
          email: assoc.ramco_emailaddress || 'Not specified',
          phone: assoc.ramco_phone || 'Not specified',
          website: assoc.ramco_website || 'Not specified'
        },
        systemInfo: {
          nrdsId: assoc.ramco_nrdsid || 'N/A',
          created: (assoc.CreatedOn as any)?.Display || assoc.CreatedOn || 'Unknown',
          modified: (assoc.ModifiedOn as any)?.Display || assoc.ModifiedOn || 'Unknown'
        },
        memberCount,
        hasMembers: hasMembersCheck
      };

      return {
        content: [{
          type: 'text',
          text: `# ${result.name}\n\n` +
            `**Type:** ${result.type}\n\n` +
            `## Leadership\n` +
            `- **Executive Officer:** ${result.executive}\n` +
            `- **President:** ${result.president}\n\n` +
            `## Contact Information\n` +
            `- **Email:** ${result.contact.email}\n` +
            `- **Phone:** ${result.contact.phone}\n` +
            `- **Website:** ${result.contact.website}\n\n` +
            `## System Information\n` +
            `- **Association ID:** \`${result.id}\`\n` +
            `- **NRDS ID:** ${result.systemInfo.nrdsId}\n` +
            `- **Created:** ${result.systemInfo.created}\n` +
            `- **Last Modified:** ${result.systemInfo.modified}\n\n` +
            `## Membership\n` +
            `- **Active Members:** ${result.memberCount}\n` +
            `- **Has Members:** ${result.hasMembers ? 'Yes ✅' : 'No ❌'}`
        }]
      };
    }

    // === List Mode: Multiple Associations ===
    const associationList = associations.map((assoc: any) => ({
      id: assoc.ramco_associationId,
      name: assoc.ramco_name,
      type: assoc.ramco_type?.Display || 'Unknown',
      executive: assoc.ramco_executiveofficername || 'N/A',
      email: assoc.ramco_emailaddress || 'N/A',
      phone: assoc.ramco_phone || 'N/A'
    }));

    const listText = associationList.map((assoc, idx) =>
      `### ${idx + 1}. ${assoc.name}\n` +
      `- **Type:** ${assoc.type}\n` +
      `- **Executive:** ${assoc.executive}\n` +
      `- **Email:** ${assoc.email}\n` +
      `- **Phone:** ${assoc.phone}\n` +
      `- **ID:** \`${assoc.id}\`\n`
    ).join('\n');

    return {
      content: [{
        type: 'text',
        text: `# Available Associations (${associationList.length})\n\n` +
          listText +
          `\n\n---\n\n` +
          `**💡 Tip:** To get detailed information about a specific association, ` +
          `use the \`get_association_info\` tool with the association ID.`
      }]
    };

  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: `❌ Failed to retrieve association information\n\n` +
          `**Error:** ${error instanceof Error ? error.message : 'Unknown error'}\n\n` +
          `This could be due to:\n` +
          `- Network connectivity issues\n` +
          `- Insufficient permissions\n` +
          `- Invalid association ID format\n\n` +
          `Please check your inputs and try again.`
      }],
      isError: true
    };
  }
};

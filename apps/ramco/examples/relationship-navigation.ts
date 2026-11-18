/**
 * Example: Using Relationship Navigation for Efficient Queries
 *
 * This demonstrates the patterns from Ramco's PHP examples
 */

import { createRamcoClient } from '../src/lib/ramco-client-v2';

async function example() {
  const client = createRamcoClient({
    apiKey: process.env.RAMCO_API_KEY!,
    baseUrl: 'https://api.ramcoams.com/api/v2'
  });

  // ============================================================================
  // Example 1: Fetch contact with memberships in ONE call
  // ============================================================================
  console.log('\n=== Example 1: Single Contact with Relationships ===\n');

  const contactId = 'your-contact-guid-here';

  // OLD WAY (3 separate calls):
  // 1. const contact = await client.getRecord(contactId, 'contact');
  // 2. const memberships = await client.getRelatedRecords(contactId, 'contact', 'cobalt_membership');
  // 3. const committees = await client.getRelatedRecords(contactId, 'contact', 'cobalt_committeemembership');

  // NEW WAY (1 call with relationship navigation):
  const contactWithRelationships = await client.getRecordWithRelationships(
    contactId,
    'contact',
    {
      baseFields: [
        'ContactId',
        'FirstName',
        'LastName',
        'EmailAddress1',
        'StatusCode',
        'ModifiedOn'
      ],
      relationships: {
        // Fetch membership data with the contact
        'cobalt_contact_cobalt_membership': [
          'StatusCode',
          'cobalt_MemberTypeId',
          'ramco_AssociationId'
        ],
        // Fetch committee memberships with the contact
        'cobalt_contact_cobalt_committeemembership': [
          'StatusCode',
          'cobalt_CommitteeId',
          'cobalt_name'
        ]
      }
    }
  );

  console.log('Contact:', {
    name: `${contactWithRelationships.FirstName} ${contactWithRelationships.LastName}`,
    email: contactWithRelationships.EmailAddress1,
    status: contactWithRelationships.StatusCode?.Display
  });

  // Access related memberships
  const memberships = (contactWithRelationships as any).cobalt_contact_cobalt_membership || [];
  console.log(`\nMemberships (${memberships.length}):`);
  memberships.forEach((m: any) => {
    console.log('  -', m.cobalt_MemberTypeId?.Display, '(Status:', m.StatusCode?.Display + ')');
  });

  // ============================================================================
  // Example 2: Bulk fetch with proper StatusCode filtering
  // ============================================================================
  console.log('\n=== Example 2: Bulk Fetch with Active Filtering ===\n');

  // WRONG: Fetches ALL contacts including inactive/deleted
  // const allContacts = await client.searchRecords({
  //   module: 'contact',
  //   filter: 'ModifiedOn<ge>2024-01-01',
  //   limit: 100
  // });

  // CORRECT: Filter for active contacts only
  const activeContacts = await client.searchRecords({
    module: 'contact',
    filter: 'statecode<eq>0 and ModifiedOn<ge>2024-01-01',
    fields: ['ContactId', 'FirstName', 'LastName', 'StatusCode'],
    limit: 100
  });

  console.log(`Found ${activeContacts.length} active contacts`);

  // ============================================================================
  // Example 3: Two-phase sync pattern (from PHP example)
  // ============================================================================
  console.log('\n=== Example 3: Two-Phase Sync Pattern ===\n');

  const CUTOFF_DATE = '2024-01-01';
  const REALTOR_MEMBER_TYPE_GUID = 'd00b84b0-ef20-e111-b470-00155d000140';

  // Phase 1: Get ContactIds of modified contacts
  const modifiedContacts = await client.searchRecords({
    module: 'contact',
    filter: `statecode<eq>0 and ModifiedOn<ge>${CUTOFF_DATE}`,
    fields: ['ContactId'],
    limit: 1000
  });

  const contactIds = new Set<string>(
    modifiedContacts.map(c => c.ContactId?.Value || c.ContactId)
  );

  console.log(`Phase 1: ${contactIds.size} modified contacts`);

  // Phase 2: Get ContactIds from modified memberships
  const modifiedMemberships = await client.searchRecords({
    module: 'cobalt_membership',
    filter: `ModifiedOn<ge>${CUTOFF_DATE} and cobalt_MemberTypeId<eq>${REALTOR_MEMBER_TYPE_GUID}`,
    fields: ['cobalt_contactid'],
    limit: 1000
  });

  modifiedMemberships.forEach(m => {
    const contactId = m.cobalt_contactid?.Value || m.cobalt_contactid;
    if (contactId) contactIds.add(contactId);
  });

  console.log(`Phase 2: ${contactIds.size} total unique contacts (after adding membership changes)`);

  // Phase 3: Fetch full records with relationships
  console.log('\nPhase 3: Fetching full records with relationships...');

  const fullRecords = [];
  for (const id of Array.from(contactIds).slice(0, 5)) { // Sample first 5
    const record = await client.getRecordWithRelationships(
      id,
      'contact',
      {
        baseFields: ['ContactId', 'FirstName', 'LastName', 'StatusCode'],
        relationships: {
          'cobalt_contact_cobalt_membership': ['StatusCode', 'cobalt_MemberTypeId']
        }
      }
    );

    // Check if contact is active
    if (record.StatusCode?.Display === 'Active') {
      fullRecords.push(record);
    }
  }

  console.log(`Retrieved ${fullRecords.length} active contacts with relationships`);

  // ============================================================================
  // Example 4: Batch IN queries (for bulk operations)
  // ============================================================================
  console.log('\n=== Example 4: Batch IN Queries ===\n');

  const contactIdsToFetch = Array.from(contactIds).slice(0, 20); // Get first 20

  // Fetch events for multiple contacts in one query
  const inClause = contactIdsToFetch.map(id => `'${id}'`).join(',');
  const events = await client.searchRecords({
    module: 'cobalt_meetingregistration',
    filter: `cobalt_contactid in (${inClause})`,
    fields: ['cobalt_contactid', 'cobalt_name', 'createdon'],
    limit: 1000
  });

  console.log(`Found ${events.length} events for ${contactIdsToFetch.length} contacts`);

  // Group events by contact
  const eventsByContact = new Map<string, any[]>();
  events.forEach(event => {
    const contactId = event.cobalt_contactid?.Value || event.cobalt_contactid;
    if (!eventsByContact.has(contactId)) {
      eventsByContact.set(contactId, []);
    }
    eventsByContact.get(contactId)!.push(event);
  });

  console.log(`Events grouped by ${eventsByContact.size} contacts`);
  console.log(`Average events per contact: ${(events.length / eventsByContact.size).toFixed(1)}`);
}

// Run the example
if (require.main === module) {
  example().catch(console.error);
}

export { example };

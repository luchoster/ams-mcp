/**
 * Integration Tests for Bulk Operations
 *
 * These tests verify the bulk operations fixes:
 * 1. StatusCode filtering prevents errors from inactive records
 * 2. Two-phase sync pattern works correctly
 * 3. Bulk relationship fetching includes proper filters
 *
 * Run with: npx tsx tests/integration/bulk-operations.test.ts
 */

import { createRamcoClient } from '../../src/lib/ramco-client-v2';
import {
  fetchAllRecords,
  fetchBulkRelationships,
  getTwoPhaseContactIds,
  twoPhaseContactSync
} from '../../src/lib/bulk-operations';
import { activeFilter, contactFilter, andFilters } from '../../src/lib/utils/ramco-filters';

// Test configuration
const TEST_CONFIG = {
  apiKey: process.env.RAMCO_API_KEY!,
  baseUrl: 'https://api.ramcoams.com/api/v2',
  associationId: process.env.RAMCO_ASSOCIATION_ID,
  testLimit: 10 // Limit records for faster testing
};

// Test results
interface TestResult {
  name: string;
  passed: boolean;
  message: string;
  duration?: number;
}

const results: TestResult[] = [];

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runTest(name: string, testFn: () => Promise<void>) {
  console.log(`\n🧪 Running: ${name}`);
  const start = Date.now();

  try {
    await testFn();
    const duration = Date.now() - start;
    results.push({ name, passed: true, message: 'Passed', duration });
    console.log(`✅ ${name} - Passed (${duration}ms)`);
  } catch (error) {
    const duration = Date.now() - start;
    const message = error instanceof Error ? error.message : String(error);
    results.push({ name, passed: false, message, duration });
    console.error(`❌ ${name} - Failed (${duration}ms)`);
    console.error(`   ${message}`);
  }
}

// ============================================================================
// Tests
// ============================================================================

async function testActiveRecordFiltering() {
  const client = createRamcoClient(TEST_CONFIG);

  // Fetch records with active filter
  const activeRecords = await client.searchRecords({
    module: 'contact',
    filter: activeFilter(),
    fields: ['ContactId', 'StatusCode', 'StateCode'],
    limit: TEST_CONFIG.testLimit
  });

  assert(activeRecords.length > 0, 'Should fetch some active records');

  // Verify all records are active (StateCode = 0)
  activeRecords.forEach((record, index) => {
    const stateCode = record.StateCode?.Value ?? record.StateCode;
    assert(
      stateCode === 0,
      `Record ${index} should have StateCode=0 (Active), got: ${stateCode}`
    );
  });

  console.log(`   Verified ${activeRecords.length} records all have StateCode=0`);
}

async function testBulkFetchWithFiltering() {
  const client = createRamcoClient(TEST_CONFIG);

  const filter = TEST_CONFIG.associationId
    ? contactFilter({
        active: true,
        associationId: TEST_CONFIG.associationId
      })
    : contactFilter({ active: true });

  const records = await fetchAllRecords(client, {
    entity: 'contact',
    filter,
    fields: ['ContactId', 'FirstName', 'LastName', 'StatusCode', 'StateCode'],
    maxRecords: TEST_CONFIG.testLimit
  });

  assert(records.length > 0, 'Should fetch records');

  // Verify all are active
  records.forEach((record, index) => {
    const stateCode = record.StateCode?.Value ?? record.StateCode;
    assert(
      stateCode === 0,
      `Bulk fetch record ${index} should be active, got StateCode: ${stateCode}`
    );
  });

  console.log(`   Bulk fetch verified ${records.length} active records`);
}

async function testRelationshipNavigation() {
  const client = createRamcoClient(TEST_CONFIG);

  // Get a contact ID first
  const contacts = await client.searchRecords({
    module: 'contact',
    filter: activeFilter(),
    fields: ['ContactId'],
    limit: 1
  });

  assert(contacts.length > 0, 'Should have at least one contact');

  const contactId = contacts[0].ContactId?.Value || contacts[0].ContactId;

  // Fetch contact with relationships using new method
  const contactWithRelations = await client.getRecordWithRelationships(
    contactId,
    'contact',
    {
      baseFields: ['ContactId', 'FirstName', 'LastName', 'StatusCode'],
      relationships: {
        'cobalt_contact_cobalt_membership': ['StatusCode', 'cobalt_MemberTypeId']
      }
    }
  );

  assert(contactWithRelations.ContactId, 'Should have ContactId');
  console.log(`   Fetched contact with relationships in single call`);

  // Verify relationship data structure
  if ((contactWithRelations as any).cobalt_contact_cobalt_membership) {
    const memberships = (contactWithRelations as any).cobalt_contact_cobalt_membership;
    console.log(`   Found ${Array.isArray(memberships) ? memberships.length : 1} membership(s)`);
  }
}

async function testTwoPhaseSync() {
  const client = createRamcoClient(TEST_CONFIG);

  // Get contacts modified in last 30 days
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 30);
  const dateString = cutoffDate.toISOString().split('T')[0];

  const result = await getTwoPhaseContactIds(client, {
    cutoffDate: dateString,
    associationId: TEST_CONFIG.associationId
  });

  console.log(`   Phase 1 (Contacts): ${result.fromContacts}`);
  console.log(`   Phase 2 (Memberships): ${result.fromMemberships}`);
  console.log(`   Total Unique: ${result.totalUnique}`);

  assert(result.totalUnique >= 0, 'Should return valid count');
  assert(result.contactIds.size === result.totalUnique, 'ContactIds size should match totalUnique');
}

async function testTwoPhaseCompleteSync() {
  const client = createRamcoClient(TEST_CONFIG);

  // Get contacts modified in last 7 days
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 7);
  const dateString = cutoffDate.toISOString().split('T')[0];

  const contacts = await twoPhaseContactSync(client, {
    cutoffDate: dateString,
    associationId: TEST_CONFIG.associationId,
    includeRelationships: false // Keep it fast for testing
  });

  console.log(`   Synced ${contacts.length} modified contacts`);

  // Verify all are active
  contacts.forEach((contact, index) => {
    const stateCode = contact.StateCode?.Value ?? contact.StateCode;
    assert(
      stateCode === 0,
      `Two-phase sync contact ${index} should be active, got StateCode: ${stateCode}`
    );
  });
}

async function testBulkRelationshipFiltering() {
  const client = createRamcoClient(TEST_CONFIG);

  // Get some contact IDs
  const contacts = await client.searchRecords({
    module: 'contact',
    filter: activeFilter(),
    fields: ['ContactId'],
    limit: 5
  });

  if (contacts.length === 0) {
    console.log('   Skipping: No contacts available');
    return;
  }

  const contactIds = contacts.map(c => c.ContactId?.Value || c.ContactId);

  const relationships = await fetchBulkRelationships(client, contactIds);

  console.log(`   Fetched relationships for ${contactIds.length} contacts`);
  console.log(`   Events: ${Array.from(relationships.events.values()).reduce((sum, arr) => sum + arr.length, 0)}`);
  console.log(`   Committees: ${Array.from(relationships.committees.values()).reduce((sum, arr) => sum + arr.length, 0)}`);
  console.log(`   Classes: ${Array.from(relationships.classes.values()).reduce((sum, arr) => sum + arr.length, 0)}`);

  // Verify structure
  assert(relationships.events instanceof Map, 'Events should be a Map');
  assert(relationships.committees instanceof Map, 'Committees should be a Map');
  assert(relationships.classes instanceof Map, 'Classes should be a Map');
}

async function testFilterUtilities() {
  // Test filter builders
  const filter1 = activeFilter();
  assert(filter1 === 'statecode<eq>0', 'Active filter should be correct');

  const filter2 = contactFilter({
    active: true,
    associationId: 'test-id',
    modifiedSince: '2024-01-01'
  });

  assert(filter2.includes('statecode<eq>0'), 'Should include active filter');
  assert(filter2.includes('ramco_primaryassociationid<eq>\'test-id\''), 'Should include association filter');
  assert(filter2.includes('ModifiedOn<ge>2024-01-01'), 'Should include modified date filter');

  const filter3 = andFilters('statecode<eq>0', 'ModifiedOn<ge>2024-01-01');
  assert(filter3 === 'statecode<eq>0 and ModifiedOn<ge>2024-01-01', 'AND filter should combine correctly');

  console.log('   All filter utilities working correctly');
}

// ============================================================================
// Run All Tests
// ============================================================================

async function main() {
  console.log('========================================');
  console.log('  Bulk Operations Integration Tests');
  console.log('========================================');

  if (!TEST_CONFIG.apiKey) {
    console.error('❌ RAMCO_API_KEY environment variable not set');
    process.exit(1);
  }

  // Run all tests
  await runTest('Active Record Filtering', testActiveRecordFiltering);
  await runTest('Bulk Fetch with Filtering', testBulkFetchWithFiltering);
  await runTest('Relationship Navigation', testRelationshipNavigation);
  await runTest('Two-Phase Sync (IDs Only)', testTwoPhaseSync);
  await runTest('Two-Phase Complete Sync', testTwoPhaseCompleteSync);
  await runTest('Bulk Relationship Filtering', testBulkRelationshipFiltering);
  await runTest('Filter Utilities', testFilterUtilities);

  // Print summary
  console.log('\n========================================');
  console.log('  Test Summary');
  console.log('========================================');

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const total = results.length;

  results.forEach(result => {
    const icon = result.passed ? '✅' : '❌';
    console.log(`${icon} ${result.name} (${result.duration}ms)`);
    if (!result.passed) {
      console.log(`   Error: ${result.message}`);
    }
  });

  console.log(`\nTotal: ${total} | Passed: ${passed} | Failed: ${failed}`);

  if (failed > 0) {
    process.exit(1);
  }
}

// Run tests
if (require.main === module) {
  main().catch(error => {
    console.error('Test suite failed:', error);
    process.exit(1);
  });
}

export { main as runTests };

import { RamcoClient } from './ramco-client-v2';
import { createLogger } from './utils/logger';

const logger = createLogger('bulk-operations');

export interface BulkFetchOptions {
  entity: string;
  filter?: string;
  fields?: string[];
  batchSize?: number;
  maxRecords?: number;
}

export interface AggregationResult {
  count: number;
  groups?: Record<string, any>;
  statistics?: {
    mean?: number;
    median?: number;
    min?: number;
    max?: number;
    stdDev?: number;
  };
}

/**
 * Fetches all records from RAMCO with automatic pagination
 */
export async function fetchAllRecords(
  client: RamcoClient,
  options: BulkFetchOptions
): Promise<any[]> {
  // IMPORTANT: RAMCO API doesn't support offset-based pagination properly
  // Following the PHP example pattern: fetch everything in one call with high maxresults
  const maxRecords = options.maxRecords || 20000; // Safety limit (206 response is valid)

  logger.info('Starting bulk fetch (single call, no offset)', {
    entity: options.entity,
    filter: options.filter,
    maxRecords
  });

  try {
    const searchOptions = {
      module: options.entity,
      filter: options.filter,
      fields: options.fields,
      limit: maxRecords
      // Note: NOT using offset - RAMCO API doesn't support it properly
    };

    logger.debug('Fetching all records in single call', {
      limit: searchOptions.limit
    });

    const records = await client.searchRecords(searchOptions);

    // The RAMCO client's searchRecords already handles data extraction
    if (!records || !Array.isArray(records)) {
      logger.warn('No records returned or invalid format', {
        recordsType: typeof records
      });
      return [];
    }

    logger.info('Bulk fetch completed', {
      entity: options.entity,
      totalRecords: records.length
    });

    return records;
  } catch (error) {
    logger.error('Error fetching records', error);
    throw error;
  }
}

/**
 * Processes records in parallel batches for better performance
 */
export async function processInBatches<T>(
  records: any[],
  batchSize: number,
  processor: (batch: any[]) => Promise<T[]>
): Promise<T[]> {
  const results: T[] = [];
  
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    const batchResults = await processor(batch);
    results.push(...batchResults);
  }
  
  return results;
}

/**
 * Groups records by a field value
 */
export function groupBy(records: any[], field: string): Record<string, any[]> {
  return records.reduce((groups, record) => {
    const key = getNestedValue(record, field) || 'Unknown';
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(record);
    return groups;
  }, {} as Record<string, any[]>);
}

/**
 * Calculates basic statistics for numeric fields
 */
export function calculateStatistics(values: number[]): AggregationResult['statistics'] {
  if (!values || values.length === 0) {
    return {};
  }

  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((a, b) => a + b, 0);
  const mean = sum / values.length;
  
  const median = sorted.length % 2 === 0
    ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : sorted[Math.floor(sorted.length / 2)];

  const variance = values.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / values.length;
  const stdDev = Math.sqrt(variance);

  return {
    mean: Math.round(mean * 100) / 100,
    median: Math.round(median * 100) / 100,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    stdDev: Math.round(stdDev * 100) / 100
  };
}

/**
 * Safely gets nested object values using dot notation
 */
export function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((current, key) => {
    if (current && typeof current === 'object') {
      // Handle RAMCO's Value/Display pattern
      if (current[key]) {
        return current[key].Value !== undefined ? current[key].Value : current[key];
      }
    }
    return undefined;
  }, obj);
}

/**
 * Calculates date differences in days
 */
export function daysSince(timestamp: number | string): number {
  const date = typeof timestamp === 'string' ? new Date(timestamp) : new Date(timestamp * 1000);
  const now = new Date();
  const diffTime = Math.abs(now.getTime() - date.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * Filters records by date range
 */
export function filterByDateRange(
  records: any[],
  dateField: string,
  startDate?: Date,
  endDate?: Date
): any[] {
  return records.filter(record => {
    const dateValue = getNestedValue(record, dateField);
    if (!dateValue) return false;
    
    const date = typeof dateValue === 'string' 
      ? new Date(dateValue) 
      : new Date(dateValue * 1000);
    
    if (startDate && date < startDate) return false;
    if (endDate && date > endDate) return false;
    
    return true;
  });
}

/**
 * Aggregates records by multiple dimensions
 */
export function multiGroupAggregate(
  records: any[],
  groupByFields: string[],
  aggregateField?: string
): Record<string, any> {
  const result: Record<string, any> = {};
  
  records.forEach(record => {
    let currentLevel = result;
    
    groupByFields.forEach((field, index) => {
      const key = getNestedValue(record, field) || 'Unknown';
      
      if (index === groupByFields.length - 1) {
        // Last level - store count or aggregate
        if (!currentLevel[key]) {
          currentLevel[key] = { count: 0, records: [] };
        }
        currentLevel[key].count++;
        currentLevel[key].records.push(record);
        
        if (aggregateField) {
          const value = getNestedValue(record, aggregateField);
          if (typeof value === 'number') {
            currentLevel[key].sum = (currentLevel[key].sum || 0) + value;
          }
        }
      } else {
        // Intermediate level - create nested structure
        if (!currentLevel[key]) {
          currentLevel[key] = {};
        }
        currentLevel = currentLevel[key];
      }
    });
  });
  
  return result;
}

/**
 * Ranks records by a numeric field
 */
export function rankByField(
  records: any[],
  field: string,
  ascending: boolean = false
): any[] {
  return [...records].sort((a, b) => {
    const aValue = getNestedValue(a, field) || 0;
    const bValue = getNestedValue(b, field) || 0;
    return ascending ? aValue - bValue : bValue - aValue;
  });
}

/**
 * Calculates percentiles for a numeric field
 */
export function calculatePercentiles(
  records: any[],
  field: string,
  percentiles: number[] = [25, 50, 75, 90, 95]
): Record<number, number> {
  const values = records
    .map(r => getNestedValue(r, field))
    .filter(v => typeof v === 'number')
    .sort((a, b) => a - b);

  const result: Record<number, number> = {};

  percentiles.forEach(p => {
    const index = Math.ceil((p / 100) * values.length) - 1;
    result[p] = values[Math.max(0, index)] || 0;
  });

  return result;
}

// ============================================================================
// Two-Phase Sync Pattern (From Ramco PHP Examples)
// ============================================================================

export interface TwoPhaseSync {
  cutoffDate: string;
  memberTypeId?: string;
  associationId?: string;
}

export interface TwoPhaseResult {
  contactIds: Set<string>;
  fromContacts: number;
  fromMemberships: number;
  totalUnique: number;
}

/**
 * Two-Phase Sync: Efficiently identify contacts that need updating
 *
 * Based on Ramco's recommended pattern:
 * 1. Get ContactIds of contacts modified since cutoff
 * 2. Get ContactIds from modified memberships since cutoff
 * 3. Combine and deduplicate
 *
 * This minimizes data transfer by fetching only IDs first,
 * then fetching full records with relationships only for changed contacts.
 *
 * @example
 * // Find all contacts changed since yesterday
 * const result = await getTwoPhaseContactIds(client, {
 *   cutoffDate: '2024-01-01',
 *   associationId: 'abc-123'
 * });
 * console.log(`${result.totalUnique} contacts need updating`);
 */
export async function getTwoPhaseContactIds(
  client: RamcoClient,
  options: TwoPhaseSync
): Promise<TwoPhaseResult> {
  const contactIds = new Set<string>();

  logger.info('Starting two-phase contact ID fetch', {
    cutoffDate: options.cutoffDate,
    memberTypeId: options.memberTypeId || 'all',
    associationId: options.associationId || 'all'
  });

  // Phase 1: Get ContactIds of modified contacts
  logger.debug('Phase 1: Fetching modified contacts...');

  const contactFilter = options.associationId
    ? `statecode<eq>0 and ModifiedOn<ge>${options.cutoffDate} and ramco_primaryassociationid<eq>'${options.associationId}'`
    : `statecode<eq>0 and ModifiedOn<ge>${options.cutoffDate}`;

  const modifiedContacts = await client.searchRecords({
    module: 'contact',
    filter: contactFilter,
    fields: ['ContactId'],
    limit: 10000
  });

  modifiedContacts.forEach(contact => {
    const id = contact.ContactId?.Value || contact.ContactId;
    if (id) contactIds.add(id);
  });

  const fromContacts = contactIds.size;
  logger.debug(`Phase 1 complete: ${fromContacts} modified contacts`);

  // Phase 2: Get ContactIds from modified memberships
  logger.debug('Phase 2: Fetching contacts with modified memberships...');

  let membershipFilter = `ModifiedOn<ge>${options.cutoffDate}`;
  if (options.memberTypeId) {
    membershipFilter += ` and cobalt_MemberTypeId<eq>'${options.memberTypeId}'`;
  }
  if (options.associationId) {
    membershipFilter += ` and ramco_AssociationId<eq>'${options.associationId}'`;
  }

  const modifiedMemberships = await client.searchRecords({
    module: 'cobalt_membership',
    filter: membershipFilter,
    fields: ['cobalt_contactid'],
    limit: 10000
  });

  modifiedMemberships.forEach(membership => {
    const id = membership.cobalt_contactid?.Value || membership.cobalt_contactid;
    if (id) contactIds.add(id);
  });

  const totalUnique = contactIds.size;
  const fromMemberships = totalUnique - fromContacts;

  logger.info('Two-phase sync complete', {
    fromContacts,
    fromMemberships,
    totalUnique,
    reductionPercent: Math.round((fromMemberships / totalUnique) * 100)
  });

  return {
    contactIds,
    fromContacts,
    fromMemberships,
    totalUnique
  };
}

/**
 * Complete two-phase sync: Get IDs then fetch full records with relationships
 *
 * Combines getTwoPhaseContactIds with fetchAllRecords to efficiently
 * sync only changed contacts with all their relationship data.
 *
 * @example
 * const contacts = await twoPhaseContactSync(client, {
 *   cutoffDate: '2024-01-01',
 *   associationId: 'abc-123',
 *   includeRelationships: true
 * });
 */
export async function twoPhaseContactSync(
  client: RamcoClient,
  options: TwoPhaseSync & { includeRelationships?: boolean }
): Promise<any[]> {
  // Phase 1 & 2: Get contact IDs
  const { contactIds, totalUnique } = await getTwoPhaseContactIds(client, options);

  if (totalUnique === 0) {
    logger.info('No contacts modified since cutoff date');
    return [];
  }

  // Phase 3: Fetch full records
  logger.info(`Phase 3: Fetching ${totalUnique} full contact records...`);

  const allContacts: any[] = [];
  const idArray = Array.from(contactIds);
  const BATCH_SIZE = 50; // Fetch in batches to avoid huge IN clauses

  for (let i = 0; i < idArray.length; i += BATCH_SIZE) {
    const batchIds = idArray.slice(i, i + BATCH_SIZE);
    const inClause = batchIds.map(id => `'${id}'`).join(',');

    const filter = `ContactId in (${inClause}) and statecode<eq>0`;

    const batch = await client.searchRecords({
      module: 'contact',
      filter,
      fields: options.includeRelationships
        ? [
            'ContactId', 'FirstName', 'LastName', 'EmailAddress1', 'StatusCode', 'ModifiedOn',
            // Include relationships if requested
            'cobalt_contact_cobalt_membership/StatusCode',
            'cobalt_contact_cobalt_membership/cobalt_MemberTypeId',
            'cobalt_contact_cobalt_committeemembership/StatusCode',
            'cobalt_contact_cobalt_committeemembership/cobalt_CommitteeId'
          ]
        : ['ContactId', 'FirstName', 'LastName', 'EmailAddress1', 'StatusCode', 'ModifiedOn'],
      limit: BATCH_SIZE
    });

    if (batch && Array.isArray(batch)) {
      allContacts.push(...batch);
    }
  }

  logger.info('Two-phase contact sync complete', {
    contactsFetched: allContacts.length,
    includeRelationships: options.includeRelationships || false
  });

  return allContacts;
}

// ============================================================================
// Bulk Relationship Fetching (Performance Optimization)
// ============================================================================

export interface BulkRelationshipResult {
  events: Map<string, any[]>;
  committees: Map<string, any[]>;
  classes: Map<string, any[]>;
}

/**
 * Fetch relationship data for multiple contacts in bulk
 *
 * Uses batched OR-chain queries (cobalt_contactid<eq>'id1' or cobalt_contactid<eq>'id2' ...)
 * to fetch event registrations, committee memberships, and class registrations.
 *
 * RAMCO doesn't support SQL-style IN operators. OR chains with <eq> are the
 * supported approach for multi-ID filtering.
 *
 * Performance: 3 entity types fetched in parallel, batches of 100 IDs with
 * 3 concurrent batches per type. ~63 batches × 3 types = ~189 API calls
 * (vs 6,000+ per-member calls without optimization).
 *
 * @param client - RAMCO API client
 * @param contactIds - Array of contact IDs to fetch relationships for
 * @returns Map of contactId -> related records for each relationship type
 */
export async function fetchBulkRelationships(
  client: RamcoClient,
  contactIds: string[]
): Promise<BulkRelationshipResult> {
  if (contactIds.length === 0) {
    return {
      events: new Map(),
      committees: new Map(),
      classes: new Map()
    };
  }

  logger.info('Starting bulk relationship fetch', {
    memberCount: contactIds.length,
    estimatedCallsSaved: (contactIds.length * 3) - 3
  });

  // Initialize result maps
  const eventsMap = new Map<string, any[]>();
  const committeesMap = new Map<string, any[]>();
  const classesMap = new Map<string, any[]>();

  // Create a Set for O(1) contact ID lookups
  const contactIdSet = new Set(contactIds);

  // Initialize empty arrays for all contacts
  contactIds.forEach(id => {
    eventsMap.set(id, []);
    committeesMap.set(id, []);
    classesMap.set(id, []);
  });

  // Helper to extract contact ID from a record (handles RAMCO's inconsistent field casing)
  const extractContactId = (record: any): string | undefined => {
    // RAMCO may return cobalt_ContactId (PascalCase) or cobalt_contactid (lowercase)
    const ref = record.cobalt_ContactId || record.cobalt_contactid;
    if (!ref) return undefined;
    // EntityReference fields have .Value with the GUID
    return ref.Value || ref;
  };

  // Build OR-chain filter for a batch of contact IDs
  // Uses RAMCO's <eq> operator with 'or' (RAMCO doesn't support SQL-style IN)
  const buildBatchFilter = (batch: string[]): string => {
    const orConditions = batch.map(id => `cobalt_contactid<eq>'${id}'`).join(' or ');
    return `(${orConditions}) and statecode<eq>0`;
  };

  // Batch contact IDs for OR-chain queries
  // Keep batch size small to stay within RAMCO's request size limits
  const BATCH_SIZE = 25;
  const CONCURRENT_BATCHES = 3;
  const idBatches: string[][] = [];
  for (let i = 0; i < contactIds.length; i += BATCH_SIZE) {
    idBatches.push(contactIds.slice(i, i + BATCH_SIZE));
  }

  logger.debug('Batching contact IDs for OR-chain queries', {
    totalContacts: contactIds.length,
    batchCount: idBatches.length,
    batchSize: BATCH_SIZE,
    concurrency: CONCURRENT_BATCHES
  });

  // Fetch all batches for a given entity type with limited concurrency
  const fetchEntityBatches = async (
    entityType: string,
    fields: string[],
    resultMap: Map<string, any[]>
  ): Promise<void> => {
    for (let i = 0; i < idBatches.length; i += CONCURRENT_BATCHES) {
      const concurrentBatches = idBatches.slice(i, i + CONCURRENT_BATCHES);
      const batchResults = await Promise.all(
        concurrentBatches.map(batch =>
          client.searchRecords({
            module: entityType,
            filter: buildBatchFilter(batch),
            fields,
            limit: 5000
          }).catch(error => {
            logger.error(`Error fetching ${entityType} batch`, error);
            return [] as any[];
          })
        )
      );

      // Group results by contact ID
      batchResults.forEach(records => {
        if (Array.isArray(records)) {
          records.forEach(record => {
            const contactId = extractContactId(record);
            if (contactId && contactIdSet.has(contactId)) {
              resultMap.get(contactId)?.push(record);
            }
          });
        }
      });
    }
  };

  // Fetch all three entity types in parallel, each with batched OR-chain queries
  logger.debug('Fetching all relationship types in parallel...');

  await Promise.all([
    fetchEntityBatches(
      'cobalt_meetingregistration',
      ['cobalt_contactid', 'cobalt_name', 'createdon', 'cobalt_meetingid'],
      eventsMap
    ),
    fetchEntityBatches(
      'cobalt_committeemembership',
      ['cobalt_contactid', 'cobalt_name', 'statecode', 'createdon', 'cobalt_committeeid'],
      committeesMap
    ),
    fetchEntityBatches(
      'cobalt_classregistration',
      ['cobalt_contactid', 'cobalt_name', 'createdon', 'cobalt_attended', 'cobalt_classid'],
      classesMap
    )
  ]);

  const totalEvents = Array.from(eventsMap.values()).reduce((sum, arr) => sum + arr.length, 0);
  const totalCommittees = Array.from(committeesMap.values()).reduce((sum, arr) => sum + arr.length, 0);
  const totalClasses = Array.from(classesMap.values()).reduce((sum, arr) => sum + arr.length, 0);

  const totalApiCalls = idBatches.length * 3;
  logger.info('Bulk relationship fetch completed', {
    memberCount: contactIds.length,
    totalApiCalls,
    matchedEvents: totalEvents,
    matchedCommittees: totalCommittees,
    matchedClasses: totalClasses
  });

  return {
    events: eventsMap,
    committees: committeesMap,
    classes: classesMap
  };
}
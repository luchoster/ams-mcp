/**
 * RAMCO Filter Builder Utilities
 *
 * Helper functions for building proper RAMCO API filters
 * Based on patterns from Ramco developer examples
 */

/**
 * Filter operators supported by RAMCO API
 */
export const FilterOperators = {
  EQUALS: '<eq>',
  NOT_EQUALS: '<ne>',
  GREATER_THAN: '<gt>',
  GREATER_THAN_OR_EQUAL: '<ge>',
  LESS_THAN: '<lt>',
  LESS_THAN_OR_EQUAL: '<le>',
  IN: 'in',
  NOT_IN: 'not in',
  CONTAINS: '<contains>',
  STARTS_WITH: '<startswith>',
  ENDS_WITH: '<endswith>'
} as const;

/**
 * Common RAMCO field values
 */
export const RamcoStateCode = {
  ACTIVE: 0,
  INACTIVE: 1
} as const;

export const RamcoStatusCode = {
  ACTIVE: 1,
  INACTIVE: 2
} as const;

/**
 * Build a filter condition
 */
export function buildFilter(field: string, operator: string, value: string | number | boolean): string {
  // Handle IN operator specially
  if (operator === FilterOperators.IN || operator === FilterOperators.NOT_IN) {
    return `${field} ${operator} (${value})`;
  }

  // Quote string values
  const formattedValue = typeof value === 'string' ? `'${value}'` : value;
  return `${field}${operator}${formattedValue}`;
}

/**
 * Combine multiple filter conditions with AND
 */
export function andFilters(...filters: (string | null | undefined)[]): string {
  const validFilters = filters.filter(f => f && f.trim().length > 0);
  return validFilters.join(' and ');
}

/**
 * Combine multiple filter conditions with OR
 */
export function orFilters(...filters: (string | null | undefined)[]): string {
  const validFilters = filters.filter(f => f && f.trim().length > 0);
  return `(${validFilters.join(' or ')})`;
}

/**
 * Build an IN clause for multiple values
 */
export function inFilter(field: string, values: string[]): string {
  const quotedValues = values.map(v => `'${v}'`).join(',');
  return `${field} in (${quotedValues})`;
}

/**
 * Build a filter for active records only
 */
export function activeFilter(): string {
  return buildFilter('statecode', FilterOperators.EQUALS, RamcoStateCode.ACTIVE);
}

/**
 * Build a filter for modified since a date
 */
export function modifiedSinceFilter(date: string): string {
  return buildFilter('ModifiedOn', FilterOperators.GREATER_THAN_OR_EQUAL, date);
}

/**
 * Build a filter for created since a date
 */
export function createdSinceFilter(date: string): string {
  return buildFilter('CreatedOn', FilterOperators.GREATER_THAN_OR_EQUAL, date);
}

/**
 * Build a comprehensive contact filter with common criteria
 */
export function contactFilter(options: {
  active?: boolean;
  associationId?: string;
  modifiedSince?: string;
  createdSince?: string;
  additionalFilters?: string[];
}): string {
  const filters: string[] = [];

  // Always include active filter by default
  if (options.active !== false) {
    filters.push(activeFilter());
  }

  if (options.associationId) {
    filters.push(buildFilter('ramco_primaryassociationid', FilterOperators.EQUALS, options.associationId));
  }

  if (options.modifiedSince) {
    filters.push(modifiedSinceFilter(options.modifiedSince));
  }

  if (options.createdSince) {
    filters.push(createdSinceFilter(options.createdSince));
  }

  if (options.additionalFilters) {
    filters.push(...options.additionalFilters);
  }

  return andFilters(...filters);
}

/**
 * Build relationship attribute paths for fetching related data
 */
export function relationshipPath(relationshipName: string, field: string): string {
  return `${relationshipName}/${field}`;
}

/**
 * Build multiple relationship paths
 */
export function relationshipPaths(relationshipName: string, fields: string[]): string[] {
  return fields.map(field => relationshipPath(relationshipName, field));
}

// ============================================================================
// Common Filter Templates
// ============================================================================

/**
 * Get all active contacts modified in last N days
 */
export function recentlyModifiedContactsFilter(days: number, associationId?: string): string {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  const dateString = cutoffDate.toISOString().split('T')[0];

  return contactFilter({
    active: true,
    modifiedSince: dateString,
    associationId
  });
}

/**
 * Get contacts with specific member type
 */
export function memberTypeFilter(memberTypeGuid: string, associationId?: string): string {
  // Note: This requires querying memberships and then getting contacts
  // Can't directly filter contacts by membership type
  return andFilters(
    activeFilter(),
    buildFilter('cobalt_MemberTypeId', FilterOperators.EQUALS, memberTypeGuid),
    associationId ? buildFilter('ramco_AssociationId', FilterOperators.EQUALS, associationId) : null
  );
}

/**
 * Common membership relationship attributes
 */
export const MEMBERSHIP_RELATIONSHIP_FIELDS = [
  'StatusCode',
  'StateCode',
  'cobalt_MemberTypeId',
  'ramco_AssociationId',
  'cobalt_JoinDate',
  'cobalt_TerminationDate',
  'ModifiedOn'
];

/**
 * Common committee relationship attributes
 */
export const COMMITTEE_RELATIONSHIP_FIELDS = [
  'StatusCode',
  'StateCode',
  'cobalt_CommitteeId',
  'cobalt_name',
  'cobalt_StartDate',
  'cobalt_EndDate'
];

/**
 * Common event registration relationship attributes
 */
export const EVENT_RELATIONSHIP_FIELDS = [
  'cobalt_MeetingId',
  'cobalt_name',
  'cobalt_RegistrationDate',
  'StatusCode'
];

/**
 * Build full contact query with all relationships
 */
export function fullContactAttributes(): string[] {
  const baseFields = [
    'ContactId',
    'FirstName',
    'LastName',
    'EmailAddress1',
    'MobilePhone',
    'StatusCode',
    'StateCode',
    'CreatedOn',
    'ModifiedOn',
    'ramco_nrdsid',
    'ramco_primaryassociationid'
  ];

  const relationships = [
    ...relationshipPaths('cobalt_contact_cobalt_membership', MEMBERSHIP_RELATIONSHIP_FIELDS),
    ...relationshipPaths('cobalt_contact_cobalt_committeemembership', COMMITTEE_RELATIONSHIP_FIELDS),
    ...relationshipPaths('cobalt_contact_cobalt_meetingregistration', EVENT_RELATIONSHIP_FIELDS)
  ];

  return [...baseFields, ...relationships];
}

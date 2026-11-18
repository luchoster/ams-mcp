/**
 * RAMCO API Type Definitions
 *
 * Comprehensive type definitions for RAMCO API responses and entities.
 * Based on RAMCO API v2 structure.
 */

// ============================================================================
// Base Field Value Types
// ============================================================================

/**
 * DateTime field format from RAMCO
 * Contains both Unix timestamp and formatted display string
 */
export interface RamcoDateTime {
  Value: number;        // Unix timestamp (seconds since epoch)
  Display: string;      // Formatted date string (e.g., "2024-01-15")
}

/**
 * OptionSet field format (picklists/dropdowns)
 * Contains both the internal value and display label
 */
export interface RamcoOptionSet {
  Value: number;        // Internal numeric value
  Display: string;      // User-friendly display label
}

/**
 * EntityReference field format (lookups to other entities)
 * Used for relationships between entities
 */
export interface RamcoEntityReference {
  Id: string;           // GUID of the referenced record
  LogicalName: string;  // Entity type name (e.g., 'contact', 'account')
  Name?: string;        // Display name of the referenced record
}

/**
 * Money/Currency field format
 * Contains both numeric value and formatted display string
 */
export interface RamcoMoney {
  Value: number;        // Numeric amount
  Display: string;      // Formatted currency string (e.g., "$1,234.56")
}

/**
 * Boolean field format
 * Contains both boolean value and display string
 */
export interface RamcoBoolean {
  Value: boolean;
  Display: string;      // "Yes" or "No"
}

/**
 * Union type for all possible RAMCO field values
 * Fields can be primitives or complex objects depending on type
 */
export type RamcoFieldValue =
  | string
  | number
  | boolean
  | RamcoDateTime
  | RamcoOptionSet
  | RamcoEntityReference
  | RamcoMoney
  | RamcoBoolean
  | null
  | undefined;

// ============================================================================
// Core Entity Types
// ============================================================================

/**
 * Contact entity (individual people)
 * Core CRM entity for managing people
 */
export interface RamcoContact {
  // Primary key
  ContactId: string;

  // Basic info
  FirstName?: string;
  LastName?: string;
  FullName?: string;
  EmailAddress1?: string;
  EmailAddress2?: string;
  EmailAddress3?: string;
  Telephone1?: string;
  Telephone2?: string;
  MobilePhone?: string;

  // Status
  StatusCode?: RamcoOptionSet;
  StateCode?: RamcoOptionSet;

  // Timestamps
  CreatedOn?: RamcoDateTime;
  ModifiedOn?: RamcoDateTime;

  // Association membership
  ramco_primaryassociationid?: string | RamcoEntityReference;
  cobalt_membertypeid?: RamcoEntityReference;
  cobalt_chapterid?: RamcoEntityReference;
  cobalt_renewaldate?: RamcoDateTime;

  // RAMCO specific
  cobalt_nrdsid?: string;
  cobalt_username?: string;

  // Address fields
  Address1_Line1?: string;
  Address1_Line2?: string;
  Address1_City?: string;
  Address1_StateOrProvince?: string;
  Address1_PostalCode?: string;
  Address1_Country?: string;
  Address1_County?: string;

  // Allow any other fields dynamically
  [key: string]: RamcoFieldValue;
}

/**
 * Association entity (organizations managing members)
 */
export interface RamcoAssociation {
  ramco_associationId: string;
  ramco_name: string;
  ramco_type?: RamcoOptionSet;
  ramco_website?: string;
  ramco_emailaddress?: string;
  ramco_phone?: string;
  ramco_currentpresident?: string;
  ramco_executiveofficername?: string;
  ramco_nrdsid?: string;
  CreatedOn?: RamcoDateTime;
  ModifiedOn?: RamcoDateTime;
  [key: string]: RamcoFieldValue;
}

/**
 * Membership entity (member records)
 */
export interface RamcoMembership {
  cobalt_membershipid: string;
  cobalt_contactid?: RamcoEntityReference;
  cobalt_membertypeid?: RamcoEntityReference;
  cobalt_status?: RamcoOptionSet;
  cobalt_startdate?: RamcoDateTime;
  cobalt_enddate?: RamcoDateTime;
  cobalt_renewaldate?: RamcoDateTime;
  statuscode?: RamcoOptionSet;
  statecode?: RamcoOptionSet;
  CreatedOn?: RamcoDateTime;
  ModifiedOn?: RamcoDateTime;
  [key: string]: RamcoFieldValue;
}

/**
 * Invoice entity (billing)
 */
export interface RamcoInvoice {
  InvoiceId: string;
  ContactId?: RamcoEntityReference;
  TotalAmount?: RamcoMoney;
  AmountDue?: RamcoMoney;
  DueDate?: RamcoDateTime;
  StatusCode?: RamcoOptionSet;
  CreatedOn?: RamcoDateTime;
  ModifiedOn?: RamcoDateTime;
  [key: string]: RamcoFieldValue;
}

/**
 * Payment entity
 */
export interface RamcoPayment {
  cobalt_paymentid: string;
  cobalt_contactid?: RamcoEntityReference;
  cobalt_amount?: RamcoMoney;
  cobalt_paymentdate?: RamcoDateTime;
  CreatedOn?: RamcoDateTime;
  [key: string]: RamcoFieldValue;
}

/**
 * Meeting/Event entity
 */
export interface RamcoMeeting {
  cobalt_meetingid: string;
  cobalt_name?: string;
  cobalt_startdate?: RamcoDateTime;
  cobalt_enddate?: RamcoDateTime;
  cobalt_location?: string;
  CreatedOn?: RamcoDateTime;
  [key: string]: RamcoFieldValue;
}

/**
 * Meeting Registration entity
 */
export interface RamcoMeetingRegistration {
  cobalt_meetingregistrationid: string;
  cobalt_contactid?: RamcoEntityReference;
  cobalt_meetingid?: RamcoEntityReference;
  cobalt_name?: string;
  CreatedOn?: RamcoDateTime;
  [key: string]: RamcoFieldValue;
}

/**
 * Committee Membership entity
 */
export interface RamcoCommitteeMembership {
  cobalt_committeemembershipid: string;
  cobalt_contactid?: RamcoEntityReference;
  cobalt_committeeid?: RamcoEntityReference;
  cobalt_name?: string;
  statecode?: RamcoOptionSet;
  statuscode?: RamcoOptionSet;
  CreatedOn?: RamcoDateTime;
  [key: string]: RamcoFieldValue;
}

/**
 * Class Registration entity
 */
export interface RamcoClassRegistration {
  cobalt_classregistrationid: string;
  cobalt_contactid?: RamcoEntityReference;
  cobalt_classid?: RamcoEntityReference;
  cobalt_name?: string;
  CreatedOn?: RamcoDateTime;
  [key: string]: RamcoFieldValue;
}

/**
 * Generic RAMCO record type
 * Use this when entity type is not known at compile time
 */
export interface RamcoRecord {
  [key: string]: RamcoFieldValue;
}

// ============================================================================
// API Response Types
// ============================================================================

/**
 * Standard RAMCO API response wrapper
 */
export interface RamcoApiResponse<T = any> {
  ResponseCode: number;
  ResponseText: string;
  Data: T;
}

/**
 * Response for search operations returning multiple records
 */
export interface RamcoSearchResponse<T = RamcoRecord> {
  ResponseCode: number;
  ResponseText: string;
  Data: T[];
}

/**
 * Response for entity metadata queries
 */
export interface RamcoEntityMetadata {
  Name: string;
  PrimaryKey: string;
  DisplayName: string;
  Attributes: Record<string, RamcoAttributeMetadata>;
}

/**
 * Metadata for a single entity attribute/field
 */
export interface RamcoAttributeMetadata {
  LogicalName: string;
  Type: string;
  DisplayName?: string;
  Description?: string;
  IsRequired?: boolean;
  MaxLength?: number;
  MinValue?: number;
  MaxValue?: number;
  Format?: string;
  [key: string]: any;
}

/**
 * Response for GetEntityTypes operation
 */
export interface RamcoEntityTypesResponse {
  ResponseCode: number;
  ResponseText: string;
  Data: Record<string, string>; // entity logical name => display name
}

// ============================================================================
// Enriched Types for Analytics
// ============================================================================

/**
 * Member record enriched with related activity data
 * Used for engagement and analytics calculations
 */
export interface EnrichedMember extends RamcoContact {
  eventRegistrations?: RamcoMeetingRegistration[];
  committees?: RamcoCommitteeMembership[];
  classRegistrations?: RamcoClassRegistration[];
  paymentHistory?: RamcoPayment[];
  invoices?: RamcoInvoice[];
  outstandingBalance?: number;
  membershipRecords?: RamcoMembership[];
}

/**
 * Engagement score result
 */
export interface EngagementScore {
  overall: number;  // 0-100
  level: 'highly-engaged' | 'moderately-engaged' | 'at-risk' | 'inactive';
  scores: {
    committees: number;
    events: number;
    education: number;
  };
  riskFactors: string[];
  recommendations: string[];
}

/**
 * Churn risk assessment result
 */
export interface ChurnRisk {
  riskScore: number;  // 0-100
  riskLevel: 'critical' | 'high' | 'medium' | 'low';
  riskFactors: string[];
  interventions: string[];
  daysUntilRenewal?: number;
  name?: string;
  contactId?: string;
}

/**
 * Member analytics data
 */
export interface MemberAnalytics {
  member: EnrichedMember;
  engagement: EngagementScore;
  risk: ChurnRisk;
}

// ============================================================================
// Query/Search Options
// ============================================================================

/**
 * Options for searching RAMCO records
 */
export interface SearchOptions {
  module: string;           // Entity logical name
  filter?: string;          // OData-style filter string
  fields?: string[];        // Array of field names to return
  limit?: number;           // Max results to return
  /**
   * Number of records to skip. RAMCO has no native offset parameter, so the
   * client emulates it by walking the StreamToken result stream. Prefer `cursor`.
   */
  offset?: number;
  /**
   * Opaque pagination cursor returned by a previous `searchRecordsPage` call.
   * Wraps the RAMCO StreamToken plus the position inside that page.
   */
  cursor?: string;
  orderBy?: string;         // Field to sort by
  orderDirection?: 'asc' | 'desc';
}

/**
 * One page of search results from `searchRecordsPage`
 */
export interface SearchPage<T = RamcoRecord> {
  records: T[];
  /** Cursor to pass back to fetch the next page, or null when exhausted */
  nextCursor: string | null;
  /** True when more records exist beyond this page */
  hasMore: boolean;
}

/**
 * Options for getting a single record
 */
export interface GetRecordOptions {
  fields?: string[];        // Fields to return
}

/**
 * Options for bulk fetch operations
 */
export interface BulkFetchOptions {
  entity: string;
  filter?: string;
  fields?: string[];
  maxRecords?: number;
}

// ============================================================================
// Statistics and Aggregations
// ============================================================================

/**
 * Statistical summary of numeric data
 */
export interface Statistics {
  count: number;
  sum: number;
  mean: number;
  median: number;
  min: number;
  max: number;
  stdDev: number;
}

/**
 * Percentile distribution
 */
export type PercentileDistribution = Record<number, number>;

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Extract the Value property from RAMCO complex types
 */
export type ExtractValue<T> = T extends { Value: infer V } ? V : T;

/**
 * Make all RAMCO complex fields return their Value
 */
export type SimplifiedRecord<T> = {
  [K in keyof T]: ExtractValue<T[K]>;
};

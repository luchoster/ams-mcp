/**
 * Input Validation Schemas
 *
 * Zod schemas for validating tool inputs.
 * These provide runtime type safety and user-friendly error messages.
 */

import { z } from 'zod';

// ============================================================================
// Reusable Base Schemas
// ============================================================================

/**
 * GUID/UUID format validation
 */
export const GuidSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  'Invalid GUID format. Expected format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
);

/**
 * Entity type validation
 * Must be lowercase letters and underscores only
 */
export const EntityTypeSchema = z.string()
  .min(1, 'Entity type is required')
  .max(100, 'Entity type too long (max 100 characters)')
  .regex(/^[a-z_]+$/, 'Entity type must contain only lowercase letters and underscores');

/**
 * RAMCO filter string validation
 * Checks for injection attempts and validates syntax
 */
export const FilterSchema = z.string()
  .max(5000, 'Filter string too long (max 5000 characters)')
  .refine(validateRamcoFilter, 'Invalid filter syntax or potential injection detected');

/**
 * Fields list validation
 * Comma-separated list of field names
 */
export const FieldsSchema = z.string()
  .max(2000, 'Fields string too long (max 2000 characters)')
  .refine(
    (s) => {
      const fields = s.split(',').map(f => f.trim());
      return fields.every(f => /^[a-zA-Z0-9_/]+$/.test(f));
    },
    'Field names must contain only letters, numbers, underscores, and forward slashes'
  );

/**
 * Limit validation for pagination
 */
export const LimitSchema = z.number()
  .int('Limit must be an integer')
  .min(1, 'Limit must be at least 1')
  .max(5000, 'Limit cannot exceed 5000 records');

/**
 * Offset validation for pagination
 */
export const OffsetSchema = z.number()
  .int('Offset must be an integer')
  .min(0, 'Offset cannot be negative');

/**
 * Date string validation (YYYY-MM-DD format)
 */
export const DateStringSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format');

// ============================================================================
// Tool-Specific Schemas
// ============================================================================

// Authentication Tools
// ----------------------------------------------------------------------------

export const TestConnectionSchema = z.object({});

export const GetAssociationInfoSchema = z.object({
  associationId: GuidSchema.optional()
});

// Search Tools
// ----------------------------------------------------------------------------

export const CursorSchema = z.string()
  .max(500, 'Cursor is too long')
  .regex(/^[A-Za-z0-9+/=_-]+$/, 'Cursor contains invalid characters');

export const SearchRecordsSchema = z.object({
  entityType: EntityTypeSchema.optional(),
  limit: LimitSchema.default(50),
  offset: OffsetSchema.default(0),
  cursor: CursorSchema.optional(),
  filter: FilterSchema.optional(),
  fields: FieldsSchema.optional()
});

export const GetRecordSchema = z.object({
  id: GuidSchema,
  entityType: EntityTypeSchema.optional(),
  fields: FieldsSchema.optional()
});

export const GetRelatedRecordsSchema = z.object({
  recordId: GuidSchema,
  entityType: EntityTypeSchema,
  relationshipName: z.string().max(200).optional(),
  fields: FieldsSchema.optional(),
  limit: LimitSchema.default(10)
});

// Metadata Tools
// ----------------------------------------------------------------------------

export const GetEntityTypesSchema = z.object({
  maxResults: z.number().int().min(1).max(500).default(50)
});

export const GetSchemaSchema = z.object({
  entityType: EntityTypeSchema
});

export const GetEntityInfoSchema = z.object({
  category: z.enum([
    'core_crm',
    'membership',
    'education',
    'finance',
    'events',
    'products',
    'system'
  ]).optional(),
  search: z.string().max(100).optional()
});

// Analytics Tools
// ----------------------------------------------------------------------------

export const CalculateMemberEngagementSchema = z.object({
  contactId: GuidSchema
});

export const AnalyzeMembershipHealthSchema = z.object({
  filters: z.object({
    chapter: z.string().max(200).optional(),
    memberType: z.string().max(200).optional(),
    dateRange: z.object({
      start: DateStringSchema.optional(),
      end: DateStringSchema.optional()
    }).optional()
  }).optional(),
  includeDetails: z.boolean().default(false)
});

export const GetChurnRiskReportSchema = z.object({
  limit: LimitSchema.default(100),
  minRiskScore: z.number().min(0).max(100).default(50),
  renewalWindow: z.number().int().min(1).max(365).default(90)
});

export const GenerateMembershipSnapshotSchema = z.object({
  asOfDate: DateStringSchema.optional(),
  compareToPeriod: z.enum(['lastMonth', 'lastQuarter', 'lastYear']).optional(),
  groupBy: z.array(z.enum(['chapter', 'memberType', 'status'])).optional()
});

// Engagement Tools
// ----------------------------------------------------------------------------

export const CalculateEngagementDistributionSchema = z.object({
  dateRange: z.object({
    start: DateStringSchema.optional(),
    end: DateStringSchema.optional()
  }).optional(),
  groupBy: z.enum(['chapter', 'memberType', 'cohort']).optional()
});

// Payment Tools
// ----------------------------------------------------------------------------

export const AnalyzePaymentHealthSchema = z.object({
  dateRange: z.object({
    start: DateStringSchema.optional(),
    end: DateStringSchema.optional()
  }).optional(),
  includeForecasting: z.boolean().default(false)
});

// Segmentation Tools
// ----------------------------------------------------------------------------

export const SearchMembersBulkSchema = z.object({
  query: z.string().min(3, 'Query must be at least 3 characters').max(500),
  limit: LimitSchema.default(100),
  exportFormat: z.enum(['json', 'csv', 'summary']).default('summary')
});

export const SegmentAllMembersSchema = z.object({
  segmentationStrategy: z.enum([
    'engagement',
    'lifecycle',
    'value',
    'risk',
    'custom'
  ]),
  customRules: z.array(z.object({
    name: z.string().min(1),
    criteria: z.string().min(1)
  })).optional()
});

export const FindAllAtRiskMembersSchema = z.object({
  riskFactors: z.array(z.enum([
    'payment',
    'engagement',
    'tenure',
    'communication'
  ])).optional(),
  returnLimit: z.number().int().min(1).max(500).default(50)
});

// Pattern Analysis Tools
// ----------------------------------------------------------------------------

export const IdentifyMemberPatternsSchema = z.object({
  analysisType: z.enum(['retention', 'growth', 'engagement', 'all']).default('all'),
  minimumSampleSize: z.number().int().min(5).max(1000).default(10)
});

// ============================================================================
// Type Inference Exports
// ============================================================================

// Export inferred types for use in tool handlers
export type SearchRecordsInput = z.infer<typeof SearchRecordsSchema>;
export type GetRecordInput = z.infer<typeof GetRecordSchema>;
export type GetRelatedRecordsInput = z.infer<typeof GetRelatedRecordsSchema>;
export type GetEntityTypesInput = z.infer<typeof GetEntityTypesSchema>;
export type GetSchemaInput = z.infer<typeof GetSchemaSchema>;
export type GetEntityInfoInput = z.infer<typeof GetEntityInfoSchema>;
export type CalculateMemberEngagementInput = z.infer<typeof CalculateMemberEngagementSchema>;
export type AnalyzeMembershipHealthInput = z.infer<typeof AnalyzeMembershipHealthSchema>;
export type GetChurnRiskReportInput = z.infer<typeof GetChurnRiskReportSchema>;
export type GenerateMembershipSnapshotInput = z.infer<typeof GenerateMembershipSnapshotSchema>;
export type CalculateEngagementDistributionInput = z.infer<typeof CalculateEngagementDistributionSchema>;
export type AnalyzePaymentHealthInput = z.infer<typeof AnalyzePaymentHealthSchema>;
export type SearchMembersBulkInput = z.infer<typeof SearchMembersBulkSchema>;
export type SegmentAllMembersInput = z.infer<typeof SegmentAllMembersSchema>;
export type FindAllAtRiskMembersInput = z.infer<typeof FindAllAtRiskMembersSchema>;
export type IdentifyMemberPatternsInput = z.infer<typeof IdentifyMemberPatternsSchema>;

// ============================================================================
// Validation Helper Functions
// ============================================================================

/**
 * Validate RAMCO filter syntax and check for injection attempts
 *
 * Supported operators (from RAMCO AdminTools findings):
 * - <eq> - equals
 * - <ne> - not equals
 * - <gt> - greater than
 * - <ge> - greater than or equal
 * - <lt> - less than
 * - <le> - less than or equal
 * - <like> - SQL LIKE pattern matching
 * - <notlike> - SQL NOT LIKE
 * - <sb> - substring/starts with (from AdminTools)
 * - <sc> - contains/search (from AdminTools)
 *
 * @param filter - The filter string to validate
 * @returns true if valid, false otherwise
 */
function validateRamcoFilter(filter: string): boolean {
  // Check for obvious injection attempts
  const dangerousPatterns = [
    /javascript:/i,
    /<script/i,
    /eval\(/i,
    /union\s+select/i,
    /;\s*drop/i,
    /--/,
    /\/\*/,
    /xp_cmdshell/i,
    /exec\s*\(/i
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(filter)) {
      return false;
    }
  }

  // Special case: statuscode<ne>null is always valid
  if (filter === 'statuscode<ne>null' || filter === 'statecode<ne>null') {
    return true;
  }

  // Validate RAMCO operators are present
  const validOperators = [
    '<eq>',
    '<ne>',
    '<gt>',
    '<ge>',
    '<lt>',
    '<le>',
    '<like>',
    '<notlike>',
    '<sb>',  // substring/starts with (from AdminTools)
    '<sc>',  // contains/search (from AdminTools)
    ' in ',  // SQL IN operator
    ' and ',
    ' or '
  ];

  const hasValidOperator = validOperators.some(op =>
    filter.toLowerCase().includes(op.toLowerCase())
  );

  if (!hasValidOperator) {
    return false;
  }

  // Check quote balance (single quotes must be balanced)
  const singleQuotes = (filter.match(/'/g) || []).length;
  if (singleQuotes % 2 !== 0) {
    return false;
  }

  // Check for balanced parentheses
  let parenCount = 0;
  for (const char of filter) {
    if (char === '(') parenCount++;
    if (char === ')') parenCount--;
    if (parenCount < 0) return false;
  }
  if (parenCount !== 0) {
    return false;
  }

  return true;
}

/**
 * Validate and parse a tool's input arguments
 *
 * @param schema - The Zod schema to validate against
 * @param args - The input arguments to validate
 * @returns Validated and type-safe arguments
 * @throws {z.ZodError} If validation fails
 */
export function validateToolInput<T extends z.ZodType>(
  schema: T,
  args: unknown
): z.infer<T> {
  return schema.parse(args);
}

/**
 * Safe validation that returns success/error object instead of throwing
 *
 * @param schema - The Zod schema to validate against
 * @param args - The input arguments to validate
 * @returns Result object with success flag and data or error
 */
export function safeValidateToolInput<T extends z.ZodType>(
  schema: T,
  args: unknown
): { success: true; data: z.infer<T> } | { success: false; error: z.ZodError } {
  const result = schema.safeParse(args);
  return result.success
    ? { success: true, data: result.data }
    : { success: false, error: result.error };
}

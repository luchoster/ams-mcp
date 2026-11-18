/**
 * RAMCO API Client v2 - Enhanced
 *
 * Comprehensive client for RAMCO AMS API with:
 * - Retry logic with exponential backoff
 * - Request caching and deduplication
 * - Proper error handling with custom error types
 * - Type-safe responses
 * - Performance monitoring
 */

import type {
  RamcoApiResponse,
  RamcoRecord,
  RamcoSearchResponse,
  RamcoEntityMetadata,
  RamcoEntityTypesResponse,
  SearchOptions,
  SearchPage
} from './types/ramco';

import {
  RamcoAPIError,
  RamcoAuthenticationError,
  RamcoAuthorizationError,
  RamcoRateLimitError,
  RamcoTimeoutError,
  RamcoServerError,
  RamcoInvalidResponseError,
  RamcoNetworkError,
  RamcoNotFoundError,
  RamcoBadRequestError,
  isRetryableError,
  getRetryDelay
} from './errors';

// ============================================================================
// Configuration Types
// ============================================================================

export interface RamcoConfig {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
  maxRetries?: number;
  retryDelay?: number;
  cacheEnabled?: boolean;
  cacheTtl?: number;
}

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

// ============================================================================
// RAMCO Client Class
// ============================================================================

export class RamcoClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeout: number;
  private readonly maxRetries: number;
  private readonly retryDelay: number;
  private readonly cacheEnabled: boolean;
  private readonly cacheTtl: number;

  // Caching and deduplication
  private requestCache: Map<string, CacheEntry<any>>;
  private pendingRequests: Map<string, Promise<any>>;
  private readonly maxCacheSize = 100;

  constructor(config: RamcoConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || 'https://api.ramcoams.com/api/v2';
    this.timeout = config.timeout || 30000;
    this.maxRetries = config.maxRetries || 3;
    this.retryDelay = config.retryDelay || 1000;
    this.cacheEnabled = config.cacheEnabled ?? true;
    this.cacheTtl = config.cacheTtl || 300000; // 5 minutes default

    this.requestCache = new Map();
    this.pendingRequests = new Map();
  }

  // ==========================================================================
  // Core Request Methods
  // ==========================================================================

  /**
   * Make a request with retry logic and caching
   */
  private async makeRequestWithRetry(
    operation: string,
    params: Record<string, string> = {},
    attempt: number = 0
  ): Promise<any> {
    // Check cache for read operations
    if (this.cacheEnabled && this.isCacheableOperation(operation)) {
      const cacheKey = this.getCacheKey(operation, params);
      const cached = this.getFromCache(cacheKey);

      if (cached) {
        console.log(`[ramco-client] Cache hit for ${operation}`);
        return cached;
      }

      // Deduplicate concurrent identical requests
      const pending = this.pendingRequests.get(cacheKey);
      if (pending) {
        console.log(`[ramco-client] Deduplicating request for ${operation}`);
        return pending;
      }
    }

    // Make the actual request
    const promise = this.makeRequest(operation, params);

    // Track pending request for deduplication
    const cacheKey = this.getCacheKey(operation, params);
    this.pendingRequests.set(cacheKey, promise);

    try {
      const result = await promise;

      // Cache successful read operations
      if (this.cacheEnabled && this.isCacheableOperation(operation)) {
        this.setCache(cacheKey, result);
      }

      this.pendingRequests.delete(cacheKey);
      return result;

    } catch (error) {
      this.pendingRequests.delete(cacheKey);

      // Retry logic for transient errors
      if (isRetryableError(error) && attempt < this.maxRetries) {
        const delay = getRetryDelay(attempt, this.retryDelay);
        console.log(`[ramco-client] Retry attempt ${attempt + 1}/${this.maxRetries} after ${delay}ms for ${operation}`);

        await new Promise(resolve => setTimeout(resolve, delay));
        return this.makeRequestWithRetry(operation, params, attempt + 1);
      }

      throw error;
    }
  }

  /**
   * Make the actual HTTP request to RAMCO API
   */
  private async makeRequest(
    operation: string,
    additionalParams: Record<string, string> = {}
  ): Promise<any> {
    const url = `${this.baseUrl}/`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    // Create form data
    const formData = new URLSearchParams();
    formData.append('Key', this.apiKey);
    formData.append('operation', operation);

    Object.entries(additionalParams).forEach(([key, value]) => {
      formData.append(key, value);
    });

    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'RAMCO-MCP-Server/2.0',
      'Accept': 'application/json'
    };

    try {
      console.log(`[ramco-client] POST ${url} operation=${operation}`);

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: formData,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Handle HTTP errors
      if (!response.ok) {
        await this.handleErrorResponse(response);
      }

      // Parse response
      let data: any;
      try {
        data = await response.json();
      } catch (parseError) {
        throw new RamcoInvalidResponseError('Failed to parse JSON response from RAMCO API');
      }

      // Validate response structure
      if (!data || typeof data !== 'object') {
        throw new RamcoInvalidResponseError('Invalid response format from RAMCO API');
      }

      // Check for API-level errors in the response
      // Accept 200 (OK) and 206 (Partial Content - payload too large)
      const validResponseCodes = [200, 206, '200', '206'];
      if (data.ResponseCode && !validResponseCodes.includes(data.ResponseCode)) {
        throw new RamcoAPIError(
          data.ResponseText || 'RAMCO API returned an error',
          Number(data.ResponseCode),
          'API_ERROR'
        );
      }

      // 206 = partial content: RAMCO returned one page (500 records) and a
      // StreamToken for the next page. searchRecordsPage() follows the token.
      if (data.ResponseCode === 206 || data.ResponseCode === '206') {
        console.log('[ramco-client] Partial content (206): more pages available via StreamToken');
      }

      return data;

    } catch (error) {
      clearTimeout(timeoutId);

      // Timeout error
      if (error instanceof Error && error.name === 'AbortError') {
        throw new RamcoTimeoutError(this.timeout);
      }

      // Re-throw RAMCO errors
      if (error instanceof RamcoAPIError) {
        throw error;
      }

      // Network/connection errors
      throw new RamcoNetworkError(
        error instanceof Error ? error.message : 'Unknown network error',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Handle HTTP error responses
   */
  private async handleErrorResponse(response: Response): Promise<never> {
    let errorData: any = null;
    let errorMessage = `HTTP ${response.status}: ${response.statusText}`;

    try {
      errorData = await response.json();
      errorMessage = errorData.message || errorData.ResponseText || errorMessage;
    } catch {
      // If JSON parsing fails, use status text
    }

    // Map HTTP status codes to specific error types
    switch (response.status) {
      case 400:
        throw new RamcoBadRequestError(errorMessage);

      case 401:
        throw new RamcoAuthenticationError(errorMessage);

      case 403:
        throw new RamcoAuthorizationError(errorMessage);

      case 404:
        throw new RamcoNotFoundError(errorMessage);

      case 429:
        const retryAfter = response.headers.get('Retry-After');
        throw new RamcoRateLimitError(errorMessage, retryAfter ? parseInt(retryAfter) : undefined);

      case 500:
      case 502:
      case 503:
      case 504:
        throw new RamcoServerError(response.status, errorMessage);

      default:
        throw new RamcoAPIError(errorMessage, response.status, errorData?.errorCode);
    }
  }

  // ==========================================================================
  // Caching Methods
  // ==========================================================================

  private getCacheKey(operation: string, params: Record<string, string>): string {
    return `${operation}:${JSON.stringify(params)}`;
  }

  private isCacheableOperation(operation: string): boolean {
    const cacheableOps = [
      'GetEntityTypes',
      'GetEntity',
      'GetEntities',
      'GetEntityMetadata',
      'GetRelatedRecords'
    ];
    return cacheableOps.includes(operation);
  }

  private getFromCache<T>(key: string): T | null {
    const entry = this.requestCache.get(key);
    if (!entry) return null;

    const age = Date.now() - entry.timestamp;
    if (age > entry.ttl) {
      this.requestCache.delete(key);
      return null;
    }

    return entry.data as T;
  }

  private setCache<T>(key: string, data: T, ttl?: number): void {
    // Evict oldest entries if cache is full
    if (this.requestCache.size >= this.maxCacheSize) {
      const oldestKey = Array.from(this.requestCache.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp)[0][0];
      this.requestCache.delete(oldestKey);
    }

    this.requestCache.set(key, {
      data,
      timestamp: Date.now(),
      ttl: ttl || this.cacheTtl
    });
  }

  /**
   * Clear the request cache
   */
  public clearCache(): void {
    this.requestCache.clear();
    console.log('[ramco-client] Cache cleared');
  }

  // ==========================================================================
  // Public API Methods
  // ==========================================================================

  /**
   * Test authentication by making a simple API call
   */
  async authenticate(): Promise<boolean> {
    try {
      await this.makeRequestWithRetry('GetEntityTypes', { maxresults: '1' });
      return true;
    } catch (error) {
      console.error('[ramco-client] Authentication failed:', error);
      return false;
    }
  }

  /**
   * Get list of available entity types
   */
  async getEntityTypes(maxResults: number = 50): Promise<RamcoEntityTypesResponse> {
    const data = await this.makeRequestWithRetry('GetEntityTypes', {
      maxresults: maxResults.toString()
    });

    return data;
  }

  /**
   * Build the GetEntities form parameters shared by every search call.
   * Deliberately excludes maxresults / StreamToken - the caller decides those.
   */
  private buildSearchParams(options: SearchOptions): Record<string, string> {
    const params: Record<string, string> = {};

    // Entity (module) is required
    params.entity = options.module || 'contact';

    // Handle field selection
    if (options.fields && options.fields.length > 0) {
      params.attributes = options.fields.join(',');
    } else if (params.entity.toLowerCase() === 'contact') {
      // Default fields for Contact entity
      params.attributes = 'ContactId,FirstName,LastName,EmailAddress1,StatusCode,CreatedOn,ModifiedOn';
    } else {
      // For other entities, request all fields
      params.attributes = '*';
    }

    if (options.filter) {
      params.filter = options.filter;
    }

    return params;
  }

  /**
   * Execute one raw GetEntities call.
   *
   * RAMCO paging model (verified against the live v2 API):
   * - `maxresults=N`  -> up to N records in one response (ResponseCode 200), no token.
   * - no maxresults   -> 500 records + ResponseCode 206 + `StreamToken` while more remain.
   * - `StreamToken=t` -> the next 500-record page (maxresults is ignored on these calls).
   * - `offset`        -> NOT supported; silently ignored by the API.
   */
  private async fetchSearchPage(
    baseParams: Record<string, string>,
    page: { maxResults?: number; streamToken?: string }
  ): Promise<{ records: RamcoRecord[]; streamToken: string | null }> {
    const params: Record<string, string> = { ...baseParams };

    if (page.streamToken) {
      params.StreamToken = page.streamToken;
    } else if (page.maxResults && page.maxResults > 0) {
      params.maxresults = Math.floor(page.maxResults).toString();
    }

    let data: any;
    try {
      data = await this.makeRequestWithRetry('GetEntities', params);
    } catch (error) {
      // RAMCO returns an error (not empty results) when no records match a filter.
      // This is normal for searches - treat it as an empty result set.
      if (error instanceof RamcoAPIError &&
          error.message.toLowerCase().includes('no matching entities found')) {
        return { records: [], streamToken: null };
      }
      throw error;
    }

    // Extract results from various possible response formats
    const result = data.Data || data.records || data.Results || data;
    const records: RamcoRecord[] = Array.isArray(result) ? (result as RamcoRecord[]) : [];
    if (!Array.isArray(result)) {
      console.warn('[ramco-client] GetEntities returned non-array:', typeof result);
    }

    const partial = Number(data.ResponseCode) === 206;
    const streamToken = partial && typeof data.StreamToken === 'string' && data.StreamToken.length > 0
      ? data.StreamToken
      : null;

    return { records, streamToken };
  }

  /**
   * Search for records with filters.
   *
   * Returns up to `limit` records in a single API call. If `cursor` or
   * `offset` is set, delegates to searchRecordsPage() so paging actually
   * advances (RAMCO ignores an `offset` form parameter).
   */
  async searchRecords(options: SearchOptions = {} as SearchOptions): Promise<RamcoRecord[]> {
    if (options.cursor || (options.offset && options.offset > 0)) {
      const page = await this.searchRecordsPage(options);
      return page.records;
    }

    const { records } = await this.fetchSearchPage(
      this.buildSearchParams(options),
      { maxResults: options.limit }
    );
    return records;
  }

  /**
   * Search for records with real pagination.
   *
   * Returns one page of up to `limit` records plus an opaque `nextCursor`
   * when more records exist. Pass the cursor back (with the same module,
   * filter and fields) to get the following page. A numeric `offset` is
   * honoured by walking the RAMCO result stream past the skipped records.
   */
  async searchRecordsPage(options: SearchOptions): Promise<SearchPage> {
    const limit = Math.max(1, Math.floor(options.limit ?? 50));
    const base = this.buildSearchParams(options);

    let pageToken: string | null = null;  // null = first page of the stream
    let pageSkip = 0;                      // records to skip inside that page

    if (options.cursor) {
      const decoded = RamcoClient.decodeCursor(options.cursor);
      pageToken = decoded.token;
      pageSkip = decoded.skip;
    } else if (options.offset && options.offset > 0) {
      pageSkip = Math.floor(options.offset);
    }

    // Fast path: first page, nothing to skip. One bounded call, requesting
    // one extra record so we can tell whether more exist. RAMCO orders a
    // bounded call and the unbounded stream identically, so a follow-up
    // cursor of {token: null, skip: limit} resumes at the right record.
    if (pageToken === null && pageSkip === 0) {
      const { records } = await this.fetchSearchPage(base, { maxResults: limit + 1 });
      const hasMore = records.length > limit;
      return {
        records: hasMore ? records.slice(0, limit) : records,
        hasMore,
        nextCursor: hasMore ? RamcoClient.encodeCursor(null, limit) : null
      };
    }

    // Stream walk: follow StreamTokens (500 records per page) until we have
    // `limit` records or the stream ends.
    const out: RamcoRecord[] = [];
    const MAX_PAGES = 200; // 100,000 records - safety valve against runaway loops

    for (let i = 0; i < MAX_PAGES; i++) {
      const { records, streamToken: nextToken } = await this.fetchSearchPage(
        base,
        pageToken ? { streamToken: pageToken } : {}
      );

      const available = records.slice(pageSkip);
      const need = limit - out.length;
      const taken = available.slice(0, need);
      out.push(...taken);

      if (out.length >= limit) {
        const positionInPage = pageSkip + taken.length;
        if (positionInPage < records.length) {
          // More records remain on this same page
          return { records: out, hasMore: true, nextCursor: RamcoClient.encodeCursor(pageToken, positionInPage) };
        }
        if (nextToken) {
          return { records: out, hasMore: true, nextCursor: RamcoClient.encodeCursor(nextToken, 0) };
        }
        return { records: out, hasMore: false, nextCursor: null };
      }

      // Page exhausted
      if (!nextToken || records.length === 0) {
        return { records: out, hasMore: false, nextCursor: null };
      }

      // Carry any unconsumed skip across to the next page
      pageSkip = pageSkip > records.length ? pageSkip - records.length : 0;
      pageToken = nextToken;
    }

    throw new RamcoAPIError(
      `Pagination aborted after ${MAX_PAGES} pages - narrow the filter or use a smaller offset`,
      500,
      'PAGINATION_LIMIT'
    );
  }

  /**
   * Fetch every record matching the search by following StreamTokens.
   * Stops at `maxRecords` (default 50,000) as a safety limit.
   */
  async searchAllRecords(options: SearchOptions, maxRecords: number = 50000): Promise<RamcoRecord[]> {
    const page = await this.searchRecordsPage({ ...options, cursor: undefined, offset: 0, limit: maxRecords });
    return page.records;
  }

  // Cursor helpers: base64url-encoded JSON {t: StreamToken|null, s: skip}
  private static encodeCursor(token: string | null, skip: number): string {
    return Buffer.from(JSON.stringify({ t: token, s: skip })).toString('base64url');
  }

  private static decodeCursor(cursor: string): { token: string | null; skip: number } {
    try {
      const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
      const token = typeof parsed?.t === 'string' && parsed.t.length > 0 ? parsed.t : null;
      const skip = Number.isInteger(parsed?.s) && parsed.s >= 0 ? parsed.s : 0;
      return { token, skip };
    } catch {
      throw new RamcoBadRequestError('Invalid pagination cursor - use the nextCursor value from a previous search_records response');
    }
  }

  /**
   * Get a single record by ID
   *
   * Supports relationship navigation using '/' syntax:
   * @example
   * // Fetch contact with memberships in one call
   * getRecord(contactId, 'contact', {
   *   fields: ['ContactId', 'FirstName', 'cobalt_contact_cobalt_membership/StatusCode']
   * })
   */
  async getRecord(
    id: string,
    entityType?: string,
    options?: { fields?: string[]; includeInactive?: boolean }
  ): Promise<RamcoRecord> {
    const params: Record<string, string> = {
      Guid: id
    };

    if (entityType) {
      params.entity = entityType;

      // Handle field selection
      // RAMCO API requires Attributes parameter
      if (options?.fields && options.fields.length > 0) {
        params.attributes = options.fields.join(',');
      } else if (entityType.toLowerCase() === 'contact') {
        // Default fields for Contact entity
        params.attributes = 'ContactId,FirstName,LastName,EmailAddress1,StatusCode,CreatedOn,ModifiedOn';
      } else {
        // For other entities, request common identifier fields
        // Most RAMCO entities have these patterns
        const entityName = entityType.toLowerCase().replace('cobalt_', '');
        params.attributes = `${entityType}Id,${entityType}_name,createdon,modifiedon,statuscode,statecode`;
      }
    }

    const data = await this.makeRequestWithRetry('GetEntity', params);
    return (data.Data || data.record || data) as RamcoRecord;
  }

  /**
   * Get a single record with related entities in one call
   *
   * Uses RAMCO's relationship navigation to fetch related data efficiently.
   *
   * @example
   * // Fetch contact with memberships, committees, and events
   * const contact = await client.getRecordWithRelationships(
   *   contactId,
   *   'contact',
   *   {
   *     baseFields: ['ContactId', 'FirstName', 'LastName', 'EmailAddress1'],
   *     relationships: {
   *       'cobalt_contact_cobalt_membership': ['StatusCode', 'cobalt_MemberTypeId'],
   *       'cobalt_contact_cobalt_committeemembership': ['StatusCode', 'cobalt_CommitteeId']
   *     }
   *   }
   * )
   */
  async getRecordWithRelationships(
    id: string,
    entityType: string,
    options: {
      baseFields: string[];
      relationships: Record<string, string[]>;
    }
  ): Promise<RamcoRecord> {
    // Build attributes list with relationship paths
    const attributes: string[] = [...options.baseFields];

    // Add relationship fields using '/' syntax
    for (const [relationshipName, fields] of Object.entries(options.relationships)) {
      fields.forEach(field => {
        attributes.push(`${relationshipName}/${field}`);
      });
    }

    return this.getRecord(id, entityType, { fields: attributes });
  }

  /**
   * Get entity metadata/schema
   */
  async getSchema(entityType: string): Promise<RamcoEntityMetadata> {
    const data = await this.makeRequestWithRetry('GetEntityMetadata', {
      Entity: entityType
    });

    return (data.Data || data.schema || data) as RamcoEntityMetadata;
  }

  /**
   * Get related records for a specific record
   */
  async getRelatedRecords(
    recordId: string,
    entityType: string,
    relationshipName?: string,
    options?: { fields?: string[]; limit?: number }
  ): Promise<RamcoRecord[]> {
    const params: Record<string, string> = {
      Guid: recordId,
      entity: entityType
    };

    if (relationshipName) {
      params.relationship = relationshipName;
    }

    if (options?.limit) {
      params.maxresults = options.limit.toString();
    }

    if (options?.fields && options.fields.length > 0) {
      params.attributes = options.fields.join(',');
    }

    const data = await this.makeRequestWithRetry('GetRelatedRecords', params);
    const result = data.Data || data.records || data.Results || data;

    if (!Array.isArray(result)) {
      return [];
    }

    return result as RamcoRecord[];
  }

  /**
   * Create a new record (write operation - no caching)
   */
  async createRecord(
    data: Partial<RamcoRecord>,
    entityType: string
  ): Promise<RamcoRecord> {
    const params: Record<string, string> = {
      entity: entityType
    };

    // Convert data object to form parameters
    Object.entries(data).forEach(([key, value]) => {
      if (value !== null && value !== undefined) {
        params[key] = String(value);
      }
    });

    const result = await this.makeRequest('CreateEntity', params);
    return (result.Data || result.record || result) as RamcoRecord;
  }

  /**
   * Update an existing record (write operation - no caching)
   */
  async updateRecord(
    id: string,
    data: Partial<RamcoRecord>,
    entityType: string
  ): Promise<RamcoRecord> {
    const params: Record<string, string> = {
      Guid: id,
      entity: entityType
    };

    // Convert data object to form parameters
    Object.entries(data).forEach(([key, value]) => {
      if (value !== null && value !== undefined) {
        params[key] = String(value);
      }
    });

    const result = await this.makeRequest('UpdateEntity', params);

    // Clear cache since we modified data
    this.clearCache();

    return (result.Data || result.record || result) as RamcoRecord;
  }

  /**
   * Delete a record (write operation - no caching)
   */
  async deleteRecord(id: string, entityType: string): Promise<boolean> {
    const params: Record<string, string> = {
      Guid: id,
      entity: entityType
    };

    await this.makeRequest('DeleteEntity', params);

    // Clear cache since we modified data
    this.clearCache();

    return true;
  }

  /**
   * List all available modules/entity types
   */
  async listModules(): Promise<string[]> {
    const data = await this.getEntityTypes(500);

    // Extract entity names from response
    if (data.Data && typeof data.Data === 'object') {
      return Object.keys(data.Data);
    }

    if (Array.isArray(data)) {
      return data.map((entity: any) => entity.name || entity.EntityType || entity);
    }

    return [];
  }

  /**
   * Clear RAMCO server cache
   * Note: This is a RAMCO API operation, not our local cache
   */
  async clearServerCache(): Promise<void> {
    await this.makeRequest('ClearCache', {});
    console.log('[ramco-client] RAMCO server cache cleared');
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  /**
   * Get current cache statistics
   */
  public getCacheStats() {
    return {
      size: this.requestCache.size,
      maxSize: this.maxCacheSize,
      enabled: this.cacheEnabled,
      ttl: this.cacheTtl
    };
  }

  /**
   * Get client configuration (without exposing API key)
   */
  public getConfig() {
    return {
      baseUrl: this.baseUrl,
      timeout: this.timeout,
      maxRetries: this.maxRetries,
      retryDelay: this.retryDelay,
      cacheEnabled: this.cacheEnabled,
      cacheTtl: this.cacheTtl
    };
  }
}

/**
 * Factory function to create a RAMCO client instance
 */
export function createRamcoClient(config: RamcoConfig): RamcoClient {
  return new RamcoClient(config);
}

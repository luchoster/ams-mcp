export interface RamcoConfig {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
}

export interface RamcoRecord {
  id: string;
  [key: string]: any;
}

export interface SearchOptions {
  module?: string;
  fields?: string[];
  filter?: string;
  limit?: number;
  offset?: number;
}

export class RamcoClient {
  private baseUrl: string;
  private apiKey: string;
  private timeout: number;

  constructor(config: RamcoConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || 'https://api.ramcoams.com/api/v2';
    this.timeout = config.timeout || 30000;
  }

  private async makeRequest(
    operation: string,
    additionalParams: Record<string, string> = {}
  ): Promise<any> {
    const url = `${this.baseUrl}/`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    // Create form data with required parameters
    const formData = new URLSearchParams();
    formData.append('Key', this.apiKey);
    formData.append('operation', operation);
    
    // Add additional parameters
    Object.entries(additionalParams).forEach(([key, value]) => {
      formData.append(key, value);
    });

    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
    };

    try {
      console.log(`Making request to: POST ${url} with operation: ${operation}`);
      
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: formData,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        await this.handleErrorResponse(response);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Request timeout after ${this.timeout}ms`);
      }
      
      throw error;
    }
  }

  private async handleErrorResponse(response: Response): Promise<never> {
    let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
    
    try {
      const errorData = await response.json();
      errorMessage = errorData.message || errorMessage;
    } catch {
      // If we can't parse JSON, use the default message
    }

    switch (response.status) {
      case 401:
        throw new Error('Invalid RAMCO API key. Please check your authentication credentials.');
      case 403:
        throw new Error('Access denied. Please check your API permissions.');
      case 429:
        throw new Error('Rate limit exceeded. Please try again later.');
      default:
        throw new Error(`RAMCO API error: ${errorMessage}`);
    }
  }

  async authenticate(): Promise<boolean> {
    try {
      // Test authentication by calling GetEntityTypes with minimal results
      await this.makeRequest('GetEntityTypes', { maxresults: '1' });
      return true;
    } catch (error) {
      return false;
    }
  }

  async getEntityTypes(maxResults: number = 50): Promise<any[]> {
    try {
      const data = await this.makeRequest('GetEntityTypes', { 
        maxresults: maxResults.toString() 
      });
      return data.entities || data.EntityTypes || data;
    } catch (error) {
      throw this.handleError(error, 'getting entity types');
    }
  }

  async searchRecords(options: SearchOptions = {}): Promise<RamcoRecord[]> {
    try {
      const params: Record<string, string> = {};
      
      // Ensure entity is always provided
      if (options.module) {
        params.entity = options.module;
      } else {
        params.entity = 'contact'; // Default fallback
      }
      
      if (options.limit) params.maxresults = options.limit.toString();
      if (options.offset) params.offset = options.offset.toString();
      
      // Handle field selection - ensure attributes are always provided
      if (options.fields && options.fields.length > 0) {
        params.attributes = options.fields.join(',');
      } else if (params.entity.toLowerCase() === 'contact') {
        // Default fields for Contact entity when no specific fields requested
        params.attributes = 'ContactId,FirstName,LastName,EmailAddress1,StatusCode,CreatedOn,ModifiedOn';
      } else {
        // Default attributes for other entities
        params.attributes = '*';
      }
      
      if (options.filter) {
        // Use RAMCO filter syntax directly
        params.filter = options.filter;
      }

      const data = await this.makeRequest('GetEntities', params);
      console.log('[ramco-client] searchRecords raw response keys:', Object.keys(data || {}).slice(0, 10));
      console.log('[ramco-client] searchRecords checking:', {
        hasRecords: !!data.records,
        hasResults: !!data.Results,
        hasData: !!data.Data,
        isDataArray: Array.isArray(data),
        dataType: typeof data
      });

      const result = data.records || data.Results || data.Data || data;

      // Ensure we always return an array
      if (!Array.isArray(result)) {
        console.warn('[ramco-client] searchRecords returned non-array:', typeof result, 'Keys:', Object.keys(result || {}).slice(0, 10));
        return [];
      }

      console.log('[ramco-client] searchRecords returning array with', result.length, 'items');
      return result;
    } catch (error) {
      throw this.handleError(error, 'searching records');
    }
  }

  async getRecord(id: string, entityType?: string, options?: { fields?: string[] }): Promise<RamcoRecord> {
    try {
      const params: Record<string, string> = {
        Guid: id
      };
      
      if (entityType) {
        params.entity = entityType;
        
        // Handle field selection
        if (options?.fields && options.fields.length > 0) {
          params.attributes = options.fields.join(',');
        } else if (entityType === 'Contact') {
          // Default fields for Contact entity when no specific fields requested
          params.attributes = 'FirstName,LastName,contactId,emailaddress1';
        }
      }

      const data = await this.makeRequest('GetEntity', params);
      return data.record || data;
    } catch (error) {
      throw this.handleError(error, `getting record ${id}`);
    }
  }

  async createRecord(data: Partial<RamcoRecord>, entityType?: string): Promise<RamcoRecord> {
    try {
      const params: Record<string, string> = {};
      
      if (entityType) {
        params.entitytype = entityType;
      }

      // Convert data object to form parameters
      Object.entries(data).forEach(([key, value]) => {
        if (value !== null && value !== undefined) {
          params[key] = String(value);
        }
      });

      const result = await this.makeRequest('CreateRecord', params);
      return result.record || result;
    } catch (error) {
      throw this.handleError(error, 'creating record');
    }
  }

  async updateRecord(id: string, data: Partial<RamcoRecord>, entityType?: string): Promise<RamcoRecord> {
    try {
      const params: Record<string, string> = {
        id: id
      };
      
      if (entityType) {
        params.entitytype = entityType;
      }

      // Convert data object to form parameters
      Object.entries(data).forEach(([key, value]) => {
        if (value !== null && value !== undefined) {
          params[key] = String(value);
        }
      });

      const result = await this.makeRequest('UpdateRecord', params);
      return result.record || result;
    } catch (error) {
      throw this.handleError(error, `updating record ${id}`);
    }
  }

  async deleteRecord(id: string, entityType?: string): Promise<boolean> {
    try {
      const params: Record<string, string> = {
        id: id
      };
      
      if (entityType) {
        params.entitytype = entityType;
      }

      await this.makeRequest('DeleteRecord', params);
      return true;
    } catch (error) {
      throw this.handleError(error, `deleting record ${id}`);
    }
  }

  async listModules(): Promise<string[]> {
    try {
      const data = await this.getEntityTypes();
      // Extract entity type names from the response
      return data.map((entity: any) => entity.name || entity.EntityType || entity);
    } catch (error) {
      throw this.handleError(error, 'listing modules');
    }
  }

  async getSchema(entityType: string): Promise<Record<string, any>> {
    try {
      const data = await this.makeRequest('GetEntityMetadata', { 
        Entity: entityType 
      });
      return data.schema || data;
    } catch (error) {
      throw this.handleError(error, `getting schema for ${entityType}`);
    }
  }

  async getRelatedRecords(
    recordId: string, 
    entityType: string, 
    relationshipName?: string,
    options?: { fields?: string[]; limit?: number }
  ): Promise<RamcoRecord[]> {
    try {
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

      const data = await this.makeRequest('GetRelatedRecords', params);
      return data.records || data.Results || data || [];
    } catch (error) {
      throw this.handleError(error, `getting related records for ${recordId}`);
    }
  }

  private handleError(error: any, context: string): Error {
    const message = error.message || 'Unknown error';
    return new Error(`Error ${context}: ${message}`);
  }
}
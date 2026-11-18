/**
 * Natural Language Query Parser for RAMCO MCP
 * Converts human-readable queries to RAMCO filter syntax
 */

export interface ParsedQuery {
  filter: string;
  fields?: string[];
  entity?: string;
  interpretation: string;
  isNameSearch?: boolean; // Flag to indicate if this is a specific name search
}

/**
 * Parses natural language queries into RAMCO filter syntax
 */
export function parseNaturalLanguageQuery(query: string): ParsedQuery {
  const lowerQuery = query.toLowerCase();
  let filter = '';
  let fields: string[] = [];
  let entity = 'contact'; // Default to contact entity
  let interpretation = '';

  // Detect entity type
  if (lowerQuery.includes('member')) {
    entity = 'contact';
  } else if (lowerQuery.includes('payment') || lowerQuery.includes('invoice')) {
    entity = 'invoice';
  } else if (lowerQuery.includes('event') || lowerQuery.includes('meeting')) {
    entity = 'cobalt_meeting';
  } else if (lowerQuery.includes('committee')) {
    entity = 'cobalt_committeemembership';
  }

  // Parse name search patterns - support multiple names separated by commas
  let firstName: string | null = null;
  let lastName: string | null = null;
  let multipleNames: Array<{first: string, last: string}> = [];

  // Check for comma-separated list of names (e.g., "Amy Allen, Brandon Roberts, Sarah Scattini")
  // More flexible pattern to handle various capitalizations
  if (query.includes(',')) {
    // Parse multiple names from comma-separated list
    const namesList = query.split(',').map(n => n.trim());
    for (const name of namesList) {
      // Match "FirstName LastName" with flexible capitalization
      const parts = name.match(/^([A-Z][a-zA-Z'-]+)\s+([A-Z][a-zA-Z'-]+)$/);
      if (parts) {
        multipleNames.push({ first: parts[1], last: parts[2] });
      }
    }
  } else {
    // Single name patterns
    const namedPattern = /(?:named|member(?:s)?)\s+([A-Z][a-z]+)\s+([A-Z][a-z]+)/i;
    const firstNamePattern = /first name\s+(?:is\s+)?(?:contains\s+)?([A-Z][a-z]+)/i;
    const lastNamePattern = /last name\s+(?:is\s+)?(?:contains\s+)?([A-Z][a-z]+)/i;

    // Check for "named FirstName LastName" or "member FirstName LastName"
    const namedMatch = query.match(namedPattern);
    if (namedMatch) {
      firstName = namedMatch[1];
      lastName = namedMatch[2];
    }

    // Check for explicit "first name X" pattern
    const firstNameMatch = query.match(firstNamePattern);
    if (firstNameMatch) {
      firstName = firstNameMatch[1];
    }

    // Check for explicit "last name Y" pattern
    const lastNameMatch = query.match(lastNamePattern);
    if (lastNameMatch) {
      lastName = lastNameMatch[1];
    }

    // If no keyword patterns found, check if query is just two capitalized words (likely a name)
    if (!firstName && !lastName && !lowerQuery.match(/\b(who|with|from|in|on|at|have|are|is)\b/)) {
      const simpleNamePattern = /^([A-Z][a-z]+)\s+([A-Z][a-z]+)$/;
      const simpleMatch = query.match(simpleNamePattern);
      if (simpleMatch) {
        firstName = simpleMatch[1];
        lastName = simpleMatch[2];
      }
    }
  }

  // Build filter for name search
  if (multipleNames.length > 0) {
    // Multiple names - use OR logic
    const nameFilters = multipleNames.map(name =>
      `(FirstName<eq>'${name.first}' and LastName<eq>'${name.last}')`
    );
    filter = nameFilters.join(' or ');
    interpretation = `Members named: ${multipleNames.map(n => `${n.first} ${n.last}`).join(', ')}`;
  } else if (firstName || lastName) {
    // Single name
    const nameParts = [];
    if (firstName) {
      nameParts.push(`FirstName<eq>'${firstName}'`);
    }
    if (lastName) {
      nameParts.push(`LastName<eq>'${lastName}'`);
    }
    filter = nameParts.join(' and ');

    // Build interpretation
    if (firstName && lastName) {
      interpretation = `Members named ${firstName} ${lastName}`;
    } else if (firstName) {
      interpretation = `Members with first name ${firstName}`;
    } else if (lastName) {
      interpretation = `Members with last name ${lastName}`;
    }
  }

  // Parse temporal conditions
  const timePatterns = [
    {
      pattern: /joined (last|this) year/i,
      handler: () => {
        const year = lowerQuery.includes('last') 
          ? new Date().getFullYear() - 1 
          : new Date().getFullYear();
        filter = `createdon<ge>'${year}-01-01' and createdon<le>'${year}-12-31'`;
        interpretation = `Members who joined in ${year}`;
      }
    },
    {
      pattern: /joined (\d+) months? ago/i,
      handler: (match: RegExpMatchArray) => {
        const months = parseInt(match[1]);
        const date = new Date();
        date.setMonth(date.getMonth() - months);
        filter = `createdon<ge>'${date.toISOString().split('T')[0]}'`;
        interpretation = `Members who joined in the last ${months} months`;
      }
    },
    {
      pattern: /haven't renewed/i,
      handler: () => {
        filter = `statuscode<eq>2`; // Assuming 2 is inactive/lapsed
        interpretation = 'Members who have not renewed';
      }
    },
    {
      pattern: /expiring (soon|in (\d+) days?)/i,
      handler: (match: RegExpMatchArray) => {
        const days = match[2] ? parseInt(match[2]) : 30;
        const futureDate = new Date();
        futureDate.setDate(futureDate.getDate() + days);
        filter = `cobalt_expirationdate<le>'${futureDate.toISOString().split('T')[0]}'`;
        interpretation = `Members expiring within ${days} days`;
      }
    }
  ];

  // Check time patterns
  for (const { pattern, handler } of timePatterns) {
    const match = lowerQuery.match(pattern);
    if (match) {
      handler(match);
      break;
    }
  }

  // Parse engagement conditions
  if (lowerQuery.includes('no event') || lowerQuery.includes("haven't attended")) {
    if (filter) filter += ' and ';
    // This would need a subquery in real implementation
    interpretation += interpretation ? ' and ' : '';
    interpretation += 'have not attended events';
    fields.push('cobalt_contact_cobalt_meetingregistration');
  }

  if (lowerQuery.includes('no committee') || lowerQuery.includes('not on committee')) {
    if (filter) filter += ' and ';
    interpretation += interpretation ? ' and ' : '';
    interpretation += 'are not on any committees';
    fields.push('cobalt_contact_cobalt_committeemembership');
  }

  // Parse payment conditions
  if (lowerQuery.includes('overdue') || lowerQuery.includes('outstanding')) {
    if (filter) filter += ' and ';
    filter += `cobalt_outstandingbalance<gt>0`;
    interpretation += interpretation ? ' and ' : '';
    interpretation += 'have outstanding balances';
    fields.push('cobalt_outstandingbalance');
  }

  // Parse member type conditions
  const memberTypes = {
    'regular': 'cobalt_membertypeid<eq>\'regular-guid\'',
    'associate': 'cobalt_membertypeid<eq>\'associate-guid\'',
    'student': 'cobalt_membertypeid<eq>\'student-guid\'',
    'lifetime': 'cobalt_membertypeid<eq>\'lifetime-guid\''
  };

  for (const [type, filterStr] of Object.entries(memberTypes)) {
    if (lowerQuery.includes(type)) {
      if (filter) filter += ' and ';
      filter += filterStr;
      interpretation += interpretation ? ' and ' : '';
      interpretation += `are ${type} members`;
      break;
    }
  }

  // Parse location/chapter conditions
  const chapterMatch = lowerQuery.match(/from (\w+) chapter/i);
  if (chapterMatch) {
    if (filter) filter += ' and ';
    filter += `cobalt_chapterid<eq>'${chapterMatch[1]}'`;
    interpretation += interpretation ? ' and ' : '';
    interpretation += `are from ${chapterMatch[1]} chapter`;
  }

  // Parse status conditions
  if (lowerQuery.includes('active')) {
    if (filter) filter += ' and ';
    filter += 'statuscode<eq>1';
    interpretation += interpretation ? ' and ' : '';
    interpretation += 'are active';
  } else if (lowerQuery.includes('inactive') || lowerQuery.includes('lapsed')) {
    if (filter) filter += ' and ';
    filter += 'statuscode<eq>2';
    interpretation += interpretation ? ' and ' : '';
    interpretation += 'are inactive/lapsed';
  }

  // Parse engagement level conditions
  if (lowerQuery.includes('highly engaged')) {
    // This would need custom scoring in implementation
    interpretation += interpretation ? ' and ' : '';
    interpretation += 'are highly engaged';
    fields.push('cobalt_engagementscore');
  } else if (lowerQuery.includes('at risk') || lowerQuery.includes('at-risk')) {
    interpretation += interpretation ? ' and ' : '';
    interpretation += 'are at risk';
    fields.push('cobalt_engagementscore');
  }

  // Default fields if none specified
  if (fields.length === 0) {
    fields = [
      'ContactId',
      'FirstName', 
      'LastName',
      'EmailAddress1',
      'StatusCode',
      'CreatedOn',
      'ModifiedOn'
    ];
  }

  // Default interpretation if none built
  if (!interpretation) {
    interpretation = 'All members matching your query';
  }

  return {
    filter: filter || 'statuscode<ne>null', // Default to all records
    fields,
    entity,
    interpretation: interpretation.charAt(0).toUpperCase() + interpretation.slice(1),
    isNameSearch: (firstName !== null || lastName !== null || multipleNames.length > 0) // Mark as name search if we found names
  };
}

/**
 * Suggests queries based on partial input
 */
export function suggestQueries(partialQuery: string): string[] {
  const suggestions = [
    'members who joined last year',
    'members who haven\'t renewed',
    'members with overdue payments',
    'members who haven\'t attended events in 6 months',
    'highly engaged members',
    'at-risk members',
    'members expiring in 30 days',
    'members not on any committee',
    'active members from downtown chapter',
    'lifetime members',
    'members who joined this year and attended 2+ events',
    'inactive members with outstanding balances'
  ];

  const lower = partialQuery.toLowerCase();
  return suggestions.filter(s => s.includes(lower)).slice(0, 5);
}

/**
 * Validates and corrects RAMCO filter syntax
 */
export function validateFilterSyntax(filter: string): { valid: boolean; corrected?: string; error?: string } {
  try {
    // Basic validation rules
    const operators = ['<eq>', '<ne>', '<gt>', '<ge>', '<lt>', '<le>', '<like>', '<notlike>'];
    const logicalOps = [' and ', ' or '];
    
    // Check for balanced quotes
    const singleQuotes = (filter.match(/'/g) || []).length;
    if (singleQuotes % 2 !== 0) {
      return { valid: false, error: 'Unbalanced quotes in filter' };
    }

    // Check for valid operators
    let hasValidOperator = false;
    for (const op of operators) {
      if (filter.includes(op)) {
        hasValidOperator = true;
        break;
      }
    }

    if (!hasValidOperator && filter !== 'statuscode<ne>null') {
      return { valid: false, error: 'No valid operator found in filter' };
    }

    // Basic corrections
    let corrected = filter;
    
    // Ensure date formats are correct (YYYY-MM-DD)
    corrected = corrected.replace(/(\d{1,2})\/(\d{1,2})\/(\d{4})/g, '$3-$1-$2');
    
    // Ensure string values are quoted
    corrected = corrected.replace(/<eq>([^']\S+)(?!['>])/g, '<eq>\'$1\'');
    
    return { valid: true, corrected };
  } catch (error) {
    return { valid: false, error: 'Invalid filter syntax' };
  }
}

/**
 * Builds complex filters from multiple conditions
 */
export function buildComplexFilter(conditions: Array<{ field: string; operator: string; value: any; logic?: 'and' | 'or' }>): string {
  return conditions.map((cond, index) => {
    const { field, operator, value, logic } = cond;
    let filterPart = '';
    
    // Add logical operator if not first condition
    if (index > 0) {
      filterPart += ` ${logic || 'and'} `;
    }
    
    // Build the condition
    const quotedValue = typeof value === 'string' && !value.startsWith('\'') 
      ? `'${value}'` 
      : value;
    
    filterPart += `${field}${operator}${quotedValue}`;
    
    return filterPart;
  }).join('');
}
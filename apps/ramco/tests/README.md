# Integration Tests

Integration tests for the RAMCO MCP server bulk operations and API fixes.

## Setup

1. Set environment variables:
```bash
export RAMCO_API_KEY="your-api-key"
export RAMCO_ASSOCIATION_ID="your-association-id" # Optional
```

2. Install tsx for running TypeScript directly:
```bash
npm install -g tsx
```

## Running Tests

### All Bulk Operations Tests
```bash
tsx tests/integration/bulk-operations.test.ts
```

## What These Tests Verify

### 1. Active Record Filtering
- Ensures `statecode<eq>0` filter works correctly
- Verifies only active contacts are returned
- Prevents errors from inactive/deleted records

### 2. Bulk Fetch with Filtering
- Tests `fetchAllRecords()` with active filter
- Verifies pagination works with filters
- Ensures bulk operations exclude inactive records

### 3. Relationship Navigation
- Tests `getRecordWithRelationships()` method
- Verifies single-call relationship fetching
- Validates relationship data structure

### 4. Two-Phase Sync (IDs Only)
- Tests `getTwoPhaseContactIds()` function
- Verifies contact ID deduplication
- Shows performance improvement from ID-only queries

### 5. Two-Phase Complete Sync
- Tests `twoPhaseContactSync()` complete workflow
- Fetches full records with optional relationships
- Verifies incremental sync pattern

### 6. Bulk Relationship Filtering
- Tests `fetchBulkRelationships()` with multiple contacts
- Ensures relationships include statecode filter
- Validates Map structure of results

### 7. Filter Utilities
- Tests filter builder functions
- Validates filter syntax
- Ensures proper combination of multiple filters

## Test Output

```
========================================
  Bulk Operations Integration Tests
========================================

🧪 Running: Active Record Filtering
   Verified 10 records all have StateCode=0
✅ Active Record Filtering - Passed (245ms)

🧪 Running: Bulk Fetch with Filtering
   Bulk fetch verified 10 active records
✅ Bulk Fetch with Filtering - Passed (312ms)

...

========================================
  Test Summary
========================================
✅ Active Record Filtering (245ms)
✅ Bulk Fetch with Filtering (312ms)
✅ Relationship Navigation (189ms)
✅ Two-Phase Sync (IDs Only) (523ms)
✅ Two-Phase Complete Sync (891ms)
✅ Bulk Relationship Filtering (1043ms)
✅ Filter Utilities (2ms)

Total: 7 | Passed: 7 | Failed: 0
```

## Troubleshooting

### API Key Issues
```
❌ RAMCO_API_KEY environment variable not set
```
**Solution**: Set your API key in environment variables

### Connection Errors
```
Error: RAMCO API timeout
```
**Solution**:
- Check network connection
- Verify API endpoint is accessible
- Increase timeout in test config

### Filter Syntax Errors
```
Error: Invalid filter syntax
```
**Solution**:
- Check RAMCO API documentation for filter operators
- Verify field names are correct
- Ensure proper quoting of string values

## Performance Benchmarks

Expected performance improvements from fixes:

| Operation | Before | After | Improvement |
|-----------|--------|-------|-------------|
| 500 member bulk fetch | 25-30 min | 8-10 min | 60-70% faster |
| 500 member relationships | 1,500 calls | 75 calls | 95% fewer calls |
| Two-phase sync (100 changes) | 300 calls | 6 calls | 98% fewer calls |

## Adding New Tests

Create new test files in `tests/integration/`:

```typescript
async function testYourFeature() {
  const client = createRamcoClient(TEST_CONFIG);

  // Your test code here
  const result = await yourFunction(client);

  assert(result !== null, 'Should return a result');
  console.log(`   Test passed with ${result.length} items`);
}

await runTest('Your Feature Name', testYourFeature);
```

## CI/CD Integration

To run in CI/CD pipelines:

```yaml
# .github/workflows/test.yml
- name: Run Integration Tests
  env:
    RAMCO_API_KEY: ${{ secrets.RAMCO_API_KEY }}
    RAMCO_ASSOCIATION_ID: ${{ secrets.RAMCO_ASSOCIATION_ID }}
  run: |
    npm install -g tsx
    tsx tests/integration/bulk-operations.test.ts
```

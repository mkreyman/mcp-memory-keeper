# Default Pagination Feature

## Overview

The context_get handler now includes default pagination to prevent responses from exceeding MCP's 25,000 token limit. This feature was implemented to address potential issues when retrieving large numbers of context items.

## Default Behavior

### When Pagination is Applied

Default pagination is automatically applied when using `context_get` with:
- No specific key requested (listing all items)
- Any enhanced query parameters (sort, limit, offset, date filters, etc.)
- Channel or priority filters
- includeMetadata flag

### Default Values

- **Default Limit**: 100 items per request
- **Default Sort**: `created_desc` (most recent items first)
- **Token Safety**: Responses are monitored to stay under 20,000 tokens (conservative limit)

### Backward Compatibility

The implementation maintains full backward compatibility:
- Single item retrieval by key returns just the value (no JSON structure)
- Simple category filtering returns formatted text list
- Only complex queries return the new paginated JSON format

## Response Formats

### Simple Response (Backward Compatible)

When requesting a single item by key:
```
This is the item value
```

When filtering by category only:
```
Found 3 context items:

• [high] task.1: First task
• [normal] task.2: Second task
• [low] task.3: Third task
```

### Enhanced Response (With Pagination)

When using any enhanced features or listing all items:
```json
{
  "items": [...],
  "pagination": {
    "total": 500,
    "returned": 100,
    "offset": 0,
    "hasMore": true,
    "nextOffset": 100,
    "totalCount": 500,
    "page": 1,
    "pageSize": 100,
    "totalPages": 5,
    "hasNextPage": true,
    "hasPreviousPage": false,
    "previousOffset": null,
    "defaultsApplied": {
      "limit": true,
      "sort": true
    }
  }
}
```

With `includeMetadata: true`, additional fields are included:
- `totalSize`: Total byte size of returned items
- `averageSize`: Average size per item
- `warning`: Added when approaching token limits

## Usage Examples

### Basic Listing (Uses Default Pagination)
```javascript
await context_get({})
// Returns first 100 items with pagination metadata
```

### Get Next Page
```javascript
await context_get({ offset: 100 })
// Returns items 101-200
```

### Override Defaults
```javascript
await context_get({ 
  limit: 50,
  sort: 'key_asc' 
})
// Returns 50 items sorted by key
```

### Single Item (No Pagination)
```javascript
await context_get({ key: 'my.item' })
// Returns just the value string
```

### Category Filter (No Pagination)
```javascript
await context_get({ category: 'task' })
// Returns formatted text list
```

## Implementation Details

### Token Estimation

The system estimates token usage using:
- 1 token ≈ 4 characters (conservative estimate)
- Response size includes JSON structure overhead
- Warning threshold: 20,000 tokens

### Performance

- Default pagination improves performance for large datasets
- Queries return quickly even with thousands of items
- Count queries are optimized separately from data retrieval

### Error Handling

- Invalid limit values (non-numeric) default to 100
- Negative limits are treated as default (100)
- Limit of 0 means unlimited (use with caution)
- Offsets beyond available items return empty results

## Testing

Comprehensive tests are available in:
- `src/__tests__/integration/paginationDefaultsHandler.test.ts`
- `src/__tests__/integration/backward-compatibility.test.ts`

Run tests with:
```bash
npm test -- paginationDefaultsHandler
npm test -- backward-compatibility
```
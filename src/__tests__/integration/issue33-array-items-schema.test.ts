import { describe, it, expect } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Issue #33: full tool profile exposes a schema that breaks some OpenAI-compatible providers
 *
 * Some providers reject tool schemas where an array property lacks an `items` declaration.
 * Per JSON Schema spec, `items` is required for `type: 'array'` to fully describe the schema.
 *
 * This test scans src/index.ts and verifies that every property with `type: 'array'`
 * has an `items` declaration within the same schema block.
 *
 * @see https://github.com/mkreyman/mcp-memory-keeper/issues/33
 */

/**
 * Scan the source for tool definitions and find array properties missing `items`.
 *
 * Strategy: for each tool (name: 'context_*'), extract its inputSchema block,
 * then find every `type: 'array'` and check that `items` appears as the next
 * sibling property (before the next `}` that closes that property).
 */
function findArrayPropertiesMissingItems(
  src: string
): Array<{ tool: string; property: string; line: number }> {
  const violations: Array<{ tool: string; property: string; line: number }> = [];
  const lines = src.split('\n');

  let currentTool = '';

  for (let i = 0; i < lines.length; i++) {
    // Track which tool we're inside
    const toolMatch = lines[i].match(/name:\s*'(context_[a-z_]+)'/);
    if (toolMatch) {
      currentTool = toolMatch[1];
    }

    // Find array type declarations
    if (!lines[i].match(/type:\s*'array'/)) continue;
    if (!currentTool) continue;

    // Look at the surrounding context to find the property name (look backwards)
    let propertyName = '(unknown)';
    for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
      const propMatch = lines[j].match(/(\w+)\s*:\s*\{/);
      if (propMatch) {
        propertyName = propMatch[1];
        break;
      }
    }

    // Check if `items` appears within the next few lines before the property closes
    // We need to look forward until we find either `items` or a closing `}` at the
    // same or lower depth
    let foundItems = false;
    let depth = 0;

    for (let j = i + 1; j < Math.min(lines.length, i + 50); j++) {
      const line = lines[j];

      // Count braces to track depth
      for (const ch of line) {
        if (ch === '{') depth++;
        if (ch === '}') depth--;
      }

      // Check for items declaration at current property level
      if (line.match(/^\s*items\s*:/) || line.match(/^\s*items:\s/)) {
        foundItems = true;
        break;
      }

      // If we've closed back to or past the array property's level, stop
      if (depth < 0) break;
    }

    if (!foundItems) {
      violations.push({
        tool: currentTool,
        property: propertyName,
        line: i + 1, // 1-indexed
      });
    }
  }

  return violations;
}

describe('Issue #33: Array properties must declare items', () => {
  const indexPath = path.join(__dirname, '..', '..', 'index.ts');
  // Strip block comments to avoid scanning commented-out tool schemas
  const rawSrc = fs.readFileSync(indexPath, 'utf-8');
  const src = rawSrc.split(/\/\*[\s\S]*?\*\//).join('');

  it('should find tool definitions in source', () => {
    const toolNames = src.match(/name:\s*'context_[a-z_]+'/g);
    expect(toolNames).not.toBeNull();
    expect(toolNames!.length).toBeGreaterThan(0);
  });

  it('every array property in every tool schema must have an items declaration', () => {
    const violations = findArrayPropertiesMissingItems(src);

    expect(violations).toHaveLength(0);
  });

  it('context_delegate.input.insights specifically must have items', () => {
    // Find the insights property in context_delegate's schema
    const lines = src.split('\n');
    let inDelegate = false;
    let insightsLine = -1;

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].match(/name:\s*'context_delegate'/)) {
        inDelegate = true;
      }
      // Stop at next tool definition
      if (
        inDelegate &&
        i > 0 &&
        lines[i].match(/name:\s*'context_/) &&
        !lines[i].match(/context_delegate/)
      ) {
        break;
      }
      if (inDelegate && lines[i].match(/insights\s*:\s*\{/)) {
        insightsLine = i;
        break;
      }
    }

    expect(insightsLine).toBeGreaterThan(-1);

    // Check that the insights property has type: 'array' and items
    const insightsBlock = lines.slice(insightsLine, insightsLine + 5).join('\n');
    expect(insightsBlock).toContain("type: 'array'");
    expect(insightsBlock).toMatch(/items\s*:/);
  });
});

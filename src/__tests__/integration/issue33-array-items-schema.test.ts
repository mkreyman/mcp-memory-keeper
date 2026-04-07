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
 * Skips block comments to avoid false positives from commented-out schemas.
 * Line numbers refer to the original source file for accurate debugging.
 */
function findArrayPropertiesMissingItems(
  src: string
): Array<{ tool: string; property: string; line: number }> {
  const violations: Array<{ tool: string; property: string; line: number }> = [];
  const lines = src.split('\n');

  let currentTool = '';
  let inBlockComment = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Track block comment state
    if (inBlockComment) {
      if (line.includes('*/')) {
        inBlockComment = false;
      }
      continue;
    }
    if (line.includes('/*')) {
      inBlockComment = true;
      if (line.includes('*/')) {
        inBlockComment = false;
      }
      continue;
    }

    // Track which tool we're inside
    const toolMatch = line.match(/name:\s*'(context_[a-z_]+)'/);
    if (toolMatch) {
      currentTool = toolMatch[1];
    }

    // Find array type declarations
    if (!line.match(/type:\s*'array'/)) continue;
    if (!currentTool) continue;

    // Look backwards to find the property name
    let propertyName = '(unknown)';
    for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
      const propMatch = lines[j].match(/(\w+)\s*:\s*\{/);
      if (propMatch) {
        propertyName = propMatch[1];
        break;
      }
    }

    // Scan forward for `items` declaration before the property closes
    let foundItems = false;
    let depth = 0;

    for (let j = i + 1; j < Math.min(lines.length, i + 50); j++) {
      const fwdLine = lines[j];

      for (const ch of fwdLine) {
        if (ch === '{') depth++;
        if (ch === '}') depth--;
      }

      if (fwdLine.match(/^\s*items\s*:/)) {
        foundItems = true;
        break;
      }

      if (depth < 0) break;
    }

    if (!foundItems) {
      violations.push({
        tool: currentTool,
        property: propertyName,
        line: i + 1,
      });
    }
  }

  return violations;
}

describe('Issue #33: Array properties must declare items', () => {
  const indexPath = path.join(__dirname, '..', '..', 'index.ts');
  const src = fs.readFileSync(indexPath, 'utf-8');

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
    const lines = src.split('\n');
    let inDelegate = false;
    let insightsLine = -1;

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].match(/name:\s*'context_delegate'/)) {
        inDelegate = true;
      }
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

    const insightsBlock = lines.slice(insightsLine, insightsLine + 5).join('\n');
    expect(insightsBlock).toContain("type: 'array'");
    expect(insightsBlock).toMatch(/items\s*:/);
  });
});

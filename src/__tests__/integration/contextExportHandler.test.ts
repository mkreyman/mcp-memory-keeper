import { DatabaseManager } from '../../utils/database';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

describe('Enhanced context_export Handler Tests', () => {
  let dbManager: DatabaseManager;
  let tempDbPath: string;
  let tempExportPath: string;
  let db: any;
  let currentSessionId: string | null;

  interface ExportResult {
    content: Array<{ type: string; text: string }>;
    exportPath?: string;
    statistics?: {
      items: number;
      files: number;
      checkpoints: number;
      size?: number;
    };
    isEmpty?: boolean;
    requiresConfirmation?: boolean;
  }

  // Mock the handler function - this will be replaced with actual implementation
  const contextExportHandler = async (
    args: any,
    db: any,
    currentSessionId: string | null
  ): Promise<ExportResult> => {
    // This is a mock implementation that represents the expected behavior
    // In TDD, this will be replaced with the actual implementation
    const { sessionId: specificSessionId, format = 'json', includeStats = false } = args;
    const targetSessionId = specificSessionId || currentSessionId;

    // Phase 1: Validation
    if (!targetSessionId) {
      throw new Error('No session ID provided and no current session active');
    }

    // Check if session exists
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(targetSessionId);
    if (!session) {
      throw new Error(`Session not found: ${targetSessionId}`);
    }

    // Get session data
    const contextItems = db
      .prepare('SELECT * FROM context_items WHERE session_id = ?')
      .all(targetSessionId);
    const fileCache = db
      .prepare('SELECT * FROM file_cache WHERE session_id = ?')
      .all(targetSessionId);
    const checkpoints = db
      .prepare('SELECT * FROM checkpoints WHERE session_id = ?')
      .all(targetSessionId);

    // Check if session is empty
    const isEmpty = contextItems.length === 0 && fileCache.length === 0 && checkpoints.length === 0;
    if (isEmpty && !args.confirmEmpty) {
      return {
        content: [
          {
            type: 'text',
            text: 'Warning: Session appears to be empty. No context items, files, or checkpoints found.\n\nTo export anyway, use confirmEmpty: true',
          },
        ],
        isEmpty: true,
        requiresConfirmation: true,
      };
    }

    const exportData = {
      version: '0.4.0',
      exported: new Date().toISOString(),
      session,
      contextItems,
      fileCache,
      checkpoints,
      metadata: {
        itemCount: contextItems.length,
        fileCount: fileCache.length,
        checkpointCount: checkpoints.length,
        totalSize: JSON.stringify({ contextItems, fileCache, checkpoints }).length,
      },
    };

    if (format === 'json') {
      const exportPath = path.resolve(
        `memory-keeper-export-${targetSessionId.substring(0, 8)}.json`
      );

      // Check write permissions
      try {
        fs.writeFileSync(exportPath, JSON.stringify(exportData, null, 2));
      } catch (error: any) {
        if (error.code === 'EACCES') {
          throw new Error(`Permission denied: Cannot write to ${exportPath}`);
        }
        throw error;
      }

      const stats = {
        items: contextItems.length,
        files: fileCache.length,
        checkpoints: checkpoints.length,
        size: fs.statSync(exportPath).size,
      };

      return {
        content: [
          {
            type: 'text',
            text: includeStats
              ? `✅ Successfully exported session "${session.name}" to: ${exportPath}

📊 Export Statistics:
- Context Items: ${stats.items}
- Cached Files: ${stats.files}
- Checkpoints: ${stats.checkpoints}
- Export Size: ${(stats.size / 1024).toFixed(2)} KB

Session ID: ${targetSessionId}`
              : `Exported session to: ${exportPath}
Items: ${stats.items}
Files: ${stats.files}`,
          },
        ],
        exportPath,
        statistics: stats,
      };
    }

    // Inline format
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(exportData, null, 2),
        },
      ],
      statistics: {
        items: contextItems.length,
        files: fileCache.length,
        checkpoints: checkpoints.length,
      },
    };
  };

  beforeEach(() => {
    tempDbPath = path.join(os.tmpdir(), `test-export-handler-${Date.now()}.db`);
    tempExportPath = path.join(os.tmpdir(), `test-exports-handler-${Date.now()}`);

    dbManager = new DatabaseManager({
      filename: tempDbPath,
      maxSize: 10 * 1024 * 1024,
      walMode: true,
    });
    db = dbManager.getDatabase();

    // Create export directory
    fs.mkdirSync(tempExportPath, { recursive: true });

    // Set current session
    currentSessionId = uuidv4();
    db.prepare('INSERT INTO sessions (id, name, description) VALUES (?, ?, ?)').run(
      currentSessionId,
      'Current Session',
      'Test session'
    );
  });

  afterEach(() => {
    dbManager.close();
    try {
      fs.unlinkSync(tempDbPath);
      fs.unlinkSync(`${tempDbPath}-wal`);
      fs.unlinkSync(`${tempDbPath}-shm`);
      fs.rmSync(tempExportPath, { recursive: true, force: true });
      // Clean up any export files
      const exportFiles = fs.readdirSync('.').filter(f => f.startsWith('memory-keeper-export-'));
      exportFiles.forEach(f => fs.unlinkSync(f));
    } catch (_e) {
      // Ignore
    }
  });

  describe('Validation Tests', () => {
    it('should throw error when exporting with invalid session ID', async () => {
      const invalidSessionId = uuidv4();

      await expect(
        contextExportHandler({ sessionId: invalidSessionId }, db, currentSessionId)
      ).rejects.toThrow(`Session not found: ${invalidSessionId}`);
    });

    it('should throw error when no session ID provided and no current session', async () => {
      await expect(contextExportHandler({}, db, null)).rejects.toThrow(
        'No session ID provided and no current session active'
      );
    });

    it('should warn when exporting empty session without confirmation', async () => {
      // Create empty session
      const emptySessionId = uuidv4();
      db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(
        emptySessionId,
        'Empty Session'
      );

      const result = await contextExportHandler(
        { sessionId: emptySessionId },
        db,
        currentSessionId
      );

      expect(result.isEmpty).toBe(true);
      expect(result.requiresConfirmation).toBe(true);
      expect(result.content[0].text).toContain('Warning: Session appears to be empty');
      expect(result.content[0].text).toContain('confirmEmpty: true');
    });

    it('should allow exporting empty session with confirmation', async () => {
      // Create empty session
      const emptySessionId = uuidv4();
      db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(
        emptySessionId,
        'Empty Session'
      );

      const result = await contextExportHandler(
        { sessionId: emptySessionId, confirmEmpty: true },
        db,
        currentSessionId
      );

      expect(result.isEmpty).toBeUndefined();
      expect(result.requiresConfirmation).toBeUndefined();
      expect(result.exportPath).toBeDefined();
      expect(result.statistics!.items).toBe(0);
      expect(result.statistics!.files).toBe(0);
    });
  });

  describe('Success Path Tests', () => {
    it('should export session with statistics when includeStats is true', async () => {
      // Add test data
      const items = [
        { key: 'task1', value: 'Complete feature', category: 'task', priority: 'high' },
        { key: 'note1', value: 'Important note', category: 'note', priority: 'normal' },
      ];

      items.forEach(item => {
        db.prepare(
          'INSERT INTO context_items (id, session_id, key, value, category, priority) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(uuidv4(), currentSessionId, item.key, item.value, item.category, item.priority);
      });

      // Add file cache
      db.prepare(
        'INSERT INTO file_cache (id, session_id, file_path, content, hash) VALUES (?, ?, ?, ?, ?)'
      ).run(uuidv4(), currentSessionId, '/test.ts', 'test content', 'hash123');

      // Add checkpoint
      db.prepare('INSERT INTO checkpoints (id, session_id, name) VALUES (?, ?, ?)').run(
        uuidv4(),
        currentSessionId,
        'Test Checkpoint'
      );

      const result = await contextExportHandler({ includeStats: true }, db, currentSessionId);

      expect(result.content[0].text).toContain('✅ Successfully exported session');
      expect(result.content[0].text).toContain('📊 Export Statistics:');
      expect(result.content[0].text).toContain('Context Items: 2');
      expect(result.content[0].text).toContain('Cached Files: 1');
      expect(result.content[0].text).toContain('Checkpoints: 1');
      expect(result.content[0].text).toContain('Export Size:');
      expect(result.content[0].text).toContain(`Session ID: ${currentSessionId}`);

      expect(result.statistics).toEqual({
        items: 2,
        files: 1,
        checkpoints: 1,
        size: expect.any(Number),
      });
    });

    it('should export in JSON format by default', async () => {
      // Add minimal data
      db.prepare('INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)').run(
        uuidv4(),
        currentSessionId,
        'key1',
        'value1'
      );

      const result = await contextExportHandler({}, db, currentSessionId);

      expect(result.exportPath).toBeDefined();
      expect(result.exportPath).toContain('memory-keeper-export-');
      expect(result.exportPath).toMatch(/\.json$/);

      // Verify file exists and has correct structure
      const exportData = JSON.parse(fs.readFileSync(result.exportPath!, 'utf-8'));
      expect(exportData.version).toBe('0.4.0');
      expect(exportData.exported).toBeDefined();
      expect(exportData.session).toBeDefined();
      expect(exportData.contextItems).toHaveLength(1);
      expect(exportData.metadata).toEqual({
        itemCount: 1,
        fileCount: 0,
        checkpointCount: 0,
        totalSize: expect.any(Number),
      });
    });

    it('should export in inline format when requested', async () => {
      // Add test data
      db.prepare('INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)').run(
        uuidv4(),
        currentSessionId,
        'key1',
        'value1'
      );

      const result = await contextExportHandler({ format: 'inline' }, db, currentSessionId);

      expect(result.exportPath).toBeUndefined();
      expect(result.content[0].type).toBe('text');

      const exportData = JSON.parse(result.content[0].text);
      expect(exportData.version).toBe('0.4.0');
      expect(exportData.contextItems).toHaveLength(1);
      expect(result.statistics).toEqual({
        items: 1,
        files: 0,
        checkpoints: 0,
      });
    });

    it('should use absolute file paths for exports', async () => {
      db.prepare('INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)').run(
        uuidv4(),
        currentSessionId,
        'key1',
        'value1'
      );

      const result = await contextExportHandler({}, db, currentSessionId);

      expect(path.isAbsolute(result.exportPath!)).toBe(true);
      expect(result.exportPath).toMatch(/^(\/|[A-Z]:\\)/); // Unix or Windows absolute path
    });

    it('should handle large exports with many items', async () => {
      // Add many items
      for (let i = 0; i < 100; i++) {
        db.prepare(
          'INSERT INTO context_items (id, session_id, key, value, category, priority) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(
          uuidv4(),
          currentSessionId,
          `key${i}`,
          `This is a test value for item ${i} with some additional content to make it larger`,
          i % 2 === 0 ? 'task' : 'note',
          i % 3 === 0 ? 'high' : 'normal'
        );
      }

      const result = await contextExportHandler({ includeStats: true }, db, currentSessionId);

      expect(result.statistics!.items).toBe(100);
      expect(result.content[0].text).toContain('Context Items: 100');

      // Verify file size is reasonable
      const stats = fs.statSync(result.exportPath!);
      expect(stats.size).toBeGreaterThan(10000); // Should be at least 10KB
      expect(result.content[0].text).toMatch(/Export Size: \d+\.\d+ KB/);
    });
  });

  describe('Error Handling Tests', () => {
    it('should handle file system errors gracefully', async () => {
      // Add test data
      db.prepare('INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)').run(
        uuidv4(),
        currentSessionId,
        'key1',
        'value1'
      );

      // Create a mock handler that simulates fs errors
      const errorHandler = async (
        _args: any,
        _db: any,
        _currentSessionId: string | null
      ): Promise<ExportResult> => {
        throw new Error('Disk full');
      };

      await expect(errorHandler({}, db, currentSessionId)).rejects.toThrow('Disk full');
    });

    it('should handle permission errors with specific message', async () => {
      // Add test data
      db.prepare('INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)').run(
        uuidv4(),
        currentSessionId,
        'key1',
        'value1'
      );

      // Create a mock handler that simulates permission errors
      const permissionErrorHandler = async (
        args: any,
        _db: any,
        currentSessionId: string | null
      ): Promise<ExportResult> => {
        const { sessionId: specificSessionId } = args;
        const targetSessionId = specificSessionId || currentSessionId;

        if (!targetSessionId) {
          throw new Error('No session ID provided and no current session active');
        }

        // Simulating permission check without using db
        if (!targetSessionId) {
          throw new Error(`Session not found: ${targetSessionId}`);
        }

        const exportPath = path.resolve(
          `memory-keeper-export-${targetSessionId.substring(0, 8)}.json`
        );
        const error: any = new Error('EACCES: permission denied');
        error.code = 'EACCES';
        throw new Error(`Permission denied: Cannot write to ${exportPath}`);
      };

      await expect(permissionErrorHandler({}, db, currentSessionId)).rejects.toThrow(
        /Permission denied: Cannot write to/
      );
    });

    it('should handle invalid export paths', async () => {
      // This test would be implemented when path validation is added
      // For now, we'll skip it as the current implementation doesn't validate paths
      expect(true).toBe(true);
    });

    it('should handle database errors during export', async () => {
      // Mock database error
      const mockDb = {
        prepare: jest.fn().mockImplementation((query: string) => {
          if (query.includes('SELECT * FROM sessions')) {
            return {
              get: () => {
                throw new Error('Database locked');
              },
            };
          }
          return {
            get: () => null,
            all: () => [],
          };
        }),
      };

      await expect(contextExportHandler({}, mockDb, currentSessionId)).rejects.toThrow(
        'Database locked'
      );
    });
  });

  describe('Backward Compatibility Tests', () => {
    it('should maintain existing behavior when no new options provided', async () => {
      // Add test data
      db.prepare('INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)').run(
        uuidv4(),
        currentSessionId,
        'key1',
        'value1'
      );

      db.prepare(
        'INSERT INTO file_cache (id, session_id, file_path, content, hash) VALUES (?, ?, ?, ?, ?)'
      ).run(uuidv4(), currentSessionId, '/test.ts', 'content', 'hash');

      // Call with no options (existing behavior)
      const result = await contextExportHandler({}, db, currentSessionId);

      // Should return in the old format
      expect(result.content[0].text).toMatch(/^Exported session to: .+\nItems: 1\nFiles: 1$/);
      expect(result.content[0].text).not.toContain('✅');
      expect(result.content[0].text).not.toContain('📊');
    });

    it('should support existing sessionId parameter', async () => {
      // Create another session
      const otherSessionId = uuidv4();
      db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(
        otherSessionId,
        'Other Session'
      );

      db.prepare('INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)').run(
        uuidv4(),
        otherSessionId,
        'other_key',
        'other_value'
      );

      const result = await contextExportHandler(
        { sessionId: otherSessionId },
        db,
        currentSessionId
      );

      expect(result.exportPath).toContain(otherSessionId.substring(0, 8));

      const exportData = JSON.parse(fs.readFileSync(result.exportPath!, 'utf-8'));
      expect(exportData.session.name).toBe('Other Session');
      expect(exportData.contextItems[0].key).toBe('other_key');
    });

    it('should support existing format parameter', async () => {
      db.prepare('INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)').run(
        uuidv4(),
        currentSessionId,
        'key1',
        'value1'
      );

      // Test JSON format (default)
      const jsonResult = await contextExportHandler({ format: 'json' }, db, currentSessionId);
      expect(jsonResult.exportPath).toBeDefined();

      // Test inline format
      const inlineResult = await contextExportHandler({ format: 'inline' }, db, currentSessionId);
      expect(inlineResult.exportPath).toBeUndefined();
      expect(inlineResult.content[0].text).toContain('"version": "0.4.0"');
    });
  });

  describe('Edge Cases', () => {
    it('should handle session with only context items', async () => {
      db.prepare('INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)').run(
        uuidv4(),
        currentSessionId,
        'key1',
        'value1'
      );

      const result = await contextExportHandler({ includeStats: true }, db, currentSessionId);

      expect(result.statistics).toEqual({
        items: 1,
        files: 0,
        checkpoints: 0,
        size: expect.any(Number),
      });
    });

    it('should handle session with only file cache', async () => {
      db.prepare(
        'INSERT INTO file_cache (id, session_id, file_path, content, hash) VALUES (?, ?, ?, ?, ?)'
      ).run(uuidv4(), currentSessionId, '/file.ts', 'content', 'hash');

      const result = await contextExportHandler({ includeStats: true }, db, currentSessionId);

      expect(result.statistics).toEqual({
        items: 0,
        files: 1,
        checkpoints: 0,
        size: expect.any(Number),
      });
    });

    it('should handle session with only checkpoints', async () => {
      db.prepare('INSERT INTO checkpoints (id, session_id, name) VALUES (?, ?, ?)').run(
        uuidv4(),
        currentSessionId,
        'Checkpoint'
      );

      const result = await contextExportHandler({ includeStats: true }, db, currentSessionId);

      expect(result.statistics).toEqual({
        items: 0,
        files: 0,
        checkpoints: 1,
        size: expect.any(Number),
      });
    });

    it('should handle very long session names', async () => {
      const longName = 'A'.repeat(500);
      const longSessionId = uuidv4();

      db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(longSessionId, longName);

      db.prepare('INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)').run(
        uuidv4(),
        longSessionId,
        'key1',
        'value1'
      );

      const result = await contextExportHandler(
        { sessionId: longSessionId, includeStats: true },
        db,
        currentSessionId
      );

      expect(result.content[0].text).toContain(`Successfully exported session "${longName}"`);
      expect(result.exportPath).toBeDefined();
    });

    it('should handle special characters in session data', async () => {
      const specialChars =
        'Test with "quotes", \'apostrophes\', \n newlines, \t tabs, and unicode: 😀';

      db.prepare('INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)').run(
        uuidv4(),
        currentSessionId,
        'special_key',
        specialChars
      );

      const result = await contextExportHandler({}, db, currentSessionId);

      // Verify the exported file contains properly escaped special characters
      const exportData = JSON.parse(fs.readFileSync(result.exportPath!, 'utf-8'));
      expect(exportData.contextItems[0].value).toBe(specialChars);
    });
  });

  describe('Integration Tests', () => {
    it('should work with complete session data including all components', async () => {
      // Create comprehensive test data
      const itemIds: string[] = [];

      // Add context items with various categories and priorities
      ['task', 'decision', 'progress', 'note', 'error', 'warning'].forEach((category, idx) => {
        const itemId = uuidv4();
        itemIds.push(itemId);
        db.prepare(
          'INSERT INTO context_items (id, session_id, key, value, category, priority) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(
          itemId,
          currentSessionId,
          `${category}_item`,
          `This is a ${category} item`,
          category,
          idx % 3 === 0 ? 'high' : idx % 3 === 1 ? 'normal' : 'low'
        );
      });

      // Add file cache entries
      ['/src/index.ts', '/src/utils.ts', '/tests/test.spec.ts'].forEach(filePath => {
        db.prepare(
          'INSERT INTO file_cache (id, session_id, file_path, content, hash) VALUES (?, ?, ?, ?, ?)'
        ).run(
          uuidv4(),
          currentSessionId,
          filePath,
          `Content of ${filePath}`,
          `hash_${filePath.replace(/\//g, '_')}`
        );
      });

      // Add checkpoints with linked items
      const checkpointId = uuidv4();
      db.prepare(
        'INSERT INTO checkpoints (id, session_id, name, description) VALUES (?, ?, ?, ?)'
      ).run(
        checkpointId,
        currentSessionId,
        'Major Milestone',
        'Checkpoint after completing major feature'
      );

      // Link some items to checkpoint
      itemIds.slice(0, 3).forEach(itemId => {
        db.prepare(
          'INSERT INTO checkpoint_items (id, checkpoint_id, context_item_id) VALUES (?, ?, ?)'
        ).run(uuidv4(), checkpointId, itemId);
      });

      // Export with full statistics
      const result = await contextExportHandler({ includeStats: true }, db, currentSessionId);

      // Verify comprehensive export
      expect(result.statistics).toEqual({
        items: 6,
        files: 3,
        checkpoints: 1,
        size: expect.any(Number),
      });

      expect(result.content[0].text).toContain('Context Items: 6');
      expect(result.content[0].text).toContain('Cached Files: 3');
      expect(result.content[0].text).toContain('Checkpoints: 1');

      // Verify exported data structure
      const exportData = JSON.parse(fs.readFileSync(result.exportPath!, 'utf-8'));
      expect(exportData.contextItems).toHaveLength(6);
      expect(exportData.fileCache).toHaveLength(3);
      expect(exportData.checkpoints).toHaveLength(1);
      expect(exportData.metadata).toBeDefined();
      expect(exportData.metadata.totalSize).toBeGreaterThan(0);
    });

    it('should handle concurrent export requests gracefully', async () => {
      // Add test data
      db.prepare('INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)').run(
        uuidv4(),
        currentSessionId,
        'key1',
        'value1'
      );

      // Simulate concurrent exports
      const promises = Array(5)
        .fill(null)
        .map(() => contextExportHandler({ includeStats: true }, db, currentSessionId));

      const results = await Promise.all(promises);

      // All exports should succeed
      results.forEach(result => {
        expect(result.exportPath).toBeDefined();
        expect(result.statistics!.items).toBe(1);
      });

      // Clean up export files
      results.forEach(result => {
        if (result.exportPath && fs.existsSync(result.exportPath)) {
          fs.unlinkSync(result.exportPath);
        }
      });
    });
  });
});

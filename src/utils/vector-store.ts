import { Database } from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';

export interface VectorDocument {
  id: string;
  content: string;
  embedding: number[];
  metadata?: Record<string, any>;
}

export interface SearchResult {
  id: string;
  content: string;
  similarity: number;
  metadata?: Record<string, any>;
}

export class VectorStore {
  private db: Database;
  private dimension: number = 384; // Using smaller embeddings for efficiency

  constructor(db: Database) {
    this.db = db;
    this.initializeTables();
  }

  private initializeTables(): void {
    // Create vector storage table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS vector_embeddings (
        id TEXT PRIMARY KEY,
        content_id TEXT NOT NULL,
        content TEXT NOT NULL,
        embedding BLOB NOT NULL,
        metadata TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (content_id) REFERENCES context_items(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_vector_content_id ON vector_embeddings(content_id);
    `);
  }

  // Simple text embedding using character n-grams and hashing
  // This is a lightweight alternative to neural embeddings
  createEmbedding(text: string): number[] {
    const embedding = new Array(this.dimension).fill(0);
    const normalizedText = text.toLowerCase().replace(/\s+/g, ' ').trim();

    // Generate character trigrams
    const ngrams: string[] = [];
    for (let i = 0; i <= normalizedText.length - 3; i++) {
      ngrams.push(normalizedText.slice(i, i + 3));
    }

    // Also add word-level features
    const words = normalizedText.split(' ');
    for (const word of words) {
      if (word.length > 2) {
        ngrams.push(word);
      }
    }

    // Hash each n-gram to a position in the embedding
    for (const ngram of ngrams) {
      const hash = crypto.createHash('md5').update(ngram).digest();

      // Use multiple hash values to set multiple positions
      for (let i = 0; i < 3; i++) {
        const position = ((hash[i * 2] << 8) | hash[i * 2 + 1]) % this.dimension;
        const value = (hash[i * 2 + 2] % 256) / 255.0;
        embedding[position] += value;
      }
    }

    // Normalize the embedding
    const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    if (magnitude > 0) {
      for (let i = 0; i < embedding.length; i++) {
        embedding[i] /= magnitude;
      }
    }

    return embedding;
  }

  // Cosine similarity between two embeddings
  private cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude > 0 ? dotProduct / magnitude : 0;
  }

  // Store a document with its embedding
  async storeDocument(
    contentId: string,
    content: string,
    metadata?: Record<string, any>
  ): Promise<string> {
    const id = uuidv4();
    const embedding = this.createEmbedding(content);

    // Convert embedding to buffer for storage
    const buffer = Buffer.from(new Float32Array(embedding).buffer);

    const stmt = this.db.prepare(`
      INSERT INTO vector_embeddings (id, content_id, content, embedding, metadata)
      VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(id, contentId, content, buffer, metadata ? JSON.stringify(metadata) : null);

    return id;
  }

  // Search for similar documents
  async search(
    query: string,
    topK: number = 10,
    minSimilarity: number = 0.3
  ): Promise<SearchResult[]> {
    const queryEmbedding = this.createEmbedding(query);

    // Get all embeddings (in production, we'd want to optimize this)
    const rows = this.db
      .prepare('SELECT id, content, embedding, metadata FROM vector_embeddings')
      .all() as any[];

    const results: SearchResult[] = [];

    for (const row of rows) {
      // Convert buffer back to array
      const buffer = row.embedding as Buffer;
      const embedding = Array.from(
        new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4)
      );

      const similarity = this.cosineSimilarity(queryEmbedding, embedding);

      if (similarity >= minSimilarity) {
        results.push({
          id: row.id,
          content: row.content,
          similarity,
          metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
        });
      }
    }

    // Sort by similarity descending
    results.sort((a, b) => b.similarity - a.similarity);

    return results.slice(0, topK);
  }

  // Search within a specific session
  async searchInSession(
    sessionId: string,
    query: string,
    topK: number = 10,
    minSimilarity: number = 0.3
  ): Promise<SearchResult[]> {
    const queryEmbedding = this.createEmbedding(query);

    // Get embeddings for this session
    const rows = this.db
      .prepare(
        `
      SELECT ve.id, ve.content, ve.embedding, ve.metadata
      FROM vector_embeddings ve
      JOIN context_items ci ON ve.content_id = ci.id
      WHERE ci.session_id = ?
    `
      )
      .all(sessionId) as any[];

    const results: SearchResult[] = [];

    for (const row of rows) {
      const buffer = row.embedding as Buffer;
      const embedding = Array.from(
        new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4)
      );

      const similarity = this.cosineSimilarity(queryEmbedding, embedding);

      if (similarity >= minSimilarity) {
        results.push({
          id: row.id,
          content: row.content,
          similarity,
          metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
        });
      }
    }

    results.sort((a, b) => b.similarity - a.similarity);

    return results.slice(0, topK);
  }

  // Find related documents to a given document
  async findRelated(
    documentId: string,
    topK: number = 10,
    minSimilarity: number = 0.3
  ): Promise<SearchResult[]> {
    // Get the document's embedding
    const doc = this.db
      .prepare('SELECT content, embedding FROM vector_embeddings WHERE id = ?')
      .get(documentId) as any;

    if (!doc) {
      return [];
    }

    const buffer = doc.embedding as Buffer;
    const targetEmbedding = Array.from(
      new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4)
    );

    // Get all other embeddings
    const rows = this.db
      .prepare('SELECT id, content, embedding, metadata FROM vector_embeddings WHERE id != ?')
      .all(documentId) as any[];

    const results: SearchResult[] = [];

    for (const row of rows) {
      const rowBuffer = row.embedding as Buffer;
      const embedding = Array.from(
        new Float32Array(rowBuffer.buffer, rowBuffer.byteOffset, rowBuffer.byteLength / 4)
      );

      const similarity = this.cosineSimilarity(targetEmbedding, embedding);

      if (similarity >= minSimilarity) {
        results.push({
          id: row.id,
          content: row.content,
          similarity,
          metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
        });
      }
    }

    results.sort((a, b) => b.similarity - a.similarity);

    return results.slice(0, topK);
  }

  // Update embeddings for all context items in a session
  async updateSessionEmbeddings(sessionId: string): Promise<number> {
    // Get all context items without embeddings
    const items = this.db
      .prepare(
        `
      SELECT ci.id, ci.key, ci.value, ci.category, ci.priority
      FROM context_items ci
      LEFT JOIN vector_embeddings ve ON ci.id = ve.content_id
      WHERE ci.session_id = ? AND ve.id IS NULL
    `
      )
      .all(sessionId) as any[];

    let count = 0;
    for (const item of items) {
      const content = `${item.key}: ${item.value}`;
      const metadata = {
        key: item.key,
        category: item.category,
        priority: item.priority,
      };

      await this.storeDocument(item.id, content, metadata);
      count++;
    }

    return count;
  }

  // Delete embeddings for a content item
  deleteEmbedding(contentId: string): void {
    this.db.prepare('DELETE FROM vector_embeddings WHERE content_id = ?').run(contentId);
  }

  // Get statistics
  getStats(): { totalDocuments: number; avgSimilarity?: number } {
    const count = this.db.prepare('SELECT COUNT(*) as count FROM vector_embeddings').get() as any;

    return {
      totalDocuments: count.count,
    };
  }
}

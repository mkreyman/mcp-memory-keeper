// Core entity types for the database schema

export interface Session {
  id: string;
  name: string;
  description?: string;
  branch?: string;
  working_directory?: string;
  parent_id?: string;
  created_at: string;
  updated_at: string;
}

export interface ContextItem {
  id: string;
  session_id: string;
  key: string;
  value: string;
  category?: string;
  priority: 'high' | 'normal' | 'low';
  metadata?: string;
  size: number;
  created_at: string;
  updated_at: string;
}

export interface FileCache {
  id: string;
  session_id: string;
  file_path: string;
  content?: string;
  hash?: string;
  size: number;
  last_read: string;
  updated_at: string;
}

export interface Checkpoint {
  id: string;
  session_id: string;
  name: string;
  description?: string;
  git_status?: string;
  git_branch?: string;
  created_at: string;
}

export interface CheckpointItem {
  id: string;
  checkpoint_id: string;
  context_item_id: string;
}

export interface CheckpointFile {
  id: string;
  checkpoint_id: string;
  file_cache_id: string;
}

export interface JournalEntry {
  id: string;
  session_id: string;
  entry: string;
  tags?: string;
  mood?: string;
  created_at: string;
}

export interface CompressedContext {
  id: string;
  session_id: string;
  original_count: number;
  compressed_data: string;
  compression_ratio: number;
  date_range_start?: string;
  date_range_end?: string;
  created_at: string;
}

export interface ToolEvent {
  id: string;
  session_id: string;
  tool_name: string;
  event_type: string;
  data?: string;
  created_at: string;
}

// Input types for creating/updating entities
export interface CreateContextItemInput {
  key: string;
  value: string;
  category?: string;
  priority?: 'high' | 'normal' | 'low';
  metadata?: string;
}

export interface CreateSessionInput {
  name?: string;
  description?: string;
  branch?: string;
  working_directory?: string;
  parent_id?: string;
}

export interface CreateFileCacheInput {
  file_path: string;
  content: string;
  hash?: string;
}

export interface CreateCheckpointInput {
  name: string;
  description?: string;
  git_status?: string;
  git_branch?: string;
}
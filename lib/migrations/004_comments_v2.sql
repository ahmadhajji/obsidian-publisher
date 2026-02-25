CREATE INDEX IF NOT EXISTS idx_comments_note_parent ON comments(note_id, parent_id);
CREATE INDEX IF NOT EXISTS idx_comments_note_resolved ON comments(note_id, is_resolved);
CREATE INDEX IF NOT EXISTS idx_comments_selection ON comments(note_id, selection_start, selection_end);

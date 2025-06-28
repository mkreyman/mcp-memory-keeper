const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// Create temporary database
const tempDbPath = path.join(__dirname, `test-timeline-${Date.now()}.db`);
const db = new Database(tempDbPath);

// Initialize schema
const schema = fs.readFileSync(path.join(__dirname, 'src/database/schema.sql'), 'utf8');
db.exec(schema);

// Create test session
const testSessionId = uuidv4();
db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(testSessionId, 'Test Session');

// Create test data
const now = new Date();
const items = [
  // Today - 6 items
  { time: new Date(now.getTime() - 1 * 60 * 60 * 1000), category: 'task', priority: 'high' },
  { time: new Date(now.getTime() - 2 * 60 * 60 * 1000), category: 'task', priority: 'normal' },
  { time: new Date(now.getTime() - 3 * 60 * 60 * 1000), category: 'note', priority: 'normal' },
  { time: new Date(now.getTime() - 4 * 60 * 60 * 1000), category: 'decision', priority: 'high' },
  { time: new Date(now.getTime() - 5 * 60 * 60 * 1000), category: 'progress', priority: 'normal' },
  { time: new Date(now.getTime() - 6 * 60 * 60 * 1000), category: 'task', priority: 'low' },
  // Yesterday - 3 items
  { time: new Date(now.getTime() - 26 * 60 * 60 * 1000), category: 'task', priority: 'high' },
  { time: new Date(now.getTime() - 28 * 60 * 60 * 1000), category: 'note', priority: 'normal' },
  { time: new Date(now.getTime() - 30 * 60 * 60 * 1000), category: 'progress', priority: 'low' },
  // 3 days ago - 1 item
  { time: new Date(now.getTime() - 72 * 60 * 60 * 1000), category: 'decision', priority: 'high' },
  // 5 days ago - 2 items
  { time: new Date(now.getTime() - 120 * 60 * 60 * 1000), category: 'task', priority: 'normal' },
  { time: new Date(now.getTime() - 121 * 60 * 60 * 1000), category: 'note', priority: 'normal' },
  // 7 days ago - 4 items
  { time: new Date(now.getTime() - 168 * 60 * 60 * 1000), category: 'progress', priority: 'high' },
  { time: new Date(now.getTime() - 169 * 60 * 60 * 1000), category: 'task', priority: 'normal' },
  { time: new Date(now.getTime() - 170 * 60 * 60 * 1000), category: 'decision', priority: 'low' },
  { time: new Date(now.getTime() - 171 * 60 * 60 * 1000), category: 'note', priority: 'normal' },
];

// Insert items
const stmt = db.prepare(`
  INSERT INTO context_items (
    id, session_id, key, value, category, priority, created_at, updated_at, size
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

items.forEach((item, index) => {
  const key = `item.${item.time.toISOString().split('T')[0]}.${index}`;
  const value = `Test item created at ${item.time.toISOString()}`;
  stmt.run(
    uuidv4(),
    testSessionId,
    key,
    value,
    item.category,
    item.priority,
    item.time.toISOString(),
    item.time.toISOString(),
    value.length
  );
});

// Query timeline data
const sql = `
  SELECT 
    strftime('%Y-%m-%d', created_at) as period,
    COUNT(*) as count
  FROM context_items
  WHERE session_id = ?
  GROUP BY period
  ORDER BY period DESC
`;

const timeline = db.prepare(sql).all(testSessionId);

console.log('Timeline results:');
console.log('Total periods:', timeline.length);
console.log('Periods:');
timeline.forEach(period => {
  console.log(`  ${period.period}: ${period.count} items`);
});

// Cleanup
db.close();
fs.unlinkSync(tempDbPath);
try { fs.unlinkSync(`${tempDbPath}-wal`); } catch (e) {}
try { fs.unlinkSync(`${tempDbPath}-shm`); } catch (e) {}
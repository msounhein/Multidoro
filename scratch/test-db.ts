import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { MultidoroDatabase } from '../src/database';

const testDir = path.join(__dirname, 'test-userData');
if (!fs.existsSync(testDir)) {
  fs.mkdirSync(testDir, { recursive: true });
}

// Cleanup previous test DB
const dbFile = path.join(testDir, 'multidoro-db.json');
if (fs.existsSync(dbFile)) {
  fs.unlinkSync(dbFile);
}

const db = new MultidoroDatabase(testDir);

// Add a test session
const session = db.addSession({
  id: 'test-session-123',
  taskName: 'Writing tests',
  startTime: new Date().toISOString(),
  durationMinutes: 25,
  type: 'focus',
  technique: 'traditional'
});

console.log('Session added:', session.id);

// Update status with tokens
const updated = db.updateSessionStatus('test-session-123', 'completed', undefined, {
  inputTokens: 1500000,
  outputTokens: 45000,
  estimatedCost: 0.126
});

assert.ok(updated, 'Session should be updated');
assert.strictEqual(updated.inputTokens, 1500000);
assert.strictEqual(updated.outputTokens, 45000);
assert.strictEqual(updated.estimatedCost, 0.126);

// Verify persistence
const db2 = new MultidoroDatabase(testDir);
const persistedSession = db2.getSessions().find(s => s.id === 'test-session-123');
assert.ok(persistedSession, 'Persisted session should exist');
assert.strictEqual(persistedSession.inputTokens, 1500000);
assert.strictEqual(persistedSession.outputTokens, 45000);
assert.strictEqual(persistedSession.estimatedCost, 0.126);

console.log('Database test passed!');

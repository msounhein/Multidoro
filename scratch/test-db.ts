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

(async () => {
  try {
    await db.initializedPromise;

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
    await db2.initializedPromise;
    const persistedSession = db2.getSessions().find(s => s.id === 'test-session-123');
    assert.ok(persistedSession, 'Persisted session should exist');
    assert.strictEqual(persistedSession.inputTokens, 1500000);
    assert.strictEqual(persistedSession.outputTokens, 45000);
    assert.strictEqual(persistedSession.estimatedCost, 0.126);

    // Verify invalid session ID update returns null
    const invalidUpdate = db.updateSessionStatus('invalid-id', 'completed');
    assert.strictEqual(invalidUpdate, null, 'Updating a non-existent session should return null');

    // Migration Test Case
    const migrationDir = path.join(testDir, 'migration-test');
    if (!fs.existsSync(migrationDir)) {
      fs.mkdirSync(migrationDir, { recursive: true });
    }
    
    // 1. Create legacy JSON files
    const legacySettings = {
      apiKey: 'test-gemini-api-key-12345',
      screenshotInterval: 10,
      voiceEnabled: false,
      voiceVolume: 0.5,
      debugLogs: true,
      consecutiveDistractionsLimit: 3
    };
    const legacyDb = {
      sessions: [
        {
          id: 'migrated-session-abc',
          taskName: 'Old focus session',
          startTime: '2026-05-22T00:00:00.000Z',
          endTime: '2026-05-22T00:25:00.000Z',
          durationMinutes: 25,
          type: 'focus',
          technique: 'traditional',
          status: 'completed',
          distractionsCount: 2,
          inputTokens: 100,
          outputTokens: 20,
          estimatedCost: 0.001
        }
      ],
      distractions: [
        {
          id: 'migrated-distraction-xyz',
          sessionId: 'migrated-session-abc',
          timestamp: '2026-05-22T00:10:00.000Z',
          detectedActivity: 'Browsing social media',
          remark: 'Sustained distraction'
        }
      ]
    };
    
    fs.writeFileSync(path.join(migrationDir, 'settings.json'), JSON.stringify(legacySettings));
    fs.writeFileSync(path.join(migrationDir, 'multidoro-db.json'), JSON.stringify(legacyDb));
    
    // 2. Instantiate MultidoroDatabase on migrationDir
    const migrationDb = new MultidoroDatabase(migrationDir);
    await migrationDb.initializedPromise;
    
    // 3. Verify settings were loaded and decrypted successfully
    const settings = migrationDb.getAppSettings();
    assert.strictEqual(settings.apiKey, 'test-gemini-api-key-12345');
    assert.strictEqual(settings.screenshotInterval, 10);
    assert.strictEqual(settings.voiceEnabled, false);
    assert.strictEqual(settings.voiceVolume, 0.5);
    assert.strictEqual(settings.debugLogs, true);
    assert.strictEqual(settings.consecutiveDistractionsLimit, 3);
    
    // 4. Verify history sessions and distractions are migrated
    const sessions = migrationDb.getSessions();
    const distractions = migrationDb.getDistractions();
    
    assert.strictEqual(sessions.length, 1);
    assert.strictEqual(sessions[0].id, 'migrated-session-abc');
    assert.strictEqual(sessions[0].taskName, 'Old focus session');
    assert.strictEqual(sessions[0].inputTokens, 100);
    assert.strictEqual(sessions[0].outputTokens, 20);
    assert.strictEqual(sessions[0].estimatedCost, 0.001);
    
    assert.strictEqual(distractions.length, 1);
    assert.strictEqual(distractions[0].id, 'migrated-distraction-xyz');
    assert.strictEqual(distractions[0].detectedActivity, 'Browsing social media');
    
    // 5. Verify legacy files are deleted
    assert.ok(!fs.existsSync(path.join(migrationDir, 'settings.json')), 'settings.json should be deleted');
    assert.ok(!fs.existsSync(path.join(migrationDir, 'multidoro-db.json')), 'multidoro-db.json should be deleted');
    
    console.log('Migration test passed!');

    console.log('Database test passed!');
    process.exit(0);
  } catch (err) {
    console.error('Database test failed:', err);
    process.exit(1);
  } finally {
    // Cleanup test data directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  }
})();



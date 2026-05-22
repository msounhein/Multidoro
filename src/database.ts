import * as fs from 'fs';
import * as path from 'path';
import { safeStorage } from 'electron';
import initSqlJs = require('sql.js');

export interface PomodoroSession {
  id: string;
  taskName: string;
  startTime: string;
  endTime: string | null;
  durationMinutes: number;
  type: 'focus' | 'break';
  technique: string;
  status: 'completed' | 'interrupted' | 'aborted';
  distractionsCount: number;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCost?: number;
}

export interface DistractionLog {
  id: string;
  sessionId: string;
  timestamp: string;
  detectedActivity: string;
  remark: string;
}

export interface AppSettings {
  apiKey: string;
  screenshotInterval: number;
  voiceEnabled: boolean;
  voiceVolume: number;
  debugLogs: boolean;
  consecutiveDistractionsLimit: number;
}

export class MultidoroDatabase {
  private dbPath: string;
  private userDataPath: string;
  private db: any = null;
  public initializedPromise: Promise<void>;

  constructor(userDataPath: string) {
    this.userDataPath = userDataPath;
    this.dbPath = path.join(userDataPath, 'multidoro.db');
    this.initializedPromise = this.init();
  }

  private async init() {
    try {
      const SQL = await initSqlJs({
        // Point to local wasm file copy
        locateFile: file => path.join(__dirname, file)
      });

      if (fs.existsSync(this.dbPath)) {
        const fileBuffer = fs.readFileSync(this.dbPath);
        this.db = new SQL.Database(fileBuffer);
      } else {
        this.db = new SQL.Database();
        this.createTables();
        this.save();
      }

      // Check and run migrations if legacy files exist
      await this.migrateLegacyData();
    } catch (error) {
      console.error('Failed to initialize SQLite database:', error);
      // Fallback to empty in-memory DB if file loading fails
      const initSqlJsFallback = require('sql.js');
      const SQL = await initSqlJsFallback();
      this.db = new SQL.Database();
      this.createTables();
    }
  }

  private createTables() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        taskName TEXT NOT NULL,
        startTime TEXT NOT NULL,
        endTime TEXT,
        durationMinutes INTEGER NOT NULL,
        type TEXT NOT NULL,
        technique TEXT NOT NULL,
        status TEXT NOT NULL,
        distractionsCount INTEGER DEFAULT 0,
        inputTokens INTEGER,
        outputTokens INTEGER,
        estimatedCost REAL
      );
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS distractions (
        id TEXT PRIMARY KEY,
        sessionId TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        detectedActivity TEXT NOT NULL,
        remark TEXT NOT NULL,
        FOREIGN KEY(sessionId) REFERENCES sessions(id) ON DELETE CASCADE
      );
    `);
  }

  private save() {
    try {
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const binaryData = this.db.export();
      fs.writeFileSync(this.dbPath, Buffer.from(binaryData));
    } catch (error) {
      console.error('Failed to save SQLite database to disk:', error);
    }
  }

  // Migration logic
  private async migrateLegacyData() {
    const legacyDbPath = path.join(this.userDataPath, 'multidoro-db.json');
    const legacySettingsPath = path.join(this.userDataPath, 'settings.json');

    let migratedAny = false;

    // Migrate settings
    if (fs.existsSync(legacySettingsPath)) {
      try {
        const content = fs.readFileSync(legacySettingsPath, 'utf8');
        const settings = JSON.parse(content);
        this.saveAppSettings(settings);
        migratedAny = true;
        console.log('[Migration] Legacy settings migrated to SQLite database.');
      } catch (e) {
        console.error('[Migration] Failed to migrate settings.json:', e);
      }
    }

    // Migrate history logs
    if (fs.existsSync(legacyDbPath)) {
      try {
        const content = fs.readFileSync(legacyDbPath, 'utf8');
        const data = JSON.parse(content);
        
        if (data.sessions && Array.isArray(data.sessions)) {
          const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO sessions (
              id, taskName, startTime, endTime, durationMinutes, type, technique, status, distractionsCount, inputTokens, outputTokens, estimatedCost
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);
          for (const s of data.sessions) {
            stmt.run([
              s.id,
              s.taskName,
              s.startTime,
              s.endTime || null,
              s.durationMinutes,
              s.type,
              s.technique,
              s.status,
              s.distractionsCount || 0,
              s.inputTokens !== undefined ? s.inputTokens : null,
              s.outputTokens !== undefined ? s.outputTokens : null,
              s.estimatedCost !== undefined ? s.estimatedCost : null
            ]);
          }
          stmt.free();
        }

        if (data.distractions && Array.isArray(data.distractions)) {
          const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO distractions (id, sessionId, timestamp, detectedActivity, remark)
            VALUES (?, ?, ?, ?, ?)
          `);
          for (const d of data.distractions) {
            stmt.run([d.id, d.sessionId, d.timestamp, d.detectedActivity, d.remark]);
          }
          stmt.free();
        }

        migratedAny = true;
        console.log('[Migration] Legacy sessions & distractions logs migrated to SQLite.');
      } catch (e) {
        console.error('[Migration] Failed to migrate multidoro-db.json:', e);
      }
    }

    if (migratedAny) {
      this.save();
      
      // Remove legacy cleartext files
      try {
        if (fs.existsSync(legacySettingsPath)) {
          fs.unlinkSync(legacySettingsPath);
          console.log('[Migration] Cleaned up legacy settings.json file.');
        }
        if (fs.existsSync(legacyDbPath)) {
          fs.unlinkSync(legacyDbPath);
          console.log('[Migration] Cleaned up legacy multidoro-db.json file.');
        }
      } catch (cleanupErr) {
        console.error('[Migration] Failed to delete legacy cleartext JSON files:', cleanupErr);
      }
    }
  }

  // Sessions API
  public addSession(session: Omit<PomodoroSession, 'endTime' | 'status' | 'distractionsCount'>): PomodoroSession {
    const newSession: PomodoroSession = {
      ...session,
      endTime: null,
      status: 'interrupted',
      distractionsCount: 0
    };

    const stmt = this.db.prepare(`
      INSERT INTO sessions (id, taskName, startTime, endTime, durationMinutes, type, technique, status, distractionsCount)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run([
      newSession.id,
      newSession.taskName,
      newSession.startTime,
      null,
      newSession.durationMinutes,
      newSession.type,
      newSession.technique,
      newSession.status,
      newSession.distractionsCount
    ]);
    stmt.free();
    this.save();
    return newSession;
  }

  public updateSessionStatus(
    id: string, 
    status: PomodoroSession['status'], 
    endTime?: string,
    tokenData?: { inputTokens: number; outputTokens: number; estimatedCost: number }
  ): PomodoroSession | null {
    const resolvedEndTime = endTime || new Date().toISOString();
    const input = tokenData ? tokenData.inputTokens : null;
    const output = tokenData ? tokenData.outputTokens : null;
    const cost = tokenData ? tokenData.estimatedCost : null;

    const checkStmt = this.db.prepare('SELECT * FROM sessions WHERE id = ?');
    checkStmt.bind([id]);
    const exists = checkStmt.step();
    checkStmt.free();

    if (!exists) return null;

    if (tokenData) {
      const stmt = this.db.prepare(`
        UPDATE sessions 
        SET status = ?, endTime = ?, inputTokens = ?, outputTokens = ?, estimatedCost = ?
        WHERE id = ?
      `);
      stmt.run([status, resolvedEndTime, input, output, cost, id]);
      stmt.free();
    } else {
      const stmt = this.db.prepare(`
        UPDATE sessions 
        SET status = ?, endTime = ?
        WHERE id = ?
      `);
      stmt.run([status, resolvedEndTime, id]);
      stmt.free();
    }
    this.save();

    // Retrieve and return updated session
    const getStmt = this.db.prepare('SELECT * FROM sessions WHERE id = ?');
    getStmt.bind([id]);
    getStmt.step();
    const row = getStmt.getAsObject();
    getStmt.free();

    return {
      id: row.id as string,
      taskName: row.taskName as string,
      startTime: row.startTime as string,
      endTime: row.endTime as string | null,
      durationMinutes: row.durationMinutes as number,
      type: row.type as any,
      technique: row.technique as string,
      status: row.status as any,
      distractionsCount: row.distractionsCount as number,
      inputTokens: row.inputTokens !== null ? (row.inputTokens as number) : undefined,
      outputTokens: row.outputTokens !== null ? (row.outputTokens as number) : undefined,
      estimatedCost: row.estimatedCost !== null ? (row.estimatedCost as number) : undefined
    };
  }

  public incrementSessionDistraction(sessionId: string): number {
    const checkStmt = this.db.prepare('SELECT distractionsCount FROM sessions WHERE id = ?');
    checkStmt.bind([sessionId]);
    if (!checkStmt.step()) {
      checkStmt.free();
      return 0;
    }
    const count = (checkStmt.getAsObject().distractionsCount as number) + 1;
    checkStmt.free();

    const stmt = this.db.prepare('UPDATE sessions SET distractionsCount = ? WHERE id = ?');
    stmt.run([count, sessionId]);
    stmt.free();
    this.save();
    return count;
  }

  public getSessions(): PomodoroSession[] {
    const sessions: PomodoroSession[] = [];
    const stmt = this.db.prepare('SELECT * FROM sessions ORDER BY startTime DESC');
    while (stmt.step()) {
      const row = stmt.getAsObject();
      sessions.push({
        id: row.id as string,
        taskName: row.taskName as string,
        startTime: row.startTime as string,
        endTime: row.endTime as string | null,
        durationMinutes: row.durationMinutes as number,
        type: row.type as any,
        technique: row.technique as string,
        status: row.status as any,
        distractionsCount: row.distractionsCount as number,
        inputTokens: row.inputTokens !== null ? (row.inputTokens as number) : undefined,
        outputTokens: row.outputTokens !== null ? (row.outputTokens as number) : undefined,
        estimatedCost: row.estimatedCost !== null ? (row.estimatedCost as number) : undefined
      });
    }
    stmt.free();
    return sessions;
  }

  // Distractions API
  public addDistraction(sessionId: string, detectedActivity: string, remark: string): DistractionLog {
    const newDistraction: DistractionLog = {
      id: Math.random().toString(36).substring(2, 9),
      sessionId,
      timestamp: new Date().toISOString(),
      detectedActivity,
      remark
    };

    const stmt = this.db.prepare(`
      INSERT INTO distractions (id, sessionId, timestamp, detectedActivity, remark)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run([
      newDistraction.id,
      newDistraction.sessionId,
      newDistraction.timestamp,
      newDistraction.detectedActivity,
      newDistraction.remark
    ]);
    stmt.free();
    this.incrementSessionDistraction(sessionId);
    this.save();
    return newDistraction;
  }

  public getDistractions(): DistractionLog[] {
    const distractions: DistractionLog[] = [];
    const stmt = this.db.prepare('SELECT * FROM distractions ORDER BY timestamp DESC');
    while (stmt.step()) {
      const row = stmt.getAsObject();
      distractions.push({
        id: row.id as string,
        sessionId: row.sessionId as string,
        timestamp: row.timestamp as string,
        detectedActivity: row.detectedActivity as string,
        remark: row.remark as string
      });
    }
    stmt.free();
    return distractions;
  }

  public getDistractionsForSession(sessionId: string): DistractionLog[] {
    const distractions: DistractionLog[] = [];
    const stmt = this.db.prepare('SELECT * FROM distractions WHERE sessionId = ? ORDER BY timestamp DESC');
    stmt.bind([sessionId]);
    while (stmt.step()) {
      const row = stmt.getAsObject();
      distractions.push({
        id: row.id as string,
        sessionId: row.sessionId as string,
        timestamp: row.timestamp as string,
        detectedActivity: row.detectedActivity as string,
        remark: row.remark as string
      });
    }
    stmt.free();
    return distractions;
  }

  // AppSettings SQLite integration
  public getAppSettings(): AppSettings {
    const settings: AppSettings = {
      apiKey: '',
      screenshotInterval: 5,
      voiceEnabled: true,
      voiceVolume: 0.8,
      debugLogs: false,
      consecutiveDistractionsLimit: 1
    };

    const stmt = this.db.prepare('SELECT key, value FROM settings');
    while (stmt.step()) {
      const row = stmt.getAsObject();
      const key = row.key as string;
      const val = row.value as string;
      if (key === 'apiKey') {
        if (val) {
          try {
            if (safeStorage.isEncryptionAvailable()) {
              settings.apiKey = safeStorage.decryptString(Buffer.from(val, 'base64'));
            } else {
              settings.apiKey = val;
            }
          } catch (e) {
            console.error('Failed to decrypt apiKey settings:', e);
            settings.apiKey = '';
          }
        }
      } else if (key === 'screenshotInterval') {
        settings.screenshotInterval = parseInt(val, 10) || 5;
      } else if (key === 'voiceEnabled') {
        settings.voiceEnabled = val === 'true';
      } else if (key === 'voiceVolume') {
        settings.voiceVolume = parseFloat(val) || 0.8;
      } else if (key === 'debugLogs') {
        settings.debugLogs = val === 'true';
      } else if (key === 'consecutiveDistractionsLimit') {
        settings.consecutiveDistractionsLimit = parseInt(val, 10) || 1;
      }
    }
    stmt.free();
    return settings;
  }

  public saveAppSettings(settings: AppSettings) {
    const stmt = this.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    
    let encryptedKey = '';
    if (settings.apiKey) {
      try {
        if (safeStorage.isEncryptionAvailable()) {
          encryptedKey = safeStorage.encryptString(settings.apiKey).toString('base64');
        } else {
          encryptedKey = settings.apiKey;
        }
      } catch (e) {
        console.error('Failed to encrypt apiKey settings:', e);
      }
    }

    stmt.run(['apiKey', encryptedKey]);
    stmt.run(['screenshotInterval', settings.screenshotInterval.toString()]);
    stmt.run(['voiceEnabled', settings.voiceEnabled ? 'true' : 'false']);
    stmt.run(['voiceVolume', settings.voiceVolume.toString()]);
    stmt.run(['debugLogs', settings.debugLogs ? 'true' : 'false']);
    stmt.run(['consecutiveDistractionsLimit', settings.consecutiveDistractionsLimit.toString()]);
    stmt.free();
    this.save();
  }

  // General
  public clearLogs() {
    this.db.run('DELETE FROM distractions');
    this.db.run('DELETE FROM sessions');
    this.save();
  }
}

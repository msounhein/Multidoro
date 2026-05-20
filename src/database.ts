import * as fs from 'fs';
import * as path from 'path';

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
}

export interface DistractionLog {
  id: string;
  sessionId: string;
  timestamp: string;
  detectedActivity: string;
  remark: string;
}

interface DatabaseSchema {
  sessions: PomodoroSession[];
  distractions: DistractionLog[];
}

export class MultidoroDatabase {
  private dbPath: string;
  private data: DatabaseSchema = { sessions: [], distractions: [] };

  constructor(userDataPath: string) {
    this.dbPath = path.join(userDataPath, 'multidoro-db.json');
    this.init();
  }

  private init() {
    try {
      if (!fs.existsSync(this.dbPath)) {
        this.save();
      } else {
        const fileContent = fs.readFileSync(this.dbPath, 'utf8');
        this.data = JSON.parse(fileContent);
        // Ensure structure is correct
        if (!this.data.sessions) this.data.sessions = [];
        if (!this.data.distractions) this.data.distractions = [];
      }
    } catch (error) {
      console.error('Failed to initialize database, using empty state:', error);
      this.data = { sessions: [], distractions: [] };
    }
  }

  private save() {
    try {
      // Ensure directory exists
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.dbPath, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (error) {
      console.error('Failed to save database to disk:', error);
    }
  }

  // Sessions
  public addSession(session: Omit<PomodoroSession, 'endTime' | 'status' | 'distractionsCount'>): PomodoroSession {
    const newSession: PomodoroSession = {
      ...session,
      endTime: null,
      status: 'interrupted', // default until completed/aborted
      distractionsCount: 0
    };
    this.data.sessions.push(newSession);
    this.save();
    return newSession;
  }

  public updateSessionStatus(id: string, status: PomodoroSession['status'], endTime?: string): PomodoroSession | null {
    const session = this.data.sessions.find(s => s.id === id);
    if (session) {
      session.status = status;
      if (endTime) {
        session.endTime = endTime;
      } else {
        session.endTime = new Date().toISOString();
      }
      this.save();
      return session;
    }
    return null;
  }

  public incrementSessionDistraction(sessionId: string): number {
    const session = this.data.sessions.find(s => s.id === sessionId);
    if (session) {
      session.distractionsCount = (session.distractionsCount || 0) + 1;
      this.save();
      return session.distractionsCount;
    }
    return 0;
  }

  public getSessions(): PomodoroSession[] {
    return this.data.sessions;
  }

  // Distractions
  public addDistraction(sessionId: string, detectedActivity: string, remark: string): DistractionLog {
    const newDistraction: DistractionLog = {
      id: Math.random().toString(36).substring(2, 9),
      sessionId,
      timestamp: new Date().toISOString(),
      detectedActivity,
      remark
    };
    this.data.distractions.push(newDistraction);
    this.incrementSessionDistraction(sessionId);
    this.save();
    return newDistraction;
  }

  public getDistractions(): DistractionLog[] {
    return this.data.distractions;
  }

  public getDistractionsForSession(sessionId: string): DistractionLog[] {
    return this.data.distractions.filter(d => d.sessionId === sessionId);
  }

  // General
  public clearLogs() {
    this.data = { sessions: [], distractions: [] };
    this.save();
  }
}

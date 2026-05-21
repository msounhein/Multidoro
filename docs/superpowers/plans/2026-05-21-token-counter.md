# Gemini Live Token Counter and Cost Estimator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record input, output, total tokens, and estimated USD cost for each Pomodoro focus session and display it in the session logs under the History/Analytics tab.

**Architecture:** We will extend the local JSON database schema (`PomodoroSession`) to store token counts and estimated costs. The main process will accumulate the usage metadata received from the stateful Gemini Live WebSocket connection and calculate the total cost upon focus session completion or abortion. Finally, we'll update the renderer process to display this data as a new column in the History logs table.

**Tech Stack:** Electron, TypeScript, Node.js, HTML5/CSS3 (Vanilla).

---

### Task 1: Database Schema & Method Upgrades

**Files:**
- Modify: [src/database.ts](file:///c:/Users/MSounhein/OneDrive/Documents/Code/multidoro/src/database.ts)
- Create: [scratch/test-db.ts](file:///c:/Users/MSounhein/OneDrive/Documents/Code/multidoro/scratch/test-db.ts)

- [ ] **Step 1: Write a failing database test script**

Create [scratch/test-db.ts](file:///c:/Users/MSounhein/OneDrive/Documents/Code/multidoro/scratch/test-db.ts) with code to verify that `updateSessionStatus` correctly writes the new token and cost fields to the database.

```typescript
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

// Update status with tokens (we expect this compiler to FAIL initially due to types/signature mismatch)
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
```

- [ ] **Step 2: Run test to verify it fails to compile or run**

Run: `npx tsx scratch/test-db.ts`
Expected: Compile failure due to `updateSessionStatus` not expecting a 4th argument, and `inputTokens` not existing on `PomodoroSession`.

- [ ] **Step 3: Modify the Database Schema and updateSessionStatus Method**

Modify [src/database.ts](file:///c:/Users/MSounhein/OneDrive/Documents/Code/multidoro/src/database.ts) to extend `PomodoroSession` and update `updateSessionStatus`.

In [src/database.ts](file:///c:/Users/MSounhein/OneDrive/Documents/Code/multidoro/src/database.ts#L4-L15):
```typescript
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
```

In [src/database.ts](file:///c:/Users/MSounhein/OneDrive/Documents/Code/multidoro/src/database.ts#L81-L94):
```typescript
  public updateSessionStatus(
    id: string, 
    status: PomodoroSession['status'], 
    endTime?: string,
    tokenData?: { inputTokens: number; outputTokens: number; estimatedCost: number }
  ): PomodoroSession | null {
    const session = this.data.sessions.find(s => s.id === id);
    if (session) {
      session.status = status;
      if (endTime) {
        session.endTime = endTime;
      } else {
        session.endTime = new Date().toISOString();
      }
      if (tokenData) {
        session.inputTokens = tokenData.inputTokens;
        session.outputTokens = tokenData.outputTokens;
        session.estimatedCost = tokenData.estimatedCost;
      }
      this.save();
      return session;
    }
    return null;
  }
```

- [ ] **Step 4: Run the test script again to verify it passes**

Run: `npx tsx scratch/test-db.ts`
Expected: Success message: `Database test passed!`

- [ ] **Step 5: Commit changes**

```powershell
git add src/database.ts scratch/test-db.ts
git commit -m "Database: Add token tracking fields to PomodoroSession and update updateSessionStatus method"
```

---

### Task 2: Main Process Token Accumulation & Cost Calculation

**Files:**
- Modify: [src/main.ts](file:///c:/Users/MSounhein/OneDrive/Documents/Code/multidoro/src/main.ts)

- [ ] **Step 1: Declare running session token accumulators and helper function**

Modify [src/main.ts](file:///c:/Users/MSounhein/OneDrive/Documents/Code/multidoro/src/main.ts) to define accumulators and a helper method `saveSessionTokenStats`.

In [src/main.ts](file:///c:/Users/MSounhein/OneDrive/Documents/Code/multidoro/src/main.ts#L36-L55) (declare variables):
```typescript
let currentSessionInputTokens = 0;
let currentSessionOutputTokens = 0;
```

In [src/main.ts](file:///c:/Users/MSounhein/OneDrive/Documents/Code/multidoro/src/main.ts#L752-L753) (add helper method):
```typescript
function saveSessionTokenStats(status: 'completed' | 'interrupted' | 'aborted') {
  if (activeSessionId) {
    // Gemini 2.5/3.1 Flash baseline rates per 1,000,000 tokens:
    // Input: $0.075, Output: $0.300
    const estimatedCost = (currentSessionInputTokens / 1000000) * 0.075 + (currentSessionOutputTokens / 1000000) * 0.30;
    db.updateSessionStatus(activeSessionId, status, undefined, {
      inputTokens: currentSessionInputTokens,
      outputTokens: currentSessionOutputTokens,
      estimatedCost
    });
  }
}
```

- [ ] **Step 2: Reset accumulators on starting a timer**

In [src/main.ts](file:///c:/Users/MSounhein/OneDrive/Documents/Code/multidoro/src/main.ts#L705-L715) (under `startTimer` setup):
```typescript
  currentSessionInputTokens = 0;
  currentSessionOutputTokens = 0;
```

- [ ] **Step 3: Accumulate tokens from WebSocket usageMetadata**

In [src/main.ts](file:///c:/Users/MSounhein/OneDrive/Documents/Code/multidoro/src/main.ts#L308-L313) (inside `onmessage` callback):
```typescript
        onmessage: (message: any) => {
          if (appSettings.debugLogs) {
            console.log('[Gemini WS Inbound]', JSON.stringify(truncateLargeData(message), null, 2));
          }
          if (message.usageMetadata) {
            currentSessionInputTokens = Math.max(currentSessionInputTokens, message.usageMetadata.promptTokenCount || 0);
            currentSessionOutputTokens = Math.max(currentSessionOutputTokens, message.usageMetadata.responseTokenCount || 0);
          }
          handleGeminiMessage(message);
        },
```

- [ ] **Step 4: Save token stats on session complete and reset/abort**

Update the two database call locations in [src/main.ts](file:///c:/Users/MSounhein/OneDrive/Documents/Code/multidoro/src/main.ts):

In `resetTimer` (around line 740):
```typescript
  // If focus session was active, record it as aborted
  if (activeSessionId && timerPhase === 'focus') {
    saveSessionTokenStats('aborted');
  }
```

In `handleTimerComplete` (around line 765):
```typescript
  // Update DB session
  if (activeSessionId) {
    saveSessionTokenStats('completed');
  }
```

- [ ] **Step 5: Verify TS compiler output**

Run: `npm run build`
Expected: Successful compilation without errors (this compiles `main.ts` and renderer scripts).

- [ ] **Step 6: Commit changes**

```powershell
git add src/main.ts
git commit -m "Main Process: Track session token metrics and save them to DB upon session end"
```

---

### Task 3: UI Renderer Logs Table Update

**Files:**
- Modify: [src/renderer/index.html](file:///c:/Users/MSounhein/OneDrive/Documents/Code/multidoro/src/renderer/index.html)
- Modify: [src/renderer/renderer.ts](file:///c:/Users/MSounhein/OneDrive/Documents/Code/multidoro/src/renderer/renderer.ts)

- [ ] **Step 1: Add "API Usage" column header to HTML table**

Modify the table header in [src/renderer/index.html](file:///c:/Users/MSounhein/OneDrive/Documents/Code/multidoro/src/renderer/index.html#L201-L210) to add the "API Usage" column:

```html
              <thead>
                <tr>
                  <th>Date & Time</th>
                  <th>Task Description</th>
                  <th>Type</th>
                  <th>Technique</th>
                  <th>Outcome</th>
                  <th>Distractions</th>
                  <th>API Usage</th>
                </tr>
              </thead>
```

- [ ] **Step 2: Update logs table rendering in renderer.ts**

Update `loadAnalyticsData` inside [src/renderer/renderer.ts](file:///c:/Users/MSounhein/OneDrive/Documents/Code/multidoro/src/renderer/renderer.ts) to format and append the token stats column.

In [src/renderer/renderer.ts](file:///c:/Users/MSounhein/OneDrive/Documents/Code/multidoro/src/renderer/renderer.ts#L488-L494) (change colspan to 7):
```typescript
  if (data.sessions.length === 0) {
    logsTbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-muted);">No history logged yet.</td></tr>`;
    return;
  }
```

In [src/renderer/renderer.ts](file:///c:/Users/MSounhein/OneDrive/Documents/Code/multidoro/src/renderer/renderer.ts#L513-L520) (under row assembly loop, and add the format function):
Add this helper function at the bottom of [src/renderer/renderer.ts](file:///c:/Users/MSounhein/OneDrive/Documents/Code/multidoro/src/renderer/renderer.ts):

```typescript
function formatTokens(num: number | undefined): string {
  if (num === undefined || num === null || num === 0) return '0';
  if (num >= 1000000) {
    return (num / 1000000).toFixed(2) + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return num.toString();
}
```

Update row innerHTML in [src/renderer/renderer.ts](file:///c:/Users/MSounhein/OneDrive/Documents/Code/multidoro/src/renderer/renderer.ts#L513-L520):
```typescript
    const tokenInfo = s.inputTokens !== undefined 
      ? `<span style="font-family: monospace;">${formatTokens(s.inputTokens)} in / ${formatTokens(s.outputTokens)} out</span><br><span style="color: var(--color-break); font-size: 0.75rem;">$${s.estimatedCost?.toFixed(4) || '0.0000'}</span>`
      : '<span style="color: var(--text-muted);">N/A</span>';

    tr.innerHTML = `
      <td>${formattedDate}</td>
      <td><strong>${s.taskName}</strong></td>
      <td style="text-transform: capitalize;">${s.type}</td>
      <td style="text-transform: capitalize;">${s.technique}</td>
      <td><span class="badge ${outcomeBadgeClass}">${s.status}</span></td>
      <td>${s.distractionsCount || 0}</td>
      <td>${tokenInfo}</td>
    `;
```

- [ ] **Step 3: Build the application to verify assets and compilation**

Run: `npm run build`
Expected: Success, assets copied to `dist/` and TypeScript compiled.

- [ ] **Step 4: Commit UI changes**

```powershell
git add src/renderer/index.html src/renderer/renderer.ts
git commit -m "UI: Add API Usage column to History logs table to show input/output tokens and cost"
```

---

### Task 4: Integration Verification

- [ ] **Step 1: Run the application**

Run: `npm start`
Expected: Application launches without errors.

- [ ] **Step 2: Start and complete a short Pomodoro test session**

1. Set "Screen Scan Interval" to `5` in Settings.
2. Set timer duration to `1` minute (or manually interrupt/complete it).
3. Start a focus task.
4. Let the timer run, capturing screenshots (verify via command logs if debug logging is enabled).
5. Let the timer complete or reset it.
6. Open the **History/Analytics** tab.
7. Verify that the session is displayed, and the **API Usage** column displays actual token metrics (e.g. `2.5K in / 120 out`) and a non-zero cost (e.g. `$0.0002`).

- [ ] **Step 3: Clean up test files**

Remove the temporary test directories created during test run.
Run: `Remove-Item -Recurse -Force scratch/test-userData`
Expected: Clean directory.

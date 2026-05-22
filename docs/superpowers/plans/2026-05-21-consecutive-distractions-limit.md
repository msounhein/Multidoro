# Consecutive Distractions Limit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a configurable "Consecutive Distractions Limit" setting that defaults to 1, updating the distraction alarming and logging logic to trigger based on consecutive scan counts instead of hardcoded 30-second duration thresholds, and fix the "Always-on-top HUD HUD Overlay" label typo.

**Architecture:** 
1. Expand the `AppSettings` interface (in backend `main.ts` and `preload.ts`) and frontend logic (`renderer.ts`) to support `consecutiveDistractionsLimit`.
2. Add a numeric configuration input to the settings tab in `index.html`, and correct the HUD overlay checkbox label typo.
3. Replace the module-level distraction duration counter (`continuousDistractedSeconds`) in `main.ts` with a consecutive scan counter (`consecutiveDistractionsCount`).
4. Update the evaluation flows (tool handler and text fallbacks) to trigger warnings/logs immediately when consecutive count $\ge$ consecutive distractions limit.

**Tech Stack:** Electron, TypeScript, HTML, CSS (Vanilla)

---

### Task 1: Update App Settings Configurations and Interfaces

**Files:**
- Modify: `src/main.ts`
- Modify: `src/preload.ts`

- [ ] **Step 1: Modify AppSettings interface in preload.ts**
  Update the `AppSettings` interface in `src/preload.ts` to include `consecutiveDistractionsLimit: number;`.
  Code to add:
  ```typescript
  export interface AppSettings {
    apiKey: string;
    screenshotInterval: number;
    voiceEnabled: boolean;
    voiceVolume: number;
    consecutiveDistractionsLimit: number;
  }
  ```

- [ ] **Step 2: Modify AppSettings interface and default settings in main.ts**
  Update the `AppSettings` interface and the default `appSettings` object in `src/main.ts`.
  Code to update:
  ```typescript
  interface AppSettings {
    apiKey: string;
    screenshotInterval: number;
    voiceEnabled: boolean;
    voiceVolume: number;
    debugLogs: boolean;
    consecutiveDistractionsLimit: number;
  }

  let appSettings: AppSettings = {
    apiKey: process.env.GEMINI_API_KEY || '',
    screenshotInterval: 5,
    voiceEnabled: true,
    voiceVolume: 0.8,
    debugLogs: false,
    consecutiveDistractionsLimit: 1
  };
  ```

- [ ] **Step 3: Commit**
  ```bash
  git add src/preload.ts src/main.ts
  git commit -m "feat: add consecutiveDistractionsLimit to settings interface and defaults"
  ```

---

### Task 2: Implement UI Inputs and Rename HUD Label

**Files:**
- Modify: `src/renderer/index.html`

- [ ] **Step 1: Add new form input for Consecutive Distractions Limit**
  Insert the HTML block for the new settings input directly below the Screen Scan Interval input (around lines 236–242).
  ```html
  <div class="form-row">
    <div class="form-group">
      <label for="setting-scan-interval">Screen Scan Interval (Seconds)</label>
      <input type="number" id="setting-scan-interval" min="1" max="60" value="5">
      <p class="form-help">Recommended: 5 seconds for normal usage.</p>
    </div>
    <div class="form-group">
      <label for="setting-consecutive-distractions">Consecutive Distractions Limit</label>
      <input type="number" id="setting-consecutive-distractions" min="1" max="10" value="1">
      <p class="form-help">Default is 1 (immediate alarm on first distraction).</p>
    </div>
  </div>
  ```

- [ ] **Step 2: Rename HUD Toggle label**
  Correct the "Always-on-top HUD HUD Overlay" label text (around line 95) to "Always-on-top HUD Overlay".
  ```html
  <span class="switch-label">Always-on-top HUD Overlay</span>
  ```

- [ ] **Step 3: Commit**
  ```bash
  git add src/renderer/index.html
  git commit -m "style: add setting input field and fix HUD label typo"
  ```

---

### Task 3: Map Configuration Field in Renderer Script

**Files:**
- Modify: `src/renderer/renderer.ts`

- [ ] **Step 1: Update AppSettings interface in renderer.ts**
  Add the property to the local TypeScript helper interface definition:
  ```typescript
  interface AppSettings {
    apiKey: string;
    screenshotInterval: number;
    voiceEnabled: boolean;
    voiceVolume: number;
    debugLogs: boolean;
    consecutiveDistractionsLimit: number;
  }
  ```

- [ ] **Step 2: Bind new settings DOM element**
  Locate DOM element bindings (around lines 409–415) and retrieve the new input element:
  ```typescript
  const consecutiveDistractionsInput = document.getElementById('setting-consecutive-distractions') as HTMLInputElement;
  ```

- [ ] **Step 3: Populate field in loadSettingsData()**
  Set the input element value during loading:
  ```typescript
  consecutiveDistractionsInput.value = (settings.consecutiveDistractionsLimit || 1).toString();
  ```

- [ ] **Step 4: Update saveBtn click event listener to write Consecutive Distractions Limit**
  Ensure the new property is sent to the main process:
  ```typescript
  const updatedSettings: AppSettings = {
    apiKey: apiInput.value.trim(),
    screenshotInterval: parseInt(intervalInput.value, 10) || 5,
    voiceEnabled: voiceEnabledChk.checked,
    voiceVolume: volRange ? parseFloat(volRange.value) : 0.8,
    debugLogs: debugLogsChk ? debugLogsChk.checked : false,
    consecutiveDistractionsLimit: parseInt(consecutiveDistractionsInput.value, 10) || 1
  };
  ```

- [ ] **Step 5: Commit**
  ```bash
  git add src/renderer/renderer.ts
  git commit -m "feat: bind consecutive distractions limit setting to frontend input"
  ```

---

### Task 4: Implement Warning and Distraction Tracking in Backend

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Replace continuousDistractedSeconds with consecutiveDistractionsCount**
  Replace line 55:
  ```typescript
  let screenCaptureTimeout: NodeJS.Timeout | null = null;
  let consecutiveDistractionsCount = 0;
  ```

- [ ] **Step 2: Reset counter on session controls**
  Ensure `consecutiveDistractionsCount` is reset to 0 in key lifecycle points (`connectGemini`, `resetTimer`, `handleTimerComplete`, `startTimer`):
  * In `connectGemini()`:
    ```typescript
    liveSession = session;
    console.log('Gemini Live session variable assigned. Starting screenshot loop.');
    consecutiveDistractionsCount = 0;
    scheduleNextScreenshotCheck();
    ```
  * In `resetTimer()`:
    ```typescript
    continuousDistractedSeconds = 0; // REPLACE WITH:
    consecutiveDistractionsCount = 0;
    ```
  * In `handleTimerComplete()`:
    ```typescript
    continuousDistractedSeconds = 0; // REPLACE WITH:
    consecutiveDistractionsCount = 0;
    ```

- [ ] **Step 3: Refactor processStatusUpdate to use consecutive scan count thresholding**
  Modify `processStatusUpdate` to increment and alarm using `consecutiveDistractionsCount` and `appSettings.consecutiveDistractionsLimit`:
  ```typescript
  function processStatusUpdate(status: string, description: string) {
    const upperStatus = status.toUpperCase();
    
    if (upperStatus === 'DISTRACTED') {
      consecutiveDistractionsCount++;
      const durationSec = consecutiveDistractionsCount * appSettings.screenshotInterval;
      const displayMsg = `[POTENTIAL DISTRACTION (${durationSec}s)] ${description}`;
      console.log(`[Status Update] User is DISTRACTED. Description: "${description}". Consecutive count: ${consecutiveDistractionsCount}`);
      
      if (consecutiveDistractionsCount >= appSettings.consecutiveDistractionsLimit) {
        broadcastComment(`[DISTRACTED] ${description}`, true);
        
        console.log(`[Status Update] Distraction threshold met (>= limit). Triggering Windows toast and verbal scolding...`);
        if (activeSessionId) {
          db.addDistraction(activeSessionId, "Sustained distraction flagged by Gemini", description);
        }
        showToast("Multidoro Distraction Warning!", description);
        
        if (liveSession) {
          const payload = {
            text: `[WARN] Speak a warning now!`
          };
          if (appSettings.debugLogs) {
            console.log('[Gemini WS Outbound - Warn]', JSON.stringify(payload, null, 2));
          } else {
            console.log(`[Status Update] Sending [WARN] message to prompt vocal warning.`);
          }
          liveSession.sendRealtimeInput(payload);
        }
      } else {
        broadcastComment(displayMsg, false);
      }
    } else if (upperStatus === 'ON_TASK') {
      console.log(`[Status Update] User is ON_TASK. Description: "${description}". Resetting distraction count.`);
      consecutiveDistractionsCount = 0;
      broadcastComment(description, false);
    } else {
      console.log(`[Status Update] Unknown status received: "${status}". Description: "${description}"`);
    }
  }
  ```

- [ ] **Step 4: Refactor handleGeminiMessage fallback blocks**
  Modify the fallback blocks in `handleGeminiMessage` (around lines 505–562) to use `consecutiveDistractionsCount` and `consecutiveDistractionsLimit`:
  ```typescript
        if (upperText.includes('STATUS: DISTRACTED')) {
          consecutiveDistractionsCount++;
          const durationSec = consecutiveDistractionsCount * appSettings.screenshotInterval;
          const cleanText = text.replace(/STATUS:\s*DISTRACTED\s*-?\s*/i, '');
          const displayMsg = `[POTENTIAL DISTRACTION (${durationSec}s)] ${cleanText}`;
          console.log(`[Gemini Response] Fallback Classified: DISTRACTED. Consecutive count: ${consecutiveDistractionsCount}`);
          
          if (consecutiveDistractionsCount >= appSettings.consecutiveDistractionsLimit) {
            broadcastComment(`[DISTRACTED] ${cleanText}`, true);
            
            console.log(`[Gemini Response] Threshold reached. Triggering active scolding warning...`);
            if (activeSessionId) {
              db.addDistraction(activeSessionId, "Sustained distraction flagged by Gemini", cleanText);
            }
            showToast("Multidoro Distraction Warning!", cleanText);
            
            if (liveSession) {
              liveSession.sendRealtimeInput({
                text: `[WARN] Speak a warning now!`
              });
            }
          } else {
            broadcastComment(displayMsg, false);
          }
          
        } else if (upperText.includes('STATUS: ON_TASK')) {
          console.log(`[Gemini Response] Fallback Classified: ON_TASK. Resetting continuous distraction count.`);
          consecutiveDistractionsCount = 0;
          const cleanText = text.replace(/STATUS:\s*ON_TASK\s*-?\s*/i, '');
          broadcastComment(cleanText, false);
        } else {
          // General fallback
          if (upperText.includes('DISTRACTED') || upperText.includes('WARNING')) {
            consecutiveDistractionsCount++;
            const durationSec = consecutiveDistractionsCount * appSettings.screenshotInterval;
            console.log(`[Gemini Response] Fallback Classified: DISTRACTED/WARNING. Consecutive count: ${consecutiveDistractionsCount}`);
            if (consecutiveDistractionsCount >= appSettings.consecutiveDistractionsLimit) {
              broadcastComment(`[DISTRACTED] ${text}`, true);
              if (activeSessionId) {
                db.addDistraction(activeSessionId, "Distraction detected by Gemini", text);
              }
              showToast("Multidoro Distraction Warning!", text);
              if (liveSession) {
                liveSession.sendRealtimeInput({
                  text: `[WARN] Speak a warning now!`
                });
              }
            } else {
              broadcastComment(`[POTENTIAL DISTRACTION (${durationSec}s)] ${text}`, false);
            }
          } else {
            console.log(`[Gemini Response] Fallback Classified: ON_TASK (default). Resetting continuous distraction count.`);
            consecutiveDistractionsCount = 0;
            broadcastComment(text, false);
          }
        }
  ```

- [ ] **Step 5: Commit**
  ```bash
  git add src/main.ts
  git commit -m "feat: refactor backend distraction tracking to check consecutive scan counts"
  ```

---

### Task 5: Build and Manual Verification

- [ ] **Step 1: Run npm build to verify compiler pass**
  Run: `npm run build`
  Expected: Success without TypeScript compilation errors.

- [ ] **Step 2: Start Application**
  Run: `npm start`
  Expected: App starts up cleanly.

- [ ] **Step 3: Verify default configuration settings load properly**
  Open settings, check if "Consecutive Distractions Limit" shows `1`.

- [ ] **Step 4: Save settings configuration**
  Change limit to `2`, save settings, restart application, and verify the setting persisted.

- [ ] **Step 5: Commit and wrap up**
  Commit any final configuration/build file changes and mark the work as complete.

import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, Notification, screen, desktopCapturer } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { GoogleGenAI, Modality, Type } from '@google/genai';
import { MultidoroDatabase, PomodoroSession } from './database';

// Windows references
let mainWindow: BrowserWindow | null = null;
let widgetWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

// Database helper
let db: MultidoroDatabase;

// App settings state
interface AppSettings {
  apiKey: string;
  screenshotInterval: number;
  voiceEnabled: boolean;
  voiceVolume: number;
  debugLogs: boolean;
  consecutiveDistractionsLimit: number;
  screenCaptureMode: string;
  geminiModel: string;
  voiceName: string;
}

let appSettings: AppSettings = {
  apiKey: '',
  screenshotInterval: 5,
  voiceEnabled: true,
  voiceVolume: 0.8,
  debugLogs: false,
  consecutiveDistractionsLimit: 1,
  screenCaptureMode: 'primary',
  geminiModel: 'gemini-3.5-flash',
  voiceName: 'Zephyr'
};

// Timer State
let timerInterval: NodeJS.Timeout | null = null;
let remainingSeconds = 1500; // 25 min default
let totalSeconds = 1500;
let timerPhase: 'focus' | 'break' | 'idle' = 'idle';
let isPaused = false;
let activeTaskName = '';
let activeTechnique = 'traditional';
let activeSessionId = '';

// Token accumulators
let currentSessionInputTokens = 0;
let currentSessionOutputTokens = 0;

// Gemini Client & Connection State
let aiClient: GoogleGenAI | null = null;

function getAIClient(): GoogleGenAI | null {
  if (!appSettings.apiKey) return null;
  if (!aiClient) {
    aiClient = new GoogleGenAI({ apiKey: appSettings.apiKey });
  }
  return aiClient;
}

let screenCaptureTimeout: NodeJS.Timeout | null = null;
let consecutiveDistractionsCount = 0;

// Programmatically generated 16x16 pixel base64 PNG of a yellow banana icon
const TRAY_ICON_DATA = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAASFJREFUOE9jZKAQMFKon2HUAIZhEwYFDgIK/NxM+TkZ3zaK8PCeYXR8/QU9fXy4JCfI9evb9u3rf9xTVPr7Ui/5eyFIDWOBg4AD43+m/SCOjfW/L37+LAdY+HhyGTUfPIAZ8v+8gsDvv1/Xnzrym//g3n+GnFz/f3z/xriievOnRJgB8yUl/h1IiPmRwM7N+paNi/0aEwvjN6b//3/+Y2AEJTadf//+nn5+73vYzZtMDOfOMkPN/p+IkhJfbuaoBwo0sLAwPeHg5/zJyPD/z38Ghp/fP//4/ffXP2Owrv8MiXPncRz49/evQ/XmzwswkvLz9RwKzCwM8xkYGBxQwoGR4QHjf4ZEUd8fB5DFceYFsEHMDA6MjAwP0DURZQCxuRQAgTlsUIbRIx0AAAAASUVORK5CYII=';

// Initialize Settings & Database
async function initStorage() {
  const userDataPath = app.getPath('userData');
  db = new MultidoroDatabase(userDataPath);
  await db.initializedPromise;
  
  // Load setting state from database settings table
  appSettings = db.getAppSettings();
}

function saveSettings(settings: AppSettings) {
  appSettings = { ...appSettings, ...settings };
  db.saveAppSettings(appSettings);
}

// Icon Loader Helper
function getAppIcon(size?: { width: number, height: number }) {
  const icoPath = path.join(__dirname, 'renderer', 'assets', 'icon.ico');
  const pngPath = path.join(__dirname, 'renderer', 'assets', 'icon.png');
  
  if (fs.existsSync(icoPath)) {
    let img = nativeImage.createFromPath(icoPath);
    if (size) {
      img = img.resize(size);
    }
    return img;
  } else if (fs.existsSync(pngPath)) {
    let img = nativeImage.createFromPath(pngPath);
    if (size) {
      img = img.resize(size);
    }
    return img;
  }
  return nativeImage.createFromDataURL(TRAY_ICON_DATA);
}

// Window Creators
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 860,
    minWidth: 800,
    minHeight: 600,
    frame: true,
    show: true,
    icon: getAppIcon(),
    backgroundColor: '#0b0f19',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.setMenu(null);

  const dashboardUrl = path.join(__dirname, 'renderer', 'index.html');
  mainWindow.loadFile(dashboardUrl);

  mainWindow.on('close', (event) => {
    // Hide to tray instead of quitting if active
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
      if (process.platform === 'win32' && tray) {
        tray.displayBalloon({
          title: "Multidoro Minimized to Tray",
          content: "The application is still running in the background. Right-click this icon to exit.",
          iconType: "info"
        });
      } else {
        showToast("Multidoro minimized to tray", "The application is still running. Right-click the system tray icon to exit.");
      }
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createWidgetWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { x: displayX, y: displayY, width: screenWidth, height: screenHeight } = primaryDisplay.workArea;
  
  const widgetWidth = 150;
  const widgetHeight = 60;
  const margin = 20;
  
  const x = displayX + screenWidth - widgetWidth - margin;
  const y = displayY + screenHeight - widgetHeight - margin;

  widgetWindow = new BrowserWindow({
    width: widgetWidth,
    height: widgetHeight,
    x: x,
    y: y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    show: false,
    icon: getAppIcon({ width: 32, height: 32 }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const widgetUrl = path.join(__dirname, 'renderer', 'widget.html');
  widgetWindow.loadFile(widgetUrl);

  widgetWindow.on('closed', () => {
    widgetWindow = null;
  });
}

// System Tray Setup
function setupSystemTray() {
  const icon = getAppIcon({ width: 16, height: 16 });
  tray = new Tray(icon);
  
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open Multidoro', click: () => mainWindow?.show() },
    { label: 'Start Focus Session', click: () => triggerStartFromTray() },
    { label: 'Pause/Resume Timer', click: () => toggleTimerPause() },
    { type: 'separator' },
    { label: 'Quit', click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip('Multidoro: Idle');
  tray.setContextMenu(contextMenu);
  
  tray.on('click', () => {
    mainWindow?.isVisible() ? mainWindow.hide() : mainWindow?.show();
  });
}

function updateTrayTooltip() {
  if (!tray) return;
  const m = Math.floor(remainingSeconds / 60);
  const s = remainingSeconds % 60;
  const timeStr = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  
  if (timerPhase === 'idle') {
    tray.setToolTip('Multidoro: Idle');
  } else {
    tray.setToolTip(`Multidoro [${timerPhase.toUpperCase()}]: ${timeStr}`);
  }
}

// Notification Helper
function showToast(title: string, body: string) {
  if (Notification.isSupported()) {
    const notification = new Notification({
      title,
      body,
      silent: true // Custom speech audio plays, so system sound is muted
    });
    notification.show();
  }
}

async function processStatusUpdate(status: string, description: string, scoldVerbalWarning: string) {
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
      
      if (scoldVerbalWarning && appSettings.voiceEnabled) {
        try {
          const ai = getAIClient();
          if (ai) {
            console.log(`[Status Update] Generating on-demand TTS scolding using voice: ${appSettings.voiceName || 'Zephyr'}`);
            const ttsResponse = await ai.models.generateContent({
              model: 'gemini-3.1-flash-tts-preview',
              contents: scoldVerbalWarning,
              config: {
                responseModalities: ['AUDIO'],
                speechConfig: {
                  voiceConfig: {
                    prebuiltVoiceConfig: {
                      voiceName: appSettings.voiceName || 'Zephyr'
                    }
                  }
                }
              }
            });

            if (ttsResponse.usageMetadata) {
              currentSessionInputTokens += ttsResponse.usageMetadata.promptTokenCount || 0;
              currentSessionOutputTokens += ttsResponse.usageMetadata.candidatesTokenCount || 0;
            }

            if (ttsResponse.candidates?.[0]?.content?.parts) {
              for (const part of ttsResponse.candidates[0].content.parts) {
                if (part.inlineData && part.inlineData.data && part.inlineData.mimeType) {
                  console.log(`[Status Update] Streaming TTS audio chunk: mimeType=${part.inlineData.mimeType}, size=${part.inlineData.data.length}`);
                  broadcastAudio(part.inlineData.data, part.inlineData.mimeType);
                }
              }
            }
          }
        } catch (ttsErr) {
          console.error('[Status Update] TTS generation failed:', ttsErr);
        }
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

/**
 * Captures the specified display as a JPEG buffer using Electron's native desktopCapturer API.
 * If targetDisplayId is not specified or not found, it falls back to the primary display.
 */
async function captureScreen(targetDisplayId?: string): Promise<Buffer> {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 1920, height: 1080 }
  });

  if (sources.length === 0) {
    throw new Error('No screen sources found by desktopCapturer');
  }

  let matchedSource = null;
  if (targetDisplayId) {
    matchedSource = sources.find(s => String(s.display_id) === String(targetDisplayId));
  }

  // Fallback to primary if target not found or not specified
  if (!matchedSource) {
    const primaryDisplay = screen.getPrimaryDisplay();
    matchedSource = sources.find(s => String(s.display_id) === String(primaryDisplay.id));
  }

  // Fallback to first source as absolute fallback
  if (!matchedSource) {
    matchedSource = sources[0];
  }

  return matchedSource.thumbnail.toJPEG(80);
}

// Stateless Screen Classification check
async function runScreenClassification() {
  if (timerPhase !== 'focus' || isPaused) {
    console.log(`[Screen Classification] Skipping: phase=${timerPhase}, isPaused=${isPaused}`);
    scheduleNextScreenshotCheck();
    return;
  }

  const ai = getAIClient();
  if (!ai) {
    console.warn('[Screen Classification] Skipping check: Gemini API key is missing.');
    broadcastComment('Gemini Coach: API key is missing. Add it in Settings.', false);
    scheduleNextScreenshotCheck();
    return;
  }

  try {
    console.log('[Screen Classification] Capturing screenshot...');
    
    let targetDisplayId: string | undefined = undefined;
    try {
      const captureMode = appSettings.screenCaptureMode || 'primary';
      
      if (captureMode === 'cursor') {
        const cursorPoint = screen.getCursorScreenPoint();
        const activeDisplay = screen.getDisplayNearestPoint(cursorPoint);
        targetDisplayId = String(activeDisplay.id);
        if (appSettings.debugLogs) {
          console.log(`[Multi-Monitor] Cursor: x=${cursorPoint.x}, y=${cursorPoint.y} on Display ID: ${activeDisplay.id}`);
        }
      } else if (captureMode.startsWith('display:')) {
        targetDisplayId = captureMode.substring('display:'.length);
        if (appSettings.debugLogs) {
          console.log(`[Screen Capture] Specific display targeted: ${targetDisplayId}`);
        }
      } else {
        // 'primary' mode or fallback: target the primary display ID
        const primaryDisplay = screen.getPrimaryDisplay();
        targetDisplayId = String(primaryDisplay.id);
        if (appSettings.debugLogs) {
          console.log(`[Screen Capture] Mode is primary. Targeting primary display: ${targetDisplayId}`);
        }
      }
    } catch (err) {
      console.warn('[Screen Capture] Failed to resolve target display. Falling back to default:', err);
    }

    const imgBuffer = await captureScreen(targetDisplayId);
    const base64Data = imgBuffer.toString('base64');

    const promptText = `You are Multidoro, a strict Pomodoro coach who monitors the user's screen screenshots.
The user is currently in a FOCUS session working on the task: "${activeTaskName}".
Your role is to strictly verify if their screen screenshot matches their task.

Analyze the screenshot:
1. If the screenshot is completely black, blank, or you cannot see any application windows/content, report:
   - status: "ON_TASK"
   - description: "Screen blank or transitioning"
   - scold_verbal_warning: ""
2. Otherwise, determine if the user is ON_TASK or DISTRACTED.
   - If they are doing anything unrelated to their task "${activeTaskName}", they are DISTRACTED.
   - In the description, describe briefly what they are doing on the screen.
   - If they are DISTRACTED, write a short, strict, direct verbal warning (under 15 words) in 'scold_verbal_warning' addressing the user. For example: "Stop looking at shoes and write your API code!" or "Close Twitter right now and focus on your math homework!". If they are ON_TASK, set 'scold_verbal_warning' to an empty string.`;

    const modelName = appSettings.geminiModel || 'gemini-3.5-flash';
    if (appSettings.debugLogs) {
      console.log(`[Screen Classification] Sending request to model: ${modelName}`);
    }

    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        status: { type: Type.STRING, enum: ['ON_TASK', 'DISTRACTED'] },
        description: { type: Type.STRING },
        scold_verbal_warning: { type: Type.STRING }
      },
      required: ['status', 'description', 'scold_verbal_warning']
    };

    const response = await ai.models.generateContent({
      model: modelName,
      contents: [
        {
          inlineData: {
            data: base64Data,
            mimeType: 'image/jpeg'
          }
        },
        promptText
      ],
      config: {
        responseMimeType: 'application/json',
        responseJsonSchema: responseSchema
      }
    });

    if (response.usageMetadata) {
      currentSessionInputTokens += response.usageMetadata.promptTokenCount || 0;
      currentSessionOutputTokens += response.usageMetadata.candidatesTokenCount || 0;
    }

    const resultText = response.text;
    if (appSettings.debugLogs) {
      console.log(`[Screen Classification] Response text: ${resultText}`);
    }

    const result = JSON.parse(resultText || '{}');
    const status = result.status || 'ON_TASK';
    const description = result.description || 'No description provided';
    const scoldVerbalWarning = result.scold_verbal_warning || '';

    await processStatusUpdate(status, description, scoldVerbalWarning);

  } catch (error) {
    console.error('[Screen Classification] Failed:', error);
    broadcastComment(`Gemini Coach: Check failed. ${(error as Error).message}`, false);
  } finally {
    scheduleNextScreenshotCheck();
  }
}

function scheduleNextScreenshotCheck(immediate: boolean = false) {
  if (screenCaptureTimeout) clearTimeout(screenCaptureTimeout);
  if (timerPhase === 'focus' && !isPaused) {
    const delay = immediate ? 500 : appSettings.screenshotInterval * 1000;
    console.log(`[Screenshot Check] Scheduling next capture in ${immediate ? '0.5' : appSettings.screenshotInterval}s`);
    screenCaptureTimeout = setTimeout(runScreenClassification, delay);
  } else {
    console.log('[Screenshot Check] Loop stopped: phase is not focus, or is paused');
  }
}

// IPC Helpers to broadcast to both windows
function broadcastTimerUpdate() {
  const state = {
    remainingSeconds,
    totalSeconds,
    phase: timerPhase,
    isPaused,
    technique: activeTechnique,
    taskName: activeTaskName
  };
  mainWindow?.webContents.send('timer-update', state);
  widgetWindow?.webContents.send('timer-update', state);
  updateTrayTooltip();
}

function broadcastAudio(base64Data: string, mimeType: string) {
  // If voice is enabled, broadcast to main window which handles playbacks
  if (appSettings.voiceEnabled) {
    mainWindow?.webContents.send('gemini-audio', { base64Data, mimeType });
  }
}

function broadcastComment(text: string, isDistraction: boolean) {
  const comment = {
    text,
    isDistraction,
    timestamp: new Date().toLocaleTimeString()
  };
  mainWindow?.webContents.send('gemini-comment', comment);
  widgetWindow?.webContents.send('gemini-comment', comment);
}

// Timer Logic
function triggerStartFromTray() {
  if (timerPhase === 'idle') {
    startTimer("Work Session", 'traditional', 25);
  }
}

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

function startTimer(taskName: string, technique: string, durationMinutes: number) {
  stopTimerInterval();

  currentSessionInputTokens = 0;
  currentSessionOutputTokens = 0;

  activeTaskName = taskName || 'Work Session';
  activeTechnique = technique;
  totalSeconds = durationMinutes * 60;
  remainingSeconds = totalSeconds;
  timerPhase = 'focus';
  isPaused = false;

  // Add Focus Session to Database
  const newSession = db.addSession({
    id: Math.random().toString(36).substring(2, 9),
    taskName: activeTaskName,
    startTime: new Date().toISOString(),
    durationMinutes,
    type: 'focus',
    technique
  });
  activeSessionId = newSession.id;

  // Broadcast initial UI update
  broadcastTimerUpdate();
  broadcastComment(`Focus started: "${activeTaskName}" for ${durationMinutes}m.`, false);

  // Start checking screenshot scanning loop
  consecutiveDistractionsCount = 0;
  scheduleNextScreenshotCheck(true);

  // Start timer count tick
  startTimerInterval();
}

function toggleTimerPause() {
  if (timerPhase === 'idle') return;
  isPaused = !isPaused;
  broadcastTimerUpdate();
  broadcastComment(isPaused ? 'Timer paused.' : 'Timer resumed.', false);
}

function resetTimer() {
  stopTimerInterval();
  
  if (screenCaptureTimeout) {
    clearTimeout(screenCaptureTimeout);
    screenCaptureTimeout = null;
  }
  consecutiveDistractionsCount = 0;

  // If focus session was active, record it as aborted; if break session, mark aborted
  if (activeSessionId) {
    if (timerPhase === 'focus') {
      saveSessionTokenStats('aborted');
    } else if (timerPhase === 'break') {
      db.updateSessionStatus(activeSessionId, 'aborted');
    }
  }

  timerPhase = 'idle';
  isPaused = false;
  remainingSeconds = 1500;
  totalSeconds = 1500;
  activeTaskName = '';
  activeSessionId = '';

  broadcastTimerUpdate();
  broadcastComment('Timer reset to idle.', false);
}

function handleTimerComplete() {
  stopTimerInterval();
  
  if (screenCaptureTimeout) {
    clearTimeout(screenCaptureTimeout);
    screenCaptureTimeout = null;
  }
  consecutiveDistractionsCount = 0;

  // Update DB session
  if (activeSessionId) {
    if (timerPhase === 'focus') {
      saveSessionTokenStats('completed');
    } else {
      db.updateSessionStatus(activeSessionId, 'completed');
    }
  }

  // Notify user
  showToast("Pomodoro Complete!", timerPhase === 'focus' ? "Focus complete! Time for a short break." : "Break complete! Let's get back to work.");

  // Transition Phase
  if (timerPhase === 'focus') {
    timerPhase = 'break';
    isPaused = false;
    
    // Choose break duration based on technique
    let breakMin = 5;
    if (activeTechnique === 'ultradian') breakMin = 10;
    else if (activeTechnique === 'animedoro') breakMin = 20;
    
    totalSeconds = breakMin * 60;
    remainingSeconds = totalSeconds;
    
    // Add Break Session to DB
    const newSession = db.addSession({
      id: Math.random().toString(36).substring(2, 9),
      taskName: 'Rest & Recover',
      startTime: new Date().toISOString(),
      durationMinutes: breakMin,
      type: 'break',
      technique: activeTechnique
    });
    activeSessionId = newSession.id;
    
    broadcastTimerUpdate();
    broadcastComment(`Focus done. Break time started (${breakMin} minutes).`, false);
    
    startTimerInterval();
  } else {
    // Break ends, go back to idle
    timerPhase = 'idle';
    remainingSeconds = 1500;
    totalSeconds = 1500;
    activeTaskName = '';
    activeSessionId = '';
    
    broadcastTimerUpdate();
    broadcastComment('Break completed. App is idle.', false);
  }
}

function startTimerInterval() {
  timerInterval = setInterval(() => {
    if (!isPaused) {
      remainingSeconds--;
      if (remainingSeconds <= 0) {
        handleTimerComplete();
      } else {
        broadcastTimerUpdate();
      }
    }
  }, 1000);
}

function stopTimerInterval() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

// IPC Listener Wire-up
function setupIpcListeners() {
  // Timer Controls
  ipcMain.on('start-timer', (_event, data) => {
    startTimer(data.taskName, data.technique, data.durationMinutes);
  });
  
  ipcMain.on('pause-timer', () => {
    isPaused = true;
    if (screenCaptureTimeout) {
      clearTimeout(screenCaptureTimeout);
      screenCaptureTimeout = null;
    }
    broadcastTimerUpdate();
  });
  
  ipcMain.on('resume-timer', () => {
    isPaused = false;
    broadcastTimerUpdate();
    scheduleNextScreenshotCheck(true);
  });
  
  ipcMain.on('reset-timer', () => {
    resetTimer();
  });
  
  // Settings & Storage APIs
  ipcMain.handle('get-settings', () => {
    return appSettings;
  });

  ipcMain.handle('get-displays', async () => {
    try {
      const displays = screen.getAllDisplays();
      return displays.map((d, index) => ({
        id: String(d.id),
        name: `Display ${index + 1}`,
        width: Math.round(d.bounds.width * d.scaleFactor),
        height: Math.round(d.bounds.height * d.scaleFactor)
      }));
    } catch (err) {
      console.error('[IPC] Failed to list displays:', err);
      return [];
    }
  });
  
  ipcMain.handle('save-settings', (_event, settings) => {
    saveSettings(settings);
    aiClient = null; // Invalidate cached instance
    // If screenshot interval changed and session is active, restart timeout loop
    if (screenCaptureTimeout && timerPhase === 'focus') {
      clearTimeout(screenCaptureTimeout);
      scheduleNextScreenshotCheck();
    }
    return appSettings;
  });
  
  ipcMain.handle('get-history', () => {
    return {
      sessions: db.getSessions(),
      distractions: db.getDistractions()
    };
  });
  
  ipcMain.handle('clear-history', () => {
    db.clearLogs();
    return { sessions: [], distractions: [] };
  });
  
  // HUD widget toggle
  ipcMain.on('toggle-widget', (_event, visible) => {
    if (visible) {
      if (!widgetWindow) createWidgetWindow();
      widgetWindow?.show();
    } else {
      widgetWindow?.hide();
    }
  });
}

// App lifecycle
app.whenReady().then(async () => {
  // Set App User Model ID for Windows Toast Notifications to work
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.multidoro.app');
  }
  
  await initStorage();
  createMainWindow();
  setupSystemTray();
  setupIpcListeners();
  
  // Warn user if API Key is missing on startup
  if (!appSettings.apiKey) {
    setTimeout(() => {
      showToast("Gemini API Key Missing", "Live screen coaching is inactive. Configure your API key in Settings.");
    }, 1500);
  }
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

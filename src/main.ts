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
}

let appSettings: AppSettings = {
  apiKey: '',
  screenshotInterval: 5,
  voiceEnabled: true,
  voiceVolume: 0.8,
  debugLogs: false,
  consecutiveDistractionsLimit: 1,
  screenCaptureMode: 'primary'
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

// Gemini Live Connection State
let liveSession: any = null;
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

// Gemini Live API Handler
async function connectGemini() {
  if (!appSettings.apiKey) {
    console.warn('Cannot connect: API key is missing.');
    return;
  }
  if (liveSession) return; // Already connected

  try {
    const ai = new GoogleGenAI({ apiKey: appSettings.apiKey });
    const model = 'models/gemini-3.1-flash-live-preview';
    
    const promptText = `You are Multidoro, a strict Pomodoro coach who monitors the user's screen screenshots.
The user is currently in a FOCUS session working on the task: "${activeTaskName}".
Your role is to strictly verify if their screen screenshots match their task.

On initial connection, do not make any tool calls or speak until you receive the first screenshot frame.

When you receive a screenshot (video frame):
- If the screenshot is completely black, blank, or you cannot see any application windows/content, report the status as ON_TASK with the description "Screen blank or transitioning". Do not guess or hallucinate any activities.
- Otherwise, you MUST call the 'report_distraction_status' tool to report the user's status.
- DO NOT speak verbally (do not output audio) in response to the screenshot. You must ONLY call the tool.

When you receive a text message from the system starting with '[WARN]':
- You MUST speak a short verbal warning (output audio, under 15 words) telling the user to return to their task: "${activeTaskName}", and explicitly state what they were caught doing (e.g., "Stop watching YouTube and get back to writing Python tests!").
- DO NOT call any tool in response to '[WARN]'.`;

    const config = {
      responseModalities: [ Modality.AUDIO ],
      systemInstruction: {
        parts: [ { text: promptText } ]
      },
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: 'Zephyr'
          }
        }
      },
      tools: [
        {
          functionDeclarations: [
            {
              name: 'report_distraction_status',
              description: 'Report the current distraction status based on screenshot content analysis.',
              parameters: {
                type: Type.OBJECT,
                properties: {
                  status: {
                    type: Type.STRING,
                    description: 'The status of the user: ON_TASK if they are working on the target task, DISTRACTED if they are doing anything else.'
                  },
                  description: {
                    type: Type.STRING,
                    description: 'A brief description of what they are doing on the screen.'
                  }
                },
                required: ['status', 'description']
              }
            }
          ]
        }
      ]
    };

    console.log('Connecting to Gemini Live WebSocket...');
    const session = await ai.live.connect({
      model,
      callbacks: {
        onopen: () => {
          console.log('Gemini Live session connected.');
          broadcastComment('Gemini Coach connected. Screen monitoring active.', false);
        },
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
        onerror: (err: any) => {
          console.error('[Gemini WS Error]:', err);
        },
        onclose: (e: any) => {
          console.log('[Gemini WS Close] Code:', e.code, 'Reason:', e.reason);
          liveSession = null;
          
          // Auto-reconnect if we are still actively focusing and no session exists
          if (timerPhase === 'focus' && !isPaused) {
            console.log('[Gemini WS Close] Unexpected close during focus phase. Auto-reconnecting in 3 seconds...');
            setTimeout(() => {
              if (timerPhase === 'focus' && !isPaused && !liveSession) {
                console.log('[Gemini WS Close] Reconnecting session after abnormal close...');
                connectGemini().catch(err => {
                  console.error('[Gemini WS Close] Auto-reconnect failed:', err);
                });
              }
            }, 3000);
          }
        }
      },
      config
    });

    liveSession = session;
    console.log('Gemini Live session variable assigned. Starting screenshot loop.');
    consecutiveDistractionsCount = 0;
    scheduleNextScreenshotCheck(true);
  } catch (err) {
    console.error('Gemini connection failed:', err);
    broadcastComment(`Gemini Connection Error: ${(err as Error).message}`, false);
  }
}

function disconnectGemini() {
  if (liveSession) {
    try {
      liveSession.close();
    } catch (e) {
      console.error('Error closing live session:', e);
    }
    liveSession = null;
  }
}

function truncateLargeData(obj: any): any {
  if (typeof obj !== 'object' || obj === null) return obj;
  if (Array.isArray(obj)) {
    return obj.map(truncateLargeData);
  }
  const truncated: any = {};
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (key === 'data' && typeof val === 'string' && val.length > 100) {
      truncated[key] = `${val.substring(0, 30)}... [truncated ${val.length} bytes]`;
    } else if (key === 'video' && typeof val === 'object' && val !== null && val.data) {
      truncated[key] = {
        ...val,
        data: `${val.data.substring(0, 30)}... [truncated ${val.data.length} bytes]`
      };
    } else {
      truncated[key] = truncateLargeData(val);
    }
  }
  return truncated;
}

function handleGeminiMessage(message: any) {
  // Handle GoAway signal from Gemini Live
  if (message.goAway) {
    console.log('[Gemini GoAway] Received GoAway signal from server. Time left:', message.goAway.timeLeft);
    disconnectGemini();
    setTimeout(() => {
      if (timerPhase === 'focus' && !isPaused && !liveSession) {
        console.log('[Gemini GoAway] Reconnecting session after GoAway signal...');
        connectGemini().catch(err => {
          console.error('[Gemini GoAway] Reconnect failed:', err);
        });
      }
    }, 1000);
    return;
  }

  // Handle root-level toolCall from Gemini Live API
  if (message.toolCall?.functionCalls) {
    for (const functionCall of message.toolCall.functionCalls) {
      console.log(`[Gemini Tool Call] Received functionCall: name="${functionCall.name}", id="${functionCall.id}", args=`, functionCall.args);
      
      if (functionCall.name === 'report_distraction_status') {
        const { status, description } = functionCall.args as { status: string; description: string };
        
        // Process status change locally
        processStatusUpdate(status, description);
        
        // Send tool response to complete the WebSocket transaction
        if (liveSession) {
          const toolResponse = {
            functionResponses: [
              {
                name: 'report_distraction_status',
                response: {
                  output: {
                    success: true
                  }
                },
                id: functionCall.id
              }
            ]
          };
          if (appSettings.debugLogs) {
            console.log('[Gemini WS Outbound - ToolResponse]', JSON.stringify(toolResponse, null, 2));
          } else {
            console.log(`[Gemini Tool Call] Sending tool response for id="${functionCall.id}"`);
          }
          try {
            liveSession.sendToolResponse(toolResponse);
          } catch (err) {
            console.error('[Gemini Tool Call] Failed to send tool response:', err);
          }
        }
      }
    }
  }

  if (message.serverContent?.modelTurn?.parts) {
    for (const part of message.serverContent.modelTurn.parts) {
      // Stream Audio (base64 PCM) to Renderer (Gemini will only generate audio in response to [WARN])
      if (part.inlineData) {
        console.log(`[Gemini Response] Streaming audio chunk: mimeType=${part.inlineData.mimeType}, size=${part.inlineData.data?.length || 0}`);
        broadcastAudio(part.inlineData.data, part.inlineData.mimeType);
      }
      
      // Handle tool call (functionCall)
      if (part.functionCall) {
        const functionCall = part.functionCall;
        console.log(`[Gemini Tool Call] Received functionCall: name="${functionCall.name}", id="${functionCall.id}", args=`, functionCall.args);
        
        if (functionCall.name === 'report_distraction_status') {
          const { status, description } = functionCall.args as { status: string; description: string };
          
          // Process status change locally
          processStatusUpdate(status, description);
          
          // Send tool response to complete the WebSocket transaction
          if (liveSession) {
            const toolResponse = {
              functionResponses: [
                {
                  name: 'report_distraction_status',
                  response: {
                    output: {
                      success: true
                    }
                  },
                  id: functionCall.id
                }
              ]
            };
            if (appSettings.debugLogs) {
              console.log('[Gemini WS Outbound - ToolResponse]', JSON.stringify(toolResponse, null, 2));
            } else {
              console.log(`[Gemini Tool Call] Sending tool response for id="${functionCall.id}"`);
            }
            try {
              liveSession.sendToolResponse(toolResponse);
            } catch (err) {
              console.error('[Gemini Tool Call] Failed to send tool response:', err);
            }
          }
        }
      }

      // Handle text comment (Fallback)
      if (part.text) {
        const text = part.text.trim();
        const upperText = text.toUpperCase();
        console.log(`[Gemini Response] Raw text comment: "${text}"`);
        
        // Skip echo warning triggers
        if (upperText.includes('[WARN]')) {
          continue;
        }
        
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
                text: `[WARN] Speak a warning now! The user was caught doing: ${cleanText}`
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
                  text: `[WARN] Speak a warning now! The user was caught doing: ${text}`
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
      }
    }
  }
}

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
          text: `[WARN] Speak a warning now! The user was caught doing: ${description}`
        };
        if (appSettings.debugLogs) {
          console.log('[Gemini WS Outbound - Warn]', JSON.stringify(payload, null, 2));
        } else {
          console.log(`[Status Update] Sending [WARN] message to prompt vocal warning: "${description}"`);
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

// Screenshot Capture loop
async function runScreenshotCheck() {
  if (!liveSession || timerPhase !== 'focus' || isPaused) {
    console.log(`[Screenshot Check] Skipping: liveSession=${!!liveSession}, phase=${timerPhase}, isPaused=${isPaused}`);
    scheduleNextScreenshotCheck();
    return;
  }

  try {
    console.log('[Screenshot Check] Capturing screenshot...');
    
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

    const payload = {
      video: {
        data: base64Data,
        mimeType: 'image/jpeg'
      },
      text: `[Frame evaluation] Target Task: "${activeTaskName}". Analyze screenshot and state if focused or distracted.`
    };
    if (appSettings.debugLogs) {
      console.log('[Gemini WS Outbound - Frame]', JSON.stringify(truncateLargeData(payload), null, 2));
    }
    // Send frame to Gemini Live
    liveSession.sendRealtimeInput(payload);
  } catch (error) {
    console.error('[Screenshot Check] Screenshot capture or send failed:', error);
  } finally {
    scheduleNextScreenshotCheck();
  }
}

function scheduleNextScreenshotCheck(immediate: boolean = false) {
  if (screenCaptureTimeout) clearTimeout(screenCaptureTimeout);
  if (timerPhase === 'focus' && !isPaused && liveSession) {
    const delay = immediate ? 500 : appSettings.screenshotInterval * 1000;
    console.log(`[Screenshot Check] Scheduling next capture in ${immediate ? '0.5' : appSettings.screenshotInterval}s`);
    screenCaptureTimeout = setTimeout(runScreenshotCheck, delay);
  } else {
    console.log('[Screenshot Check] Loop stopped: phase is not focus, or is paused, or liveSession is inactive');
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
  disconnectGemini();

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

  // Connect Gemini Live Coach
  connectGemini();

  // Start checking screenshot scanning loop
  if (screenCaptureTimeout) clearTimeout(screenCaptureTimeout);

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
  disconnectGemini();
  
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
  disconnectGemini();
  
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

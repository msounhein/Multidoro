// Local type helpers for typescript
interface TimerState {
  remainingSeconds: number;
  totalSeconds: number;
  phase: 'focus' | 'break' | 'idle';
  isPaused: boolean;
  technique: string;
  taskName: string;
}

interface AppSettings {
  apiKey: string;
  screenshotInterval: number;
  voiceEnabled: boolean;
  voiceVolume: number;
  debugLogs: boolean;
}

interface PomodoroSession {
  id: string;
  taskName: string;
  startTime: string;
  endTime?: string;
  durationMinutes: number;
  type: 'focus' | 'break';
  status: 'completed' | 'interrupted' | 'aborted';
  technique: string;
  distractionsCount?: number;
}

// SVG Circular progress details
const CIRCLE_CIRCUMFERENCE = 2 * Math.PI * 115; // 722.56px for radius 115
const progressCircle = document.querySelector('.progress-ring__circle') as SVGCircleElement;

if (progressCircle) {
  progressCircle.style.strokeDasharray = `${CIRCLE_CIRCUMFERENCE} ${CIRCLE_CIRCUMFERENCE}`;
  progressCircle.style.strokeDashoffset = `${CIRCLE_CIRCUMFERENCE}`;
}

// Audio context states for coach voice playback
let audioCtx: AudioContext | null = null;
let nextPlayTime = 0;

function parseSampleRate(mimeType: string): number {
  if (!mimeType) return 24000;
  const parts = mimeType.split(';');
  for (const part of parts) {
    const subParts = part.split('=');
    if (subParts.length === 2 && subParts[0].trim() === 'rate') {
      const rate = parseInt(subParts[1].trim(), 10);
      if (!isNaN(rate)) return rate;
    }
  }
  return 24000; // Default fallback
}

// Queue and play PCM raw audio chunks
function playPCMChunk(base64Data: string, mimeType: string) {
  const volumeSlider = document.getElementById('setting-voice-volume') as HTMLInputElement;
  const volume = volumeSlider ? parseFloat(volumeSlider.value) : 0.8;
  
  if (volume <= 0) return; // Muted

  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }

    const rate = parseSampleRate(mimeType);

    // Decode base64 to binary
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // Convert Int16 PCM to Float32
    const int16Data = new Int16Array(bytes.buffer);
    const float32Data = new Float32Array(int16Data.length);
    for (let i = 0; i < int16Data.length; i++) {
      float32Data[i] = int16Data[i] < 0 ? int16Data[i] / 32768 : int16Data[i] / 32767;
    }

    // Create Buffer
    const audioBuffer = audioCtx.createBuffer(1, float32Data.length, rate);
    audioBuffer.copyToChannel(float32Data, 0);

    const gainNode = audioCtx.createGain();
    gainNode.gain.value = volume;
    gainNode.connect(audioCtx.destination);

    const source = audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(gainNode);

    // Schedule play time to avoid audio clicking/gaps
    const now = audioCtx.currentTime;
    if (nextPlayTime < now) {
      nextPlayTime = now;
    }

    source.start(nextPlayTime);
    nextPlayTime += audioBuffer.duration;
  } catch (error) {
    console.error('Failed to play incoming audio chunk:', error);
  }
}

// Play UI synthetic chimes
function playChimeSound() {
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }

    const now = audioCtx.currentTime;
    
    // Note 1 (G5)
    const osc1 = audioCtx.createOscillator();
    const gain1 = audioCtx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(783.99, now); // G5
    gain1.gain.setValueAtTime(0.15, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    osc1.connect(gain1);
    gain1.connect(audioCtx.destination);
    
    // Note 2 (C6) starting slightly later
    const osc2 = audioCtx.createOscillator();
    const gain2 = audioCtx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1046.50, now + 0.12); // C6
    gain2.gain.setValueAtTime(0.15, now + 0.12);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
    osc2.connect(gain2);
    gain2.connect(audioCtx.destination);

    osc1.start(now);
    osc1.stop(now + 0.5);
    
    osc2.start(now + 0.12);
    osc2.stop(now + 0.6);
  } catch (e) {
    console.error('Failed to play synthetic chime:', e);
  }
}

// DOM elements
const timeDisplay = document.getElementById('time-left') as HTMLSpanElement;
const taskDisplay = document.getElementById('current-task-display') as HTMLSpanElement;
const phaseBadge = document.getElementById('timer-phase') as HTMLDivElement;

const btnStart = document.getElementById('btn-start') as HTMLButtonElement;
const btnPause = document.getElementById('btn-pause') as HTMLButtonElement;
const btnReset = document.getElementById('btn-reset') as HTMLButtonElement;
const chkWidget = document.getElementById('chk-hud-overlay') as HTMLInputElement;

const inputTaskName = document.getElementById('input-task-name') as HTMLInputElement;
const btnMic = document.getElementById('btn-mic') as HTMLButtonElement;
const speechStatus = document.getElementById('speech-status') as HTMLDivElement;

const feedLog = document.getElementById('feed-log') as HTMLDivElement;

// Tab links logic
const tabPaneTimer = document.getElementById('tab-timer') as HTMLElement;
const tabPaneHistory = document.getElementById('tab-history') as HTMLElement;
const tabPaneSettings = document.getElementById('tab-settings') as HTMLElement;
const tabLinks = document.querySelectorAll('.nav-links li');

tabLinks.forEach(link => {
  link.addEventListener('click', () => {
    tabLinks.forEach(l => l.classList.remove('active'));
    link.classList.add('active');

    const tab = link.getAttribute('data-tab');
    tabPaneTimer.classList.remove('active');
    tabPaneHistory.classList.remove('active');
    tabPaneSettings.classList.remove('active');

    if (tab === 'timer') {
      tabPaneTimer.classList.add('active');
    } else if (tab === 'history') {
      tabPaneHistory.classList.add('active');
      loadAnalyticsData();
    } else if (tab === 'settings') {
      tabPaneSettings.classList.add('active');
      loadSettingsData();
    }
  });
});

// Pomodoro Techniques Configuration
const techCards = document.querySelectorAll('.tech-card');
const customRatioInputs = document.getElementById('custom-ratio-inputs') as HTMLDivElement;
const customFocusInput = document.getElementById('custom-focus') as HTMLInputElement;
const customBreakInput = document.getElementById('custom-break') as HTMLInputElement;

let selectedTechnique = 'traditional';
let selectedFocusMin = 25;

techCards.forEach(card => {
  card.addEventListener('click', () => {
    techCards.forEach(c => c.classList.remove('active'));
    card.classList.add('active');

    const tech = card.getAttribute('data-tech') || 'traditional';
    selectedTechnique = tech;

    if (tech === 'custom') {
      customRatioInputs.style.display = 'flex';
      selectedFocusMin = parseInt(customFocusInput.value, 10) || 30;
    } else {
      customRatioInputs.style.display = 'none';
      selectedFocusMin = parseInt(card.getAttribute('data-focus') || '25', 10);
    }
    
    // Reset display time
    timeDisplay.textContent = `${selectedFocusMin.toString().padStart(2, '0')}:00`;
  });
});

[customFocusInput, customBreakInput].forEach(inp => {
  inp.addEventListener('input', () => {
    if (selectedTechnique === 'custom') {
      selectedFocusMin = parseInt(customFocusInput.value, 10) || 30;
      timeDisplay.textContent = `${selectedFocusMin.toString().padStart(2, '0')}:00`;
    }
  });
});

// Speech-to-Text using Web Speech API
const SpeechRecognitionAPI = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
if (SpeechRecognitionAPI) {
  const recognition = new SpeechRecognitionAPI();
  recognition.continuous = false;
  recognition.lang = 'en-US';
  recognition.interimResults = false;
  
  btnMic.addEventListener('click', () => {
    try {
      recognition.start();
      speechStatus.textContent = 'Listening to your task...';
      speechStatus.className = 'speech-feedback listening';
    } catch (e) {
      console.log('Recognition already active.');
    }
  });

  recognition.onresult = (event: any) => {
    const resultText = event.results[0][0].transcript;
    inputTaskName.value = resultText;
    speechStatus.textContent = 'Speech detected!';
    speechStatus.className = 'speech-feedback';
    setTimeout(() => { speechStatus.textContent = ''; }, 3000);
  };

  recognition.onerror = (event: any) => {
    speechStatus.textContent = `Speech Error: ${event.error}`;
    speechStatus.className = 'speech-feedback error';
    setTimeout(() => { speechStatus.textContent = ''; }, 3000);
  };

  recognition.onend = () => {
    if (speechStatus.className.includes('listening')) {
      speechStatus.textContent = 'No speech detected.';
      speechStatus.className = 'speech-feedback';
      setTimeout(() => { speechStatus.textContent = ''; }, 3000);
    }
  };
} else {
  btnMic.style.display = 'none'; // Unsupported
}

// Timer buttons click bindings
btnStart.addEventListener('click', () => {
  const taskName = inputTaskName.value.trim();
  if (selectedTechnique === 'custom') {
    const focusMin = parseInt(customFocusInput.value, 10) || 30;
    (window as any).electronAPI.startTimer(taskName, selectedTechnique, focusMin);
  } else {
    (window as any).electronAPI.startTimer(taskName, selectedTechnique, selectedFocusMin);
  }
});

btnPause.addEventListener('click', () => {
  const isPauseState = btnPause.textContent === 'Pause';
  if (isPauseState) {
    (window as any).electronAPI.pauseTimer();
  } else {
    (window as any).electronAPI.resumeTimer();
  }
});

btnReset.addEventListener('click', () => {
  (window as any).electronAPI.resetTimer();
});

chkWidget.addEventListener('change', () => {
  (window as any).electronAPI.toggleWidget(chkWidget.checked);
});

// Handle IPC timer-update
let currentPhase: TimerState['phase'] = 'idle';
(window as any).electronAPI.onTimerUpdate((state: TimerState) => {
  // Check for phase transitions to play chime sound
  if (currentPhase !== state.phase) {
    if (currentPhase !== 'idle' && state.phase !== 'idle') {
      playChimeSound();
    }
    currentPhase = state.phase;
  }

  // Format countdown string
  const m = Math.floor(state.remainingSeconds / 60).toString().padStart(2, '0');
  const s = (state.remainingSeconds % 60).toString().padStart(2, '0');
  timeDisplay.textContent = `${m}:${s}`;
  
  // Task text indicator
  taskDisplay.textContent = state.taskName || 'Idle';
  
  // Phase indicator
  phaseBadge.textContent = state.phase.toUpperCase();
  
  // Progress Ring
  if (progressCircle) {
    const fraction = state.remainingSeconds / state.totalSeconds;
    const offset = CIRCLE_CIRCUMFERENCE * fraction;
    progressCircle.style.strokeDashoffset = `${offset}`;
  }
  
  // Visual Theme mapping
  document.body.className = `theme-${state.phase}`;
  
  // Render control visibilities
  if (state.phase === 'idle') {
    btnStart.style.display = 'inline-flex';
    btnPause.style.display = 'none';
    inputTaskName.disabled = false;
  } else {
    btnStart.style.display = 'none';
    btnPause.style.display = 'inline-flex';
    btnPause.textContent = state.isPaused ? 'Resume' : 'Pause';
    btnPause.className = state.isPaused ? 'btn btn-primary' : 'btn btn-secondary';
    inputTaskName.disabled = true;
  }
  
  if (state.isPaused) {
    timeDisplay.style.opacity = '0.5';
  } else {
    timeDisplay.style.opacity = '1';
  }
});

// Handle IPC audio chunks
(window as any).electronAPI.onGeminiAudio((data: { base64Data: string; mimeType: string }) => {
  playPCMChunk(data.base64Data, data.mimeType);
});

// Handle IPC comments & warnings logs
(window as any).electronAPI.onGeminiComment((comment: { text: string; isDistraction: boolean; timestamp: string }) => {
  const placeholder = feedLog.querySelector('.feed-placeholder');
  if (placeholder) {
    placeholder.remove();
  }
  
  const entry = document.createElement('div');
  entry.className = `log-entry ${comment.isDistraction ? 'distraction' : 'normal'}`;
  
  // If distraction, change theme color to focus distraction colors briefly
  if (comment.isDistraction) {
    document.body.className = 'theme-distracted';
  }
  
  entry.innerHTML = `
    <span class="log-time">[${comment.timestamp}]</span>
    <span class="log-sender">Gemini Coach:</span>
    <span class="log-text">${comment.text}</span>
  `;
  
  feedLog.appendChild(entry);
  feedLog.scrollTop = feedLog.scrollHeight;
});

// Settings tab handler
const apiInput = document.getElementById('setting-api-key') as HTMLInputElement;
const visibilityBtn = document.getElementById('btn-toggle-key-visibility') as HTMLButtonElement;
const intervalInput = document.getElementById('setting-scan-interval') as HTMLInputElement;
const voiceEnabledChk = document.getElementById('setting-voice-enabled') as HTMLInputElement;
const saveBtn = document.getElementById('btn-save-settings') as HTMLButtonElement;
const settingsStatusMsg = document.getElementById('settings-status-msg') as HTMLSpanElement;

visibilityBtn.addEventListener('click', () => {
  apiInput.type = apiInput.type === 'password' ? 'text' : 'password';
});

function checkApiKeyStatus(apiKey: string) {
  const warningBanner = document.getElementById('api-key-warning');
  if (warningBanner) {
    if (!apiKey) {
      warningBanner.style.display = 'flex';
    } else {
      warningBanner.style.display = 'none';
    }
  }
}

// Link warning to Settings tab
const linkToSettings = document.getElementById('link-to-settings');
if (linkToSettings) {
  linkToSettings.addEventListener('click', (e) => {
    e.preventDefault();
    const settingsTabLi = document.querySelector('li[data-tab="settings"]') as HTMLElement;
    if (settingsTabLi) settingsTabLi.click();
  });
}

async function loadSettingsData() {
  const settings: AppSettings = await (window as any).electronAPI.getSettings();
  apiInput.value = settings.apiKey || '';
  intervalInput.value = (settings.screenshotInterval || 5).toString();
  voiceEnabledChk.checked = settings.voiceEnabled !== false;
  
  const volRange = document.getElementById('setting-voice-volume') as HTMLInputElement;
  if (volRange) volRange.value = (settings.voiceVolume ?? 0.8).toString();

  const debugLogsChk = document.getElementById('setting-debug-logs') as HTMLInputElement;
  if (debugLogsChk) debugLogsChk.checked = settings.debugLogs === true;

  checkApiKeyStatus(settings.apiKey);
}

saveBtn.addEventListener('click', async () => {
  const volRange = document.getElementById('setting-voice-volume') as HTMLInputElement;
  const debugLogsChk = document.getElementById('setting-debug-logs') as HTMLInputElement;
  
  const updatedSettings: AppSettings = {
    apiKey: apiInput.value.trim(),
    screenshotInterval: parseInt(intervalInput.value, 10) || 5,
    voiceEnabled: voiceEnabledChk.checked,
    voiceVolume: volRange ? parseFloat(volRange.value) : 0.8,
    debugLogs: debugLogsChk ? debugLogsChk.checked : false
  };
  
  await (window as any).electronAPI.saveSettings(updatedSettings);
  checkApiKeyStatus(updatedSettings.apiKey);
  
  settingsStatusMsg.textContent = 'Settings saved successfully!';
  settingsStatusMsg.className = 'status-msg success';
  setTimeout(() => { settingsStatusMsg.textContent = ''; }, 3000);
});

// Analytics & Logs tab handler
const statTotalFocus = document.getElementById('stat-total-focus') as HTMLDivElement;
const statCompletionRate = document.getElementById('stat-completion-rate') as HTMLDivElement;
const statTotalDistractions = document.getElementById('stat-total-distractions') as HTMLDivElement;
const logsTbody = document.getElementById('logs-tbody') as HTMLTableSectionElement;
const btnClearLogs = document.getElementById('btn-clear-logs') as HTMLButtonElement;

async function loadAnalyticsData() {
  const data = await (window as any).electronAPI.getHistory();
  
  // Calculate Stats
  const focusSessions = data.sessions.filter((s: PomodoroSession) => s.type === 'focus');
  const completedFocus = focusSessions.filter((s: PomodoroSession) => s.status === 'completed');
  
  let totalMin = 0;
  completedFocus.forEach((s: PomodoroSession) => {
    totalMin += s.durationMinutes;
  });
  
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  statTotalFocus.textContent = `${hours}h ${mins}m`;
  
  const rate = focusSessions.length > 0 ? Math.round((completedFocus.length / focusSessions.length) * 100) : 0;
  statCompletionRate.textContent = `${rate}%`;
  
  statTotalDistractions.textContent = data.distractions.length.toString();
  
  // Populate Logs Table
  logsTbody.innerHTML = '';
  
  if (data.sessions.length === 0) {
    logsTbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--text-muted);">No history logged yet.</td></tr>`;
    return;
  }
  
  // Sort session descending
  const sortedSessions = [...data.sessions].reverse();
  
  sortedSessions.forEach((s: PomodoroSession) => {
    const tr = document.createElement('tr');
    
    const formattedDate = new Date(s.startTime).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    
    let outcomeBadgeClass = 'badge-aborted';
    if (s.status === 'completed') outcomeBadgeClass = 'badge-completed';
    else if (s.status === 'interrupted') outcomeBadgeClass = 'badge-interrupted';
    
    tr.innerHTML = `
      <td>${formattedDate}</td>
      <td><strong>${s.taskName}</strong></td>
      <td style="text-transform: capitalize;">${s.type}</td>
      <td style="text-transform: capitalize;">${s.technique}</td>
      <td><span class="badge ${outcomeBadgeClass}">${s.status}</span></td>
      <td>${s.distractionsCount || 0}</td>
    `;
    
    logsTbody.appendChild(tr);
  });
}

btnClearLogs.addEventListener('click', async () => {
  if (confirm('Are you sure you want to delete all session history? This cannot be undone.')) {
    await (window as any).electronAPI.clearHistory();
    loadAnalyticsData();
  }
});

// Load settings on startup
loadSettingsData();

import { contextBridge, ipcRenderer } from 'electron';

export interface TimerState {
  remainingSeconds: number;
  totalSeconds: number;
  phase: 'focus' | 'break' | 'idle';
  isPaused: boolean;
  technique: string;
  taskName: string;
}

export interface AppSettings {
  apiKey: string;
  screenshotInterval: number;
  voiceEnabled: boolean;
  voiceVolume: number;
}

contextBridge.exposeInMainWorld('electronAPI', {
  // Timer commands
  startTimer: (taskName: string, technique: string, durationMinutes: number) => 
    ipcRenderer.send('start-timer', { taskName, technique, durationMinutes }),
  pauseTimer: () => ipcRenderer.send('pause-timer'),
  resumeTimer: () => ipcRenderer.send('resume-timer'),
  resetTimer: () => ipcRenderer.send('reset-timer'),
  
  // Settings & DB commands
  getHistory: () => ipcRenderer.invoke('get-history'),
  clearHistory: () => ipcRenderer.invoke('clear-history'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings: AppSettings) => ipcRenderer.invoke('save-settings', settings),
  
  // Widget Toggle
  toggleWidget: (visible: boolean) => ipcRenderer.send('toggle-widget', visible),
  
  // Event listeners
  onTimerUpdate: (callback: (state: TimerState) => void) => {
    const subscription = (_event: any, state: TimerState) => callback(state);
    ipcRenderer.on('timer-update', subscription);
    return () => {
      ipcRenderer.removeListener('timer-update', subscription);
    };
  },
  
  onGeminiAudio: (callback: (data: { base64Data: string; mimeType: string }) => void) => {
    const subscription = (_event: any, data: { base64Data: string; mimeType: string }) => callback(data);
    ipcRenderer.on('gemini-audio', subscription);
    return () => {
      ipcRenderer.removeListener('gemini-audio', subscription);
    };
  },
  
  onGeminiComment: (callback: (comment: { text: string; isDistraction: boolean; timestamp: string }) => void) => {
    const subscription = (_event: any, comment: { text: string; isDistraction: boolean; timestamp: string }) => callback(comment);
    ipcRenderer.on('gemini-comment', subscription);
    return () => {
      ipcRenderer.removeListener('gemini-comment', subscription);
    };
  },
  
  onSettingsUpdate: (callback: (settings: AppSettings) => void) => {
    const subscription = (_event: any, settings: AppSettings) => callback(settings);
    ipcRenderer.on('settings-update', subscription);
    return () => {
      ipcRenderer.removeListener('settings-update', subscription);
    };
  }
});

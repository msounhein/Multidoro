# 🍅 Multidoro

Multidoro is a state-of-the-art, glassmorphic desktop Pomodoro application built with **Electron, TypeScript, and HTML5/Vanilla CSS**. It integrates the **Gemini Live API** to act as a real-time visual work coach—monitoring your active screen and speaking warnings out loud if you get distracted from your declared task.

---

## ✨ Features

- **🧠 Real-Time AI Coaching**: Uses Gemini Live (via WebSockets) to analyze screenshots of your active screen against your declared task.
- **🔊 Voice Feedback**: Gemini speaks verbal warnings, scoldings, and encouragement directly to you via low-latency PCM audio stream playback.
- **🎙️ Speech-to-Text Task Input**: Dictate your current task hands-free using built-in speech recognition.
- **⏱️ Flexible Pomodoro Techniques**:
  - *Traditional*: 25m focus / 5m break.
  - *Ultradian*: 50m focus / 10m break (ideal for deep work).
  - *Animedoro*: 60m focus / 20m break.
  - *Custom*: Configure your own focus and break durations.
- **🖥️ Smart HUD Overlay**: A floating, always-on-top overlay widget automatically positioned in the bottom-right corner of your primary screen (safely above the taskbar) displaying your remaining time and task focus indicator.
- **📊 Focus & Distraction Analytics**: View historical session logs, completed Pomodoro intervals, and tracked distraction events stored in a local offline database.
- **🎨 Premium Dark Glassmorphic UI**: Beautiful responsive layout with glowing neon color-coded indicators (red for focus, green for breaks), custom glossy scrollbars, and dynamic inline vector SVG icons.
- **🔌 Offline Resiliency**: Detects server-initiated `goAway` signals and automatically reconnects in under a second; schedules a 3-second self-healing loop for unexpected connection dropouts.

---

## 🛠️ Architecture

- **Main Process (`src/main.ts`)**: Controls window lifecycles, global tray setup, screen captures, native Windows balloon notifications, offline settings storage, and WebSocket communication with the Gemini Live API.
- **Renderer Process (`src/renderer/renderer.ts`)**: Handles DOM actions, tab navigation, timer counting state, speech recognition, audio node buffering, and rendering analytics charts.
- **Database Layer (`src/database.ts`)**: Stores sessions locally using SQLite/json structures to persist focus histories offline.
- **Preload Script (`src/preload.ts`)**: Exposes IPC channels securely between the Electron main process and the front-end renderer.

---

## 🚀 Installation & Setup

### Prerequisites
- [Node.js](https://nodejs.org/) (v16+)
- A **Gemini API Key** (obtainable from Google AI Studio)

### 1. Clone & Install
```bash
# Clone the repository
git clone https://github.com/yourusername/multidoro.git
cd multidoro

# Install dependencies
npm install
```

### 2. Configure Environment
Copy `.env.example` to `.env` in the root folder:
```env
GEMINI_API_KEY=your_gemini_api_key_here
```
*(Alternatively, you can paste your API key directly inside the Settings tab of the running app).*

### 3. Build & Start
```bash
# Compile TypeScript and copy asset files
npm run build

# Start the application
npm start
```

---

## ⌨️ Development Commands

- `npm run build`: Compiles TS code and copies static renderer assets (HTML, CSS, templates) to the `dist/` build output directory.
- `npm start`: Launches the compiled Electron binary.
- `npm run dev`: Optional watch script for compiling code during active development.

---

## 🛡️ License

This project is licensed under the MIT License.

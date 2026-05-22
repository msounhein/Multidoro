# Design Specification: SQLite and Safe Storage Integration

This document outlines the transition of Multidoro's storage from cleartext JSON files to a secure SQLite database using WebAssembly (`sql.js`), alongside encrypting the Gemini API key using Electron's native `safeStorage` API.

## Goal
Replace the plain-text JSON storage (`multidoro-db.json` and `settings.json`) with a single SQLite database file (`multidoro.db`). Ensure the Gemini API key is encrypted at rest using OS-level credentials protection, avoiding any cleartext keys or settings on disk, and eliminating the `.env` startup fallback.

---

## 1. System Architecture

We will implement SQLite in the Main process via WebAssembly to ensure portability without native compilers, maintaining multi-window sync and file safety.

```
┌────────────────────────────────────────────────────────┐
│                      Main Process                      │
│                                                        │
│  ┌──────────────────────┐    ┌──────────────────────┐  │
│  │    settings.json     │    │  multidoro-db.json   │  │
│  └──────────┬───────────┘    └──────────┬───────────┘  │
│             │                           │              │
│             ▼ (Migrated on startup)     ▼              │
│  ┌──────────────────────────────────────────────────┐  │
│  │               MultidoroDatabase                  │  │
│  │      (sqlite.db managed by WebAssembly)          │  │
│  │                                                  │  │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────┐  │  │
│  │  │ distractions │ │   sessions   │ │ settings │  │  │
│  │  └──────────────┘ └──────────────┘ └────┬─────┘  │  │
│  └─────────────────────────────────────────┼────────┘  │
│                                            │           │
│                                            ▼           │
│                                   (safeStorage API)    │
│                                  ┌──────────────────┐  │
│                                  │ Encrypted API Key│  │
│                                  └──────────────────┘  │
└────────────────────────────────────────────────────────┘
```

---

## 2. Dependencies
* **`sql.js`**: WebAssembly SQLite engine.
* **`@types/sql.js`** (DevDependency): TypeScript definition files.

---

## 3. Database Schema

A single binary database file `multidoro.db` will be created in the `userData` directory.

### Table: `settings`
Stores configuration options. Values are stored as plaintext except for the API key, which is encrypted.
```sql
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
```

### Table: `sessions`
Tracks pomodoro focus and break sessions.
```sql
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
```

### Table: `distractions`
Logs distraction events identified by the Gemini coach.
```sql
CREATE TABLE IF NOT EXISTS distractions (
  id TEXT PRIMARY KEY,
  sessionId TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  detectedActivity TEXT NOT NULL,
  remark TEXT NOT NULL,
  FOREIGN KEY(sessionId) REFERENCES sessions(id) ON DELETE CASCADE
);
```

---

## 4. Encryption & Security Workflow

### The `safeStorage` API
Electron's Main Process exposes `safeStorage`, which leverages local OS-level encryption providers (DPAPI on Windows, Keychain on macOS, Gnome Keyring/KWallet on Linux).
* **Encryption**: `safeStorage.encryptString(plainText).toString('base64')`
* **Decryption**: `safeStorage.decryptString(Buffer.from(encryptedBase64, 'base64'))`

### Key Management Lifecycle
1. **Startup**: The Main Process loads the configuration database. If a setting for `apiKey` exists and is not empty:
   * It decrypts the setting value using `safeStorage.decryptString()`.
   * It holds the plaintext key strictly in memory (`appSettings.apiKey`).
2. **Settings Save**: When saving settings:
   * The Main Process receives the settings payload from the Renderer.
   * The API key is encrypted: `const encrypted = safeStorage.encryptString(key).toString('base64')`.
   * The encrypted value is saved to the `settings` table.
3. **Skipping `.env`**: Remove `dotenv` imports and configuration. The system will rely purely on the user entering their API key via the settings panel.

---

## 5. Migration Logic

On app startup, the system will look for legacy cleartext storage files inside the `userData` directory:
1. If `settings.json` is found:
   * Parse the settings.
   * Write each setting to the `settings` SQLite table.
   * If `apiKey` is present in `settings.json`, encrypt it and save the encrypted string.
2. If `multidoro-db.json` is found:
   * Parse the sessions and distractions list.
   * Insert all sessions and distractions into the SQLite database.
3. If migration completes successfully:
   * Delete `settings.json` and `multidoro-db.json` from disk.

---

## 6. Verification Plan

### Manual Verification
1. Launch the application with legacy JSON files present to ensure all history and settings are successfully imported and legacy files are deleted.
2. Enter a Gemini API key into the Settings screen, hit Save, and verify:
   * The WebSocket connection successfully connects.
   * Inspecting `multidoro.db` shows the key is encrypted (in base64 format, not plain text).
3. Validate that deleting the `.env` file does not break the app startup, and starting without a key prompts the user with the expected warning.

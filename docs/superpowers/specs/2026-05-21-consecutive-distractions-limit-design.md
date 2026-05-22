# Design Spec: Consecutive Distractions Limit Setting

Enable users to configure how many consecutive distracted screenshot checks/scans must be observed before triggering a distraction alarm (toast notifications, audio warnings, and database logging).

## Problem & Context

Currently, the application monitors distractions by accumulating distraction duration (`continuousDistractedSeconds += screenshotInterval`) and triggering alarms when this duration reaches 30 seconds.
However, when the screen scan interval is adjusted (e.g. raised to 45 seconds), this time-based thresholding breaks:
1. The first check immediately registers as 45 seconds of distraction.
2. The check `continuousDistractedSeconds === 30 || continuousDistractedSeconds % 30 === 0` fails because 45 is neither 30 nor a multiple of 30.
3. Alarms are skipped entirely or delayed until subsequent scans align with the modulo check.

To make distraction monitoring robust and configurable, we will track the number of consecutive distracted scans and allow the user to set a limit (defaulting to 1) in the settings.

## Proposed Changes

### Configuration Schema Update
* **`AppSettings` Interface**: Add `consecutiveDistractionsLimit: number`.
* **Default Settings**: Initialize `consecutiveDistractionsLimit` to `1`.

### Backend Process (`src/main.ts`)
* Replace `continuousDistractedSeconds: number` state with `consecutiveDistractionsCount: number` to track consecutive checks.
* Update `processStatusUpdate` and the text-fallback evaluation blocks in `handleGeminiMessage`:
  * Upon a distraction detection:
    * Increment `consecutiveDistractionsCount`.
    * If `consecutiveDistractionsCount >= consecutiveDistractionsLimit`:
      * Trigger Windows Toast Notification.
      * Send a `[WARN]` command to Gemini Live to speak a verbal warning.
      * Log the infraction details using `db.addDistraction(...)`.
      * Broadcast distraction comment to the client: `[DISTRACTED] <description>`.
    * If `consecutiveDistractionsCount < consecutiveDistractionsLimit`:
      * Broadcast potential distraction comment: `[POTENTIAL DISTRACTION (<seconds>s)] <description>` where seconds is calculated dynamically as `consecutiveDistractionsCount * screenshotInterval`.
  * Upon an on-task detection:
    * Reset `consecutiveDistractionsCount` to `0`.
    * Broadcast comment normal.

### Preload Script (`src/preload.ts`)
* Update `AppSettings` interface definition to include `consecutiveDistractionsLimit`.

### Frontend HTML (`src/renderer/index.html`)
* Add a number input field right below the "Screen Scan Interval" setting with:
  * ID: `setting-consecutive-distractions`
  * Label: "Consecutive Distractions Limit"
  * Attributes: `type="number" min="1" max="10" value="1"`
  * Help description text.

### Frontend Logic (`src/renderer/renderer.ts`)
* Map UI settings element `setting-consecutive-distractions` to retrieve, display, and save `consecutiveDistractionsLimit`.

## Verification Plan

### Manual Verification
1. Open the application.
2. Navigate to Settings and verify the "Consecutive Distractions Limit" is shown below "Screen Scan Interval" with a default value of `1`.
3. Set the Limit to `1` and Screenshot Interval to `15` seconds. Start a Focus session.
4. Open a distracting window. Confirm that the first distraction check immediately triggers a toast warning, database log entry, and voice warning.
5. Change the Limit to `2` and Screenshot Interval to `10` seconds. Start a Focus session.
6. Open a distracting window. Confirm that the first scan only prints `[POTENTIAL DISTRACTION (10s)]`, and the second consecutive distracted scan triggers the full warning.
7. Change window to on-task. Confirm that on the next scan, the count is reset, and a normal task status is printed.

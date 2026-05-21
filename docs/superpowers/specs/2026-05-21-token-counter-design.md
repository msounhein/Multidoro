# Design Spec: Gemini Live Token Counter and Cost Estimator

## Context & Background
The Gemini Multimodal Live API is a stateful bidirectional WebSocket service. It keeps the conversation history (including text, audio, and captured screenshots) in context for the duration of the active session. 
Because the application captures and sends screenshots every 5 seconds (by default), the input token size grows quadratically over time. Over a single 25-minute Pomodoro session, this can consume up to ~11.8 million input tokens, resulting in unexpected API costs ($0.90 to $3.50+ per session). 

To help users track and monitor their API consumption, this feature implements a local token counter and cost estimator that records input/output tokens and cost in USD for each session, displaying the summary in the application's **History / Analytics** tab.

## Proposed Changes

### 1. Database Layer (`src/database.ts`)
We will extend the `PomodoroSession` type and the JSON storage schema to include input tokens, output tokens, and estimated cost fields:
*   Add optional fields to `PomodoroSession` interface:
    *   `inputTokens?: number;`
    *   `outputTokens?: number;`
    *   `estimatedCost?: number;`
*   Extend `updateSessionStatus(id, status, endTime, tokenData)` to save these values.

### 2. Main Process (`src/main.ts`)
*   Define session-level token accumulators:
    ```typescript
    let currentSessionInputTokens = 0;
    let currentSessionOutputTokens = 0;
    ```
*   Reset these values to `0` whenever a new timer focus session starts.
*   In the WebSocket `onmessage` callback:
    *   Extract `message.usageMetadata` (which is present in the `LiveServerMessage` root).
    *   Update `currentSessionInputTokens` and `currentSessionOutputTokens` using the maximum value received during the active session.
*   Upon timer completion, interruption, or abortion:
    *   Compute the estimated cost based on baseline Gemini 2.0/2.5/3.1 Flash pricing:
        *   **Input Pricing**: $0.075 / 1,000,000 tokens
        *   **Output Pricing**: $0.300 / 1,000,000 tokens
        *   *Formula*: `(inputTokens / 1_000_000) * 0.075 + (outputTokens / 1_000_000) * 0.30`
    *   Update the database record with the final token stats.

### 3. Renderer & UI (`src/renderer/renderer.ts`)
*   In the History UI renderer, update the session card builder.
*   If token metrics are present on the session record, render a styled glassmorphic badge at the bottom of the card:
    *   Display: `🪙 Tokens: 1.2M in / 4.5k out (Est. Cost: $0.0913)`
    *   Ensure costs are formatted to 4 decimal places (`.toFixed(4)`) to show sub-cent costs correctly.
    *   For older sessions lacking token stats, gracefully render nothing or a generic placeholder (like `Tokens: N/A`).

## Verification Plan

### Manual Verification
1. Open the application.
2. Verify that a focus session tracks screenshots.
3. Complete or interrupt the session.
4. Check the **History / Analytics** tab. Verify that the session card shows:
   - Input tokens (e.g. `24.5k`) formatted cleanly (using `K` or `M` for readability).
   - Output tokens.
   - Cost formatted to 4 decimal places.
5. Check the raw `multidoro-db.json` database file to ensure `inputTokens`, `outputTokens`, and `estimatedCost` are stored correctly.

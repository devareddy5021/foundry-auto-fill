# Foundry Conversation Rating Auto-Filler & AI Evaluator (v2.0)

A powerful Chrome Extension (Manifest V3) that provides **end-to-end AI evaluation and 1-click form auto-filling** for Foundry / Perit AI conversation rating tasks.

---

## What's New in Version 2.0 🚀

- **🤖 1-Click AI Auto-Evaluator**:
  - You no longer need to write or paste answers manually!
  - Automatically scrapes conversation turns, timestamps, speech gaps, and pre-filled justifications directly from the active Foundry page.
  - Consults Google Gemini AI using the official **Perit AI guidelines** (Content, Prosody, Fluidity).
  - Generates strict 1-sentence quoted justifications and detects UI pre-filled traps (contradictions, ignored constraints).
  - Automatically clicks rating buttons (1–5), confirms the 6-item checklist modal, selects error codes, and fills all justification textareas.
- **▶️ Fast-Play Audio (4x Speed)**:
  - Fulfills the Perit AI requirement ("Play at least 90% of each file's agent audio before submitting") in seconds.
- **🛡️ Clean Browsing**:
  - In-page floating button is hidden by default so other tabs (Google, WhatsApp, etc.) remain clean. Can be toggled in Settings if desired.
- **⚙️ Integrated Gemini Key**:
  - Pre-configured with your verified Gemini API key and high-speed `gemini-3.5-flash-lite` model.

---

## How to Install / Reload in Google Chrome

1. Open Google Chrome and navigate to: `chrome://extensions/`
2. Ensure **Developer mode** (top-right toggle) is **ON**.
3. If already installed:
   - Find **Foundry Auto-Filler & AI Evaluator** and click the **🔄 Reload** icon.
4. If installing for the first time:
   - Click **Load unpacked** (top-left) and select this folder:
     `/home/user/Pictures/new_project`
5. Pin the extension to your Chrome toolbar for easy access.

---

## How to Use on Foundry

1. Open your Foundry rating task page (`https://foundry.zyka.ai/workspace/conversation-rating/...`).
2. *(Optional)* Click **`▶️ Fast-Play Audio (4x)`** to play the audio and satisfy the 90% audio rule.
3. Click the extension icon in your Chrome toolbar and click:
   **`⚡ Auto-Evaluate & Fill with AI`**
4. Watch the live progress console as it:
   - Extracts all turns and speech timing gaps.
   - Evaluates each turn according to Perit AI rubric.
   - Clicks rating scores, dismisses confirmation modals, selects error codes, and fills justifications.
5. Review the turns and click **Submit conversation**!

---

## Fallback Manual Mode

If you ever want to paste custom answers manually, switch to the **📋 Manual** tab in the popup, paste your text, and click **`⚡ Fill Current Page`**.

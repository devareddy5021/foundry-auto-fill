// ============================================================
// Foundry Auto-Filler & AI Evaluator v2.0 - Popup Controller
// Coordinates tabs, 1-click AI workflow, and manual filling
// ============================================================

const DEFAULT_MODEL = "gemini-3.5-flash-lite";

document.addEventListener("DOMContentLoaded", () => {
  // Elements: Tabs
  const tabButtons = document.querySelectorAll(".tab-btn");
  const tabPanes = document.querySelectorAll(".tab-pane");

  // Elements: AI Tab
  const aiEvalBtn = document.getElementById("ai-eval-btn");
  const fastAudioBtn = document.getElementById("fast-audio-btn");
  const aiFillJustCb = document.getElementById("ai-fill-just-cb");
  const togglePreviewBtn = document.getElementById("toggle-preview-btn");
  const aiPreviewBox = document.getElementById("ai-preview-box");
  const aiPreviewText = document.getElementById("ai-preview-text");
  const copyAiPreviewBtn = document.getElementById("copy-ai-preview-btn");

  // Elements: Manual Tab
  const answersInput = document.getElementById("answers-input");
  const pasteBtn = document.getElementById("paste-btn");
  const clearBtn = document.getElementById("clear-btn");
  const manualFillJustCb = document.getElementById("manual-fill-just-cb");
  const fillBtn = document.getElementById("fill-btn");

  // Elements: Settings Tab
  const apiKeyInput = document.getElementById("api-key-input");
  const testKeyBtn = document.getElementById("test-key-btn");
  const modelSelect = document.getElementById("model-select");
  const showFloatingBtnCb = document.getElementById("show-floating-btn-checkbox");
  const saveSettingsBtn = document.getElementById("save-settings-btn");

  // Elements: Logging
  const logEl = document.getElementById("log-output");
  const clearLogBtn = document.getElementById("clear-log-btn");

  const appendLog = (msg) => {
    logEl.textContent += "\n" + msg;
    logEl.scrollTop = logEl.scrollHeight;
  };

  const setLog = (msg) => {
    logEl.textContent = msg;
  };

  // ----------------------------------------------------------
  // Tab Switching
  // ----------------------------------------------------------
  tabButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      tabButtons.forEach(b => b.classList.remove("active"));
      tabPanes.forEach(p => p.classList.remove("active"));

      btn.classList.add("active");
      const targetId = btn.getAttribute("data-tab");
      document.getElementById(targetId)?.classList.add("active");
    });
  });

  // ----------------------------------------------------------
  // Load Preferences & Storage
  // ----------------------------------------------------------
  function initStorage() {
    chrome.storage.local.get([
      "geminiApiKey",
      "geminiModel",
      "lastAnswersText",
      "fillJustifications",
      "showFloatingButton"
    ], (res) => {
      if (res && res.geminiApiKey) {
        apiKeyInput.value = res.geminiApiKey;
      } else {
        // Try loading from local config.local.json
        fetch(chrome.runtime.getURL("config.local.json"))
          .then(r => r.json())
          .then(cfg => {
            if (cfg && cfg.geminiApiKey) {
              apiKeyInput.value = cfg.geminiApiKey;
              chrome.storage.local.set({ geminiApiKey: cfg.geminiApiKey });
            }
          })
          .catch(() => {});
      }

      modelSelect.value = res.geminiModel || DEFAULT_MODEL;

      if (res.lastAnswersText) answersInput.value = res.lastAnswersText;

      const fillJust = res.fillJustifications !== false;
      aiFillJustCb.checked = fillJust;
      manualFillJustCb.checked = fillJust;

      // Floating button is OFF by default
      showFloatingBtnCb.checked = res.showFloatingButton === true;
    });
  }

  initStorage();

  // Sync checkboxes
  aiFillJustCb.addEventListener("change", () => {
    manualFillJustCb.checked = aiFillJustCb.checked;
    chrome.storage.local.set({ fillJustifications: aiFillJustCb.checked });
  });

  manualFillJustCb.addEventListener("change", () => {
    aiFillJustCb.checked = manualFillJustCb.checked;
    chrome.storage.local.set({ fillJustifications: manualFillJustCb.checked });
  });

  answersInput.addEventListener("input", () => {
    chrome.storage.local.set({ lastAnswersText: answersInput.value });
  });

  // Toggle preview box
  togglePreviewBtn.addEventListener("click", () => {
    aiPreviewBox.classList.toggle("hidden");
    togglePreviewBtn.textContent = aiPreviewBox.classList.contains("hidden")
      ? "Show AI Output ▾"
      : "Hide AI Output ▴";
  });

  copyAiPreviewBtn.addEventListener("click", async () => {
    if (aiPreviewText.value) {
      await navigator.clipboard.writeText(aiPreviewText.value);
      setLog("Copied AI output to clipboard.");
    }
  });

  clearLogBtn.addEventListener("click", () => {
    setLog("Ready.");
  });

  // ----------------------------------------------------------
  // Listen for Live Logs from Content Script
  // ----------------------------------------------------------
  chrome.runtime.onMessage.addListener((request) => {
    if (request.action === "LOG_PROGRESS" && request.message) {
      appendLog(request.message);
    }
  });

  // ----------------------------------------------------------
  // Helper: Get Active Tab
  // ----------------------------------------------------------
  async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      throw new Error("Could not find active browser tab.");
    }
    if (tab.url && (tab.url.startsWith("chrome://") || tab.url.startsWith("edge://"))) {
      throw new Error("Extensions cannot run on browser internal pages. Please open your Foundry task.");
    }
    return tab;
  }

  // ----------------------------------------------------------
  // 1-Click AI Evaluation & Fill Workflow
  // ----------------------------------------------------------
  aiEvalBtn.addEventListener("click", async () => {
    aiEvalBtn.disabled = true;
    aiEvalBtn.innerHTML = '<span>⏳ Evaluating with Gemini...</span>';
    setLog("🚀 Initiating 1-Click AI Evaluation...");

    try {
      const tab = await getActiveTab();

      // Step 1: Extract conversation turns from active Foundry tab
      appendLog("1. Extracting transcripts & timing gaps from page...");
      const scrapeResponse = await new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tab.id, { action: "EXTRACT_CONVERSATION" }, (resp) => {
          if (chrome.runtime.lastError) {
            reject(new Error("Could not connect to page. Please REFRESH your Foundry tab once and try again."));
          } else {
            resolve(resp);
          }
        });
      });

      if (!scrapeResponse || !scrapeResponse.success) {
        throw new Error(scrapeResponse?.error || "Failed to extract conversation turns.");
      }

      const turns = scrapeResponse.turns;
      appendLog(`✓ Scraped ${turns.length} turns from page.`);

      // Step 2: Call Gemini API via background service worker
      appendLog("2. Consulting Gemini AI with Perit AI Rubric...");
      const apiKey = apiKeyInput.value.trim();
      const model = modelSelect.value || DEFAULT_MODEL;

      const evalResponse = await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          action: "CALL_GEMINI_EVALUATION",
          turns,
          apiKey,
          model
        }, (resp) => resolve(resp));
      });

      if (!evalResponse || !evalResponse.success) {
        throw new Error(evalResponse?.error || "Gemini evaluation request failed.");
      }

      const evaluations = evalResponse.evaluations;
      appendLog(`✓ Gemini evaluated all ${evaluations.length} turns conforming to Perit guidelines.`);

      // Format clean preview text
      let previewStr = "";
      evaluations.forEach(ev => {
        previewStr += `TURN ${ev.turnNum}\n`;
        previewStr += `Content: ${ev.content.score}/5\nError Code: ${ev.content.errorCode}\nJustification: ${ev.content.justification}\n\n`;
        previewStr += `Prosody: ${ev.prosody.score}/5\nError Code: ${ev.prosody.errorCode}\nJustification: ${ev.prosody.justification}\n\n`;
        previewStr += `Fluidity: ${ev.fluidity.score}/5\nError Code: ${ev.fluidity.errorCode}\nJustification: ${ev.fluidity.justification}\n\n`;
      });
      aiPreviewText.value = previewStr;
      aiPreviewBox.classList.remove("hidden");
      togglePreviewBtn.textContent = "Hide AI Output ▴";

      // Step 3: Send evaluated turns to content script to fill the form
      appendLog("3. Auto-filling scores, modal checklist & justifications...");
      const fillJust = aiFillJustCb.checked;

      const fillResponse = await new Promise((resolve) => {
        chrome.tabs.sendMessage(tab.id, {
          action: "FILL_PARSED_TURNS",
          turns: evaluations,
          fillJustifications: fillJust
        }, (resp) => resolve(resp));
      });

      if (!fillResponse || !fillResponse.success) {
        throw new Error(fillResponse?.error || "Failed to fill form fields.");
      }

      appendLog(`\n🎉 100% COMPLETE! All ${fillResponse.count} turns filled successfully.`);
    } catch (err) {
      appendLog(`\n❌ Error: ${err.message}`);
    } finally {
      aiEvalBtn.disabled = false;
      aiEvalBtn.innerHTML = '<span class="btn-icon">⚡</span><span>Auto-Evaluate & Fill with AI</span>';
    }
  });

  // ----------------------------------------------------------
  // Fast Audio Play (4x)
  // ----------------------------------------------------------
  fastAudioBtn.addEventListener("click", async () => {
    fastAudioBtn.disabled = true;
    setLog("Triggering fast audio playback (4x speed)...");
    try {
      const tab = await getActiveTab();
      chrome.tabs.sendMessage(tab.id, { action: "FAST_PLAY_AUDIO", speed: 4.0 }, (resp) => {
        fastAudioBtn.disabled = false;
        if (resp && resp.success) {
          appendLog("✓ Fast audio started at 4x speed.");
        } else {
          appendLog("⚠️ " + (resp?.error || "Could not start audio playback."));
        }
      });
    } catch (err) {
      fastAudioBtn.disabled = false;
      setLog("❌ " + err.message);
    }
  });

  // ----------------------------------------------------------
  // Manual Paste Workflow
  // ----------------------------------------------------------
  pasteBtn.addEventListener("click", async () => {
    try {
      const text = await navigator.clipboard.readText();
      answersInput.value = text;
      chrome.storage.local.set({ lastAnswersText: text });
      setLog("Pasted text from clipboard.");
    } catch (e) {
      setLog("Could not read clipboard. Please paste directly into the box.");
    }
  });

  clearBtn.addEventListener("click", () => {
    answersInput.value = "";
    chrome.storage.local.remove("lastAnswersText");
    setLog("Cleared manual input.");
  });

  fillBtn.addEventListener("click", async () => {
    const text = answersInput.value.trim();
    if (!text) {
      setLog("❌ Please paste your evaluation text first!");
      return;
    }

    fillBtn.disabled = true;
    fillBtn.textContent = "Filling...";
    setLog("Sending text answers to page...");

    try {
      const tab = await getActiveTab();
      const fillJust = manualFillJustCb.checked;

      chrome.tabs.sendMessage(tab.id, {
        action: "FILL_FORM",
        text,
        fillJustifications: fillJust
      }, (response) => {
        fillBtn.disabled = false;
        fillBtn.textContent = "⚡ Fill Current Page";

        if (chrome.runtime.lastError) {
          setLog("❌ Could not connect to page. Refresh the Foundry tab and try again.");
          return;
        }

        if (response && response.success) {
          appendLog(`\n🎉 DONE! Successfully filled ${response.count} turns.`);
        } else if (response && response.error) {
          appendLog(`\n❌ Error: ${response.error}`);
        }
      });
    } catch (err) {
      fillBtn.disabled = false;
      fillBtn.textContent = "⚡ Fill Current Page";
      setLog("❌ Error: " + err.message);
    }
  });

  // ----------------------------------------------------------
  // Settings Management
  // ----------------------------------------------------------
  testKeyBtn.addEventListener("click", () => {
    const key = apiKeyInput.value.trim();
    testKeyBtn.disabled = true;
    testKeyBtn.textContent = "Testing...";
    setLog("Testing API key with Google Gemini...");

    chrome.runtime.sendMessage({ action: "VERIFY_API_KEY", apiKey: key }, (resp) => {
      testKeyBtn.disabled = false;
      testKeyBtn.textContent = "Verify";
      if (resp && resp.success) {
        setLog("✓ API Key is valid and working!");
      } else {
        setLog("❌ Invalid Key: " + (resp?.error || "Verification failed"));
      }
    });
  });

  saveSettingsBtn.addEventListener("click", async () => {
    const apiKey = apiKeyInput.value.trim();
    const model = modelSelect.value;
    const showFloating = showFloatingBtnCb.checked;

    chrome.storage.local.set({
      geminiApiKey: apiKey,
      geminiModel: model,
      showFloatingButton: showFloating
    }, async () => {
      setLog("✓ Settings saved successfully.");
      try {
        const tab = await getActiveTab();
        chrome.tabs.sendMessage(tab.id, {
          action: "TOGGLE_FLOATING_BUTTON",
          show: showFloating
        });
      } catch (e) {}
    });
  });
});

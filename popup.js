// ============================================================
// Foundry Auto-Filler Popup Script
// Communicates with active tab content script
// ============================================================

document.addEventListener("DOMContentLoaded", () => {
  const inputEl = document.getElementById("answers-input");
  const fillJustCheckbox = document.getElementById("fill-just-checkbox");
  const showFloatingBtnCheckbox = document.getElementById("show-floating-btn-checkbox");
  const fillBtn = document.getElementById("fill-btn");
  const pasteBtn = document.getElementById("paste-btn");
  const clearBtn = document.getElementById("clear-btn");
  const logEl = document.getElementById("log-output");

  const appendLog = (msg) => {
    logEl.textContent += "\n" + msg;
    logEl.scrollTop = logEl.scrollHeight;
  };

  const setLog = (msg) => {
    logEl.textContent = msg;
  };

  // Restore previous text & checkbox preferences from storage
  if (chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(["lastAnswersText", "fillJustifications", "showFloatingButton"], (res) => {
      if (res) {
        if (res.lastAnswersText) inputEl.value = res.lastAnswersText;
        fillJustCheckbox.checked = res.fillJustifications !== false;
        // Floating button is OFF (false) by default
        showFloatingBtnCheckbox.checked = res.showFloatingButton === true;
      } else {
        fillJustCheckbox.checked = true;
        showFloatingBtnCheckbox.checked = false;
      }
    });
  } else {
    fillJustCheckbox.checked = true;
    showFloatingBtnCheckbox.checked = false;
  }

  // Save changes to storage
  inputEl.addEventListener("input", () => {
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ lastAnswersText: inputEl.value });
    }
  });

  fillJustCheckbox.addEventListener("change", () => {
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ fillJustifications: fillJustCheckbox.checked });
    }
  });

  // Toggle floating button visibility
  showFloatingBtnCheckbox.addEventListener("change", async () => {
    const isChecked = showFloatingBtnCheckbox.checked;
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ showFloatingButton: isChecked });
    }
    // Notify active tab
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.id) {
        chrome.tabs.sendMessage(tab.id, { action: "TOGGLE_FLOATING_BUTTON", show: isChecked });
      }
    } catch (e) {}
  });

  // Paste from clipboard
  pasteBtn.addEventListener("click", async () => {
    try {
      const text = await navigator.clipboard.readText();
      inputEl.value = text;
      if (chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ lastAnswersText: text });
      }
      setLog("Pasted text from clipboard.");
    } catch (e) {
      setLog("Could not read clipboard. Please click in the box and press Ctrl+V.");
    }
  });

  // Clear text
  clearBtn.addEventListener("click", () => {
    inputEl.value = "";
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.remove("lastAnswersText");
    }
    setLog("Cleared input.");
  });

  // Listen for progress logs forwarded from content script
  chrome.runtime.onMessage.addListener((request) => {
    if (request.action === "LOG_PROGRESS" && request.message) {
      appendLog(request.message);
    }
  });

  // Fill Current Page
  fillBtn.addEventListener("click", async () => {
    const text = inputEl.value.trim();
    if (!text) {
      setLog("❌ Please paste your evaluation text first!");
      return;
    }

    fillBtn.disabled = true;
    fillBtn.textContent = "Filling...";
    setLog("Connecting to page...");

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) {
        throw new Error("Could not find active browser tab.");
      }

      if (tab.url && (tab.url.startsWith("chrome://") || tab.url.startsWith("edge://"))) {
        throw new Error("Extensions cannot run on internal browser pages. Please open your Foundry task tab.");
      }

      const fillJust = fillJustCheckbox.checked;

      chrome.tabs.sendMessage(
        tab.id,
        { action: "FILL_FORM", text: text, fillJustifications: fillJust },
        (response) => {
          fillBtn.disabled = false;
          fillBtn.textContent = "⚡ Fill Current Page";

          if (chrome.runtime.lastError) {
            setLog(
              "❌ Could not connect to page.\n" +
              "Please REFRESH your Foundry tab once after installing/updating the extension, then try again!"
            );
            return;
          }

          if (response && response.success) {
            appendLog(`\n🎉 DONE! Successfully filled ${response.count} turns with justifications.`);
          } else if (response && response.error) {
            appendLog(`\n❌ Error: ${response.error}`);
          }
        }
      );
    } catch (err) {
      fillBtn.disabled = false;
      fillBtn.textContent = "⚡ Fill Current Page";
      setLog("❌ Error: " + err.message);
    }
  });
});

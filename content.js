// ============================================================
// Foundry Auto-Filler Content Script
// Handles page interaction, form automation, checklist modal, and in-page UI
// ============================================================

(function () {
  // Prevent duplicate initialization
  if (window.__foundryAutofillInitialized) return;
  window.__foundryAutofillInitialized = true;

  // ----------------------------------------------------------
  // 1. Robust Index-Based Text Parsing Engine
  // ----------------------------------------------------------
  function parseAnnotationText(text) {
    const turns = [];

    // Find all Turn header line starts
    const turnHeaderRegex = /(?:^|\r?\n)\s*TURN\s+(\d+)\b/gi;
    const matches = [];
    let m;
    while ((m = turnHeaderRegex.exec(text)) !== null) {
      matches.push({
        turnNum: parseInt(m[1], 10),
        startIndex: m.index
      });
    }

    for (let i = 0; i < matches.length; i++) {
      const current = matches[i];
      const nextStart = i + 1 < matches.length ? matches[i + 1].startIndex : text.length;
      const block = text.slice(current.startIndex, nextStart);

      function extractSection(cat) {
        // Find where this category starts
        const catRegex = new RegExp("(?:^|\\r?\\n)\\s*" + cat + "\\s*:", "i");
        const catMatch = block.match(catRegex);
        if (!catMatch) return null;

        const catStart = catMatch.index;
        // Find where the next category begins or end of turn
        const nextCatsRegex = /(?:^|\r?\n)\s*(?:Content|Prosody|Fluidity)\s*:/gi;
        nextCatsRegex.lastIndex = catStart + catMatch[0].length;
        const nextMatch = nextCatsRegex.exec(block);
        const catEnd = nextMatch ? nextMatch.index : block.length;

        const sectionText = block.slice(catStart, catEnd);

        // Score
        const scoreMatch = sectionText.match(new RegExp(cat + "\\s*:\\s*(\\d+)", "i"));
        const score = scoreMatch ? parseInt(scoreMatch[1], 10) : 5;

        // Error Code
        const errMatch = sectionText.match(/Error\s*Code\s*:\s*([^\n\r]+)/i);
        let err = errMatch ? errMatch[1].trim() : "";
        if (err.toLowerCase() === "none") err = "";

        // Justification
        const justMatch = sectionText.match(/Justification\s*:\s*([\s\S]*)$/i);
        const just = justMatch ? justMatch[1].trim() : "";

        return { score, errorCode: err, justification: just };
      }

      turns.push({
        turnNum: current.turnNum,
        content: extractSection("Content"),
        prosody: extractSection("Prosody"),
        fluidity: extractSection("Fluidity")
      });
    }

    return turns;
  }

  // ----------------------------------------------------------
  // 2. React-Compatible Input Value Setter
  // ----------------------------------------------------------
  function setReactInputValue(textarea, value) {
    if (!textarea || typeof value !== "string" || !value.trim()) return;
    textarea.focus();
    const proto = Object.getPrototypeOf(textarea);
    const setter =
      Object.getOwnPropertyDescriptor(proto, "value")?.set ||
      Object.getOwnPropertyDescriptor(textarea, "value")?.set;

    if (setter) {
      setter.call(textarea, value);
    } else {
      textarea.value = value;
    }

    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.dispatchEvent(new Event("change", { bubbles: true }));
    textarea.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  // ----------------------------------------------------------
  // 3. Category Container Finder
  // ----------------------------------------------------------
  function getCategoryContainer(textarea) {
    let curr = textarea.parentElement;
    while (curr && curr !== document.body) {
      const textareas = curr.querySelectorAll("textarea");
      const buttons = Array.from(
        curr.querySelectorAll('button, [role="button"], div, span')
      ).filter(el => {
        const txt = el.textContent.trim();
        return ["1", "2", "3", "4", "5"].includes(txt) && el.children.length === 0;
      });
      if (buttons.length >= 5 && textareas.length === 1) {
        return curr;
      }
      curr = curr.parentElement;
    }
    return textarea.parentElement?.parentElement || textarea.parentElement;
  }

  // ----------------------------------------------------------
  // 4. Click Rating Button (1-5)
  // ----------------------------------------------------------
  function clickRatingScore(container, score) {
    const scoreStr = String(score);
    const elements = Array.from(
      container.querySelectorAll('button, [role="button"], div, span')
    ).filter(el => {
      const txt = el.textContent.trim();
      return txt === scoreStr && el.children.length === 0;
    });

    const best =
      elements.find(
        el =>
          el.tagName === "BUTTON" ||
          el.getAttribute("role") === "button" ||
          el.className.toString().toLowerCase().includes("rating") ||
          el.className.toString().toLowerCase().includes("btn")
      ) || elements[0];

    if (best) {
      best.focus();
      best.click();
      best.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      best.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      best.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      return true;
    }
    return false;
  }

  // ----------------------------------------------------------
  // 5. Handle "Confirm Rating" Checklist Modal (Prosody 4 or 5)
  // ----------------------------------------------------------
  async function handleConfirmationModal(logFn = () => {}) {
    await new Promise(r => setTimeout(r, 200));

    let confirmBtn = Array.from(document.querySelectorAll('button, [role="button"]')).find(b =>
      /Confirm & continue/i.test(b.textContent.trim())
    );

    const modalHeader = Array.from(
      document.querySelectorAll('h1, h2, h3, h4, div, span')
    ).find(el => {
      const txt = el.textContent.trim();
      return /Confirm your.*rating/i.test(txt) || /Tick each one/i.test(txt);
    });

    if (!confirmBtn && !modalHeader) {
      return;
    }

    logFn("    ⚙️ Detected checklist modal. Checking all boxes...");

    const modalContainer =
      (modalHeader && modalHeader.closest('[role="dialog"], [class*="modal"], [class*="dialog"]')) ||
      (confirmBtn && confirmBtn.closest('[role="dialog"], [class*="modal"], [class*="dialog"]')) ||
      document;

    // A. Native Checkboxes: tick every one
    const nativeCheckboxes = Array.from(modalContainer.querySelectorAll('input[type="checkbox"]'));
    for (const cb of nativeCheckboxes) {
      if (!cb.checked) {
        cb.focus();
        cb.click();
        cb.dispatchEvent(new Event("input", { bubbles: true }));
        cb.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }

    // B. Custom role="checkbox" elements
    const customCbs = Array.from(modalContainer.querySelectorAll('[role="checkbox"]')).filter(
      el => el.getAttribute("aria-checked") !== "true"
    );
    for (const ccb of customCbs) {
      ccb.click();
    }

    // C. Click item rows containing "Perfect"
    const rows = Array.from(modalContainer.querySelectorAll('div, label, li')).filter(el => {
      const txt = el.textContent.trim();
      return (
        /Perfect (voice|intonation|expressiveness|pauses|pacing|pronunciation)/i.test(txt) &&
        el.children.length <= 4
      );
    });
    for (const row of rows) {
      const cb = row.querySelector('input[type="checkbox"]');
      if (cb && !cb.checked) {
        cb.click();
      } else if (!cb) {
        row.click();
      }
    }

    await new Promise(r => setTimeout(r, 150));

    // D. Click "Confirm & continue" button
    confirmBtn = Array.from(document.querySelectorAll('button, [role="button"]')).find(b =>
      /Confirm & continue/i.test(b.textContent.trim())
    );

    if (confirmBtn) {
      confirmBtn.focus();
      confirmBtn.click();
      confirmBtn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      confirmBtn.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      confirmBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      logFn("    ✓ Confirmed modal & continued.");
    }

    await new Promise(r => setTimeout(r, 250));
  }

  // ----------------------------------------------------------
  // 6. Select Error Code (Select, Chips, or Dropdown)
  // ----------------------------------------------------------
  async function applyErrorCode(container, errorCode) {
    if (!errorCode || errorCode.toUpperCase() === "NONE") return true;
    await new Promise(r => setTimeout(r, 120));
    const code = errorCode.trim().toUpperCase();

    // Option A: Native select element
    const selects = Array.from(container.querySelectorAll("select"));
    for (const sel of selects) {
      for (const opt of sel.options) {
        if (
          opt.value.toUpperCase() === code ||
          opt.textContent.toUpperCase().includes(code)
        ) {
          sel.value = opt.value;
          sel.dispatchEvent(new Event("change", { bubbles: true }));
          sel.dispatchEvent(new Event("input", { bubbles: true }));
          return true;
        }
      }
    }

    // Option B: Clickable chips / pill buttons / badges
    const clickables = Array.from(
      container.querySelectorAll('button, [role="button"], span, div, label')
    ).filter(el => {
      if (el.children.length > 2) return false;
      const txt = el.textContent.trim().toUpperCase();
      return (
        txt === code ||
        txt.startsWith(code + " ") ||
        txt.includes("(" + code + ")") ||
        txt.endsWith(" - " + code)
      );
    });
    if (clickables.length > 0) {
      clickables[0].click();
      clickables[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
      return true;
    }

    // Option C: Custom Combobox or Dropdown trigger
    const dropdownTrig = container.querySelector(
      '[role="combobox"], [aria-haspopup="listbox"], [aria-haspopup="menu"], button[class*="select"], div[class*="select"]'
    );
    if (dropdownTrig) {
      dropdownTrig.click();
      await new Promise(r => setTimeout(r, 150));
      const options = Array.from(
        document.querySelectorAll(
          '[role="option"], [role="menuitem"], li, div[class*="option"]'
        )
      ).filter(el => {
        const txt = el.textContent.trim().toUpperCase();
        return txt === code || txt.startsWith(code + " ") || txt.includes("(" + code + ")");
      });
      if (options.length > 0) {
        options[0].click();
        return true;
      }
    }

    return false;
  }

  // ----------------------------------------------------------
  // 7. Complete Automation Execution (Fills Justifications by default!)
  // ----------------------------------------------------------
  async function fillAllTurns(text, fillJustifications = true, logFn = console.log) {
    logFn("Parsing text answers...");
    const turns = parseAnnotationText(text);
    if (!turns || turns.length === 0) {
      const err = "No valid turns detected! Please verify format contains 'TURN 1', 'Content:', etc.";
      logFn("❌ " + err);
      return { success: false, error: err };
    }
    logFn(`✓ Found ${turns.length} turns in text.`);
    if (fillJustifications) {
      logFn("📝 Justifications: ENABLED (filling all textareas).");
    } else {
      logFn("ℹ️ Justifications: SKIPPED (scores & error codes only).");
    }

    // If an EXPAND ALL button exists, trigger it
    const expandBtn = Array.from(
      document.querySelectorAll('button, [role="button"]')
    ).find(b => /EXPAND ALL/i.test(b.textContent.trim()));
    if (expandBtn) {
      expandBtn.click();
      await new Promise(r => setTimeout(r, 200));
    }

    // Find all justification textareas by placeholder pattern
    const allTextareas = Array.from(document.querySelectorAll("textarea"));
    const contentTextareas = allTextareas.filter(t =>
      /quote what was said|what was said/i.test(t.placeholder)
    );
    const prosodyTextareas = allTextareas.filter(t =>
      /what you heard/i.test(t.placeholder)
    );
    const fluidityTextareas = allTextareas.filter(t =>
      /gap or the overlap|overlap/i.test(t.placeholder)
    );

    let filledCount = 0;

    for (let i = 0; i < turns.length; i++) {
      const turn = turns[i];
      const turnIdx = turn.turnNum - 1;
      logFn(`➡️ Processing Turn ${turn.turnNum}...`);

      // 1. Content
      if (turn.content && contentTextareas[turnIdx]) {
        const ta = contentTextareas[turnIdx];
        const container = getCategoryContainer(ta);
        clickRatingScore(container, turn.content.score);
        await handleConfirmationModal(logFn);
        if (turn.content.errorCode) {
          await applyErrorCode(container, turn.content.errorCode);
        }
        if (fillJustifications && turn.content.justification) {
          setReactInputValue(ta, turn.content.justification);
        }
        await new Promise(r => setTimeout(r, 50));
      }

      // 2. Prosody
      if (turn.prosody && prosodyTextareas[turnIdx]) {
        const ta = prosodyTextareas[turnIdx];
        const container = getCategoryContainer(ta);
        clickRatingScore(container, turn.prosody.score);
        await handleConfirmationModal(logFn);
        if (turn.prosody.errorCode) {
          await applyErrorCode(container, turn.prosody.errorCode);
        }
        if (fillJustifications && turn.prosody.justification) {
          setReactInputValue(ta, turn.prosody.justification);
        }
        await new Promise(r => setTimeout(r, 50));
      }

      // 3. Fluidity
      if (turn.fluidity && fluidityTextareas[turnIdx]) {
        const ta = fluidityTextareas[turnIdx];
        const container = getCategoryContainer(ta);
        clickRatingScore(container, turn.fluidity.score);
        await handleConfirmationModal(logFn);
        if (turn.fluidity.errorCode) {
          await applyErrorCode(container, turn.fluidity.errorCode);
        }
        if (fillJustifications && turn.fluidity.justification) {
          setReactInputValue(ta, turn.fluidity.justification);
        }
        await new Promise(r => setTimeout(r, 50));
      }

      filledCount++;
      logFn(`  ✓ Turn ${turn.turnNum} completed.`);
      await new Promise(r => setTimeout(r, 80));
    }

    logFn(`🎉 SUCCESS! Completed ${filledCount} turns with justifications! Ready for submit.`);
    return { success: true, count: filledCount };
  }

  // ----------------------------------------------------------
  // 8. Chrome Extension Message Listener (From Extension Popup)
  // ----------------------------------------------------------
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "FILL_FORM") {
      const fillJust = request.fillJustifications !== false;
      fillAllTurns(request.text, fillJust, (msg) => {
        try {
          chrome.runtime.sendMessage({ action: "LOG_PROGRESS", message: msg });
        } catch (e) {}
      }).then(res => {
        sendResponse(res);
      }).catch(err => {
        sendResponse({ success: false, error: err.message });
      });
      return true;
    }
  });

  // ----------------------------------------------------------
  // 9. In-Page Floating Button & Drawer UI
  // ----------------------------------------------------------
  function injectInPageUI() {
    if (document.getElementById("foundry-floating-trigger")) return;

    // Floating pill trigger button on bottom-right of the screen
    const trigger = document.createElement("button");
    trigger.id = "foundry-floating-trigger";
    trigger.className = "foundry-floating-btn";
    trigger.innerHTML = `<span>⚡</span> Auto-Fill`;
    document.body.appendChild(trigger);

    // Floating slide-out panel
    const drawer = document.createElement("div");
    drawer.id = "foundry-inpage-drawer";
    drawer.className = "foundry-drawer foundry-drawer-hidden";
    drawer.innerHTML = `
      <div class="foundry-drawer-header">
        <div class="foundry-drawer-title">
          <span class="foundry-icon">⚡</span>
          <span>Foundry Auto-Filler</span>
        </div>
        <button id="foundry-drawer-close" class="foundry-close-btn" title="Close">×</button>
      </div>
      <div class="foundry-drawer-body">
        <div class="foundry-hint">Paste evaluation text (Turn 1 to 7) below:</div>
        <textarea id="foundry-drawer-textarea" class="foundry-textarea" placeholder="File: s0_0317.wav&#10;TURN 1&#10;Content: 5/5&#10;Error Code: None&#10;Justification: ...&#10;Prosody: 4/5..."></textarea>
        
        <label class="foundry-checkbox-row">
          <input type="checkbox" id="foundry-drawer-fill-just" checked>
          <span>Fill Justifications (Checked = Auto-fill all justification boxes)</span>
        </label>

        <div class="foundry-btn-row">
          <button id="foundry-drawer-paste" class="foundry-btn foundry-btn-secondary">📋 Paste Clipboard</button>
          <button id="foundry-drawer-submit" class="foundry-btn foundry-btn-primary">⚡ Fill Form Now</button>
        </div>
        <div id="foundry-drawer-log" class="foundry-log">Ready. Paste answers and click Fill Form Now.</div>
      </div>
    `;
    document.body.appendChild(drawer);

    const logBox = document.getElementById("foundry-drawer-log");
    const appendLog = (msg) => {
      logBox.textContent += "\n" + msg;
      logBox.scrollTop = logBox.scrollHeight;
    };

    const justCheckbox = document.getElementById("foundry-drawer-fill-just");
    const savedPref = localStorage.getItem("foundry_fill_justifications");
    // Default to true (checked) because "justification is main"!
    justCheckbox.checked = savedPref !== "false";

    justCheckbox.addEventListener("change", () => {
      localStorage.setItem("foundry_fill_justifications", justCheckbox.checked ? "true" : "false");
    });

    trigger.onclick = () => {
      drawer.classList.toggle("foundry-drawer-hidden");
    };

    document.getElementById("foundry-drawer-close").onclick = () => {
      drawer.classList.add("foundry-drawer-hidden");
    };

    document.getElementById("foundry-drawer-paste").onclick = async () => {
      try {
        const text = await navigator.clipboard.readText();
        document.getElementById("foundry-drawer-textarea").value = text;
        appendLog("Pasted text from clipboard.");
      } catch (e) {
        appendLog("Clipboard blocked. Please paste with Ctrl+V.");
      }
    };

    document.getElementById("foundry-drawer-submit").onclick = async () => {
      const text = document.getElementById("foundry-drawer-textarea").value.trim();
      if (!text) {
        appendLog("❌ Please paste evaluation answers first!");
        return;
      }
      const fillJust = justCheckbox.checked;
      const submitBtn = document.getElementById("foundry-drawer-submit");
      submitBtn.disabled = true;
      submitBtn.textContent = "Filling...";
      try {
        await fillAllTurns(text, fillJust, appendLog);
      } catch (err) {
        appendLog("❌ Error: " + err.message);
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "⚡ Fill Form Now";
      }
    };
  }

  // Inject UI once DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", injectInPageUI);
  } else {
    injectInPageUI();
  }
})();

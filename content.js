// ============================================================
// Foundry Auto-Filler & AI Evaluator v2.0 - Content Script
// Handles DOM scraping, speech timing analysis, automated filling,
// modal checklists, and audio fast-playback
// ============================================================

(function () {
  // Prevent duplicate initialization
  if (window.__foundryAutofillInitialized) return;
  window.__foundryAutofillInitialized = true;

  // ----------------------------------------------------------
  // Helper: Clean Justification Noise (PDF links, +1 tags, chat notes)
  // ----------------------------------------------------------
  function cleanJustification(text) {
    if (!text) return "";
    return text
      // Remove any lines containing PDF/image filenames or screencapture URLs/citations
      .replace(/(?:^|\r?\n).*?(?:s?creencapture|https?:\/\/|[a-zA-Z0-9_\-\.]+\.(?:pdf|png|jpg|jpeg)).*$/gim, "")
      // Remove trailing footnote tags like "+ 1", "+ 4"
      .replace(/(?:^|\r?\n)\s*\+\s*\d+\s*$/gm, "")
      .trim();
  }

  // ----------------------------------------------------------
  // 1. DOM Scraper: Extract Conversation Turns from Foundry
  // ----------------------------------------------------------
  function extractConversationTurns(logFn = console.log) {
    logFn("🔍 Scanning page for conversation turns...");

    // If an EXPAND ALL button exists, trigger it first
    const expandBtn = Array.from(
      document.querySelectorAll('button, [role="button"]')
    ).find(b => /EXPAND ALL/i.test(b.textContent.trim()));
    if (expandBtn) {
      expandBtn.click();
    }

    // Find all justification textareas by placeholder pattern
    const allTextareas = Array.from(document.querySelectorAll("textarea"));
    const contentTextareas = allTextareas.filter(t =>
      /quote what was said|what was said/i.test(t.placeholder)
    );

    // Also look for turn headers like "TURN 1", "TURN 1 / 7"
    const turnHeaders = Array.from(document.querySelectorAll("*")).filter(el => {
      const txt = el.textContent.trim();
      return /^TURN\s+\d+\b/i.test(txt) && el.children.length <= 2;
    });

    const totalTurns = Math.max(contentTextareas.length, turnHeaders.length);
    logFn(`Found ${totalTurns} conversation turn(s) on page.`);

    if (totalTurns === 0) {
      return {
        success: false,
        error: "No conversation turns detected on this page. Please make sure a Foundry conversation rating task is loaded!"
      };
    }

    const turns = [];

    for (let i = 0; i < totalTurns; i++) {
      const turnNum = i + 1;
      let turnContainer = null;

      // Find the turn container starting from the content textarea
      if (contentTextareas[i]) {
        let cur = contentTextareas[i];
        while (cur && cur.parentElement && cur.parentElement !== document.body) {
          const siblingContentTas = contentTextareas.filter(c => cur.parentElement.contains(c));
          if (siblingContentTas.length > 1) {
            turnContainer = cur;
            break;
          }
          cur = cur.parentElement;
        }
        if (!turnContainer) turnContainer = cur;
      }

      // Fallback: search near turnHeader element if available
      if ((!turnContainer || !turnContainer.innerText || turnContainer.innerText.length < 30) && turnHeaders[i]) {
        let cur = turnHeaders[i];
        while (cur && cur.parentElement && cur.parentElement !== document.body) {
          if ((cur.parentElement.innerText.match(/TURN\s+\d+/g) || []).length > 1) {
            turnContainer = cur;
            break;
          }
          cur = cur.parentElement;
        }
      }

      const turnText = turnContainer ? turnContainer.innerText : "";

      // 1. User section: start, end, transcript
      let userStart = "0:00", userEnd = "0:00", userText = "";
      const userMatch = turnText.match(/USER\s*[-–]\s*CONTEXT ONLY\s*(\d+:\d+(?:\.\d+)?)\s*[-–]\s*(\d+:\d+(?:\.\d+)?)\s*\n([\s\S]*?)(?=AGENT RESPONSE|$)/i);
      if (userMatch) {
        userStart = userMatch[1].trim();
        userEnd = userMatch[2].trim();
        userText = userMatch[3]
          .replace(/^[▶►\s]+/, "")
          .replace(/(?:COPY|Play turn)\s*$/gi, "")
          .trim();
      } else {
        const fallbackUser = turnText.match(/USER[^\n]*?(\d+:\d+)\s*[-–]\s*(\d+:\d+)\s*\n([\s\S]*?)(?=AGENT|$)/i);
        if (fallbackUser) {
          userStart = fallbackUser[1].trim();
          userEnd = fallbackUser[2].trim();
          userText = fallbackUser[3].replace(/^[▶►\s]+/, "").trim();
        }
      }

      // 2. Agent section: start, end, transcript
      let agentStart = "0:00", agentEnd = "0:00", agentText = "";
      const agentMatch = turnText.match(/AGENT RESPONSE\s*(?:\d+\s*\/\s*\d+)?\s*(\d+:\d+(?:\.\d+)?)\s*[-–]\s*(\d+:\d+(?:\.\d+)?)\s*(?:COPY)?\s*\n([\s\S]*?)(?=SPEECH TIMELINE|CONTENT|JUSTIFICATION|$)/i);
      if (agentMatch) {
        agentStart = agentMatch[1].trim();
        agentEnd = agentMatch[2].trim();
        agentText = agentMatch[3]
          .replace(/^[▶►\s]+/, "")
          .replace(/(?:COPY|Play turn)\s*$/gi, "")
          .trim();
      } else {
        const fallbackAgent = turnText.match(/AGENT[^\n]*?(\d+:\d+)\s*[-–]\s*(\d+:\d+)\s*(?:COPY)?\s*\n([\s\S]*?)(?=SPEECH|CONTENT|JUSTIFICATION|$)/i);
        if (fallbackAgent) {
          agentStart = fallbackAgent[1].trim();
          agentEnd = fallbackAgent[2].trim();
          agentText = fallbackAgent[3].replace(/^[▶►\s]+/, "").trim();
        }
      }

      // 3. Compute timing gap
      function parseSeconds(ts) {
        if (!ts) return 0;
        const parts = ts.split(":");
        return parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
      }
      let gapSeconds = "0.0";
      if (userEnd && agentStart) {
        gapSeconds = (parseSeconds(agentStart) - parseSeconds(userEnd)).toFixed(1);
      }

      // 4. Pre-filled Content Justification (if any exists in UI)
      let prefilledJustification = "";
      if (contentTextareas[i] && contentTextareas[i].value) {
        prefilledJustification = contentTextareas[i].value.trim();
      }

      turns.push({
        turnNum,
        userStart,
        userEnd,
        userText,
        agentStart,
        agentEnd,
        agentText,
        gapSeconds,
        prefilledJustification
      });
    }

    logFn(`✓ Scraped data for ${turns.length} turn(s).`);
    return { success: true, turns };
  }

  // ----------------------------------------------------------
  // 2. Fast Audio Player (Fulfills Perit AI 90% Audio Requirement)
  // ----------------------------------------------------------
  function fastPlayAudio(speed = 4.0, logFn = console.log) {
    const audios = Array.from(document.querySelectorAll("audio"));
    if (audios.length > 0) {
      logFn(`Found ${audios.length} audio element(s). Playing at ${speed}x speed...`);
      audios.forEach(audio => {
        audio.playbackRate = speed;
        audio.play().catch(e => logFn("Play error: " + e.message));
      });
      return { success: true, count: audios.length };
    }

    // Fallback: look for play buttons on Foundry
    const playButtons = Array.from(document.querySelectorAll('button, [role="button"]')).filter(b => {
      const txt = b.textContent.trim();
      return /full conversation|play turn/i.test(txt) || b.getAttribute("aria-label")?.includes("play");
    });

    if (playButtons.length > 0) {
      logFn("Triggering main conversation play button...");
      playButtons[0].click();
      return { success: true, clicked: true };
    }

    return { success: false, error: "No audio player or play buttons found on page." };
  }

  // ----------------------------------------------------------
  // 3. Universal Text Parsing Engine (For Manual Paste)
  // ----------------------------------------------------------
  function parseAnnotationText(text) {
    const turns = [];
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
        const catRegex = new RegExp("(?:^|\\r?\\n)\\s*" + cat + "\\s*(?::|\\r?\\n|$)", "i");
        const catMatch = block.match(catRegex);
        if (!catMatch) return null;

        const subStart = catMatch.index + catMatch[0].length;
        const otherCats = ["Content", "Prosody", "Fluidity", "TURN"].filter(c => c.toLowerCase() !== cat.toLowerCase());
        const otherCatsRegex = new RegExp("(?:^|\\r?\\n)\\s*(?:" + otherCats.join("|") + ")\\s*(?::|\\r?\\n|$)", "i");

        const remainingText = block.slice(subStart);
        const nextCatMatch = remainingText.match(otherCatsRegex);
        const subBlock = nextCatMatch ? remainingText.slice(0, nextCatMatch.index) : remainingText;

        let score = null;
        const scoreMatch = subBlock.match(/(?:Score\s*:?|:\s*)\s*([1-5])\s*(?:\/\s*5)?\b/i) || subBlock.match(/\b([1-5])\s*\/\s*5\b/);
        if (scoreMatch) {
          score = parseInt(scoreMatch[1], 10);
        }

        let errorCode = null;
        const errorMatch = subBlock.match(/Error\s*Code\s*:\s*([^\n\r]+)/i);
        if (errorMatch) {
          errorCode = errorMatch[1].trim();
        }

        let justification = "";
        const justMatch = subBlock.match(/Justification\s*:\s*([\s\S]*)$/i);
        if (justMatch) {
          justification = cleanJustification(justMatch[1]);
        }

        return { score, errorCode, justification };
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
  // 4. React-Friendly Input Value Setter
  // ----------------------------------------------------------
  function setReactInputValue(textarea, value) {
    if (!textarea) return;
    const cleanVal = cleanJustification(value);

    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value"
    )?.set;

    if (nativeSetter) {
      nativeSetter.call(textarea, cleanVal);
    } else {
      textarea.value = cleanVal;
    }

    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.dispatchEvent(new Event("change", { bubbles: true }));
    textarea.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  // ----------------------------------------------------------
  // 5. Container Resolution
  // ----------------------------------------------------------
  function getCategoryContainer(textarea) {
    let cur = textarea;
    while (cur && cur.parentElement && cur.parentElement !== document.body) {
      const buttons = cur.parentElement.querySelectorAll('button, [role="button"]');
      const text = cur.parentElement.innerText || "";
      if (buttons.length >= 5 && (/CONTENT|PROSODY|FLUIDITY/i.test(text) || /\b[1-5]\b/.test(text))) {
        return cur.parentElement;
      }
      cur = cur.parentElement;
    }
    return textarea.closest("div") || textarea.parentElement;
  }

  // ----------------------------------------------------------
  // 6. Rating Button Detection & Clicking
  // ----------------------------------------------------------
  function clickRatingScore(container, score) {
    if (!container || !score) return false;
    const targetStr = String(score);

    const candidates = Array.from(
      container.querySelectorAll('button, [role="button"], [data-value], div[tabindex]')
    );

    // Strategy 1: Subtitle or startsWith match
    for (const btn of candidates) {
      const txt = btn.textContent.trim();
      const aria = btn.getAttribute("aria-label") || "";
      const val = btn.getAttribute("data-value") || "";

      if (
        txt.startsWith(targetStr + " ") ||
        txt.startsWith(targetStr + "\n") ||
        txt === targetStr ||
        aria === targetStr ||
        val === targetStr
      ) {
        btn.click();
        return true;
      }
    }

    // Strategy 2: Standalone number regex
    for (const btn of candidates) {
      const txt = btn.textContent.trim();
      if (new RegExp("^" + targetStr + "(?:\\s*-\\s*.*|\\s+.*)?$").test(txt)) {
        btn.click();
        return true;
      }
    }

    // Strategy 3: Position index fallback among 5 buttons
    const smallButtons = candidates.filter(b => {
      const t = b.textContent.trim();
      return /^[1-5](\s.*)?$/.test(t) || b.children.length <= 2;
    });

    if (smallButtons.length >= 5 && score >= 1 && score <= 5) {
      smallButtons[score - 1].click();
      return true;
    }

    return false;
  }

  // ----------------------------------------------------------
  // 7. Automated Confirmation Modal Handler
  // ----------------------------------------------------------
  async function handleConfirmationModal(logFn = () => {}) {
    await new Promise(r => setTimeout(r, 120));

    const modals = Array.from(
      document.querySelectorAll('[role="dialog"], .modal, [class*="modal"], [class*="Modal"], [class*="dialog"]')
    );

    let targetModal = null;
    for (const m of modals) {
      const txt = m.innerText || "";
      if (/Confirm rating|Checklist|Confirm & continue/i.test(txt)) {
        targetModal = m;
        break;
      }
    }

    if (!targetModal) {
      const allText = document.body.innerText || "";
      if (/Confirm rating/i.test(allText)) {
        targetModal = document.body;
      } else {
        return false;
      }
    }

    logFn("  📋 Checklist modal detected. Confirming items...");

    const checkCandidates = Array.from(
      targetModal.querySelectorAll('input[type="checkbox"], [role="checkbox"], div[aria-checked], span[aria-checked]')
    );

    const checklistLabels = [
      /voice quality/i,
      /intonation/i,
      /expressiveness/i,
      /pauses/i,
      /pacing/i,
      /pronunciation/i
    ];

    for (const pattern of checklistLabels) {
      let matched = false;
      for (const el of checkCandidates) {
        const parentText = el.closest("label, div, li")?.innerText || "";
        if (pattern.test(parentText)) {
          const isChecked = el.checked === true || el.getAttribute("aria-checked") === "true";
          if (!isChecked) {
            el.click();
            await new Promise(r => setTimeout(r, 30));
          }
          matched = true;
          break;
        }
      }

      if (!matched) {
        const labels = Array.from(targetModal.querySelectorAll("label, span, div"));
        for (const lbl of labels) {
          if (pattern.test(lbl.textContent.trim()) && lbl.children.length === 0) {
            lbl.click();
            await new Promise(r => setTimeout(r, 30));
            break;
          }
        }
      }
    }

    // Check all remaining checkboxes in modal
    targetModal.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      if (!cb.checked) cb.click();
    });

    await new Promise(r => setTimeout(r, 60));

    // Click "Confirm & continue" button
    const confirmButtons = Array.from(
      targetModal.querySelectorAll('button, [role="button"]')
    ).filter(b => /Confirm & continue|Confirm/i.test(b.textContent.trim()));

    if (confirmButtons.length > 0) {
      confirmButtons[0].click();
      logFn("  ✓ Modal confirmed & dismissed.");
      await new Promise(r => setTimeout(r, 80));
      return true;
    }

    return false;
  }

  // ----------------------------------------------------------
  // 8. Error Code Dropdown Automation
  // ----------------------------------------------------------
  async function applyErrorCode(container, errorCode) {
    if (!container || !errorCode || /none|n\/a|^$/i.test(errorCode.trim())) return;

    const rawCodes = errorCode.split(/\s*[\/,|]\s*/).map(c => c.trim()).filter(Boolean);

    for (const code of rawCodes) {
      if (/none/i.test(code)) continue;

      let trigger = container.querySelector('[aria-haspopup="listbox"], [role="combobox"], select, [class*="select"], [class*="dropdown"]');
      if (!trigger) {
        trigger = Array.from(container.querySelectorAll('button, [role="button"], div')).find(el =>
          /error code|select error|no error/i.test(el.textContent.trim())
        );
      }

      if (trigger) {
        if (trigger.tagName === "SELECT") {
          const opt = Array.from(trigger.options).find(o =>
            o.value.toUpperCase().includes(code.toUpperCase()) || o.text.toUpperCase().includes(code.toUpperCase())
          );
          if (opt) {
            trigger.value = opt.value;
            trigger.dispatchEvent(new Event("change", { bubbles: true }));
          }
        } else {
          trigger.click();
          await new Promise(r => setTimeout(r, 80));

          const options = Array.from(
            document.querySelectorAll('[role="option"], li, [class*="option"], [class*="item"]')
          );

          const match = options.find(o => {
            const t = o.textContent.trim().toUpperCase();
            return t === code.toUpperCase() || t.startsWith(code.toUpperCase() + " ") || t.startsWith(code.toUpperCase() + " -");
          });

          if (match) {
            match.click();
            await new Promise(r => setTimeout(r, 50));
          } else {
            // Dismiss dropdown if no match
            document.body.click();
          }
        }
      }
    }
  }

  // ----------------------------------------------------------
  // 9. Core Filling Engine (Executes Structured JSON Turns)
  // ----------------------------------------------------------
  async function fillParsedTurns(turns, fillJustifications = true, logFn = console.log) {
    if (!turns || turns.length === 0) {
      const err = "No valid turns to fill!";
      logFn("❌ " + err);
      return { success: false, error: err };
    }
    logFn(`🚀 Starting fill for ${turns.length} turn(s)...`);

    // Ensure all turns are expanded
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
      logFn(`➡️ Turn ${turn.turnNum}:`);

      // 1. Content
      if (turn.content && contentTextareas[turnIdx]) {
        const ta = contentTextareas[turnIdx];
        ta.scrollIntoView({ block: "center", behavior: "smooth" });
        const container = getCategoryContainer(ta);
        const clicked = clickRatingScore(container, turn.content.score);
        if (clicked) {
          logFn(`  ⭐ Content: ${turn.content.score}/5`);
        }
        await handleConfirmationModal(logFn);
        if (turn.content.errorCode) {
          await applyErrorCode(container, turn.content.errorCode);
        }
        if (fillJustifications && turn.content.justification) {
          setReactInputValue(ta, turn.content.justification);
        }
        await new Promise(r => setTimeout(r, 60));
      }

      // 2. Prosody
      if (turn.prosody && prosodyTextareas[turnIdx]) {
        const ta = prosodyTextareas[turnIdx];
        ta.scrollIntoView({ block: "center", behavior: "smooth" });
        const container = getCategoryContainer(ta);
        const clicked = clickRatingScore(container, turn.prosody.score);
        if (clicked) {
          logFn(`  ⭐ Prosody: ${turn.prosody.score}/5`);
        }
        await handleConfirmationModal(logFn);
        if (turn.prosody.errorCode) {
          await applyErrorCode(container, turn.prosody.errorCode);
        }
        if (fillJustifications && turn.prosody.justification) {
          setReactInputValue(ta, turn.prosody.justification);
        }
        await new Promise(r => setTimeout(r, 60));
      }

      // 3. Fluidity
      if (turn.fluidity && fluidityTextareas[turnIdx]) {
        const ta = fluidityTextareas[turnIdx];
        ta.scrollIntoView({ block: "center", behavior: "smooth" });
        const container = getCategoryContainer(ta);
        const clicked = clickRatingScore(container, turn.fluidity.score);
        if (clicked) {
          logFn(`  ⭐ Fluidity: ${turn.fluidity.score}/5`);
        }
        await handleConfirmationModal(logFn);
        if (turn.fluidity.errorCode) {
          await applyErrorCode(container, turn.fluidity.errorCode);
        }
        if (fillJustifications && turn.fluidity.justification) {
          setReactInputValue(ta, turn.fluidity.justification);
        }
        await new Promise(r => setTimeout(r, 60));
      }

      filledCount++;
      logFn(`  ✓ Turn ${turn.turnNum} completed.`);
      await new Promise(r => setTimeout(r, 80));
    }

    logFn(`🎉 SUCCESS! Completed all ${filledCount} turns!`);
    return { success: true, count: filledCount };
  }

  // ----------------------------------------------------------
  // 10. Manual Text Entry Wrapper
  // ----------------------------------------------------------
  async function fillAllTurns(text, fillJustifications = true, logFn = console.log) {
    logFn("Parsing text answers...");
    const turns = parseAnnotationText(text);
    if (!turns || turns.length === 0) {
      const err = "No valid turns detected! Please verify format contains 'TURN 1', 'Content', etc.";
      logFn("❌ " + err);
      return { success: false, error: err };
    }
    return fillParsedTurns(turns, fillJustifications, logFn);
  }

  // ----------------------------------------------------------
  // 11. Chrome Message Listener
  // ----------------------------------------------------------
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "EXTRACT_CONVERSATION") {
      const res = extractConversationTurns((msg) => {
        try { chrome.runtime.sendMessage({ action: "LOG_PROGRESS", message: msg }); } catch (e) {}
      });
      sendResponse(res);
      return false;
    } else if (request.action === "FILL_PARSED_TURNS") {
      const fillJust = request.fillJustifications !== false;
      fillParsedTurns(request.turns, fillJust, (msg) => {
        try { chrome.runtime.sendMessage({ action: "LOG_PROGRESS", message: msg }); } catch (e) {}
      }).then(res => sendResponse(res))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    } else if (request.action === "FILL_FORM") {
      const fillJust = request.fillJustifications !== false;
      fillAllTurns(request.text, fillJust, (msg) => {
        try { chrome.runtime.sendMessage({ action: "LOG_PROGRESS", message: msg }); } catch (e) {}
      }).then(res => sendResponse(res))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    } else if (request.action === "FAST_PLAY_AUDIO") {
      const res = fastPlayAudio(request.speed || 4.0, (msg) => {
        try { chrome.runtime.sendMessage({ action: "LOG_PROGRESS", message: msg }); } catch (e) {}
      });
      sendResponse(res);
      return false;
    } else if (request.action === "TOGGLE_FLOATING_BUTTON") {
      updateFloatingButtonVisibility(request.show);
      sendResponse({ success: true });
      return false;
    }
  });

  // ----------------------------------------------------------
  // 12. Optional In-Page UI (OFF by default)
  // ----------------------------------------------------------
  function removeInPageUI() {
    const trigger = document.getElementById("foundry-floating-trigger");
    if (trigger) trigger.remove();
    const drawer = document.getElementById("foundry-inpage-drawer");
    if (drawer) drawer.remove();
  }

  function injectInPageUI() {
    removeInPageUI();

    const trigger = document.createElement("button");
    trigger.id = "foundry-floating-trigger";
    trigger.className = "foundry-floating-btn";
    trigger.innerHTML = "⚡ Auto-Fill";
    trigger.title = "Open Foundry Auto-Filler";

    const drawer = document.createElement("div");
    drawer.id = "foundry-inpage-drawer";
    drawer.className = "foundry-drawer foundry-drawer-hidden";
    drawer.innerHTML = `
      <div class="foundry-drawer-header">
        <div class="foundry-drawer-title">⚡ Foundry Auto-Filler v2.0</div>
        <button id="foundry-drawer-close" class="foundry-btn-close">×</button>
      </div>
      <div class="foundry-drawer-body">
        <button id="foundry-inpage-ai-btn" class="foundry-btn-primary" style="background:#2563eb; margin-bottom:8px;">
          🤖 1-Click AI Evaluate & Fill
        </button>
        <button id="foundry-inpage-play-btn" class="foundry-btn-secondary" style="margin-bottom:8px;">
          ▶️ Fast-Play Audio (4x)
        </button>
        <textarea id="foundry-inpage-textarea" placeholder="Paste manual answers or leave empty for AI..."></textarea>
        <div class="foundry-drawer-controls">
          <label style="font-size:12px; color:#cbd5e1; display:flex; align-items:center; gap:6px;">
            <input type="checkbox" id="foundry-inpage-just-cb" checked>
            <span>Fill Justifications</span>
          </label>
        </div>
        <button id="foundry-inpage-fill-btn" class="foundry-btn-secondary" style="width:100%; margin-top:8px;">
          📋 Fill from Manual Text
        </button>
        <div id="foundry-inpage-log" class="foundry-inpage-log">Ready.</div>
      </div>
    `;

    document.body.appendChild(trigger);
    document.body.appendChild(drawer);

    const closeBtn = drawer.querySelector("#foundry-drawer-close");
    const aiBtn = drawer.querySelector("#foundry-inpage-ai-btn");
    const playBtn = drawer.querySelector("#foundry-inpage-play-btn");
    const fillBtn = drawer.querySelector("#foundry-inpage-fill-btn");
    const logDiv = drawer.querySelector("#foundry-inpage-log");

    trigger.addEventListener("click", () => drawer.classList.toggle("foundry-drawer-hidden"));
    closeBtn.addEventListener("click", () => drawer.classList.add("foundry-drawer-hidden"));

    playBtn.addEventListener("click", () => {
      fastPlayAudio(4.0, (m) => logDiv.textContent = m);
    });

    aiBtn.addEventListener("click", async () => {
      logDiv.textContent = "Extracting page conversation...";
      const scraped = extractConversationTurns((m) => logDiv.textContent = m);
      if (!scraped.success) {
        logDiv.textContent = "❌ " + scraped.error;
        return;
      }
      logDiv.textContent = "Analyzing with Gemini AI (Perit rubric)...";
      chrome.runtime.sendMessage({
        action: "CALL_GEMINI_EVALUATION",
        turns: scraped.turns
      }, (resp) => {
        if (!resp || !resp.success) {
          logDiv.textContent = "❌ AI Error: " + (resp?.error || "Connection failed");
          return;
        }
        logDiv.textContent = `AI evaluated ${resp.evaluations.length} turns. Filling form...`;
        fillParsedTurns(resp.evaluations, true, (m) => logDiv.textContent = m);
      });
    });

    fillBtn.addEventListener("click", () => {
      const text = drawer.querySelector("#foundry-inpage-textarea").value;
      const just = drawer.querySelector("#foundry-inpage-just-cb").checked;
      fillAllTurns(text, just, (m) => logDiv.textContent = m);
    });
  }

  function updateFloatingButtonVisibility(show) {
    if (show) {
      injectInPageUI();
    } else {
      removeInPageUI();
    }
  }

  // By default check stored preference
  try {
    chrome.storage.local.get(["showFloatingButton"], (res) => {
      if (res && res.showFloatingButton === true) {
        injectInPageUI();
      }
    });
  } catch (e) {}

})();

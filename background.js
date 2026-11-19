// ============================================================
// Foundry Auto-Filler v2.0 - Background Service Worker
// Manages Gemini API communication & Perit AI evaluation engine
// ============================================================

const FALLBACK_KEY = atob("QVEuQWI4Uk42SUNSekRJUXRqdWRSRk5LeUZsNFNMU3BWUzVFWHZlN0RSelJvMXl6SlJpNWc=");
const DEFAULT_MODEL = "gemini-3.5-flash-lite";

// Initialize defaults
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(["geminiApiKey", "geminiModel", "fillJustifications", "showFloatingButton"], (res) => {
    const updates = {};
    if (!res.geminiApiKey) updates.geminiApiKey = FALLBACK_KEY;
    if (!res.geminiModel) updates.geminiModel = DEFAULT_MODEL;
    if (res.fillJustifications === undefined) updates.fillJustifications = true;
    if (res.showFloatingButton === undefined) updates.showFloatingButton = false;
    chrome.storage.local.set(updates);
  });
});

async function getActiveApiKey(passedKey) {
  if (passedKey && passedKey.trim()) return passedKey.trim();
  const stored = await chrome.storage.local.get(["geminiApiKey"]);
  if (stored && stored.geminiApiKey && stored.geminiApiKey.trim()) {
    return stored.geminiApiKey.trim();
  }
  return FALLBACK_KEY;
}

/**
 * Builds the comprehensive prompt strictly adhering to the 8-page Perit AI Rubric
 */
function buildPeritPrompt(turns) {
  let conversationText = "";
  turns.forEach(t => {
    conversationText += `\nTURN ${t.turnNum}:\n`;
    conversationText += `User (${t.userStart || "0:00"} - ${t.userEnd || "0:00"}): "${t.userText || ""}"\n`;
    conversationText += `Agent (${t.agentStart || "0:00"} - ${t.agentEnd || "0:00"}): "${t.agentText || ""}"\n`;
    if (t.gapSeconds !== null && t.gapSeconds !== undefined) {
      conversationText += `Timing Gap: ${t.gapSeconds}s between user turn end and agent turn start.\n`;
    }
    if (t.prefilledJustification) {
      conversationText += `Pre-filled UI Justification (TRAP CHECK): "${t.prefilledJustification}"\n`;
    }
  });

  return `You are an expert conversation rating evaluator strictly following the official PERIT AI guidelines.
Rate each Agent turn on 3 dimensions: Content (1-5), Prosody (1-5), and Fluidity (1-5).

CONVERSATION TURNS TO EVALUATE:
${conversationText}

PERIT AI GUIDELINES & SCORING RULES:
1. DIMENSIONS & ERROR CODES:
   - Content (1-5): Correct, relevant, complete, and grounded in the conversation.
     * Score 5: Very satisfied. Answers everything asked. Nothing missing. Error Code: "None".
     * Score 4: Somewhat satisfied. Good with one small shortfall. Error Code: "None" or "PAR".
     * Score 3: Neutral. Half-answers. Leaves question open. Error Code: "PAR" (2-3).
     * Score 2: Somewhat dissatisfied. Largely misses, repeats, or adds unasked info. Error Code: "OFF" (1-2), "INV" (1-2), "CTR" (1-2), "IGN" (1-2), or "PAR" (2-3).
     * Score 1: Very dissatisfied. Fails, off-topic, contradicts, invents, or rude. Error Code: "OFF" (1-2), "INV" (1-2), "CTR" (1-2), "FAC" (1), "IGN" (1-2), "RUD" (1).
     * CRITICAL TRAP CHECK: Pre-filled UI justifications often praise an agent turn that actually contradicts or ignores user constraints (e.g. claiming agent confirmed branch when it named a different branch). If the agent erred, you MUST override with 1 or 2, assign the error code (e.g. CTR), and rewrite the justification!

   - Prosody (1-5): The agent's voice: melody, pacing, clarity, expressiveness.
     * Score 5: Very satisfied. Natural, human-like voice quality and pacing. Error Code: "None".
     * Score 4: Somewhat satisfied. Mostly natural, 1-2 moments feel slightly off. Error Code: "None" or "PAC" (3-4) / "INT" (2-4).
     * Score 3: Neutral. Mix of natural and unnatural. Error Code: "PAC" (3-4), "INT" (2-4), "GLI" (1-3).
     * Score 2: Somewhat dissatisfied. Noticeably robotic, monotone, or harsh. Error Code: "ROB" (1-2), "INT" (2-4), "ENU" (2-4).
     * Score 1: Very dissatisfied. Voice switch, loud audio glitch, or completely broken. Error Code: "VOC" (1), "ROB" (1-2), "GLI" (1-3).
     * Note: In text transcripts without audio defects, default prosody to 5 ("None") unless specified otherwise.

   - Fluidity (1-5): Timing between speakers: gaps, cutting in, yielding when interrupted.
     * Score 5: Very satisfied. Natural timing (gap between 0.0s and 1.5s). Error Code: "None".
     * Score 4: Somewhat satisfied. Minor gap (1.5s - 2.0s). Error Code: "None" or "LAG" (1-3).
     * Score 3: Neutral. Clunky gap (2.0s - 2.8s) or slight overlap. Error Code: "LAG" (1-3), "CUT" (1-4).
     * Score 2: Somewhat dissatisfied. Noticeable dead air (>2.8s, LAG) or steps on user. Error Code: "LAG" (1-3), "CUT" (1-4), "YLD" (1-2), "RST" (2-3).
     * Score 1: Very dissatisfied. Prolonged dead air (>4.0s) or sustained crosstalk. Error Code: "LAG" (1-3), "XTK" (1).

2. JUSTIFICATION REQUIREMENTS (STRICT):
   - Exactly ONE sentence per justification. No more, no less.
   - Must quote a few exact words from the turn (in single or double quotes).
   - If the score is 4: MUST explicitly explain what stops it from being a 5 (a 4 with praise-only counts as an error).
   - Keep each dimension strictly in its own lane:
     * Content justification discusses ONLY what was said (words / meaning).
     * Prosody justification discusses ONLY vocal delivery / tone / pacing.
     * Fluidity justification discusses ONLY timing, gaps, or overlap.
   - Never reuse a justification across turns.

RETURN VALID JSON ONLY matching this exact schema:
[
  {
    "turnNum": 1,
    "content": { "score": 5, "errorCode": "None", "justification": "One sentence quoting words." },
    "prosody": { "score": 5, "errorCode": "None", "justification": "One sentence quoting words." },
    "fluidity": { "score": 5, "errorCode": "None", "justification": "One sentence quoting words." }
  }
]`;
}

/**
 * Calls Gemini API to perform the Perit AI evaluation
 */
async function callGeminiEvaluation(turns, apiKey, model) {
  const activeKey = await getActiveApiKey(apiKey);
  if (!activeKey) {
    throw new Error("No Gemini API Key provided. Please enter your API key in Settings.");
  }

  const activeModel = model || DEFAULT_MODEL;
  const prompt = buildPeritPrompt(turns);

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${activeModel}:generateContent?key=${activeKey}`;

  const requestBody = {
    contents: [
      {
        parts: [{ text: prompt }]
      }
    ],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.1
    }
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    let parsedErr = errorText;
    try {
      const errJson = JSON.parse(errorText);
      parsedErr = errJson.error?.message || errorText;
    } catch (e) {}

    if (response.status === 401) {
      throw new Error("Invalid or revoked Gemini API Key (401). Please enter a fresh free API key from Google AI Studio in the Settings tab.");
    }

    throw new Error(`Gemini API Error (${response.status}): ${parsedErr}`);
  }

  const json = await response.json();
  const rawText = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) {
    throw new Error("No evaluation generated by Gemini.");
  }

  let evaluations = [];
  try {
    evaluations = JSON.parse(rawText);
  } catch (e) {
    const jsonMatch = rawText.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      evaluations = JSON.parse(jsonMatch[0]);
    } else {
      throw new Error("Could not parse JSON response from Gemini: " + rawText.substring(0, 200));
    }
  }

  return {
    success: true,
    evaluations,
    rawText
  };
}

/**
 * Verify API key validity
 */
async function verifyApiKey(apiKey) {
  const key = await getActiveApiKey(apiKey);
  if (!key) throw new Error("Please enter an API Key to test.");

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;
  const res = await fetch(endpoint);
  if (!res.ok) {
    const errText = await res.text();
    let msg = `Status ${res.status}`;
    try {
      const errJson = JSON.parse(errText);
      if (errJson.error?.message) msg = errJson.error.message;
    } catch (e) {}
    throw new Error(msg);
  }
  return { success: true };
}

// Runtime message listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "CALL_GEMINI_EVALUATION") {
    callGeminiEvaluation(request.turns, request.apiKey, request.model)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  } else if (request.action === "VERIFY_API_KEY") {
    verifyApiKey(request.apiKey)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

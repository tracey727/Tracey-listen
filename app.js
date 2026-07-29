"use strict";

const DB_NAME = "genevieve-listens-tracey";
const DB_VERSION = 1;
const ENTRY_STORE = "entries";
const SETTING_STORE = "settings";

const state = {
  db: null,
  recording: false,
  recorder: null,
  stream: null,
  chunks: [],
  audioBlob: null,
  recognition: null,
  transcript: "",
  transcriptFinal: "",
  recordingStarted: null,
  timerId: null,
  selectedNeed: "listen",
  lastEntryId: null,
  lastResponse: "",
  followupMode: false,
  settleTimerId: null,
  settleSeconds: 90,
  settleIndex: 0
};

const $ = (id) => document.getElementById(id);
const qsa = (selector) => [...document.querySelectorAll(selector)];
const nowISO = () => new Date().toISOString();

const TRIGGERS = [
  { key: "silence_or_ignored", label: "Silence / ignored", re: /ignore|ignored|no reply|no response|not answering|answer me|silence|won't call|didn't call|missed.*call|callback/i },
  { key: "broken_promises", label: "Broken promise", re: /promise|promised|said.*would|told me.*would|commitment|didn't do|hasn't done|still not/i },
  { key: "care_disruption", label: "Care disruption", re: /cancel|appointment|psychologist|clinic|practice|renee|irene|stacey|stacy|doctor|six weeks|twice a week|one day a week|overseas|back operation/i },
  { key: "conflicting_information", label: "Conflicting information", re: /conflict|not true|lied|honest|dishonest|different answer|doesn't add up|misled|accurate|inaccurate/i },
  { key: "unclear_responsibility", label: "No one responsible", re: /who.*responsible|who am i seeing|who is taking|nobody|no one|passed around|bounced around|fall through|fell through/i },
  { key: "rejection_or_no_closure", label: "Rejection / no closure", re: /reject|closure|hate me|doesn't care|unimportant|not worthy|worthless|terrible person|no value|self-worth|left me/i },
  { key: "privacy", label: "Privacy concern", re: /reception.*read|private|privacy|confidential|secretary|personal email/i },
  { key: "technology_failure", label: "Technology failed", re: /app.*doesn't work|button.*doesn't work|won't save|404|deployment|api key|broken app|not working/i },
  { key: "too_much_at_once", label: "Too much at once", re: /too much information|hundred steps|overwhelmed|brain.*full|can't think|too many/i }
];

const REACTIONS = [
  { key: "anger", label: "Anger / strong language", re: /fuck|fucking|angry|furious|pissed|lost it|went off|fuming/i },
  { key: "repeated_chasing", label: "Repeated chasing", re: /again|keep calling|keep asking|chasing|third email|many attempts|repeatedly|pleaded|begged/i },
  { key: "exit_or_delete", label: "Wanting to leave / delete", re: /cancel all|never going back|i'm done|leave the practice|delete all|stop.*care|won't be back/i },
  { key: "self_worth_drop", label: "Self-worth collapse", re: /self-worth|worthless|not worthy|no value|unimportant|terrible person|ashamed|rejected/i },
  { key: "dissociation", label: "Dissociation / numbness", re: /dissociat|lost time|losing time|numb|not real|outside my body|blank/i },
  { key: "suicidal_thoughts", label: "Suicidal thoughts", re: /suicid|kill myself|hurt myself|end my life|want to die|not be alive|going to be next|can't go on/i }
];

const SETTLE_PROMPTS = [
  "Look around and find three quiet colours.",
  "Say today's date and the room you are in.",
  "Notice one ordinary thing Mr Gruff is doing—or picture him safe.",
  "Let your shoulders be where they are. You do not have to force your body.",
  "The fact is: something hurt. The injury says: you have no worth. They are not the same.",
  "Choose only the next five minutes. Nothing beyond that is required."
];

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ENTRY_STORE)) {
        const store = db.createObjectStore(ENTRY_STORE, { keyPath: "id", autoIncrement: true });
        store.createIndex("createdAt", "createdAt");
        store.createIndex("type", "type");
      }
      if (!db.objectStoreNames.contains(SETTING_STORE)) {
        db.createObjectStore(SETTING_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function dbAdd(storeName, value) {
  return new Promise((resolve, reject) => {
    const tx = state.db.transaction(storeName, "readwrite");
    const req = tx.objectStore(storeName).add(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbPut(storeName, value) {
  return new Promise((resolve, reject) => {
    const tx = state.db.transaction(storeName, "readwrite");
    const req = tx.objectStore(storeName).put(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbGet(storeName, key) {
  return new Promise((resolve, reject) => {
    const tx = state.db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbGetAll(storeName) {
  return new Promise((resolve, reject) => {
    const tx = state.db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function dbDelete(storeName, key) {
  return new Promise((resolve, reject) => {
    const tx = state.db.transaction(storeName, "readwrite");
    const req = tx.objectStore(storeName).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function classify(text) {
  const clean = (text || "").trim();
  return {
    triggers: TRIGGERS.filter(item => item.re.test(clean)).map(item => item.key),
    reactions: REACTIONS.filter(item => item.re.test(clean)).map(item => item.key),
    safetyFlag: REACTIONS.find(item => item.key === "suicidal_thoughts").re.test(clean),
    dissociationFlag: REACTIONS.find(item => item.key === "dissociation").re.test(clean)
  };
}

function labelsFor(keys) {
  const all = [...TRIGGERS, ...REACTIONS];
  return keys.map(key => all.find(item => item.key === key)?.label || key);
}

function buildResponse(transcript, analysis, need) {
  const lines = ["Tracey, I heard you. You do not have to make it tidy or prove that it hurts."];
  const has = key => analysis.triggers.includes(key) || analysis.reactions.includes(key);

  if (has("silence_or_ignored")) {
    lines.push("Silence is one of the things that can send your nervous system straight to rejection. The fact is that an answer has not arrived. That is not proof that you are not worth answering.");
  }
  if (has("broken_promises")) {
    lines.push("A promise without follow-through is not a small thing for you. We will keep the exact words, date and responsibility so you do not have to carry it all in your head.");
  }
  if (has("care_disruption") || has("unclear_responsibility")) {
    lines.push("You need continuity, a named person and a clear next step—not another vague reassurance or another person to chase.");
  }
  if (has("rejection_or_no_closure") || has("self_worth_drop")) {
    lines.push("Your self-worth has dropped, but the feeling is not a verdict. Another person's limit, silence or behaviour cannot measure your value.");
  }
  if (has("anger")) {
    lines.push("Strong language is allowed here. I will listen for the injury and the need underneath it instead of punishing you for how distress sounds.");
  }
  if (has("exit_or_delete")) {
    lines.push("Keep the evidence and hold the final decision for now. You can choose later; you do not need to erase anything while the surge is high.");
  }
  if (analysis.dissociationFlag) {
    lines.push("Keep your eyes open. Say today's date, where you are and three things you can see. Do not force touch on your face or torso.");
  }

  if (need === "settle") {
    lines.push("Go to Settle. For ninety seconds, nothing has to be solved.");
  } else if (need === "record") {
    lines.push("I am keeping the facts, the trigger and your exact words for the record and future clinician handover.");
  } else if (need === "hold") {
    lines.push("This is being held here. It is not being sent to Irene, reception, a psychologist or anyone else.");
  } else {
    lines.push("The only next step is this: stay here, check safety if needed, and let me hold what happened.");
  }

  if (analysis.safetyFlag) {
    lines.push("Suicidal thoughts were heard. I will open the safety check because this is the one thing I cannot safely guess.");
  }
  return lines.join("\n\n");
}

function preferredMimeType() {
  const types = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
  return types.find(type => window.MediaRecorder && MediaRecorder.isTypeSupported(type)) || "";
}

function initialiseRecognition() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) return null;
  const recognition = new Recognition();
  recognition.lang = "en-AU";
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.onresult = event => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const phrase = event.results[i][0].transcript;
      if (event.results[i].isFinal) state.transcriptFinal += `${phrase} `;
      else interim += phrase;
    }
    state.transcript = `${state.transcriptFinal}${interim}`.trim();
    $("liveTranscript").textContent = state.transcript;
    $("liveTranscriptWrap").classList.toggle("hidden", !state.transcript);
  };
  recognition.onerror = () => {};
  recognition.onend = () => {
    if (state.recording) {
      try { recognition.start(); } catch (_) {}
    }
  };
  return recognition;
}

async function startRecording({ followup = false } = {}) {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    $("unsupportedDialog").showModal();
    return;
  }
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    state.chunks = [];
    state.audioBlob = null;
    state.transcript = "";
    state.transcriptFinal = "";
    state.recordingStarted = Date.now();
    state.followupMode = followup;

    const mimeType = preferredMimeType();
    state.recorder = new MediaRecorder(state.stream, mimeType ? { mimeType } : undefined);
    state.recorder.ondataavailable = event => { if (event.data?.size) state.chunks.push(event.data); };
    state.recorder.onstop = () => {
      state.audioBlob = new Blob(state.chunks, { type: state.recorder.mimeType || "audio/mp4" });
      state.stream?.getTracks().forEach(track => track.stop());
      state.stream = null;
      if (state.followupMode) saveFollowupRecording();
      else revealRecordingActions();
    };
    state.recorder.start(600);
    state.recording = true;
    state.recognition = initialiseRecognition();
    if (state.recognition) {
      try { state.recognition.start(); } catch (_) {}
    }
    updateRecordingUI(true);
    state.timerId = window.setInterval(updateRecordingTimer, 250);
  } catch (error) {
    console.error(error);
    toast("Microphone permission is needed to listen.");
  }
}

function stopRecording() {
  if (!state.recording) return;
  state.recording = false;
  window.clearInterval(state.timerId);
  state.timerId = null;
  try { state.recognition?.stop(); } catch (_) {}
  state.recognition = null;
  if (state.recorder?.state !== "inactive") state.recorder.stop();
  updateRecordingUI(false);
}

function updateRecordingUI(active) {
  $("voiceStage").classList.toggle("recording", active);
  $("recordLabel").textContent = active ? "I’m listening" : "Tap once, talk freely, tap again";
  $("recordButton").setAttribute("aria-label", active ? "Stop recording" : "Start talking to Genevieve");
  if (!active) $("recordTimer").textContent = "Recording ready to keep or discard";
}

function updateRecordingTimer() {
  if (!state.recordingStarted) return;
  const elapsed = Math.floor((Date.now() - state.recordingStarted) / 1000);
  const mins = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const secs = String(elapsed % 60).padStart(2, "0");
  $("recordTimer").textContent = `${mins}:${secs}`;
}

function revealRecordingActions() {
  $("afterRecording").classList.remove("hidden");
  if (!state.transcript) {
    $("liveTranscriptWrap").classList.remove("hidden");
    $("liveTranscript").textContent = "Voice captured. This browser did not provide a written transcript, but the recording will still be saved.";
  }
}

function resetRecordingUI() {
  state.audioBlob = null;
  state.chunks = [];
  state.transcript = "";
  state.transcriptFinal = "";
  state.recordingStarted = null;
  $("afterRecording").classList.add("hidden");
  $("liveTranscriptWrap").classList.add("hidden");
  $("liveTranscript").textContent = "";
  $("recordTimer").textContent = "Ready when you are";
}

async function saveCurrentRecording() {
  if (!state.audioBlob) return;
  const analysis = classify(state.transcript);
  const response = buildResponse(state.transcript, analysis, state.selectedNeed);
  const entry = {
    type: state.selectedNeed === "hold" ? "held" : "checkin",
    createdAt: nowISO(),
    transcript: state.transcript,
    audio: state.audioBlob,
    audioType: state.audioBlob.type,
    need: state.selectedNeed,
    triggers: analysis.triggers,
    reactions: analysis.reactions,
    safetyFlag: analysis.safetyFlag,
    dissociationFlag: analysis.dissociationFlag,
    response,
    feedback: null
  };
  try {
    state.lastEntryId = await dbAdd(ENTRY_STORE, entry);
    state.lastResponse = response;
    $("responseText").textContent = response;
    $("responseCard").classList.remove("hidden");
    resetRecordingUI();
    toast("Kept safely on this device");
    speak(response);
    if (analysis.safetyFlag) window.setTimeout(() => $("safetyDialog").showModal(), 450);
    renderPatterns();
  } catch (error) {
    console.error(error);
    toast("I could not save that recording. Please use backup after the next successful save.");
  }
}

async function saveFollowupRecording() {
  if (!state.audioBlob) return;
  const analysis = classify(state.transcript);
  const entry = {
    type: "followup",
    createdAt: nowISO(),
    transcript: state.transcript,
    audio: state.audioBlob,
    audioType: state.audioBlob.type,
    triggers: analysis.triggers,
    reactions: analysis.reactions,
    safetyFlag: analysis.safetyFlag
  };
  try {
    await dbAdd(ENTRY_STORE, entry);
    resetRecordingUI();
    state.followupMode = false;
    toast("Promise or callback saved");
    await renderFollowups();
  } catch (error) {
    console.error(error);
    toast("Could not save that follow-up");
  }
}

function speak(text) {
  if (!text || !("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-AU";
  utterance.rate = 0.9;
  utterance.pitch = 1;
  speechSynthesis.speak(utterance);
}

function formatDate(iso) {
  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Australia/Brisbane"
  }).format(new Date(iso));
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

async function renderEntries() {
  const entries = (await dbGetAll(ENTRY_STORE)).filter(entry => entry.type === "checkin" || entry.type === "held").sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
  const list = $("entriesList");
  if (!entries.length) {
    list.innerHTML = '<div class="empty-state">Your first voice check-in will appear here.<br>Nothing is shared automatically.</div>';
    return;
  }
  list.innerHTML = "";
  entries.forEach(entry => {
    const card = document.createElement("article");
    card.className = "entry-card";
    const labels = labelsFor([...(entry.triggers || []), ...(entry.reactions || [])]).slice(0, 6);
    const audioUrl = entry.audio instanceof Blob ? URL.createObjectURL(entry.audio) : "";
    card.innerHTML = `
      <div class="entry-date"><span>${escapeHtml(formatDate(entry.createdAt))}</span><span>${entry.type === "held" ? "Held—not sent" : "Voice check-in"}</span></div>
      <div class="entry-tags">${labels.map(label => `<span class="entry-tag">${escapeHtml(label)}</span>`).join("")}</div>
      ${entry.transcript ? `<div class="entry-transcript">“${escapeHtml(entry.transcript)}”</div>` : '<div class="entry-transcript">Voice recording saved without transcript.</div>'}
      ${audioUrl ? `<audio class="entry-audio" controls preload="metadata" src="${audioUrl}"></audio>` : ""}
      ${entry.response ? `<div class="entry-response">${escapeHtml(entry.response)}</div>` : ""}
      <div class="entry-actions">
        <button class="entry-action download-entry" type="button">Download voice</button>
        <button class="entry-action delete-entry" type="button">Delete</button>
      </div>`;
    card.querySelector(".download-entry")?.addEventListener("click", () => downloadBlob(entry.audio, `genevieve-voice-${entry.id}.${extensionFor(entry.audioType)}`));
    card.querySelector(".delete-entry")?.addEventListener("click", async () => {
      if (!confirm("Delete this voice check-in from this device?")) return;
      await dbDelete(ENTRY_STORE, entry.id);
      await renderEntries();
      await renderPatterns();
    });
    list.appendChild(card);
  });
}

async function renderPatterns() {
  const entries = (await dbGetAll(ENTRY_STORE)).filter(entry => entry.type === "checkin" || entry.type === "held");
  const triggerCount = {};
  const reactionCount = {};
  let safety = 0;
  let helped = 0;
  entries.forEach(entry => {
    (entry.triggers || []).forEach(key => triggerCount[key] = (triggerCount[key] || 0) + 1);
    (entry.reactions || []).forEach(key => reactionCount[key] = (reactionCount[key] || 0) + 1);
    if (entry.safetyFlag) safety += 1;
    if (entry.feedback === "helped") helped += 1;
  });
  const topTrigger = Object.entries(triggerCount).sort((a,b) => b[1]-a[1])[0];
  const topReaction = Object.entries(reactionCount).sort((a,b) => b[1]-a[1])[0];
  const triggerLabel = topTrigger ? labelsFor([topTrigger[0]])[0] : "Still learning";
  const reactionLabel = topReaction ? labelsFor([topReaction[0]])[0] : "Still learning";
  $("patternCards").innerHTML = `
    <div class="pattern-card"><div class="pattern-number">${entries.length}</div><div class="pattern-label">voice check-ins</div><div class="pattern-note">Patterns strengthen after five.</div></div>
    <div class="pattern-card"><div class="pattern-number">${escapeHtml(triggerLabel)}</div><div class="pattern-label">most repeated trigger</div><div class="pattern-note">Based only on your own words.</div></div>
    <div class="pattern-card"><div class="pattern-number">${escapeHtml(reactionLabel)}</div><div class="pattern-label">common distress response</div><div class="pattern-note">Description, not diagnosis.</div></div>
    <div class="pattern-card"><div class="pattern-number">${helped}</div><div class="pattern-label">responses marked helpful</div><div class="pattern-note">Genevieve learns what settles you.</div></div>`;
}

async function renderFollowups() {
  const entries = (await dbGetAll(ENTRY_STORE)).filter(entry => entry.type === "followup").sort((a,b) => new Date(b.createdAt)-new Date(a.createdAt));
  const list = $("followupList");
  if (!entries.length) {
    list.innerHTML = '<p class="small">No promises or callbacks recorded yet.</p>';
    return;
  }
  list.innerHTML = "";
  entries.forEach(entry => {
    const item = document.createElement("div");
    item.className = "followup-item";
    const audioUrl = entry.audio instanceof Blob ? URL.createObjectURL(entry.audio) : "";
    item.innerHTML = `<b>${escapeHtml(formatDate(entry.createdAt))}</b><p>${entry.transcript ? escapeHtml(entry.transcript) : "Voice promise saved without transcript."}</p>${audioUrl ? `<audio class="entry-audio" controls src="${audioUrl}"></audio>` : ""}`;
    list.appendChild(item);
  });
}

async function setFeedback(value) {
  if (!state.lastEntryId) return;
  const entry = await dbGet(ENTRY_STORE, state.lastEntryId);
  if (!entry) return;
  entry.feedback = value;
  await dbPut(ENTRY_STORE, entry);
  toast(value === "helped" ? "I’ll remember that this helped" : "I’ll remember that it was not enough");
  await renderPatterns();
}

async function createHandover() {
  const entries = (await dbGetAll(ENTRY_STORE)).filter(entry => entry.type === "checkin" || entry.type === "held").sort((a,b) => new Date(a.createdAt)-new Date(b.createdAt));
  const triggerCount = {};
  const reactionCount = {};
  entries.forEach(entry => {
    (entry.triggers || []).forEach(key => triggerCount[key] = (triggerCount[key] || 0) + 1);
    (entry.reactions || []).forEach(key => reactionCount[key] = (reactionCount[key] || 0) + 1);
  });
  const sortedLabels = counts => Object.entries(counts).sort((a,b) => b[1]-a[1]).map(([key,count]) => `${labelsFor([key])[0]} (${count})`);
  const safetyEntries = entries.filter(entry => entry.safetyFlag);
  const dissociationEntries = entries.filter(entry => entry.dissociationFlag);
  const exactWords = entries.filter(entry => entry.transcript).slice(-10).map(entry => `- ${formatDate(entry.createdAt)}: “${entry.transcript.replace(/\s+/g," ").slice(0,650)}”`).join("\n");

  const text = `GENEVIEVE LISTENS™ — TRACEY KENNEDY\nPRIVATE CLINICIAN HANDOVER\nCreated: ${formatDate(nowISO())}\n\nPURPOSE\nThis document was created from Tracey's own private voice check-ins. It is intended to help a clinician understand recurring triggers, crisis escalation, safety concerns, communication needs and what is more likely to help. It does not diagnose Tracey and does not replace a clinical assessment.\n\nWHAT TRACEY NEEDS A CLINICIAN TO UNDERSTAND\nTracey needs clear, direct communication, continuity of care, privacy, a named person responsible for follow-up, and to be taken seriously when she says the level of support is not enough. Silence, conflicting information, broken commitments, cancelled care and unexplained clinician changes can cause a rapid fall in self-worth, escalation of distress, dissociation and suicidal thoughts. Strong language during distress should be understood as a sign of overload and injury, not used as a reason to withdraw care or ignore the underlying safety need.\n\nOBSERVED PERSONAL TRIGGER PATTERN\n${sortedLabels(triggerCount).join("\n") || "Not enough saved check-ins yet."}\n\nOBSERVED DISTRESS RESPONSES\n${sortedLabels(reactionCount).join("\n") || "Not enough saved check-ins yet."}\n\nSAFETY INFORMATION\nVoice check-ins containing suicidal-thought language: ${safetyEntries.length}\nVoice check-ins containing dissociation/lost-time language: ${dissociationEntries.length}\nAny current safety risk must be assessed directly by a qualified human professional.\n\nWHAT IS MORE LIKELY TO HELP TRACEY\n- Acknowledge receipt immediately and plainly.\n- Tell the truth even when the answer is no or the service cannot meet the request.\n- Give one step at a time rather than a large list.\n- Use exact dates, names, responsibilities and written follow-through.\n- Do not shame or punish strong language expressed during crisis.\n- Preserve facts and delay irreversible decisions until the surge reduces.\n- Provide a private communication pathway and confirm that clinical information was received.\n- Make a written continuity plan for clinician absence, cancellation or change.\n- Include Mr Gruff in safety planning where appropriate.\n- Review whether the frequency and level of care are clinically adequate rather than leaving Tracey to repeatedly chase support.\n\nWHAT CAN MAKE THINGS WORSE\n- Silence after urgent or safety-related communication.\n- Vague reassurance without action.\n- Promised callbacks that are not owned or tracked.\n- Requiring Tracey to repeat the same issue to multiple people.\n- Conflicting information about appointments, qualifications or responsibility.\n- Abrupt reductions or gaps in treatment without an agreed transition plan.\n- Treating distress language as misconduct while missing the safety issue underneath.\n- Forcing trauma processing, touch work, forgiveness, trust or reconciliation when Tracey has not consented.\n\nTRACEY'S RECENT EXACT WORDS\n${exactWords || "No written transcripts were available. The app may contain voice recordings on Tracey's device."}\n\nCLINICAL REQUEST\nPlease complete a direct safety and needs assessment; agree on a written continuity-of-care plan; establish an appropriate confidential communication pathway; clarify who is clinically responsible; assess the required appointment frequency; document what will happen during absence or cancellation; and review the plan regularly with Tracey.\n\nCONSENT AND PRIVACY\nThis file was created by Tracey pressing the handover button. The app does not send it automatically. Tracey decides who receives it.\n`;
  downloadText(text, `Genevieve-Listens-Tracey-Clinician-Handover-${dateFile()}.txt`);
  toast("Clinician handover created");
}

async function createBackup() {
  const entries = await dbGetAll(ENTRY_STORE);
  const portable = [];
  for (const entry of entries) {
    const copy = { ...entry };
    if (entry.audio instanceof Blob) copy.audioData = await blobToDataURL(entry.audio);
    delete copy.audio;
    portable.push(copy);
  }
  const payload = {
    app: "GENEVIEVE LISTENS",
    owner: "Tracey Kennedy",
    exportedAt: nowISO(),
    version: 1,
    note: "Private backup. This JSON file is not encrypted; store it securely.",
    entries: portable
  };
  downloadText(JSON.stringify(payload, null, 2), `Genevieve-Listens-Private-Backup-${dateFile()}.json`, "application/json");
  toast("Private backup downloaded");
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function extensionFor(type = "") {
  if (type.includes("mp4")) return "m4a";
  if (type.includes("ogg")) return "ogg";
  return "webm";
}

function downloadBlob(blob, filename) {
  if (!(blob instanceof Blob)) { toast("No voice file is available"); return; }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function downloadText(text, filename, type = "text/plain") {
  downloadBlob(new Blob([text], { type: `${type};charset=utf-8` }), filename);
}

function dateFile() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Brisbane" }).format(new Date());
}

function showScreen(targetId) {
  qsa(".screen").forEach(screen => screen.classList.toggle("active", screen.id === targetId));
  qsa(".dock-item").forEach(item => item.classList.toggle("active", item.dataset.target === targetId));
  if (targetId === "recordScreen") renderEntries();
  if (targetId === "patternsScreen") renderPatterns();
  if (targetId === "handoverScreen") renderFollowups();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function startSettle() {
  if (state.settleTimerId) {
    window.clearInterval(state.settleTimerId);
    state.settleTimerId = null;
    $("settleButton").textContent = "Continue";
    return;
  }
  if (state.settleSeconds <= 0) {
    state.settleSeconds = 90;
    state.settleIndex = 0;
  }
  $("settleButton").textContent = "Pause";
  speak(SETTLE_PROMPTS[state.settleIndex]);
  state.settleTimerId = window.setInterval(() => {
    state.settleSeconds -= 1;
    const mins = String(Math.floor(state.settleSeconds / 60)).padStart(2, "0");
    const secs = String(state.settleSeconds % 60).padStart(2, "0");
    $("settleTime").textContent = `${mins}:${secs}`;
    if (state.settleSeconds > 0 && state.settleSeconds % 15 === 0) {
      state.settleIndex = Math.min(state.settleIndex + 1, SETTLE_PROMPTS.length - 1);
      $("settlePrompt").textContent = SETTLE_PROMPTS[state.settleIndex];
      speak(SETTLE_PROMPTS[state.settleIndex]);
    }
    if (state.settleSeconds <= 0) {
      window.clearInterval(state.settleTimerId);
      state.settleTimerId = null;
      $("settleButton").textContent = "Begin again";
      $("settlePrompt").textContent = "You stayed through the minute. Choose only one next step.";
      speak("You stayed through the minute. Choose only one next step.");
    }
  }, 1000);
}

function toast(message) {
  const element = $("toast");
  element.textContent = message;
  element.classList.add("show");
  window.setTimeout(() => element.classList.remove("show"), 2600);
}

function wireEvents() {
  $("recordButton").addEventListener("click", () => state.recording ? stopRecording() : startRecording());
  $("saveVoiceButton").addEventListener("click", saveCurrentRecording);
  $("discardVoiceButton").addEventListener("click", () => { resetRecordingUI(); toast("Discarded"); });
  $("speakResponseButton").addEventListener("click", () => speak(state.lastResponse));
  $("helpedButton").addEventListener("click", () => setFeedback("helped"));
  $("notEnoughButton").addEventListener("click", () => setFeedback("not_enough"));
  $("privacyButton").addEventListener("click", () => $("privacyDialog").showModal());
  $("openSafetyButton").addEventListener("click", () => $("safetyDialog").showModal());
  $("settleButton").addEventListener("click", startSettle);
  $("createHandoverButton").addEventListener("click", createHandover);
  $("backupButton").addEventListener("click", createBackup);
  $("followupVoiceButton").addEventListener("click", () => {
    showScreen("listenScreen");
    startRecording({ followup: true });
    toast("Say the promise, who made it and when it should happen");
  });

  qsa(".need-chip").forEach(chip => chip.addEventListener("click", () => {
    state.selectedNeed = chip.dataset.need;
    qsa(".need-chip").forEach(item => item.classList.toggle("selected", item === chip));
  }));

  qsa(".dock-item").forEach(item => item.addEventListener("click", () => showScreen(item.dataset.target)));

  qsa(".safety-choice").forEach(choice => choice.addEventListener("click", async () => {
    const risk = choice.dataset.risk;
    await dbPut(SETTING_STORE, { key: "lastSafety", value: risk, at: nowISO() });
    if (risk === "safe") {
      $("safetyDialog").close();
      toast("Safe right now recorded");
    } else {
      $("urgentPanel").classList.remove("hidden");
      speak("Do not stay alone. Move away from anything you could use to hurt yourself and choose a human connection now.");
    }
  }));
}

async function init() {
  try {
    state.db = await openDatabase();
    wireEvents();
    await Promise.all([renderEntries(), renderPatterns(), renderFollowups()]);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  } catch (error) {
    console.error(error);
    toast("Private storage could not start. Please use normal Safari, not Private Browsing.");
  }
}

document.addEventListener("DOMContentLoaded", init);

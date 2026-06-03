// Real-time ElevenLabs voice agent client — CSP-safe, no SDK. Connects to a
// signed wss URL minted by /api/voice-agent/start, streams mic audio up as PCM
// 16k, plays the agent's streamed audio down (gapless), handles barge-in and
// ping/pong, and surfaces the live transcript. Returns a small controller.
//
// Usage:
//   const agent = createVoiceAgent({ scenarioId, onStatus, onUserText, onAgentText, onEnd });
//   await agent.start();
//   ... agent.stop();  // -> onEnd({ transcript, conversationId })

const DEFAULT_OUT_RATE = 16000; // agent output PCM rate (overridden by metadata)
const SAMPLE_RATE_IN = 16000;   // rate we send mic audio at

export function createVoiceAgent(opts = {}) {
  const {
    scenarioId,
    onStatus = () => {},
    onUserText = () => {},
    onAgentText = () => {},
    onEnd = () => {},
    onError = () => {},
  } = opts;

  let ws = null;
  let micStream = null;
  let audioCtx = null;
  let sourceNode = null;
  let processor = null;
  let sink = null;
  let stopped = false;
  let paused = false;
  let finished = false;
  let conversationId = null;
  let outRate = DEFAULT_OUT_RATE;
  let playHead = 0;
  const liveSources = new Set();
  const transcript = [];

  const setStatus = (s) => { try { onStatus(s); } catch {} };
  const log = (...a) => { try { console.log('[voice-agent]', ...a); } catch {} };
  let gotAudio = false;

  // ---- playback (decode base64 PCM16 -> scheduled gapless playout) --------
  function playPcm16(base64) {
    if (!audioCtx || stopped || paused) return;
    const bytes = b64ToBytes(base64);
    const usable = bytes.byteLength - (bytes.byteLength % 2);
    const int16 = new Int16Array(bytes.buffer, bytes.byteOffset, usable / 2);
    const float = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) float[i] = int16[i] / 32768;
    if (!float.length) return;
    const buf = audioCtx.createBuffer(1, float.length, outRate);
    buf.copyToChannel(float, 0);
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    src.connect(audioCtx.destination);
    const now = audioCtx.currentTime;
    if (playHead < now) playHead = now;
    src.start(playHead);
    playHead += buf.duration;
    liveSources.add(src);
    src.onended = () => liveSources.delete(src);
  }

  function stopPlayback() {
    for (const s of liveSources) { try { s.stop(); } catch {} }
    liveSources.clear();
    if (audioCtx) playHead = audioCtx.currentTime;
  }

  // ---- mic capture (downsample to 16k, PCM16, base64, stream up) ----------
  function startMic() {
    sourceNode = audioCtx.createMediaStreamSource(micStream);
    processor = audioCtx.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = (e) => {
      if (stopped || paused || !ws || ws.readyState !== WebSocket.OPEN) return;
      const input = e.inputBuffer.getChannelData(0);
      const down = downsample(input, audioCtx.sampleRate, SAMPLE_RATE_IN);
      const b64 = floatToPcm16Base64(down);
      try { ws.send(JSON.stringify({ user_audio_chunk: b64 })); } catch {}
    };
    sourceNode.connect(processor);
    // ScriptProcessor must reach a destination to run; route through a muted
    // gain so there's no mic feedback.
    sink = audioCtx.createGain();
    sink.gain.value = 0;
    processor.connect(sink);
    sink.connect(audioCtx.destination);
  }

  // ---- lifecycle ----------------------------------------------------------
  async function start() {
    setStatus('connecting');
    // Create + resume the AudioContext SYNCHRONOUSLY, within the user gesture
    // (the Answer click), BEFORE any await. If we create it after an await the
    // browser keeps it suspended and NO audio is captured or played — which
    // looks exactly like "she doesn't talk back at all." We re-resume after the
    // awaits as a belt-and-suspenders.
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AC();
      if (audioCtx.resume) audioCtx.resume();
      playHead = audioCtx.currentTime;
    } catch (e) {
      log('audioContext create failed', e);
    }

    let data;
    try {
      const r = await fetch('/api/voice-agent/start', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario_id: scenarioId }),
      });
      data = await r.json().catch(() => null);
      if (!r.ok || !data?.signed_url) {
        throw new Error((data && (data.detail || data.error)) || `http_${r.status}`);
      }
      log('signed url ok');
    } catch (e) {
      log('signed-url fetch failed', e);
      teardown(); setStatus('error'); try { onError(e); } catch {} throw e;
    }

    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      log('mic granted');
    } catch (e) {
      log('mic denied', e);
      teardown(); setStatus('mic_denied'); try { onError(e); } catch {} throw e;
    }

    try { await audioCtx.resume(); } catch {}
    playHead = audioCtx.currentTime;
    log('audioContext state', audioCtx && audioCtx.state, 'rate', audioCtx && audioCtx.sampleRate);

    ws = new WebSocket(data.signed_url);
    ws.onopen = () => {
      log('ws open');
      setStatus('live');
      const ov = data.overrides || {};
      const agentOverride = {
        prompt: { prompt: ov.prompt || '' },
        first_message: ov.first_message || '',
        language: ov.language || 'en',
      };
      const init = {
        type: 'conversation_initiation_client_data',
        conversation_config_override: { agent: agentOverride },
      };
      if (ov.voice_id) init.conversation_config_override.tts = { voice_id: ov.voice_id };
      try { ws.send(JSON.stringify(init)); log('init sent', { voice: ov.voice_id, first: (ov.first_message || '').slice(0, 40) }); } catch (e) { log('init send failed', e); }
      startMic();
    };
    ws.onmessage = (ev) => handleMessage(ev.data);
    ws.onerror = (e) => { log('ws error', e); try { onError(e); } catch {} };
    ws.onclose = (e) => { log('ws close', e && e.code, e && e.reason); if (!stopped) finish(); };
  }

  function handleMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    switch (msg.type) {
      case 'conversation_initiation_metadata': {
        const ev = msg.conversation_initiation_metadata_event || {};
        conversationId = ev.conversation_id || null;
        const fmt = ev.agent_output_audio_format || '';
        const m = /(\d{4,6})/.exec(fmt);
        if (m) outRate = Number(m[1]) || DEFAULT_OUT_RATE;
        log('metadata', { conversationId, outFmt: fmt, outRate, inFmt: ev.user_input_audio_format });
        break;
      }
      case 'audio': {
        const b64 = msg.audio_event?.audio_base_64;
        if (b64) {
          if (!gotAudio) { gotAudio = true; log('first audio received'); }
          playPcm16(b64);
        }
        break;
      }
      case 'user_transcript': {
        const t = msg.user_transcription_event?.user_transcript;
        if (t) { log('user:', t.slice(0, 60)); transcript.push({ role: 'user', content: t }); try { onUserText(t); } catch {} }
        break;
      }
      case 'agent_response': {
        const t = msg.agent_response_event?.agent_response;
        if (t) { log('agent:', t.slice(0, 60)); transcript.push({ role: 'assistant', content: t }); try { onAgentText(t); } catch {} }
        break;
      }
      case 'interruption':
        stopPlayback();
        break;
      case 'ping': {
        const id = msg.ping_event?.event_id;
        try { ws.send(JSON.stringify({ type: 'pong', event_id: id })); } catch {}
        break;
      }
      default:
        log('msg', msg.type);
        break;
    }
  }

  function teardown() {
    stopped = true;
    try { if (processor) processor.onaudioprocess = null; } catch {}
    try { if (processor) processor.disconnect(); } catch {}
    try { if (sink) sink.disconnect(); } catch {}
    try { if (sourceNode) sourceNode.disconnect(); } catch {}
    stopPlayback();
    try { if (micStream) micStream.getTracks().forEach((t) => t.stop()); } catch {}
    try { if (audioCtx) audioCtx.close(); } catch {}
    try { if (ws && ws.readyState <= 1) ws.close(); } catch {}
    ws = null; audioCtx = null; micStream = null; processor = null; sourceNode = null; sink = null;
  }

  function finish() {
    if (finished) return;
    finished = true;
    teardown();
    setStatus('ended');
    try { onEnd({ transcript, conversationId }); } catch {}
  }

  // Pause/resume without tearing down the connection: while paused we stop
  // streaming the mic up AND stop playing the customer's audio down (and cut any
  // in-progress playback). On resume, both flow again.
  function setPaused(p) {
    paused = !!p;
    if (paused) stopPlayback();
  }

  return {
    start,
    stop: finish,
    setPaused,
    isPaused: () => paused,
    getTranscript: () => transcript.slice(),
    getConversationId: () => conversationId,
  };
}

// ---- helpers --------------------------------------------------------------
function b64ToBytes(b64) {
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function downsample(input, inRate, outRate) {
  if (!inRate || outRate >= inRate) return input;
  const ratio = inRate / outRate;
  const newLen = Math.floor(input.length / ratio);
  const out = new Float32Array(newLen);
  for (let i = 0; i < newLen; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0, n = 0;
    for (let j = start; j < end; j++) { sum += input[j]; n++; }
    out[i] = n ? sum / n : 0;
  }
  return out;
}

function floatToPcm16Base64(float) {
  const int16 = new Int16Array(float.length);
  for (let i = 0; i < float.length; i++) {
    const s = Math.max(-1, Math.min(1, float[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(int16.buffer);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

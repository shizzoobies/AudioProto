export class AudioPlayer {
  constructor({ onStart, onEnd, onError } = {}) {
    this.audioContext = null;
    this.analyser = null;
    this.queue = [];
    this.decoding = 0;
    this.playing = false;
    this.cancelled = false;
    this.muted = false;
    this.currentSource = null;
    this.onStart = onStart;
    this.onEnd = onEnd;
    this.onError = onError;
  }

  _ensureContext() {
    if (!this.audioContext) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) throw new Error('audio_context_unsupported');
      this.audioContext = new Ctx();
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 128;
      this.analyser.smoothingTimeConstant = 0.78;
      this.analyser.connect(this.audioContext.destination);
    }
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume().catch(() => {});
    }
    return this.audioContext;
  }

  getAnalyser() {
    this._ensureContext();
    return this.analyser;
  }

  setMuted(muted) {
    this.muted = !!muted;
    if (this.muted) this.cancel();
  }

  isMuted() {
    return this.muted;
  }

  async enqueueBlob(blob, onSegmentStart = null) {
    if (this.muted || this.cancelled) return;
    try {
      this._ensureContext();
    } catch (err) {
      this.onError?.(err);
      return;
    }
    this.decoding++;
    try {
      const arrayBuffer = await blob.arrayBuffer();
      const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
      if (this.cancelled || this.muted) return;
      this.queue.push({ buffer: audioBuffer, onSegmentStart });
      this._maybeStart();
    } catch (err) {
      this.onError?.(err);
    } finally {
      this.decoding--;
    }
  }

  _maybeStart() {
    if (this.playing) return;
    if (this.queue.length === 0) return;
    this.playing = true;
    this.onStart?.();
    this._playNext();
  }

  _playNext() {
    if (this.cancelled) {
      this.playing = false;
      this.currentSource = null;
      this.onEnd?.();
      return;
    }
    if (this.queue.length === 0) {
      if (this.decoding > 0) {
        setTimeout(() => this._playNext(), 60);
        return;
      }
      this.playing = false;
      this.currentSource = null;
      this.onEnd?.();
      return;
    }
    const item = this.queue.shift();
    const buffer = item.buffer;
    const onSegmentStart = item.onSegmentStart;
    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(this.analyser);
    source.onended = () => {
      if (this.currentSource === source) {
        this.currentSource = null;
        this._playNext();
      }
    };
    try {
      source.start();
      this.currentSource = source;
      try { onSegmentStart?.(); } catch (err) { /* swallow callback errors */ }
    } catch (err) {
      this.onError?.(err);
      this._playNext();
    }
  }

  cancel() {
    this.queue = [];
    if (this.currentSource) {
      try {
        this.currentSource.onended = null;
        this.currentSource.stop();
      } catch {}
      this.currentSource = null;
    }
    if (this.playing) {
      this.playing = false;
      this.onEnd?.();
    }
  }

  isBusy() {
    return this.playing || this.decoding > 0 || this.queue.length > 0;
  }

  destroy() {
    this.cancelled = true;
    this.cancel();
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
      this.analyser = null;
    }
  }
}

// Procedural ambient room-tone bed, played under the showcase persona's
// voice so she feels like she's in a real space. Pure Web Audio - no
// asset files, so it stays CSP-clean and dependency-free. A brown-noise
// bed heavily low-passed into a warm room rumble, with a slow LFO
// breathing the level so it never sounds like flat static. Kept very
// quiet so it never competes with her voice or buries an identifier the
// trainee needs to copy down. Its own AudioContext, separate from the
// voice player, so it never feeds the orb's analyser.
export class AmbientBed {
  constructor({ level = 0.06 } = {}) {
    this.level = level;
    this.ctx = null;
    this.master = null;
    this.source = null;
    this.lfo = null;
    this.started = false;
    this.muted = false;
  }

  start() {
    if (this.started) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    try {
      this.ctx = new Ctx();
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});

      const seconds = 4;
      const len = Math.floor(this.ctx.sampleRate * seconds);
      const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1;
        last = (last + 0.02 * white) / 1.02;
        data[i] = last * 3.2;
      }

      this.source = this.ctx.createBufferSource();
      this.source.buffer = buffer;
      this.source.loop = true;

      const hp = this.ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 40;

      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 480;
      lp.Q.value = 0.4;

      this.master = this.ctx.createGain();
      this.master.gain.value = 0;

      // Slow breath so the bed has life.
      this.lfo = this.ctx.createOscillator();
      this.lfo.frequency.value = 0.07;
      const lfoGain = this.ctx.createGain();
      lfoGain.gain.value = this.level * 0.3;
      this.lfo.connect(lfoGain).connect(this.master.gain);

      this.source.connect(hp).connect(lp).connect(this.master).connect(this.ctx.destination);
      this.source.start();
      this.lfo.start();

      const now = this.ctx.currentTime;
      this.master.gain.setValueAtTime(0, now);
      this.master.gain.linearRampToValueAtTime(this.muted ? 0 : this.level, now + 1.5);

      this.started = true;
    } catch {
      this.stop();
    }
  }

  setMuted(muted) {
    this.muted = !!muted;
    if (!this.ctx || !this.master) return;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.linearRampToValueAtTime(this.muted ? 0 : this.level, now + 0.4);
  }

  stop() {
    try { this.source?.stop(); } catch {}
    try { this.lfo?.stop(); } catch {}
    try { this.ctx?.close(); } catch {}
    this.ctx = null;
    this.master = null;
    this.source = null;
    this.lfo = null;
    this.started = false;
  }
}

export function attachVisualizer(canvas, getAnalyser, { barCount = 32, color = '#f5a524', getColor } = {}) {
  const ctx = canvas.getContext('2d');
  let rafId = null;
  const fallback = new Uint8Array(64);

  const dpr = window.devicePixelRatio || 1;
  function resize() {
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, rect.width * dpr);
    canvas.height = Math.max(1, rect.height * dpr);
  }
  resize();
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);

  function draw() {
    rafId = requestAnimationFrame(draw);
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    let analyser = null;
    try {
      analyser = getAnalyser();
    } catch {
      analyser = null;
    }

    const freq = analyser ? new Uint8Array(analyser.frequencyBinCount) : fallback;
    if (analyser) analyser.getByteFrequencyData(freq);

    const currentColor = (typeof getColor === 'function' ? getColor() : null) || color;

    const gap = 3 * dpr;
    const barW = Math.max(1, (w - gap * (barCount - 1)) / barCount);
    const step = Math.max(1, Math.floor(freq.length / barCount));
    const minBar = h * 0.08;

    for (let i = 0; i < barCount; i++) {
      const v = (freq[i * step] || 0) / 255;
      const barH = Math.max(minBar, v * h * 0.95);
      const x = i * (barW + gap);
      const y = (h - barH) / 2;
      ctx.fillStyle = currentColor;
      ctx.globalAlpha = 0.25 + v * 0.75;
      const radius = Math.min(barW / 2, 2 * dpr);
      roundedRect(ctx, x, y, barW, barH, radius);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  draw();

  return () => {
    if (rafId) cancelAnimationFrame(rafId);
    resizeObserver.disconnect();
  };
}

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export async function synthesizeSentence({ scenarioId, text, signal }) {
  const res = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenario_id: scenarioId, text }),
    credentials: 'same-origin',
    signal,
  });
  if (!res.ok) {
    let detail = `http_${res.status}`;
    try {
      const data = await res.json();
      if (data?.error) detail = data.error;
    } catch {}
    throw new Error(detail);
  }
  return res.blob();
}

export class MicRecorder {
  constructor() {
    this.stream = null;
    this.recorder = null;
    this.chunks = [];
    this.mimeType = null;
    this.audioContext = null;
    this.sourceNode = null;
    this.analyser = null;
  }

  isRecording() {
    return !!this.recorder && this.recorder.state === 'recording';
  }

  getAnalyser() {
    return this.analyser;
  }

  async start() {
    if (this.recorder) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('mic_unsupported');
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      throw new Error(err?.name === 'NotAllowedError' ? 'mic_denied' : 'mic_unavailable');
    }
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4',
    ];
    let mimeType = '';
    for (const c of candidates) {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c)) {
        mimeType = c;
        break;
      }
    }
    this.mimeType = mimeType || '';
    this.recorder = mimeType ? new MediaRecorder(this.stream, { mimeType }) : new MediaRecorder(this.stream);
    this.chunks = [];
    this.recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };

    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) {
        this.audioContext = new Ctx();
        if (this.audioContext.state === 'suspended') this.audioContext.resume().catch(() => {});
        this.sourceNode = this.audioContext.createMediaStreamSource(this.stream);
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 128;
        this.analyser.smoothingTimeConstant = 0.7;
        this.sourceNode.connect(this.analyser);
      }
    } catch {
      this.analyser = null;
    }

    this.recorder.start();
  }

  async stop() {
    if (!this.recorder) return null;
    if (this.recorder.state === 'inactive') {
      this._cleanup();
      return null;
    }
    return new Promise((resolve) => {
      const finalize = () => {
        const type = this.recorder?.mimeType || this.mimeType || 'audio/webm';
        const blob = new Blob(this.chunks, { type });
        this._cleanup();
        resolve(blob);
      };
      this.recorder.onstop = finalize;
      try {
        this.recorder.stop();
      } catch {
        finalize();
      }
    });
  }

  cancel() {
    if (this.recorder && this.recorder.state !== 'inactive') {
      try {
        this.recorder.onstop = null;
        this.recorder.stop();
      } catch {}
    }
    this._cleanup();
  }

  _cleanup() {
    if (this.sourceNode) {
      try { this.sourceNode.disconnect(); } catch {}
      this.sourceNode = null;
    }
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    this.analyser = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.recorder = null;
    this.chunks = [];
  }
}

export class ContinuousRecorder {
  constructor({ onSpeechStart, onSpeechEnd, onError } = {}) {
    this.onSpeechStart = onSpeechStart;
    this.onSpeechEnd = onSpeechEnd;
    this.onError = onError;
    this.stream = null;
    this.recorder = null;
    this.audioContext = null;
    this.analyser = null;
    this.sourceNode = null;
    this.dataArray = null;
    this.rafId = null;
    this.state = 'idle';
    this.chunks = [];
    this.mimeType = null;
    this.speechStartTime = null;
    this.silenceStartTime = null;
    this.SILENCE_RMS = 0.012;
    this.SILENCE_DURATION_MS = 1400;
    this.MIN_SPEECH_DURATION_MS = 450;
    this.MAX_RECORDING_MS = 25000;
  }

  isActive() {
    return this.state !== 'idle' && this.state !== 'ending';
  }

  isSpeaking() {
    return this.state === 'speaking';
  }

  getAnalyser() {
    return this.analyser;
  }

  async start() {
    if (this.state !== 'idle') return;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('mic_unsupported');
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      throw new Error(err?.name === 'NotAllowedError' ? 'mic_denied' : 'mic_unavailable');
    }
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
    let mimeType = '';
    for (const c of candidates) {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c)) {
        mimeType = c;
        break;
      }
    }
    this.mimeType = mimeType || '';
    this.recorder = mimeType ? new MediaRecorder(this.stream, { mimeType }) : new MediaRecorder(this.stream);
    this.chunks = [];
    this.recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.start();

    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new Ctx();
      if (this.audioContext.state === 'suspended') this.audioContext.resume().catch(() => {});
      this.sourceNode = this.audioContext.createMediaStreamSource(this.stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.smoothingTimeConstant = 0.4;
      this.dataArray = new Uint8Array(this.analyser.fftSize);
      this.sourceNode.connect(this.analyser);
    } catch (err) {
      this.onError?.(err);
    }

    this.state = 'listening';
    this.speechStartTime = null;
    this.silenceStartTime = null;
    this._tick();
  }

  _tick() {
    if (this.state === 'idle' || this.state === 'ending') return;
    this.rafId = requestAnimationFrame(() => this._tick());
    if (!this.analyser || !this.dataArray) return;

    this.analyser.getByteTimeDomainData(this.dataArray);
    let sumSq = 0;
    for (let i = 0; i < this.dataArray.length; i++) {
      const v = (this.dataArray[i] - 128) / 128;
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / this.dataArray.length);
    const now = performance.now();

    if (rms > this.SILENCE_RMS) {
      if (this.state === 'listening') {
        this.state = 'speaking';
        this.speechStartTime = now;
        this.onSpeechStart?.();
      }
      this.silenceStartTime = null;
    } else if (this.state === 'speaking') {
      if (this.silenceStartTime === null) {
        this.silenceStartTime = now;
      } else if (now - this.silenceStartTime >= this.SILENCE_DURATION_MS) {
        const duration = this.silenceStartTime - this.speechStartTime;
        if (duration >= this.MIN_SPEECH_DURATION_MS) {
          this._finalize();
          return;
        }
        this.state = 'listening';
        this.speechStartTime = null;
        this.silenceStartTime = null;
      }
    }

    if (this.state === 'speaking' && this.speechStartTime && now - this.speechStartTime >= this.MAX_RECORDING_MS) {
      this._finalize();
    }
  }

  _finalize() {
    if (this.state === 'ending' || this.state === 'idle') return;
    this.state = 'ending';
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    const emit = () => {
      const type = this.mimeType || 'audio/webm';
      const blob = new Blob(this.chunks, { type });
      const callback = this.onSpeechEnd;
      this._cleanup();
      callback?.(blob);
    };
    if (this.recorder && this.recorder.state !== 'inactive') {
      this.recorder.onstop = emit;
      try { this.recorder.stop(); } catch { emit(); }
    } else {
      emit();
    }
  }

  cancel() {
    if (this.state === 'idle') return;
    this.state = 'ending';
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.recorder && this.recorder.state !== 'inactive') {
      try {
        this.recorder.onstop = null;
        this.recorder.stop();
      } catch {}
    }
    this._cleanup();
  }

  _cleanup() {
    if (this.sourceNode) {
      try { this.sourceNode.disconnect(); } catch {}
      this.sourceNode = null;
    }
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    this.analyser = null;
    this.dataArray = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.recorder = null;
    this.chunks = [];
    this.state = 'idle';
  }
}

export async function transcribeAudio(blob, { signal } = {}) {
  if (!blob || blob.size === 0) {
    throw new Error('empty_recording');
  }
  const form = new FormData();
  const ext = (blob.type.split(';')[0] || '').split('/')[1] || 'webm';
  form.append('audio', blob, `recording.${ext}`);
  const res = await fetch('/api/stt', {
    method: 'POST',
    body: form,
    credentials: 'same-origin',
    signal,
  });
  if (!res.ok) {
    let detail = `http_${res.status}`;
    try {
      const data = await res.json();
      if (data?.error) detail = data.error;
    } catch {}
    throw new Error(detail);
  }
  const data = await res.json();
  return data?.transcript || '';
}

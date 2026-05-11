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

  async enqueueBlob(blob) {
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
      this.queue.push(audioBuffer);
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
    const buffer = this.queue.shift();
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

export function attachVisualizer(canvas, getAnalyser, { barCount = 32, color = '#f5a524' } = {}) {
  let analyser = null;
  const ctx = canvas.getContext('2d');
  let rafId = null;
  const data = new Uint8Array(64);

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

    if (!analyser) {
      try {
        analyser = getAnalyser();
      } catch {
        analyser = null;
      }
    }

    const freq = new Uint8Array(analyser ? analyser.frequencyBinCount : data.length);
    if (analyser) analyser.getByteFrequencyData(freq);

    const gap = 3 * dpr;
    const barW = Math.max(1, (w - gap * (barCount - 1)) / barCount);
    const step = Math.max(1, Math.floor(freq.length / barCount));
    const minBar = h * 0.08;

    for (let i = 0; i < barCount; i++) {
      const v = (freq[i * step] || 0) / 255;
      const barH = Math.max(minBar, v * h * 0.95);
      const x = i * (barW + gap);
      const y = (h - barH) / 2;
      ctx.fillStyle = color;
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

export class Conversation {
  constructor({ scenario, onAssistantDelta, onAssistantStart, onAssistantEnd, onSentence, onError, onMode }) {
    this.scenario = scenario;
    this.messages = [];
    this.controller = null;
    this.streaming = false;
    this.cancelled = false;
    this._sentenceBuffer = '';
    this.onAssistantDelta = onAssistantDelta;
    this.onAssistantStart = onAssistantStart;
    this.onAssistantEnd = onAssistantEnd;
    this.onSentence = onSentence;
    this.onError = onError;
    this.onMode = onMode;
  }

  isStreaming() {
    return this.streaming;
  }

  getMessages() {
    return this.messages.slice();
  }

  cancel() {
    this.cancelled = true;
    if (this.controller) {
      this.controller.abort();
      this.controller = null;
    }
    this.streaming = false;
  }

  async sendUserMessage(text) {
    const content = (text || '').trim();
    if (!content) return;
    if (this.streaming) return;

    this.messages.push({ role: 'user', content });
    await this._stream();
  }

  async _stream() {
    this.streaming = true;
    this.controller = new AbortController();
    this._sentenceBuffer = '';
    let rawBuffer = '';
    let started = false;

    // Mode marker parsing. The showcase persona prefixes turns where she
    // transitions between meta-chat and customer-roleplay with
    // [mode:scenario] or [mode:meta]. We keep the marker in rawBuffer (so
    // the model sees it in conversation history) but strip it from the
    // delta/sentence callbacks so it never reaches the transcript or TTS.
    let modeChecked = false;
    let pendingPrefix = '';

    const emitDelta = (text) => {
      if (!text) return;
      if (!started) {
        started = true;
        this.onAssistantStart?.();
      }
      this.onAssistantDelta?.(text);
      this._flushSentences(text);
    };

    const consume = (text) => {
      if (!text) return;
      if (modeChecked) {
        emitDelta(text);
        return;
      }
      pendingPrefix += text;
      const trimmed = pendingPrefix.replace(/^\s+/, '');
      if (trimmed.length === 0) return;
      if (!trimmed.startsWith('[')) {
        modeChecked = true;
        emitDelta(pendingPrefix);
        pendingPrefix = '';
        return;
      }
      const match = trimmed.match(/^\[mode:(scenario|meta)\]\s?([\s\S]*)$/);
      if (match) {
        try { this.onMode?.(match[1]); } catch {}
        modeChecked = true;
        const remainder = match[2];
        pendingPrefix = '';
        if (remainder) emitDelta(remainder);
        return;
      }
      if (trimmed.includes(']') || pendingPrefix.length > 32) {
        modeChecked = true;
        emitDelta(pendingPrefix);
        pendingPrefix = '';
      }
    };

    const flushPending = () => {
      if (modeChecked || !pendingPrefix) return;
      emitDelta(pendingPrefix);
      pendingPrefix = '';
      modeChecked = true;
    };

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scenario_id: this.scenario.id,
          messages: this.messages,
        }),
        credentials: 'same-origin',
        signal: this.controller.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'unknown' }));
        throw new Error(err.error || `http_${res.status}`);
      }
      if (!res.body) {
        throw new Error('no_response_body');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let pending = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        pending += decoder.decode(value, { stream: true });

        let idx;
        while ((idx = pending.indexOf('\n\n')) >= 0) {
          const rawEvent = pending.slice(0, idx);
          pending = pending.slice(idx + 2);
          if (!rawEvent.startsWith('data: ')) continue;
          const data = rawEvent.slice(6);
          if (data === '[DONE]') {
            flushPending();
            this._finishAssistant(rawBuffer);
            return;
          }
          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch {
            continue;
          }
          if (parsed.type === 'text_delta' && typeof parsed.text === 'string') {
            rawBuffer += parsed.text;
            consume(parsed.text);
          } else if (parsed.type === 'error') {
            throw new Error(parsed.message || 'stream_error');
          }
        }
      }
      flushPending();
      this._finishAssistant(rawBuffer);
    } catch (err) {
      if (err?.name === 'AbortError') {
        return;
      }
      if (!this.cancelled) {
        this.onError?.(err);
      }
    } finally {
      this.streaming = false;
      this.controller = null;
    }
  }

  _finishAssistant(text) {
    if (this.cancelled) return;
    const remainder = this._sentenceBuffer.trim();
    if (remainder) {
      this.onSentence?.(remainder);
    }
    this._sentenceBuffer = '';
    const trimmed = (text || '').trim();
    if (trimmed) {
      this.messages.push({ role: 'assistant', content: trimmed });
    }
    this.streaming = false;
    this.onAssistantEnd?.(trimmed);
  }

  _flushSentences(deltaText) {
    if (!this.onSentence) return;
    this._sentenceBuffer += deltaText;
    const boundary = /[.?!]+\s+/;
    while (true) {
      const match = this._sentenceBuffer.match(boundary);
      if (!match) break;
      const end = match.index + match[0].length;
      const sentence = this._sentenceBuffer.slice(0, end).trim();
      this._sentenceBuffer = this._sentenceBuffer.slice(end);
      if (sentence.length >= 2) {
        this.onSentence(sentence);
      }
    }
  }
}

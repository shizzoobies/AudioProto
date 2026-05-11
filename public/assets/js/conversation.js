export class Conversation {
  constructor({ scenario, onAssistantDelta, onAssistantStart, onAssistantEnd, onError }) {
    this.scenario = scenario;
    this.messages = [];
    this.controller = null;
    this.streaming = false;
    this.cancelled = false;
    this.onAssistantDelta = onAssistantDelta;
    this.onAssistantStart = onAssistantStart;
    this.onAssistantEnd = onAssistantEnd;
    this.onError = onError;
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
    let buffer = '';
    let started = false;

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
            this._finishAssistant(buffer);
            return;
          }
          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch {
            continue;
          }
          if (parsed.type === 'text_delta' && typeof parsed.text === 'string') {
            if (!started) {
              started = true;
              this.onAssistantStart?.();
            }
            buffer += parsed.text;
            this.onAssistantDelta?.(parsed.text);
          } else if (parsed.type === 'error') {
            throw new Error(parsed.message || 'stream_error');
          }
        }
      }
      this._finishAssistant(buffer);
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
    const trimmed = (text || '').trim();
    if (trimmed) {
      this.messages.push({ role: 'assistant', content: trimmed });
    }
    this.streaming = false;
    this.onAssistantEnd?.(trimmed);
  }
}

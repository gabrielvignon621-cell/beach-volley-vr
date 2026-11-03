/** Barramento de eventos mínimo para desacoplar física, efeitos, áudio e regras. */
export class EventBus {
  #handlers = new Map();

  on(type, handler) {
    if (!this.#handlers.has(type)) this.#handlers.set(type, new Set());
    this.#handlers.get(type).add(handler);
    return () => this.#handlers.get(type)?.delete(handler);
  }

  emit(type, payload) {
    const handlers = this.#handlers.get(type);
    if (!handlers) return;
    for (const handler of handlers) handler(payload);
  }
}

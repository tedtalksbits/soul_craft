/** A per-tick outbox: producers emit during a tick, one consumer drains afterwards. */
export class EventQueue<E> {
  private items: E[] = [];

  emit(event: E): void {
    this.items.push(event);
  }

  drain(): E[] {
    const out = this.items;
    this.items = [];
    return out;
  }
}

/** Petit bus d'événements typé pour découpler simulation et interface. */
type Handler<T> = (payload: T) => void;

export class EventBus<Events extends Record<string, unknown>> {
  private handlers: { [K in keyof Events]?: Handler<Events[K]>[] } = {};
  on<K extends keyof Events>(type: K, h: Handler<Events[K]>): () => void {
    (this.handlers[type] ??= []).push(h);
    return () => {
      this.handlers[type] = this.handlers[type]!.filter((x) => x !== h);
    };
  }
  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    for (const h of this.handlers[type] ?? []) h(payload);
  }
}

/**
 * 极简、类型安全、零依赖的事件发射器(浏览器 & Node 通用)。
 */
export type Listener<T = any> = (payload: T) => void;

export class TypedEmitter<E extends Record<string, any> = Record<string, any>> {
  private map: { [K in keyof E]?: Set<Listener<E[K]>> } = {};

  on<K extends keyof E>(event: K, fn: Listener<E[K]>): () => void {
    (this.map[event] ??= new Set()).add(fn);
    return () => this.off(event, fn);
  }

  once<K extends keyof E>(event: K, fn: Listener<E[K]>): () => void {
    const wrap: Listener<E[K]> = (p) => {
      this.off(event, wrap);
      fn(p);
    };
    return this.on(event, wrap);
  }

  off<K extends keyof E>(event: K, fn: Listener<E[K]>): void {
    this.map[event]?.delete(fn);
  }

  protected emit<K extends keyof E>(event: K, payload: E[K]): void {
    const set = this.map[event];
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (err) {
        console.error('[notify-panel] listener error:', err);
      }
    }
  }

  removeAllListeners(): void {
    this.map = {};
  }
}

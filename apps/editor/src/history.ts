/** Command-stack undo/redo over immutable snapshots. Typing in the same field within `windowMs` is one undo step. */
export class History<T> {
  private past: T[] = [];
  private future: T[] = [];
  private lastKey: string | null = null;
  private lastAt = 0;
  constructor(public present: T, private windowMs = 1200, private max = 200) {}

  push(next: T, key?: string, now = Date.now()): void {
    if (next === this.present) return;
    const merge = key != null && key === this.lastKey && now - this.lastAt < this.windowMs && this.past.length > 0;
    if (!merge) {
      this.past.push(this.present);
      if (this.past.length > this.max) this.past.shift();
    }
    this.present = next;
    this.future = [];
    this.lastKey = key ?? null;
    this.lastAt = now;
  }
  /** Change the present without an undo step (refit, rev numbers, restore of saved state). */
  replace(next: T): void {
    this.present = next;
  }
  undo(): T | null {
    const p = this.past.pop();
    if (p === undefined) return null;
    this.future.push(this.present);
    this.present = p;
    this.lastKey = null;
    return p;
  }
  redo(): T | null {
    const n = this.future.pop();
    if (n === undefined) return null;
    this.past.push(this.present);
    this.present = n;
    this.lastKey = null;
    return n;
  }
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
}

export type TouchVector = { x: number; z: number; stealth: boolean };
export type GestureState = {
  active: boolean; slow: boolean; originX: number; originY: number; x: number; y: number;
};
type Contact = { x: number; y: number; startX: number; startY: number; started: number; travelled: number };
export const EMPTY_GESTURE: GestureState = { active: false, slow: false, originX: 0, originY: 0, x: 0, y: 0 };

/** Touch-only input model shared by the browser hook and deterministic tests. */
export class TouchNavigation {
  private contacts = new Map<number, Contact>();
  private movementId: number | null = null;
  private radius = 84;
  vector: TouchVector = { x: 0, z: 0, stealth: false };
  gesture: GestureState = { ...EMPTY_GESTURE };

  get ids() { return [...this.contacts.keys()]; }

  begin(id: number, type: string, x: number, y: number, time: number, viewportWidth: number): boolean {
    if (type !== 'touch') return false;
    this.contacts.set(id, { x, y, startX: x, startY: y, started: time, travelled: 0 });
    if (this.movementId === null) {
      this.movementId = id;
      this.radius = Math.max(60, Math.min(100, viewportWidth * 0.22));
      this.gesture = { ...EMPTY_GESTURE, originX: x, originY: y, x, y };
    }
    return true;
  }

  move(id: number, x: number, y: number): void {
    const p = this.contacts.get(id);
    if (!p) return;
    p.x = x; p.y = y;
    const dx = x - p.startX, dy = y - p.startY;
    const distance = Math.hypot(dx, dy);
    p.travelled = Math.max(p.travelled, distance);
    if (id !== this.movementId) return;
    const strength = distance <= 10 ? 0 : Math.min(1, (distance - 10) / (this.radius - 10));
    const slow = strength > 0 && strength < 0.5;
    this.vector = { x: distance ? dx / distance * strength : 0, z: distance ? dy / distance * strength : 0, stealth: slow };
    this.gesture = { active: strength > 0, slow, originX: p.startX, originY: p.startY, x, y };
  }

  /** Returns true only for a short, unmoved touch release (including a second finger). */
  end(id: number, time: number, cancelled = false): boolean {
    const p = this.contacts.get(id);
    if (!p) return false;
    const tap = !cancelled && p.travelled <= 10 && time - p.started <= 350;
    this.contacts.delete(id);
    if (id === this.movementId) {
      this.movementId = null;
      this.vector = { x: 0, z: 0, stealth: false };
      this.gesture = { ...EMPTY_GESTURE };
    }
    return tap;
  }

  reset(): void {
    this.contacts.clear();
    this.movementId = null;
    this.vector = { x: 0, z: 0, stealth: false };
    this.gesture = { ...EMPTY_GESTURE };
  }
}

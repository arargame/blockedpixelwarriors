/**
 * Unified input: keyboard (WASD / arrows), mouse drag and touch drag.
 * Exposes a normalized move vector in world XZ (screen-up = -Z).
 * Drag is relative ("virtual joystick anywhere"), which works on phones and desktop alike.
 */
export class Input {
  constructor(element) {
    this.element = element;
    this.keys = new Set();
    this.pointerId = null;
    this.dragStart = { x: 0, y: 0 };
    this.dragVector = { x: 0, y: 0 };
    this.move = { x: 0, z: 0 };
    /** Keyboard pilot input in the helicopter's own frame (see update()). */
    this.pilot = { forward: 0, strafe: 0, turn: 0, active: false };
    this.dragging = false;
    this.fireHeld = true; // auto-fire by default (mobile friendly)
    this.listeners = [];
    this.onAnyAction = null;

    this.listen(window, 'keydown', (e) => {
      this.keys.add(e.code);
      this.onAnyAction?.(e);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'].includes(e.code)) e.preventDefault();
    });
    this.listen(window, 'keyup', (e) => this.keys.delete(e.code));
    this.listen(window, 'blur', () => this.keys.clear());
    this.listen(element, 'pointerdown', (e) => {
      this.onAnyAction?.(e);
      if (this.pointerId !== null) return;
      this.pointerId = e.pointerId;
      this.dragStart = { x: e.clientX, y: e.clientY };
      this.dragVector = { x: 0, y: 0 };
      element.setPointerCapture?.(e.pointerId);
    });
    this.listen(element, 'pointermove', (e) => {
      if (e.pointerId !== this.pointerId) return;
      const scale = Math.min(window.innerWidth, window.innerHeight) * 0.12;
      let dx = (e.clientX - this.dragStart.x) / scale;
      let dy = (e.clientY - this.dragStart.y) / scale;
      const len = Math.hypot(dx, dy);
      if (len > 1) {
        // Joystick origin follows the finger so reversing direction is instant.
        this.dragStart.x = e.clientX - (dx / len) * scale;
        this.dragStart.y = e.clientY - (dy / len) * scale;
        dx /= len;
        dy /= len;
      }
      this.dragVector = { x: dx, y: dy };
    });
    const end = (e) => {
      if (e.pointerId !== this.pointerId) return;
      this.pointerId = null;
      this.dragVector = { x: 0, y: 0 };
    };
    this.listen(element, 'pointerup', end);
    this.listen(element, 'pointercancel', end);
  }

  listen(target, type, handler) {
    target.addEventListener(type, handler, { passive: false });
    this.listeners.push(() => target.removeEventListener(type, handler));
  }

  /**
   * Keyboard = helicopter-relative ("pilot") controls:
   *   W  forward along the nose      S  backward along the tail
   *   A  strafe to the heli's left   D  strafe to the heli's right
   *   Left / Right arrows (or Q / E)  turn (yaw) left / right
   * Touch / mouse drag = screen-relative joystick (the nose follows the drag direction).
   */
  update() {
    const k = this.keys;
    const has = (...codes) => codes.some((c) => k.has(c));
    let forward = (has('KeyW') ? 1 : 0) - (has('KeyS') ? 1 : 0);
    let strafe = (has('KeyD') ? 1 : 0) - (has('KeyA') ? 1 : 0);
    const len = Math.hypot(forward, strafe);
    if (len > 1) {
      forward /= len;
      strafe /= len;
    }
    this.pilot.forward = forward;
    this.pilot.strafe = strafe;
    // Turning: Left/Right arrows (Q/E also work). Up/Down arrows are unused.
    this.pilot.turn = (has('KeyQ', 'ArrowLeft') ? 1 : 0) - (has('KeyE', 'ArrowRight') ? 1 : 0);
    this.pilot.active = forward !== 0 || strafe !== 0 || this.pilot.turn !== 0;

    let x = this.dragVector.x;
    let z = this.dragVector.y;
    const dl = Math.hypot(x, z);
    if (dl > 1) {
      x /= dl;
      z /= dl;
    }
    this.move.x = x;
    this.move.z = z;
    this.dragging = this.pointerId !== null && dl > 0.05;
  }

  dispose() {
    this.listeners.forEach((off) => off());
  }
}

// Keyboard + mouse input. Actions are bound to KeyboardEvent.code values
// (layout independent), e.g. input.onKey('KeyC', () => ...).
export class InputManager {
  constructor(canvas) {
    this.down = new Set();
    this.bindings = new Map();
    this.mouse = { dx: 0, dy: 0, dragging: false };
    this.wheelHandler = null;
    this.enabled = true;

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      this.down.add(e.code);
      if (e.repeat) return;
      const action = this.bindings.get(e.code);
      if (action && (this.enabled || e.code === 'Escape')) action();
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());

    // Dragging on the 3D view (mouse or finger) turns the orbit / free camera.
    let dragPointer = null;
    let last = null;
    canvas.addEventListener('pointerdown', (e) => {
      dragPointer = e.pointerId;
      last = { x: e.clientX, y: e.clientY };
      this.mouse.dragging = true;
    });
    window.addEventListener('pointermove', (e) => {
      if (e.pointerId !== dragPointer) return;
      this.mouse.dx += e.clientX - last.x;
      this.mouse.dy += e.clientY - last.y;
      last = { x: e.clientX, y: e.clientY };
    });
    const endDrag = (e) => {
      if (e.pointerId !== dragPointer) return;
      dragPointer = null;
      this.mouse.dragging = false;
    };
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (this.enabled && this.wheelHandler) this.wheelHandler(e.deltaY);
    }, { passive: false });
  }

  onKey(code, action) {
    this.bindings.set(code, action);
  }

  onWheel(handler) {
    this.wheelHandler = handler;
  }

  isDown(code) {
    return this.enabled && this.down.has(code);
  }

  consumeMouseDelta() {
    const delta = { dx: this.mouse.dx, dy: this.mouse.dy };
    this.mouse.dx = 0;
    this.mouse.dy = 0;
    return delta;
  }
}

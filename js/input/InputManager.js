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

    canvas.addEventListener('mousedown', () => { this.mouse.dragging = true; });
    window.addEventListener('mouseup', () => { this.mouse.dragging = false; });
    window.addEventListener('mousemove', (e) => {
      if (!this.mouse.dragging) return;
      this.mouse.dx += e.movementX;
      this.mouse.dy += e.movementY;
    });
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

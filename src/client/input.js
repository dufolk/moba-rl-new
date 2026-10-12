export class Input {
  constructor(el, handlers) {
    this.el = el;
    this.h = handlers;
    this.mouse = { x: window.innerWidth / 2, y: window.innerHeight / 2, inside: true };
    this.rightHeld = false;
    this.keys = new Set();
    this.attackMoveArmed = false;
    this.listeners = [];
    const on = (target, type, fn, opts) => {
      target.addEventListener(type, fn, opts);
      this.listeners.push([target, type, fn, opts]);
    };
    on(el, 'contextmenu', (e) => e.preventDefault());
    on(window, 'mousemove', (e) => {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      this.mouse.inside = true;
    });
    on(document, 'mouseleave', () => { this.mouse.inside = false; });
    on(el, 'mousedown', (e) => {
      if (e.button === 2) {
        this.rightHeld = true;
        this.attackMoveArmed = false;
        this.h.onRightDown?.(e);
      } else if (e.button === 0) {
        if (this.attackMoveArmed) {
          this.attackMoveArmed = false;
          this.h.onAttackMove?.(e);
        } else this.h.onLeftDown?.(e);
      }
    });
    on(window, 'mouseup', (e) => {
      if (e.button === 2) this.rightHeld = false;
    });
    on(el, 'wheel', (e) => {
      e.preventDefault();
      this.h.onWheel?.(Math.sign(e.deltaY));
    }, { passive: false });
    on(window, 'keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (['q', 'w', 'e', 'r', 'd', 'f', ' ', 'Tab', 'p', 'a', 's'].includes(k) || e.ctrlKey || e.altKey) e.preventDefault();
      const repeat = this.keys.has(k);
      this.keys.add(k);
      if (k === 'a' && !e.ctrlKey && !e.altKey) { this.attackMoveArmed = true; }
      if (k === 'Escape') this.attackMoveArmed = false;
      this.h.onKeyDown?.(k, e, repeat);
    });
    on(window, 'keyup', (e) => {
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      this.keys.delete(k);
      this.h.onKeyUp?.(k, e);
    });
    on(window, 'blur', () => { this.keys.clear(); this.rightHeld = false; });
  }

  dispose() {
    for (const [t, type, fn, opts] of this.listeners) t.removeEventListener(type, fn, opts);
  }
}

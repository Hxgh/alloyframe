type Pointer = {
  pointerId: number;
  clientX: number;
  clientY: number;
  button?: number;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
};

function modified(event: Pick<Pointer, "ctrlKey" | "metaKey" | "shiftKey" | "altKey">) {
  return event.ctrlKey || event.metaKey || event.shiftKey || event.altKey;
}

export function isSelectionClick(event: Pick<Pointer, "button" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey"> & { type: string }) {
  return event.type === "click" && (event.button ?? 0) === 0 && !modified(event);
}

/** 只把单指、小位移且未取消的完整手势当作轻点；回到起点也不算轻点。 */
export function createTapGesture(threshold = 8) {
  const pointers = new Map<number, { x: number; y: number }>();
  let moved = false;
  let allowed = false;

  function move(event: Pointer) {
    const start = pointers.get(event.pointerId);
    if (start && (modified(event) || Math.hypot(event.clientX - start.x, event.clientY - start.y) > threshold)) {
      moved = true;
    }
  }

  return {
    down(event: Pointer) {
      if (pointers.size === 0) moved = (event.button ?? 0) !== 0 || Boolean(modified(event));
      else moved = true;
      allowed = false;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    },
    move,
    up(event: Pointer) {
      if (!pointers.has(event.pointerId)) return;
      move(event);
      pointers.delete(event.pointerId);
      allowed = !moved && pointers.size === 0;
    },
    cancel(event: Pointer) {
      moved = true;
      allowed = false;
      pointers.delete(event.pointerId);
    },
    reset() {
      pointers.clear();
      moved = false;
      allowed = false;
    },
    isTap: () => allowed,
  };
}

type FullscreenState = {
  fullscreen: boolean;
  supported: boolean;
  busy: boolean;
  error: string;
};

const initialState: FullscreenState = { fullscreen: false, supported: false, busy: false, error: "" };
const fullscreenError = "浏览器未能切换全屏。可继续使用当前画布，或检查浏览器的全屏权限。";

function canEnterFullscreen(element: HTMLElement | null) {
  return Boolean(element?.ownerDocument.fullscreenEnabled && typeof element.requestFullscreen === "function"
    && typeof element.ownerDocument.exitFullscreen === "function");
}

export function createFullscreenController() {
  let element: HTMLElement | null = null;
  let state = initialState;
  let pending = false;
  const listeners = new Set<() => void>();

  function update(patch: Partial<Pick<FullscreenState, "busy" | "error">> = {}) {
    const next = {
      ...state,
      ...patch,
      fullscreen: Boolean(element && element.ownerDocument.fullscreenElement === element),
      supported: canEnterFullscreen(element),
    };
    if (next.fullscreen === state.fullscreen && next.supported === state.supported && next.busy === state.busy && next.error === state.error) return;
    state = next;
    for (const listener of listeners) listener();
  }

  const changed = () => update({ error: "" });
  const failed = (event: Event) => {
    if (event.target === element || event.target === element?.ownerDocument) update({ error: fullscreenError });
  };
  function listen(document: Document | undefined) {
    document?.addEventListener("fullscreenchange", changed);
    document?.addEventListener("fullscreenerror", failed);
  }
  function unlisten(document: Document | undefined) {
    document?.removeEventListener("fullscreenchange", changed);
    document?.removeEventListener("fullscreenerror", failed);
  }

  return {
    // 由稳定的 DOM ref 回调绑定，render 和服务端快照均不访问 DOM。
    setElement(next: HTMLElement | null) {
      if (element === next) return;
      if (listeners.size) unlisten(element?.ownerDocument);
      element = next;
      if (listeners.size) listen(element?.ownerDocument);
      update();
    },
    getSnapshot: () => state,
    getServerSnapshot: () => initialState,
    subscribe(onChange: () => void) {
      listeners.add(onChange);
      if (listeners.size === 1) listen(element?.ownerDocument);
      update();
      return () => {
        listeners.delete(onChange);
        if (!listeners.size) unlisten(element?.ownerDocument);
      };
    },
    async toggle() {
      const target = element;
      if (!target || pending) return;
      const document = target.ownerDocument;
      const exiting = document.fullscreenElement === target;
      if (!exiting && !canEnterFullscreen(target)) {
        update({ error: "当前浏览器不支持全屏。可继续使用当前画布。" });
        return;
      }
      // 同步加锁，避免 React 尚未更新按钮时重复请求；不乐观设置 fullscreen。
      pending = true;
      update({ busy: true, error: "" });
      try {
        if (exiting) await document.exitFullscreen();
        else await target.requestFullscreen();
        // 部分浏览器/API 包装可能 resolve 却没有切换，不能把它当作成功。
        if ((document.fullscreenElement === target) === exiting) throw new Error(fullscreenError);
      } catch {
        update({ error: fullscreenError });
      } finally {
        pending = false;
        update({ busy: false });
      }
    },
  };
}

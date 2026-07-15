(() => {
  window.__webShotCutterContentReady = true;
  let activeSelector = null;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "WSC_PING") {
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === "WSC_START_AREA_SELECTION") {
      startAreaSelection(message.sessionId);
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === "WSC_GET_PAGE_METRICS") {
      sendResponse({
        ok: true,
        metrics: {
          scrollX: window.scrollX,
          scrollY: window.scrollY,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          documentWidth: Math.max(
            document.documentElement.scrollWidth,
            document.body ? document.body.scrollWidth : 0
          ),
          documentHeight: Math.max(
            document.documentElement.scrollHeight,
            document.body ? document.body.scrollHeight : 0
          ),
          devicePixelRatio: window.devicePixelRatio || 1
        }
      });
      return false;
    }

    if (message.type === "WSC_SCROLL_TO") {
      window.scrollTo(message.x || 0, message.y || 0);
      setTimeout(() => {
        sendResponse({
          ok: true,
          scrollX: window.scrollX,
          scrollY: window.scrollY
        });
      }, message.delay || 350);
      return true;
    }

    return false;
  });

  function startAreaSelection(sessionId) {
    cleanupSelection();

    const style = document.createElement("style");
    const overlay = document.createElement("div");
    const box = document.createElement("div");
    const hint = document.createElement("div");

    style.textContent = `
      .wsc-overlay {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        cursor: crosshair;
        background: rgba(15, 23, 42, 0.18);
        user-select: none;
      }
      .wsc-box {
        position: fixed;
        display: none;
        min-width: 1px;
        min-height: 1px;
        border: 2px solid #0b7cff;
        background: rgba(11, 124, 255, 0.26);
        box-shadow:
          0 0 0 99999px rgba(0, 0, 0, 0.36),
          inset 0 0 0 1px rgba(255, 255, 255, 0.9);
        pointer-events: none;
      }
      .wsc-box::before,
      .wsc-box::after {
        content: "";
        position: absolute;
        width: 10px;
        height: 10px;
        background: #fff;
        border: 2px solid #0b7cff;
        border-radius: 50%;
      }
      .wsc-box::before {
        top: -7px;
        left: -7px;
      }
      .wsc-box::after {
        right: -7px;
        bottom: -7px;
      }
      .wsc-box.wsc-box-active {
        display: block;
      }
      .wsc-box.wsc-box-locked {
        border-color: #20c997;
        background: rgba(32, 201, 151, 0.28);
      }
      .wsc-box.wsc-box-locked::before,
      .wsc-box.wsc-box-locked::after {
        border-color: #20c997;
      }
      .wsc-hint {
        position: fixed;
        top: 16px;
        left: 50%;
        transform: translateX(-50%);
        padding: 8px 12px;
        border-radius: 6px;
        color: #fff;
        background: rgba(15, 23, 42, 0.94);
        font: 13px/1.4 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        pointer-events: none;
      }
    `;

    overlay.className = "wsc-overlay";
    box.className = "wsc-box";
    hint.className = "wsc-hint";
    hint.textContent = "드래그해서 캡처할 영역을 선택하세요. 취소: ESC";

    document.documentElement.append(style, overlay, box, hint);
    activeSelector = { style, overlay, box, hint };

    let startX = 0;
    let startY = 0;
    let dragging = false;
    let finished = false;

    overlay.addEventListener("mousedown", (event) => {
      dragging = true;
      startX = event.clientX;
      startY = event.clientY;
      box.classList.add("wsc-box-active");
      box.classList.remove("wsc-box-locked");
      drawBox(startX, startY, startX, startY);
    });

    overlay.addEventListener("mousemove", (event) => {
      if (!dragging) return;
      drawBox(startX, startY, event.clientX, event.clientY);
    });

    overlay.addEventListener("mouseup", (event) => {
      if (!dragging || finished) return;
      dragging = false;
      finished = true;

      const rect = normalizeRect(startX, startY, event.clientX, event.clientY);
      window.removeEventListener("keydown", onKeyDown, true);

      if (rect.width < 4 || rect.height < 4) {
        cleanupSelection();
        chrome.runtime.sendMessage({ type: "WSC_AREA_CANCELLED", sessionId });
        return;
      }

      box.classList.add("wsc-box-locked");
      hint.textContent = "선택 영역을 캡처합니다.";

      const payload = {
        type: "WSC_AREA_SELECTED",
        sessionId,
        rect,
        devicePixelRatio: window.devicePixelRatio || 1
      };

      setTimeout(() => {
        cleanupSelection();
        chrome.runtime.sendMessage(payload);
      }, 180);
    });

    window.addEventListener("keydown", onKeyDown, true);

    function onKeyDown(event) {
      if (event.key !== "Escape" || finished) return;
      event.preventDefault();
      finished = true;
      cleanupSelection();
      window.removeEventListener("keydown", onKeyDown, true);
      chrome.runtime.sendMessage({ type: "WSC_AREA_CANCELLED", sessionId });
    }

    function drawBox(x1, y1, x2, y2) {
      const rect = normalizeRect(x1, y1, x2, y2);
      box.style.left = `${rect.x}px`;
      box.style.top = `${rect.y}px`;
      box.style.width = `${Math.max(1, rect.width)}px`;
      box.style.height = `${Math.max(1, rect.height)}px`;
    }
  }

  function normalizeRect(x1, y1, x2, y2) {
    const left = Math.max(0, Math.min(x1, x2));
    const top = Math.max(0, Math.min(y1, y2));
    const right = Math.min(window.innerWidth, Math.max(x1, x2));
    const bottom = Math.min(window.innerHeight, Math.max(y1, y2));

    return {
      x: left,
      y: top,
      width: right - left,
      height: bottom - top
    };
  }

  function cleanupSelection() {
    if (!activeSelector) return;
    activeSelector.style.remove();
    activeSelector.overlay.remove();
    activeSelector.box.remove();
    activeSelector.hint.remove();
    activeSelector = null;
  }
})();

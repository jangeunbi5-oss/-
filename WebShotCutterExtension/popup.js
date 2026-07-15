const areaBtn = document.querySelector("#areaBtn");
const visibleBtn = document.querySelector("#visibleBtn");
const scrollBtn = document.querySelector("#scrollBtn");
const formatSelect = document.querySelector("#format");
const cutCountInput = document.querySelector("#cutCount");
const statusText = document.querySelector("#status");

areaBtn.addEventListener("click", captureSelectedArea);
visibleBtn.addEventListener("click", captureVisiblePage);
scrollBtn.addEventListener("click", captureScrollingCuts);

async function captureSelectedArea() {
  await withBusy(async () => {
    const tab = await getActiveTab();
    const sessionId = crypto.randomUUID();

    setStatus("영역 선택 도구를 표시합니다.");
    await chrome.runtime.sendMessage({
      type: "WSC_REGISTER_AREA_SESSION",
      sessionId,
      tabId: tab.id,
      windowId: tab.windowId,
      format: formatSelect.value
    });

    await runInTab(tab.id, startAreaSelectionInPage, [sessionId]);
    setStatus("영역을 드래그하면 다운로드가 시작됩니다.");
    setTimeout(() => window.close(), 250);
  });
}

async function captureVisiblePage() {
  await withBusy(async () => {
    const tab = await getActiveTab();
    const captureFormat = formatSelect.value === "jpeg" ? "jpeg" : "png";
    setStatus("현재 보이는 전체 화면을 캡처합니다.");
    const capture = await captureVisibleTab(tab.windowId, captureFormat);
    await downloadByFormat(capture, formatSelect.value, "web-shot-visible");
    setStatus("다운로드가 시작되었습니다.");
  });
}

async function captureScrollingCuts() {
  await withBusy(async () => {
    const tab = await getActiveTab();
    const cutCount = clamp(Number(cutCountInput.value) || 1, 1, 30);
    cutCountInput.value = String(cutCount);

    const metrics = await runInTab(tab.id, getPageMetricsInPage);
    const originalX = metrics.scrollX;
    const originalY = metrics.scrollY;
    const maxScrollY = Math.max(0, metrics.documentHeight - metrics.viewportHeight);
    const stickyTopHeight = Math.min(metrics.stickyTopHeight || 0, Math.floor(metrics.viewportHeight * 0.35));
    const overlapGuard = Math.min(
      Math.floor(metrics.viewportHeight * 0.45),
      Math.max(140, stickyTopHeight + 40)
    );
    const step = Math.max(1, Math.floor(metrics.viewportHeight - overlapGuard));
    const captures = [];
    let targetY = originalY;
    let pageEnded = false;

    try {
      for (let index = 0; index < cutCount; index += 1) {
        setStatus(`스크롤 촬영 중입니다. ${index + 1}/${cutCount}`);
        const scrollResult = await runInTab(tab.id, scrollToInPage, [originalX, targetY, 560]);
        const actualY = Math.round(scrollResult.scrollY);

        if (captures.length > 0 && actualY <= captures[captures.length - 1].scrollY) {
          pageEnded = true;
          break;
        }

        captures.push({
          dataUrl: await captureVisibleTab(tab.windowId, "jpeg"),
          scrollY: actualY,
          viewportHeight: metrics.viewportHeight,
          stickyTopHeight: scrollResult.stickyTopHeight || metrics.stickyTopHeight || 0
        });

        if (actualY >= maxScrollY) {
          pageEnded = true;
          break;
        }

        const nextY = Math.min(maxScrollY, actualY + step);
        if (nextY <= actualY) {
          pageEnded = true;
          break;
        }

        targetY = nextY;
      }
    } finally {
      await runInTab(tab.id, scrollToInPage, [originalX, originalY, 120]);
    }

    if (captures.length === 0) {
      throw new Error("스크롤 캡처 결과가 없습니다.");
    }

    const endNote = pageEnded && captures.length < cutCount ? " 페이지 끝에 도달해 남은 컷은 제외했습니다." : "";
    setStatus(`${captures.length}개 컷을 자연스럽게 이어붙입니다.${endNote}`);
    const stitched = await stitchScrollingCaptures(captures, metrics);
    const pdfBlob = await imageDataUrlToPdf(stitched);
    await downloadBlob(pdfBlob, "web-shot-scroll-cuts.pdf");
    setStatus("PDF 다운로드가 시작되었습니다.");
  });
}

async function withBusy(task) {
  setButtonsDisabled(true);
  try {
    await task();
  } catch (error) {
    setStatus(error.message || "작업 중 오류가 발생했습니다.");
  } finally {
    setButtonsDisabled(false);
  }
}

function setButtonsDisabled(disabled) {
  areaBtn.disabled = disabled;
  visibleBtn.disabled = disabled;
  scrollBtn.disabled = disabled;
}

function setStatus(message) {
  statusText.textContent = message;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) {
    throw new Error("활성 탭을 찾을 수 없습니다.");
  }

  if (/^(chrome|edge|about|devtools):/i.test(tab.url || "")) {
    throw new Error("브라우저 내부 페이지는 캡처할 수 없습니다.");
  }

  return tab;
}

async function runInTab(tabId, func, args = []) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func,
    args
  });
  return result?.result;
}

function captureVisibleTab(windowId, format) {
  return new Promise((resolve, reject) => {
    chrome.tabs.captureVisibleTab(windowId, { format }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve(dataUrl);
    });
  });
}

async function downloadByFormat(dataUrl, format, baseName) {
  if (format === "pdf") {
    const pdf = await imageDataUrlToPdf(dataUrl);
    await downloadBlob(pdf, `${baseName}.pdf`);
    return;
  }

  const converted = await convertDataUrl(dataUrl, format);
  await chrome.downloads.download({
    url: converted,
    filename: `${baseName}.${format === "jpeg" ? "jpg" : "png"}`,
    saveAs: true
  });
}

async function stitchScrollingCaptures(captures, metrics) {
  const parts = [];
  let coveredUntil = captures[0].scrollY;

  for (let index = 0; index < captures.length; index += 1) {
    const capture = captures[index];
    const image = await loadImage(capture.dataUrl);
    const scale = image.naturalHeight / metrics.viewportHeight;
    const visibleTop = capture.scrollY;
    const visibleBottom = Math.min(capture.scrollY + metrics.viewportHeight, metrics.documentHeight);
    const nextCapture = captures[index + 1];
    const stickyTopHeight = index === 0 ? 0 : capture.stickyTopHeight || 0;
    const nextStickyTopHeight = nextCapture ? nextCapture.stickyTopHeight || 0 : 0;
    const cropTopCss = Math.max(stickyTopHeight, coveredUntil - visibleTop);
    const desiredBottom = nextCapture
      ? Math.min(nextCapture.scrollY + nextStickyTopHeight, visibleBottom)
      : visibleBottom;
    const cropBottomCss = Math.max(cropTopCss, desiredBottom - visibleTop);
    const cropTop = clamp(Math.round(cropTopCss * scale), 0, image.naturalHeight - 1);
    const cropBottom = clamp(Math.round(cropBottomCss * scale), cropTop + 1, image.naturalHeight);
    const cropHeight = cropBottom - cropTop;

    if (cropHeight <= 0) {
      continue;
    }

    parts.push({
      image,
      width: image.naturalWidth,
      sourceY: cropTop,
      height: cropHeight
    });

    coveredUntil = Math.max(coveredUntil, visibleTop + cropBottomCss);
  }

  if (parts.length === 0) {
    throw new Error("이어붙일 스크롤 캡처 영역이 없습니다.");
  }

  const width = Math.max(...parts.map((part) => part.width));
  const height = parts.reduce((sum, part) => sum + part.height, 0);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  canvas.width = width;
  canvas.height = height;

  let y = 0;
  for (const part of parts) {
    context.drawImage(part.image, 0, part.sourceY, part.width, part.height, 0, y, part.width, part.height);
    y += part.height;
  }

  return canvas.toDataURL("image/jpeg", 0.92);
}

async function convertDataUrl(dataUrl, format) {
  if (format === "png" && dataUrl.startsWith("data:image/png")) {
    return dataUrl;
  }

  if (format === "jpeg" && dataUrl.startsWith("data:image/jpeg")) {
    return dataUrl;
  }

  const image = await loadImage(dataUrl);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;

  if (format === "jpeg") {
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
  }

  context.drawImage(image, 0, 0);
  return canvas.toDataURL(format === "jpeg" ? "image/jpeg" : "image/png", 0.92);
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("이미지를 읽을 수 없습니다."));
    image.src = dataUrl;
  });
}

async function imageDataUrlToPdf(dataUrl) {
  const jpegDataUrl = await convertDataUrl(dataUrl, "jpeg");
  const image = await loadImage(jpegDataUrl);
  const binary = atob(jpegDataUrl.split(",")[1]);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return makeSingleImagePdf(bytes, image.naturalWidth, image.naturalHeight);
}

function makeSingleImagePdf(jpegBytes, width, height) {
  const encoder = new TextEncoder();
  const chunks = [];
  const offsets = [0];
  let position = 0;

  const addBytes = (bytes) => {
    chunks.push(bytes);
    position += bytes.length;
  };
  const addText = (text) => addBytes(encoder.encode(text));
  const beginObject = (number) => {
    offsets[number] = position;
    addText(`${number} 0 obj\n`);
  };

  addText("%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n");

  beginObject(1);
  addText("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

  beginObject(2);
  addText("<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");

  beginObject(3);
  addText(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`);

  beginObject(4);
  addText(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`);
  addBytes(jpegBytes);
  addText("\nendstream\nendobj\n");

  const content = `q\n${width} 0 0 ${height} 0 0 cm\n/Im0 Do\nQ\n`;
  beginObject(5);
  addText(`<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`);

  const xrefPosition = position;
  addText("xref\n0 6\n0000000000 65535 f \n");
  for (let number = 1; number <= 5; number += 1) {
    addText(`${String(offsets[number]).padStart(10, "0")} 00000 n \n`);
  }
  addText(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefPosition}\n%%EOF`);

  return new Blob(chunks, { type: "application/pdf" });
}

async function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({ url, filename, saveAs: true });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getPageMetricsInPage() {
  const stickyTopHeight = getStickyTopHeight();

  return {
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
    stickyTopHeight,
    devicePixelRatio: window.devicePixelRatio || 1
  };

  function getStickyTopHeight() {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const ranges = [];
    const elements = Array.from(document.body ? document.body.querySelectorAll("*") : []);

    for (const element of elements) {
      const style = window.getComputedStyle(element);
      if (style.position !== "fixed" && style.position !== "sticky") {
        continue;
      }

      const rect = element.getBoundingClientRect();
      if (rect.height <= 0 || rect.width <= 0) {
        continue;
      }

      if (rect.top > 2 || rect.bottom <= 0) {
        continue;
      }

      if (rect.width < viewportWidth * 0.35 || rect.height > viewportHeight * 0.45) {
        continue;
      }

      const bottom = Math.min(viewportHeight, Math.max(0, rect.bottom));
      if (bottom > 0) {
        ranges.push([0, bottom]);
      }
    }

    if (ranges.length === 0) {
      return 0;
    }

    return Math.ceil(Math.max(...ranges.map((range) => range[1])));
  }
}

function scrollToInPage(x, y, delay) {
  return new Promise((resolve) => {
    const previousBehavior = document.documentElement.style.scrollBehavior;
    document.documentElement.style.scrollBehavior = "auto";
    window.scrollTo(x || 0, y || 0);

    let lastY = window.scrollY;
    let stableFrames = 0;
    const startedAt = performance.now();
    const minDelay = delay || 350;

    function check() {
      const currentY = window.scrollY;
      stableFrames = Math.abs(currentY - lastY) < 1 ? stableFrames + 1 : 0;
      lastY = currentY;

      const waitedLongEnough = performance.now() - startedAt >= minDelay;
      if ((waitedLongEnough && stableFrames >= 2) || performance.now() - startedAt > minDelay + 900) {
        document.documentElement.style.scrollBehavior = previousBehavior;
        resolve({
          scrollX: window.scrollX,
          scrollY: window.scrollY,
          stickyTopHeight: getStickyTopHeight()
        });
        return;
      }

      requestAnimationFrame(check);
    }

    requestAnimationFrame(check);

    function getStickyTopHeight() {
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const ranges = [];
      const elements = Array.from(document.body ? document.body.querySelectorAll("*") : []);

      for (const element of elements) {
        const style = window.getComputedStyle(element);
        if (style.position !== "fixed" && style.position !== "sticky") {
          continue;
        }

        const rect = element.getBoundingClientRect();
        if (rect.height <= 0 || rect.width <= 0) {
          continue;
        }

        if (rect.top > 2 || rect.bottom <= 0) {
          continue;
        }

        if (rect.width < viewportWidth * 0.35 || rect.height > viewportHeight * 0.45) {
          continue;
        }

        const bottom = Math.min(viewportHeight, Math.max(0, rect.bottom));
        if (bottom > 0) {
          ranges.push([0, bottom]);
        }
      }

      if (ranges.length === 0) {
        return 0;
      }

      return Math.ceil(Math.max(...ranges.map((range) => range[1])));
    }
  });
}

function startAreaSelectionInPage(sessionId) {
  const existing = document.querySelector("[data-wsc-overlay='true']");
  if (existing) {
    existing.remove();
  }

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
    .wsc-box.wsc-box-active {
      display: block;
    }
    .wsc-box.wsc-box-locked {
      border-color: #20c997;
      background: rgba(32, 201, 151, 0.28);
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
  overlay.dataset.wscOverlay = "true";
  box.className = "wsc-box";
  hint.className = "wsc-hint";
  hint.textContent = "드래그해서 캡처할 영역을 선택하세요. 취소: ESC";
  document.documentElement.append(style, overlay, box, hint);

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
    drawBox(event.clientX, event.clientY);
  });

  overlay.addEventListener("mousemove", (event) => {
    if (!dragging) return;
    drawBox(event.clientX, event.clientY);
  });

  overlay.addEventListener("mouseup", (event) => {
    if (!dragging || finished) return;
    dragging = false;
    finished = true;

    const rect = normalizeRect(startX, startY, event.clientX, event.clientY);
    window.removeEventListener("keydown", onKeyDown, true);

    if (rect.width < 4 || rect.height < 4) {
      cleanup();
      chrome.runtime.sendMessage({ type: "WSC_AREA_CANCELLED", sessionId });
      return;
    }

    box.classList.add("wsc-box-locked");
    hint.textContent = "선택 영역을 캡처합니다.";
    setTimeout(() => {
      cleanup();
      chrome.runtime.sendMessage({
        type: "WSC_AREA_SELECTED",
        sessionId,
        rect,
        devicePixelRatio: window.devicePixelRatio || 1
      });
    }, 180);
  });

  window.addEventListener("keydown", onKeyDown, true);

  function onKeyDown(event) {
    if (event.key !== "Escape" || finished) return;
    event.preventDefault();
    finished = true;
    cleanup();
    window.removeEventListener("keydown", onKeyDown, true);
    chrome.runtime.sendMessage({ type: "WSC_AREA_CANCELLED", sessionId });
  }

  function drawBox(currentX, currentY) {
    const rect = normalizeRect(startX, startY, currentX, currentY);
    box.style.left = `${rect.x}px`;
    box.style.top = `${rect.y}px`;
    box.style.width = `${Math.max(1, rect.width)}px`;
    box.style.height = `${Math.max(1, rect.height)}px`;
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

  function cleanup() {
    style.remove();
    overlay.remove();
    box.remove();
    hint.remove();
  }
}

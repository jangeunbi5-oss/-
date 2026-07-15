const areaSessions = new Map();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "WSC_REGISTER_AREA_SESSION") {
    areaSessions.set(message.sessionId, {
      tabId: message.tabId,
      windowId: message.windowId,
      format: message.format
    });
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === "WSC_AREA_SELECTED") {
    handleAreaSelected(message).catch((error) => {
      console.error(error);
    });
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === "WSC_AREA_CANCELLED") {
    areaSessions.delete(message.sessionId);
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

async function handleAreaSelected(message) {
  const session = areaSessions.get(message.sessionId);
  if (!session) return;
  areaSessions.delete(message.sessionId);

  const capture = await captureVisibleTab(session.windowId, "png");
  const cropped = await cropDataUrl(capture, message.rect, message.devicePixelRatio || 1);
  await downloadByFormat(cropped, session.format, "web-shot-selected");
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
    const pdfBlob = await imageDataUrlToPdf(dataUrl);
    await downloadDataUrl(await blobToDataUrl(pdfBlob), `${baseName}.pdf`);
    return;
  }

  const converted = await convertDataUrl(dataUrl, format);
  await downloadDataUrl(converted, `${baseName}.${format === "jpeg" ? "jpg" : "png"}`);
}

function downloadDataUrl(url, filename) {
  return chrome.downloads.download({ url, filename, saveAs: true });
}

async function cropDataUrl(dataUrl, rect, scale) {
  const image = await loadImageBitmap(dataUrl);
  const sourceX = Math.round(rect.x * scale);
  const sourceY = Math.round(rect.y * scale);
  const sourceWidth = Math.round(rect.width * scale);
  const sourceHeight = Math.round(rect.height * scale);
  const canvas = new OffscreenCanvas(sourceWidth, sourceHeight);
  const context = canvas.getContext("2d");

  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    sourceWidth,
    sourceHeight
  );

  const blob = await canvas.convertToBlob({ type: "image/png" });
  return blobToDataUrl(blob);
}

async function convertDataUrl(dataUrl, format) {
  if (format === "png" && dataUrl.startsWith("data:image/png")) {
    return dataUrl;
  }

  if (format === "jpeg" && dataUrl.startsWith("data:image/jpeg")) {
    return dataUrl;
  }

  const image = await loadImageBitmap(dataUrl);
  const canvas = new OffscreenCanvas(image.width, image.height);
  const context = canvas.getContext("2d");

  if (format === "jpeg") {
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
  }

  context.drawImage(image, 0, 0);
  const blob = await canvas.convertToBlob({
    type: format === "jpeg" ? "image/jpeg" : "image/png",
    quality: 0.92
  });
  return blobToDataUrl(blob);
}

async function imageDataUrlToPdf(dataUrl) {
  const jpegDataUrl = await convertDataUrl(dataUrl, "jpeg");
  const image = await loadImageBitmap(jpegDataUrl);
  const jpegBytes = await dataUrlToBytes(jpegDataUrl);
  return makeSingleImagePdf(jpegBytes, image.width, image.height);
}

async function loadImageBitmap(dataUrl) {
  const blob = await dataUrlToBlob(dataUrl);
  return createImageBitmap(blob);
}

async function dataUrlToBlob(dataUrl) {
  return fetch(dataUrl).then((response) => response.blob());
}

async function dataUrlToBytes(dataUrl) {
  const blob = await dataUrlToBlob(dataUrl);
  return new Uint8Array(await blob.arrayBuffer());
}

async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return `data:${blob.type};base64,${btoa(binary)}`;
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

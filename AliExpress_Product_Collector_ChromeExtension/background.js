importScripts("parser.js", "storage.js", "exporters.js");

const state = {
  running: false,
  paused: false,
  stopRequested: false,
  logs: [],
  currentItems: [],
  activeTabId: null
};

function addLog(message) {
  state.logs.push(`${new Date().toLocaleTimeString()} ${message}`);
  state.logs = state.logs.slice(-200);
}

function status() {
  return {
    running: state.running,
    paused: state.paused,
    stop_requested: state.stopRequested,
    logs: state.logs,
    current_items: state.currentItems
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkpoint() {
  if (state.stopRequested) throw new Error("사용자 요청으로 수집을 종료했습니다.");
  while (state.paused && !state.stopRequested) {
    await delay(400);
  }
  if (state.stopRequested) throw new Error("사용자 요청으로 수집을 종료했습니다.");
}

function keywordTerms(keyword) {
  const normalized = String(keyword || "").trim().toLowerCase();
  const terms = normalized.split(/[\s,/_+-]+/).filter((term) => term.length >= 2);
  if (normalized && !terms.includes(normalized)) terms.unshift(normalized);
  if (terms.includes("라면")) terms.push("ramen", "noodle", "noodles", "instant noodle", "instant noodles");
  return Array.from(new Set(terms));
}

function productMatchesKeyword(row, keyword) {
  const terms = keywordTerms(keyword);
  if (!terms.length) return true;
  const haystack = `${row.title || ""} ${row.description || ""} ${row.brand || ""} ${row.url || ""}`.toLowerCase();
  const phrase = String(keyword || "").trim().toLowerCase();
  if (phrase && haystack.includes(phrase)) return true;
  return terms.some((term) => haystack.includes(term));
}

async function fetchProduct(url) {
  try {
    const response = await fetch(url, {
      credentials: "include",
      redirect: "follow",
      cache: "no-store"
    });
    const text = await response.text();
    const row = AliParser.parseProduct(text, response.url || url, response.status);
    if (response.status >= 400) row.status = `http_${response.status}`;
    return row;
  } catch (error) {
    return {
      status: "error",
      http_status: "",
      product_id: AliParser.extractProductId(url),
      store_id: "",
      title: "",
      price: "",
      currency: "",
      brand: "",
      rating: "",
      image: "",
      description: "",
      availability: "",
      url,
      error: error instanceof Error ? error.message : String(error),
      crawled_at: new Date().toISOString()
    };
  }
}

async function waitForTabLoaded(tabId, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === "complete") return;
    await delay(500);
  }
}

async function collectLinksFromSearch(keyword, maxItems) {
  const searchUrl = `https://ko.aliexpress.com/w/wholesale-${encodeURIComponent(keyword)}.html?SearchText=${encodeURIComponent(keyword)}`;
  const tab = await chrome.tabs.create({ url: searchUrl, active: true });
  state.activeTabId = tab.id;
  addLog("AliExpress 검색 페이지를 열었습니다.");
  await waitForTabLoaded(tab.id);
  await delay(2000);
  await checkpoint();

  const maxLinks = maxItems > 0 ? maxItems * 3 : 80;
  const response = await chrome.tabs.sendMessage(tab.id, {
    type: "COLLECT_LINKS_FROM_PAGE",
    keyword,
    maxLinks
  });
  if (response && response.error) throw new Error(response.error);
  const links = (response && response.links) || [];
  addLog(`상품 후보 링크 ${links.length}개를 수집했습니다.`);
  return links;
}

function resetRunState() {
  state.running = true;
  state.paused = false;
  state.stopRequested = false;
  state.logs = [];
  state.currentItems = [];
  state.activeTabId = null;
}

async function runKeywordCrawl(keyword, maxItems) {
  if (state.running) throw new Error("이미 수집이 실행 중입니다.");
  resetRunState();
  addLog(`키워드 수집 시작: ${keyword}`);

  try {
    const links = await collectLinksFromSearch(keyword, maxItems);
    const rows = [];
    const seen = new Set();

    for (const url of links) {
      await checkpoint();
      const id = AliParser.extractProductId(url) || url;
      if (seen.has(id)) continue;
      seen.add(id);
      addLog(`[${rows.length + 1}] 상세 페이지 분석: ${url}`);
      const row = await fetchProduct(url);
      if (row.status === "ok" && row.title && row.product_id && productMatchesKeyword(row, keyword)) {
        rows.push(row);
        state.currentItems = rows.slice(-100);
        addLog(`추출 완료: ${row.title}`);
      } else {
        addLog(`추출 제외: ${row.title || row.error || url}`);
      }
      if (maxItems > 0 && rows.length >= maxItems) break;
      await delay(600);
    }

    await AliStorage.saveCollectionItems(rows);
    addLog(`수집 완료: ${rows.length}개 저장`);
    return { total: rows.length, ok: rows.filter((row) => row.status === "ok").length, items: rows, logs: state.logs };
  } finally {
    state.running = false;
    state.paused = false;
  }
}

async function runUrlCrawl(urls) {
  if (state.running) throw new Error("이미 수집이 실행 중입니다.");
  resetRunState();
  addLog(`URL 수집 시작: ${urls.length}개`);

  try {
    const rows = [];
    for (const url of urls) {
      await checkpoint();
      addLog(`상세 페이지 분석: ${url}`);
      const row = await fetchProduct(url);
      rows.push(row);
      state.currentItems = rows.slice(-100);
      await delay(400);
    }
    const okRows = rows.filter((row) => row.status === "ok" && row.product_id && row.title);
    await AliStorage.saveCollectionItems(okRows);
    addLog(`URL 수집 완료: ${okRows.length}/${rows.length}개 저장`);
    return { total: rows.length, ok: okRows.length, items: rows, logs: state.logs };
  } finally {
    state.running = false;
    state.paused = false;
  }
}

async function exportItems({ items, formats, filename }) {
  const baseName = AliParser.safeOutputStem(filename);
  const selectedFormats = formats && formats.length ? formats : ["csv"];
  const entry = {
    id: `${baseName}-${Date.now()}`,
    name: baseName,
    formats: selectedFormats,
    count: items.length,
    created_at: Date.now()
  };

  if (selectedFormats.includes("json")) {
    AliExporters.downloadText(`${baseName}.json`, JSON.stringify(items, null, 2), "application/json;charset=utf-8");
  }
  if (selectedFormats.includes("csv")) {
    AliExporters.downloadText(`${baseName}.csv`, AliExporters.toCsv(items), "text/csv;charset=utf-8");
  }
  if (selectedFormats.includes("xls")) {
    AliExporters.downloadText(`${baseName}.xls`, AliExporters.toExcelHtml(items), "application/vnd.ms-excel;charset=utf-8");
  }

  await AliStorage.addExportHistory(entry);
  return entry;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    switch (message.type) {
      case "GET_STATUS":
        return status();
      case "CLEAR_LOGS":
        state.logs = [];
        return status();
      case "CONTROL":
        if (message.action === "pause" && state.running) state.paused = true;
        if (message.action === "resume") state.paused = false;
        if (message.action === "stop") {
          state.stopRequested = true;
          state.paused = false;
          if (state.activeTabId) {
            try {
              await chrome.tabs.remove(state.activeTabId);
            } catch {
              // The user may already have closed the tab.
            }
          }
        }
        return status();
      case "START_KEYWORD_CRAWL":
        return runKeywordCrawl(message.keyword, Number(message.maxItems || 0));
      case "START_URL_CRAWL":
        return runUrlCrawl(message.urls || []);
      case "SAVE_COLLECTION":
        return { items: await AliStorage.saveCollectionItems(message.items || []) };
      case "DELETE_COLLECTION":
        return { items: await AliStorage.deleteCollectionItems(message.keys || []) };
      case "GET_COLLECTION":
        return {
          items: await AliStorage.getCollectionItems(),
          exports: await AliStorage.getExportHistory()
        };
      case "DELETE_EXPORT_HISTORY":
        return { exports: await AliStorage.deleteExportHistory(message.id) };
      case "EXPORT_ITEMS":
        return exportItems(message);
      default:
        throw new Error(`Unknown message type: ${message.type}`);
    }
  })()
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  return true;
});

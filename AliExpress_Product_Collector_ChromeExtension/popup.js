const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

let crawlItems = [];
let crawlSelected = new Set();
let resultItems = [];
let resultSelected = new Set();
let exportHistory = [];

function send(type, payload = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, ...payload }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response || !response.ok) {
        reject(new Error((response && response.error) || "확장 프로그램 처리에 실패했습니다."));
        return;
      }
      resolve(response.result);
    });
  });
}

function setError(message) {
  const box = $("#errorBox");
  if (!message) {
    box.classList.add("hidden");
    box.textContent = "";
    return;
  }
  box.textContent = `오류: ${message}`;
  box.classList.remove("hidden");
}

function setNotice(message) {
  const box = $("#noticeBox");
  if (!message) {
    box.classList.add("hidden");
    box.textContent = "";
    return;
  }
  box.textContent = message;
  box.classList.remove("hidden");
}

function itemKey(item) {
  return AliParser.productKey(item);
}

function canSaveItem(item) {
  return item.status === "ok" && Boolean(item.product_id) && Boolean(item.title);
}

function escapeHtml(value) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderStatus(status) {
  const label = $("#runStatus");
  label.classList.toggle("running", status.running && !status.paused);
  label.classList.toggle("paused", status.paused);
  label.textContent = status.paused ? "일시정지" : status.running ? "실행 중" : "대기";

  $("#pauseButton").disabled = !status.running || status.paused;
  $("#resumeButton").disabled = !status.paused;
  $("#stopButton").disabled = !status.running && !status.paused;

  if (Array.isArray(status.current_items) && status.current_items.length > crawlItems.length) {
    crawlItems = status.current_items;
    renderCrawlItems();
  }

  const logs = Array.isArray(status.logs) ? status.logs : [];
  $("#logBox").innerHTML = logs.length
    ? logs.slice().reverse().map((line) => `<div>${escapeHtml(line)}</div>`).join("")
    : "<div>대기 중</div>";
}

function renderRows(items, selected, tbodySelector, emptyMessage) {
  const tbody = $(tbodySelector);
  if (!items.length) {
    tbody.innerHTML = `<tr><td colspan="4">${emptyMessage}</td></tr>`;
    return;
  }
  tbody.innerHTML = items
    .map((item) => {
      const key = itemKey(item);
      const price = [item.price, item.currency].filter(Boolean).join(" ");
      return `
        <tr>
          <td><input type="checkbox" data-key="${escapeHtml(key)}" ${selected.has(key) ? "checked" : ""}></td>
          <td>${escapeHtml(item.status || "-")}</td>
          <td class="productTitle" title="${escapeHtml(item.title || item.error || "-")}">${escapeHtml(item.title || item.error || "-")}</td>
          <td>${escapeHtml(price || "-")}</td>
        </tr>
      `;
    })
    .join("");
}

function renderCrawlItems() {
  $("#crawlCount").textContent = `${crawlItems.length}개`;
  renderRows(crawlItems, crawlSelected, "#crawlRows", "아직 수집한 상품이 없습니다.");
  $$("#crawlRows input[type='checkbox']").forEach((input) => {
    input.addEventListener("change", () => {
      input.checked ? crawlSelected.add(input.dataset.key) : crawlSelected.delete(input.dataset.key);
    });
  });
}

function renderResults() {
  $("#totalItems").textContent = String(resultItems.length);
  $("#selectedItems").textContent = String(resultSelected.size);
  $("#resultCount").textContent = `${resultItems.length}개`;
  renderRows(resultItems, resultSelected, "#resultRows", "저장된 상품이 없습니다.");
  $$("#resultRows input[type='checkbox']").forEach((input) => {
    input.addEventListener("change", () => {
      input.checked ? resultSelected.add(input.dataset.key) : resultSelected.delete(input.dataset.key);
      $("#selectedItems").textContent = String(resultSelected.size);
    });
  });

  const history = $("#exportHistory");
  if (!exportHistory.length) {
    history.innerHTML = '<p class="hint">아직 내보내기 기록이 없습니다.</p>';
    return;
  }
  history.innerHTML = exportHistory
    .map((entry) => {
      const date = entry.created_at ? new Date(entry.created_at).toLocaleString() : "";
      return `
        <div class="historyItem">
          <div>
            <strong>${escapeHtml(entry.name)}</strong>
            <div class="hint">${escapeHtml((entry.formats || []).join(", "))} · ${entry.count || 0}개 · ${escapeHtml(date)}</div>
          </div>
          <button class="secondary small" data-export-id="${escapeHtml(entry.id)}">기록 삭제</button>
        </div>
      `;
    })
    .join("");
  $$("[data-export-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      await send("DELETE_EXPORT_HISTORY", { id: button.dataset.exportId });
      await loadResults();
    });
  });
}

async function refreshStatus() {
  try {
    const status = await send("GET_STATUS");
    renderStatus(status);
  } catch (error) {
    setError(error.message);
  }
}

async function loadResults() {
  const data = await send("GET_COLLECTION");
  resultItems = data.items || [];
  exportHistory = data.exports || [];
  resultSelected = new Set([...resultSelected].filter((key) => resultItems.some((item) => itemKey(item) === key)));
  renderResults();
}

function selectedFormats() {
  const values = $$(".formatRow input[type='checkbox']:checked").map((input) => input.value);
  return values.length ? values : ["csv"];
}

function switchView(view) {
  setNotice("");
  $$(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.view === view));
  $("#crawlView").classList.toggle("active", view === "crawl");
  $("#resultsView").classList.toggle("active", view === "results");
  if (view === "results") loadResults().catch((error) => setNotice(error.message));
}

async function init() {
  $$(".tab").forEach((tab) => tab.addEventListener("click", () => switchView(tab.dataset.view)));

  $("#toggleUrlPanel").addEventListener("click", () => {
    const panel = $("#urlPanel");
    const open = !panel.classList.toggle("hidden");
    $("#toggleUrlPanel").textContent = open ? "URL 직접 수집 닫기" : "URL 직접 수집 열기";
  });

  $("#startKeywordButton").addEventListener("click", async () => {
    const keyword = $("#keywordInput").value.trim();
    if (!keyword) {
      setError("검색 키워드를 입력하세요.");
      return;
    }
    setError("");
    crawlItems = [];
    crawlSelected = new Set();
    renderCrawlItems();
    try {
      const result = await send("START_KEYWORD_CRAWL", {
        keyword,
        maxItems: Number($("#maxItemsInput").value || 0)
      });
      crawlItems = result.items || [];
      crawlSelected = new Set(crawlItems.filter(canSaveItem).map(itemKey));
      renderCrawlItems();
      await loadResults();
    } catch (error) {
      setError(error.message);
    } finally {
      await refreshStatus();
    }
  });

  $("#startUrlsButton").addEventListener("click", async () => {
    const urls = $("#urlsInput").value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!urls.length) {
      setError("수집할 URL을 입력하세요.");
      return;
    }
    setError("");
    crawlItems = [];
    crawlSelected = new Set();
    renderCrawlItems();
    try {
      const result = await send("START_URL_CRAWL", { urls });
      crawlItems = result.items || [];
      crawlSelected = new Set(crawlItems.filter(canSaveItem).map(itemKey));
      renderCrawlItems();
      await loadResults();
    } catch (error) {
      setError(error.message);
    } finally {
      await refreshStatus();
    }
  });

  $("#pauseButton").addEventListener("click", () => send("CONTROL", { action: "pause" }).then(renderStatus).catch((error) => setError(error.message)));
  $("#resumeButton").addEventListener("click", () => send("CONTROL", { action: "resume" }).then(renderStatus).catch((error) => setError(error.message)));
  $("#stopButton").addEventListener("click", () => send("CONTROL", { action: "stop" }).then(renderStatus).catch((error) => setError(error.message)));
  $("#clearLogsButton").addEventListener("click", () => send("CLEAR_LOGS").then(renderStatus).catch((error) => setError(error.message)));

  $("#selectCrawlAllButton").addEventListener("click", () => {
    crawlSelected = new Set(crawlItems.filter(canSaveItem).map(itemKey));
    renderCrawlItems();
  });
  $("#clearCrawlSelectionButton").addEventListener("click", () => {
    crawlSelected = new Set();
    renderCrawlItems();
  });
  $("#saveSelectedButton").addEventListener("click", async () => {
    const items = crawlItems.filter((item) => crawlSelected.has(itemKey(item)) && canSaveItem(item));
    if (!items.length) {
      setError("저장할 상품을 선택하세요.");
      return;
    }
    await send("SAVE_COLLECTION", { items });
    await loadResults();
    setError("");
  });

  $("#refreshResultsButton").addEventListener("click", () => loadResults().catch((error) => setNotice(error.message)));
  $("#selectAllResultsButton").addEventListener("click", () => {
    resultSelected = new Set(resultItems.filter(canSaveItem).map(itemKey));
    renderResults();
  });
  $("#clearResultsSelectionButton").addEventListener("click", () => {
    resultSelected = new Set();
    renderResults();
  });
  $("#deleteSelectedButton").addEventListener("click", async () => {
    if (!resultSelected.size) return;
    await send("DELETE_COLLECTION", { keys: Array.from(resultSelected) });
    resultSelected = new Set();
    await loadResults();
    setNotice("선택한 상품을 삭제했습니다.");
  });
  $("#exportSelectedButton").addEventListener("click", async () => {
    const items = resultItems.filter((item) => resultSelected.has(itemKey(item)) && canSaveItem(item));
    if (!items.length) {
      setNotice("파일로 저장할 상품을 선택하세요.");
      return;
    }
    const entry = await send("EXPORT_ITEMS", {
      items,
      formats: selectedFormats(),
      filename: $("#filenameInput").value.trim()
    });
    await loadResults();
    setNotice(`${entry.count}개 상품 파일 저장을 시작했습니다.`);
  });

  renderCrawlItems();
  await refreshStatus();
  await loadResults();
  setInterval(refreshStatus, 1000);
}

document.addEventListener("DOMContentLoaded", () => {
  init().catch((error) => setError(error.message));
});

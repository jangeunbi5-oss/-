(function () {
  function normalizeProductUrl(href) {
    if (!href) return "";
    const absolute = new URL(href, "https://ko.aliexpress.com/");
    return `${absolute.protocol}//${absolute.host}${absolute.pathname}`;
  }

  function isProductUrl(url) {
    return /\/item\/\d+\.html/i.test(url || "");
  }

  function keywordTerms(keyword) {
    const normalized = String(keyword || "").trim().toLowerCase();
    const terms = normalized.split(/[\s,/_+-]+/).filter((term) => term.length >= 2);
    if (normalized && !terms.includes(normalized)) terms.unshift(normalized);
    if (terms.includes("라면")) terms.push("ramen", "noodle", "noodles", "instant noodle", "instant noodles");
    return Array.from(new Set(terms));
  }

  async function scrollAndCollect(keyword, maxLinks) {
    const terms = keywordTerms(keyword);
    const seen = new Set();
    const links = [];

    for (let round = 0; round < 8; round += 1) {
      const anchors = Array.from(document.querySelectorAll("a[href*='/item/']"));
      for (const anchor of anchors) {
        const card = anchor.closest("[class*='card'], [class*='item'], li, div");
        const text = (card ? card.innerText : anchor.innerText || "").toLowerCase();
        if (terms.length && text && !terms.some((term) => text.includes(term))) continue;

        const url = normalizeProductUrl(anchor.href || anchor.getAttribute("href") || "");
        if (!isProductUrl(url)) continue;

        const id = (url.match(/\/item\/(\d+)\.html/i) || [])[1] || url;
        if (seen.has(id)) continue;
        seen.add(id);
        links.push(url);
        if (maxLinks > 0 && links.length >= maxLinks) return links;
      }
      window.scrollBy(0, 1400);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    return links;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message && message.type === "COLLECT_LINKS_FROM_PAGE") {
      scrollAndCollect(message.keyword, message.maxLinks || 0)
        .then((links) => sendResponse({ links }))
        .catch((error) => sendResponse({ error: String(error) }));
      return true;
    }
    return false;
  });
})();

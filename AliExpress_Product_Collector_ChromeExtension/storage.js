(function (global) {
  const COLLECTION_KEY = "collectionItems";
  const EXPORT_HISTORY_KEY = "exportHistory";

  async function getLocal(keys) {
    return chrome.storage.local.get(keys);
  }

  async function setLocal(values) {
    return chrome.storage.local.set(values);
  }

  async function getCollectionItems() {
    const data = await getLocal([COLLECTION_KEY]);
    return Array.isArray(data[COLLECTION_KEY]) ? data[COLLECTION_KEY] : [];
  }

  async function saveCollectionItems(items) {
    const existing = await getCollectionItems();
    const byKey = new Map(existing.map((item) => [global.AliParser.productKey(item), item]));
    for (const item of items) {
      const key = global.AliParser.productKey(item);
      if (key) byKey.set(key, item);
    }
    const nextItems = Array.from(byKey.values());
    await setLocal({ [COLLECTION_KEY]: nextItems });
    return nextItems;
  }

  async function deleteCollectionItems(keys) {
    const removeKeys = new Set(keys);
    const existing = await getCollectionItems();
    const nextItems = existing.filter((item) => !removeKeys.has(global.AliParser.productKey(item)));
    await setLocal({ [COLLECTION_KEY]: nextItems });
    return nextItems;
  }

  async function getExportHistory() {
    const data = await getLocal([EXPORT_HISTORY_KEY]);
    return Array.isArray(data[EXPORT_HISTORY_KEY]) ? data[EXPORT_HISTORY_KEY] : [];
  }

  async function addExportHistory(entry) {
    const history = await getExportHistory();
    const nextHistory = [entry, ...history].slice(0, 50);
    await setLocal({ [EXPORT_HISTORY_KEY]: nextHistory });
    return nextHistory;
  }

  async function deleteExportHistory(id) {
    const history = await getExportHistory();
    const nextHistory = history.filter((entry) => entry.id !== id);
    await setLocal({ [EXPORT_HISTORY_KEY]: nextHistory });
    return nextHistory;
  }

  global.AliStorage = {
    getCollectionItems,
    saveCollectionItems,
    deleteCollectionItems,
    getExportHistory,
    addExportHistory,
    deleteExportHistory
  };
})(globalThis);

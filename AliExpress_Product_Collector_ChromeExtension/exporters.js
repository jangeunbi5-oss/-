(function (global) {
  function csvEscape(value) {
    const text = value === undefined || value === null ? "" : String(value);
    if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  }

  function toCsv(items) {
    const columns = global.AliParser.COLUMNS;
    const lines = [columns.join(",")];
    for (const item of items) {
      lines.push(columns.map((column) => csvEscape(item[column] || "")).join(","));
    }
    return `\ufeff${lines.join("\r\n")}`;
  }

  function htmlEscape(value) {
    return String(value === undefined || value === null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function toExcelHtml(items) {
    const columns = global.AliParser.COLUMNS;
    const head = columns.map((column) => `<th>${htmlEscape(column)}</th>`).join("");
    const rows = items
      .map((item) => `<tr>${columns.map((column) => `<td>${htmlEscape(item[column] || "")}</td>`).join("")}</tr>`)
      .join("");
    return `<!doctype html><html><head><meta charset="utf-8"></head><body><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></body></html>`;
  }

  function downloadText(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({ url, filename, saveAs: true }, () => {
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    });
  }

  global.AliExporters = {
    toCsv,
    toExcelHtml,
    downloadText
  };
})(globalThis);

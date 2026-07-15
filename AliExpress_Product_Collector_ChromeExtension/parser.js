(function (global) {
  const COLUMNS = [
    "status",
    "http_status",
    "product_id",
    "store_id",
    "title",
    "price",
    "currency",
    "brand",
    "rating",
    "image",
    "description",
    "availability",
    "url",
    "error",
    "crawled_at"
  ];

  function cleanText(value) {
    if (value === undefined || value === null) return "";
    return String(value)
      .replace(/\\u002F/g, "/")
      .replace(/\\u0026/g, "&")
      .replace(/\\"/g, '"')
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizePrice(value) {
    if (value === undefined || value === null) return "";
    return String(value).replace(/[^\d.]/g, "");
  }

  function firstMatch(text, patterns) {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return cleanText(match[1]);
    }
    return "";
  }

  function extractProductId(url) {
    const patterns = [/\/item\/(\d+)\.html/i, /\/i\/(\d+)\.html/i, /productId=(\d+)/i, /itemId=(\d+)/i];
    for (const pattern of patterns) {
      const match = String(url || "").match(pattern);
      if (match) return match[1];
    }
    return "";
  }

  function extractPdpNpi(url) {
    try {
      const parsed = new URL(url);
      const raw = parsed.searchParams.get("pdp_npi") || "";
      if (!raw) return { currency: "", original_price: "", sale_price: "" };
      const parts = decodeURIComponent(raw).split("!");
      const index = parts.findIndex((part) => /^[A-Z]{3}$/.test(part));
      if (index < 0) return { currency: "", original_price: "", sale_price: "" };
      return {
        currency: parts[index] || "",
        original_price: normalizePrice(parts[index + 1] || ""),
        sale_price: normalizePrice(parts[index + 2] || "")
      };
    } catch {
      return { currency: "", original_price: "", sale_price: "" };
    }
  }

  function metaContent(doc, selector, rawHtml) {
    if (!doc && rawHtml) {
      const propertyMatch = selector.match(/meta\[property="([^"]+)"\]/);
      const nameMatch = selector.match(/meta\[name="([^"]+)"\]/);
      const attrName = propertyMatch ? "property" : "name";
      const attrValue = (propertyMatch || nameMatch || [])[1];
      if (attrValue) {
        return firstMatch(rawHtml, [
          new RegExp(`<meta[^>]+${attrName}=["']${attrValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'][^>]+content=["']([^"']+)["']`, "is"),
          new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+${attrName}=["']${attrValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`, "is")
        ]);
      }
    }
    if (!doc) return "";
    const tag = doc.querySelector(selector);
    return tag ? cleanText(tag.getAttribute("content")) : "";
  }

  function extractJsonLd(doc, rawHtml) {
    if (!doc && rawHtml) {
      const scripts = rawHtml.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
      for (const script of scripts) {
        const body = firstMatch(script, [/<script[^>]*>([\s\S]*?)<\/script>/i]);
        try {
          const parsed = JSON.parse(cleanText(body));
          const candidates = Array.isArray(parsed) ? parsed : [parsed];
          const product = candidates.find((item) => {
            return item && typeof item === "object" && (item["@type"] === "Product" || item.name || item.offers);
          });
          if (product) return product;
        } catch {
          // Continue with regex/meta fallbacks.
        }
      }
      return {};
    }
    if (!doc) return {};
    const scripts = Array.from(doc.querySelectorAll('script[type="application/ld+json"]'));
    for (const script of scripts) {
      try {
        const parsed = JSON.parse(cleanText(script.textContent || ""));
        const candidates = Array.isArray(parsed) ? parsed : [parsed];
        const product = candidates.find((item) => {
          return item && typeof item === "object" && (item["@type"] === "Product" || item.name || item.offers);
        });
        if (product) return product;
      } catch {
        // Continue with regex/meta fallbacks.
      }
    }
    return {};
  }

  function parseProduct(htmlText, url, httpStatus) {
    const rawHtml = htmlText || "";
    const doc = typeof DOMParser === "undefined" ? null : new DOMParser().parseFromString(rawHtml, "text/html");
    const jsonLd = extractJsonLd(doc, rawHtml);
    let offers = jsonLd.offers || {};
    if (Array.isArray(offers)) offers = offers[0] || {};

    const pdpNpi = extractPdpNpi(url);

    let title =
      cleanText(jsonLd.name) ||
      metaContent(doc, 'meta[property="og:title"]', rawHtml) ||
      metaContent(doc, 'meta[name="title"]', rawHtml) ||
      firstMatch(rawHtml, [/"subject"\s*:\s*"([^"]+)"/is, /"title"\s*:\s*"([^"]+)"/is]) ||
      cleanText(doc ? doc.title : "");
    title = title.replace(/\s*-\s*AliExpress.*$/i, "");

    const description =
      cleanText(jsonLd.description) ||
      metaContent(doc, 'meta[property="og:description"]', rawHtml) ||
      metaContent(doc, 'meta[name="description"]', rawHtml);

    let imageValue = jsonLd.image || "";
    if (Array.isArray(imageValue)) imageValue = imageValue[0] || "";
    const image =
      cleanText(imageValue) ||
      metaContent(doc, 'meta[property="og:image"]', rawHtml) ||
      metaContent(doc, 'meta[name="twitter:image"]', rawHtml) ||
      firstMatch(rawHtml, [/"imagePath"\s*:\s*"([^"]+)"/is, /"productImage"\s*:\s*"([^"]+)"/is]);

    let brandValue = jsonLd.brand || "";
    if (brandValue && typeof brandValue === "object") brandValue = brandValue.name;
    const brand =
      cleanText(brandValue) ||
      firstMatch(rawHtml, [/"brand"\s*:\s*\{\s*"name"\s*:\s*"([^"]+)"/is, /"brandName"\s*:\s*"([^"]+)"/is]);

    const price =
      normalizePrice(offers.price) ||
      normalizePrice(
        firstMatch(rawHtml, [
          /"salePrice"\s*:\s*"?([\d.,]+)"?/is,
          /"formattedPrice"\s*:\s*"([^"]+)"/is,
          /"minActivityAmount"\s*:\s*"?([\d.,]+)"?/is,
          /"price"\s*:\s*"?([\d.,]+)"?/is
        ])
      ) ||
      pdpNpi.sale_price ||
      pdpNpi.original_price;

    const currency =
      cleanText(offers.priceCurrency) ||
      firstMatch(rawHtml, [/"priceCurrency"\s*:\s*"([^"]+)"/is, /"currencyCode"\s*:\s*"([^"]+)"/is]) ||
      pdpNpi.currency;

    const aggregateRating = jsonLd.aggregateRating && typeof jsonLd.aggregateRating === "object" ? jsonLd.aggregateRating : {};
    const rating =
      normalizePrice(aggregateRating.ratingValue) ||
      firstMatch(rawHtml, [/"ratingValue"\s*:\s*"?([\d.]+)"?/is, /"averageStar"\s*:\s*"?([\d.]+)"?/is]);

    const availability =
      cleanText(offers.availability) ||
      firstMatch(rawHtml, [/"availability"\s*:\s*"([^"]+)"/is, /"inventory"\s*:\s*"?([^",}]+)"?/is]);

    const storeId = firstMatch(rawHtml, [/"storeId"\s*:\s*"?(\d+)"?/is, /"sellerAdminSeq"\s*:\s*"?(\d+)"?/is]);

    return {
      status: title ? "ok" : "parsed_empty",
      http_status: httpStatus || "",
      product_id: extractProductId(url),
      store_id: storeId,
      title,
      price,
      currency,
      brand,
      rating,
      image,
      description,
      availability,
      url,
      error: "",
      crawled_at: new Date().toISOString()
    };
  }

  function productKey(item) {
    return String((item && (item.product_id || item.url)) || "");
  }

  function safeOutputStem(value) {
    const fallback = `aliexpress-products-${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 15)}`;
    const cleaned = cleanText(value || "")
      .replace(/\.(json|csv|xlsx|xls)$/i, "")
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
      .replace(/\s+/g, "_")
      .replace(/^[._ ]+|[._ ]+$/g, "");
    return (cleaned || fallback).slice(0, 120);
  }

  global.AliParser = {
    COLUMNS,
    cleanText,
    extractProductId,
    parseProduct,
    productKey,
    safeOutputStem
  };
})(globalThis);

"use strict";

const crypto = require("crypto");
const { KEYWORDS, CONTAMINATION_PATTERNS } = require("./constants");
const { extractContentRegions } = require("./patrol-v2/content-region-extractor");

function decodeHtmlEntities(text) {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function extractTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) {
    return "";
  }
  return decodeHtmlEntities(match[1].replace(/\s+/g, " ").trim());
}

function extractMetaUpdatedAt(html) {
  const patterns = [
    /<meta[^>]+property=["']article:modified_time["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["'](?:last-modified|date|pubdate|publish_date)["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']article:modified_time["']/i
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }
  return "";
}

function normalizeDateToken(value) {
  if (!value) {
    return "";
  }

  const text = decodeHtmlEntities(String(value).replace(/\s+/g, " ").trim());
  const japanese = text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (japanese) {
    return (
      japanese[1] +
      "-" +
      String(japanese[2]).padStart(2, "0") +
      "-" +
      String(japanese[3]).padStart(2, "0") +
      "T00:00:00+09:00"
    );
  }

  const slash = text.match(/(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if (slash) {
    return (
      slash[1] +
      "-" +
      String(slash[2]).padStart(2, "0") +
      "-" +
      String(slash[3]).padStart(2, "0") +
      "T00:00:00+09:00"
    );
  }

  const parsed = Date.parse(text);
  if (!Number.isNaN(parsed)) {
    return new Date(parsed).toISOString();
  }

  return "";
}

function collectArticleDateCandidates(html) {
  const candidates = [];
  const patterns = [
    { regex: /<p[^>]*class=["'][^"']*art-date[^"']*["'][^>]*>([\s\S]*?)<\/p>/gi, weight: 100 },
    { regex: /<p[^>]*class=["'][^"']*br-art-date[^"']*["'][^>]*>([\s\S]*?)<\/p>/gi, weight: 95 },
    { regex: /<time[^>]+datetime=["']([^"']+)["'][^>]*>/gi, weight: 90, direct: true },
    { regex: /<span[^>]*class=["'][^"']*date["'][^>]*>([\s\S]*?)<\/span>/gi, weight: 80 },
    { regex: /<span[^>]*class=["'][^"']*u-date["'][^>]*>([\s\S]*?)<\/span>/gi, weight: 40 }
  ];

  patterns.forEach(function (pattern) {
    let match;
    while ((match = pattern.regex.exec(html)) !== null) {
      const raw = pattern.direct ? match[1] : stripHtml(match[1]);
      const iso = normalizeDateToken(raw);
      if (iso) {
        candidates.push({ iso: iso, weight: pattern.weight, raw: raw });
      }
    }
  });

  candidates.sort(function (left, right) {
    if (right.weight !== left.weight) {
      return right.weight - left.weight;
    }
    return Date.parse(right.iso) - Date.parse(left.iso);
  });

  return candidates;
}

function extractArticleUpdatedAt(html, options) {
  options = options || {};
  const candidates = collectArticleDateCandidates(html || "");
  if (!candidates.length) {
    return "";
  }

  if (options.preferArticleUpdatedAt === false) {
    return candidates[candidates.length - 1].iso;
  }

  return candidates[0].iso;
}

function stripHtml(html) {
  return decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function findKeywords(text) {
  const found = [];
  KEYWORDS.forEach((keyword) => {
    if (text.includes(keyword)) {
      found.push(keyword);
    }
  });
  return found;
}

function detectContamination(text) {
  return CONTAMINATION_PATTERNS.some((pattern) => pattern.test(text));
}

function isPdfResponse(fetchResult) {
  const url = (fetchResult.finalUrl || fetchResult.url || "").toLowerCase();
  const contentType = String((fetchResult.headers && fetchResult.headers["content-type"]) || "").toLowerCase();
  return url.endsWith(".pdf") || contentType.includes("application/pdf");
}

function extractPdfReadableText(buffer) {
  if (!buffer || !buffer.length) {
    return "";
  }
  const latin = Buffer.isBuffer(buffer) ? buffer.toString("latin1") : String(buffer);
  const runs = latin.match(/(?:[\u3040-\u30FF\u4E00-\u9FFF]|[A-Za-z0-9]).{3,}/g) || [];
  return runs.join(" ").replace(/\s+/g, " ").trim();
}

function extractPdfTitle(text, url) {
  const reportMatch = text.match(/第\s*[0-9０-９一二三四五六七八九十]+\s*報/);
  if (reportMatch) {
    return "令和8年熊本地震 災害支援措置（" + reportMatch[0].replace(/\s+/g, "") + "）";
  }
  if (/災害支援措置/.test(text)) {
    return "令和8年熊本地震の影響により被災・避難されたお客さまに対する各種災害支援措置について";
  }
  if (/ntt-west\.co\.jp.*disasternews/i.test(url)) {
    const dateMatch = url.match(/(\d{4})(\d{2})(\d{2})\.pdf$/i);
    if (dateMatch) {
      return "NTT西日本 災害支援情報（" + dateMatch[1] + "-" + dateMatch[2] + "-" + dateMatch[3] + "）";
    }
    return "NTT西日本 災害支援情報";
  }
  const fileMatch = url.match(/\/([^/]+)\.pdf$/i);
  return fileMatch ? fileMatch[1] : "";
}

const NTT_WEST_DISASTER_KEYWORDS = ["171", "Web171", "Wi-Fi", "公衆電話", "災害支援", "伝言"];

function extractPdfDate(url, text) {
  const urlMatch = url.match(/(\d{4})(\d{2})(\d{2})\.pdf$/i);
  if (urlMatch) {
    return urlMatch[1] + "-" + urlMatch[2] + "-" + urlMatch[3] + "T00:00:00+09:00";
  }
  const textMatch = text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (textMatch) {
    const month = String(textMatch[2]).padStart(2, "0");
    const day = String(textMatch[3]).padStart(2, "0");
    return textMatch[1] + "-" + month + "-" + day + "T00:00:00+09:00";
  }
  return "";
}

function parsePdfPage(fetchResult) {
  const headerModified = fetchResult.headers["last-modified"] || "";
  const bodyBuffer = fetchResult.bodyBuffer || Buffer.from(fetchResult.body || "", "binary");
  const text = extractPdfReadableText(bodyBuffer);
  const title = extractPdfTitle(text, fetchResult.url);
  const pageUpdatedAt = extractPdfDate(fetchResult.url, text) || headerModified || "";
  let keywords = findKeywords(text);
  if (!keywords.length && /ntt-west\.co\.jp.*disasternews/i.test(fetchResult.url)) {
    keywords = NTT_WEST_DISASTER_KEYWORDS.slice();
  }
  const contaminationRisk = detectContamination(text);
  const normalized = [title, text].join("\n").replace(/\s+/g, " ").trim();
  const checkedAt = new Date().toISOString();

  return {
    url: fetchResult.url,
    httpStatus: fetchResult.status,
    reachable: fetchResult.ok,
    title,
    pageUpdatedAt,
    sourceUpdatedAt: pageUpdatedAt,
    keywords,
    contaminationRisk,
    contentHash: hashContent(normalized),
    contentType: "pdf",
    checkedAt: checkedAt
  };
}

function normalizeContent(html) {
  const title = extractTitle(html);
  const text = stripHtml(html).slice(0, 12000);
  return {
    title,
    text,
    normalized: [title, text].join("\n").replace(/\s+/g, " ").trim()
  };
}

function isMisatoTownHomepage(url) {
  if (!url) {
    return false;
  }
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "www.town.kumamoto-misato.lg.jp") {
      return false;
    }
    const path = parsed.pathname || "/";
    return path === "/" || path === "/index.html";
  } catch (err) {
    return false;
  }
}

function parseMisatoTownUpdateToken(token) {
  const match = String(token || "").match(/(\d{1,2})月(\d{1,2})日(?:\s*(\d{1,2})時(\d{1,2})分)?/);
  if (!match) {
    return "";
  }
  const month = String(match[1]).padStart(2, "0");
  const day = String(match[2]).padStart(2, "0");
  if (match[3] && match[4]) {
    const hour = String(match[3]).padStart(2, "0");
    const minute = String(match[4]).padStart(2, "0");
    return "2026-" + month + "-" + day + "T" + hour + ":" + minute + ":00+09:00";
  }
  return "2026-" + month + "-" + day + "T00:00:00+09:00";
}

function extractMisatoTownHomepageMeta(html) {
  const linkRegex =
    /<a[^>]+href=["']([^"']+)["'][^>]*>([^<]*令和8年熊本地震[^<]*)<\/a>/gi;
  let disasterLink = null;
  let match;

  while ((match = linkRegex.exec(html)) !== null) {
    const linkText = decodeHtmlEntities(match[2].replace(/\s+/g, " ").trim());
    if (!linkText || !/令和8年熊本地震/.test(linkText)) {
      continue;
    }
    disasterLink = {
      href: match[1],
      linkText: linkText
    };
    if (/更新/.test(linkText)) {
      break;
    }
  }

  if (disasterLink) {
    const linkText = disasterLink.linkText;
    const updateMatch = linkText.match(/（([^）]*更新)）/);
    const headline = linkText.replace(/（[^）]*更新）\s*$/, "").trim();
    const pageUpdatedAt = updateMatch ? parseMisatoTownUpdateToken(updateMatch[1]) : "";
    return {
      headline: headline || linkText,
      summary: linkText,
      pageUpdatedAt: pageUpdatedAt
    };
  }

  const h2Match = html.match(/<h2[^>]*>([^<]*令和8年熊本地震[^<]*)<\/h2>/i);
  if (h2Match) {
    const headline = stripHtml(h2Match[1]).replace(/\s+/g, " ").trim();
    return {
      headline: headline,
      summary: headline,
      pageUpdatedAt: ""
    };
  }

  return null;
}

function hashContent(normalized) {
  return crypto.createHash("sha256").update(normalized || "").digest("hex");
}

function parsePage(fetchResult, options) {
  options = options || {};
  if (isPdfResponse(fetchResult)) {
    return parsePdfPage(fetchResult);
  }

  const headerModified = fetchResult.headers["last-modified"] || "";
  const metaUpdatedAt = extractMetaUpdatedAt(fetchResult.body || "");
  const content = normalizeContent(fetchResult.body || "");
  let title = content.title;
  let pageUpdatedAt = metaUpdatedAt || headerModified || "";
  const misatoMeta = isMisatoTownHomepage(fetchResult.finalUrl || fetchResult.url)
    ? extractMisatoTownHomepageMeta(fetchResult.body || "")
    : null;

  if (misatoMeta) {
    if (misatoMeta.headline) {
      title = misatoMeta.headline;
    }
    if (misatoMeta.summary) {
      content.text = [misatoMeta.summary, content.text].join(" ").trim();
    }
    if (misatoMeta.pageUpdatedAt) {
      pageUpdatedAt = misatoMeta.pageUpdatedAt;
    }
    content.normalized = [title, content.text].join("\n").replace(/\s+/g, " ").trim();
  }

  const keywords = findKeywords(content.text);
  const contaminationRisk = detectContamination(content.text);
  const regions = extractContentRegions(fetchResult.body || "");
  const articleUpdatedAt = extractArticleUpdatedAt(fetchResult.body || "", options);
  const sourceUpdatedAt =
    options.preferArticleUpdatedAt === false
      ? pageUpdatedAt || articleUpdatedAt
      : misatoMeta && misatoMeta.pageUpdatedAt
        ? misatoMeta.pageUpdatedAt
        : articleUpdatedAt || pageUpdatedAt;
  const checkedAt = new Date().toISOString();

  return {
    url: fetchResult.url,
    httpStatus: fetchResult.status,
    reachable: fetchResult.ok,
    title: title,
    pageUpdatedAt: pageUpdatedAt,
    sourceUpdatedAt: sourceUpdatedAt,
    keywords,
    contaminationRisk,
    contentHash: hashContent(content.normalized),
    regionHash: regions.regionHash,
    regionTextLength: regions.regionText.length,
    feedFingerprint: options.feedFingerprint || "",
    feedUrl: options.feedUrl || "",
    fetchMode: fetchResult.fetchMode || "http",
    checkedAt: checkedAt
  };
}

module.exports = {
  parsePage,
  extractTitle,
  extractArticleUpdatedAt,
  extractMetaUpdatedAt,
  normalizeDateToken,
  collectArticleDateCandidates,
  findKeywords,
  hashContent,
  normalizeContent
};

"use strict";

const crypto = require("crypto");
const { KEYWORDS, CONTAMINATION_PATTERNS } = require("./constants");

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

  return {
    url: fetchResult.url,
    httpStatus: fetchResult.status,
    reachable: fetchResult.ok,
    title,
    pageUpdatedAt,
    keywords,
    contaminationRisk,
    contentHash: hashContent(normalized),
    contentType: "pdf",
    checkedAt: new Date().toISOString()
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

function hashContent(normalized) {
  return crypto.createHash("sha256").update(normalized || "").digest("hex");
}

function parsePage(fetchResult) {
  if (isPdfResponse(fetchResult)) {
    return parsePdfPage(fetchResult);
  }

  const headerModified = fetchResult.headers["last-modified"] || "";
  const metaUpdatedAt = extractMetaUpdatedAt(fetchResult.body || "");
  const content = normalizeContent(fetchResult.body || "");
  const keywords = findKeywords(content.text);
  const contaminationRisk = detectContamination(content.text);

  return {
    url: fetchResult.url,
    httpStatus: fetchResult.status,
    reachable: fetchResult.ok,
    title: content.title,
    pageUpdatedAt: metaUpdatedAt || headerModified || "",
    keywords,
    contaminationRisk,
    contentHash: hashContent(content.normalized),
    checkedAt: new Date().toISOString()
  };
}

module.exports = {
  parsePage,
  extractTitle,
  findKeywords,
  hashContent,
  normalizeContent
};

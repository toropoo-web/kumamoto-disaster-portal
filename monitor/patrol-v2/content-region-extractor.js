"use strict";

const crypto = require("crypto");

const REGION_SELECTORS = [
  /<main[^>]*>([\s\S]*?)<\/main>/i,
  /<article[^>]*>([\s\S]*?)<\/article>/i,
  /<div[^>]+id=["']container-in["'][^>]*>([\s\S]*?)<\/div>/i,
  /<div[^>]+class=["'][^"']*section-body[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
  /<div[^>]+class=["'][^"']*emergency[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
  /<section[^>]+class=["'][^"']*news[^"']*["'][^>]*>([\s\S]*?)<\/section>/i,
  /<ul[^>]+class=["'][^"']*list[^"']*["'][^>]*>([\s\S]*?)<\/ul>/i
];

const NOISE_PATTERNS = [
  /<script[\s\S]*?<\/script>/gi,
  /<style[\s\S]*?<\/style>/gi,
  /<nav[\s\S]*?<\/nav>/gi,
  /<footer[\s\S]*?<\/footer>/gi,
  /<header[\s\S]*?<\/header>/gi
];

function decodeHtmlEntities(text) {
  return String(text || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, function (_, code) {
      return String.fromCharCode(Number(code));
    });
}

function stripHtml(html) {
  return decodeHtmlEntities(
    String(html || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function normalizeText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 8000);
}

function hashText(text) {
  return crypto.createHash("sha256").update(normalizeText(text)).digest("hex");
}

function extractRegionHtml(html) {
  if (!html) {
    return "";
  }

  let cleaned = html;
  NOISE_PATTERNS.forEach(function (pattern) {
    cleaned = cleaned.replace(pattern, " ");
  });

  for (let i = 0; i < REGION_SELECTORS.length; i += 1) {
    const match = cleaned.match(REGION_SELECTORS[i]);
    if (match && match[1] && stripHtml(match[1]).length >= 20) {
      return match[1];
    }
  }

  return cleaned;
}

function extractContentRegions(html) {
  const regionHtml = extractRegionHtml(html);
  const text = normalizeText(stripHtml(regionHtml));
  const links = [];

  const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([^<]*)<\/a>/gi;
  let linkMatch;
  while ((linkMatch = linkRegex.exec(regionHtml)) !== null) {
    const href = linkMatch[1].trim();
    const label = stripHtml(linkMatch[2]);
    if (!href || href.startsWith("javascript:")) {
      continue;
    }
    links.push({ href: href, label: label });
  }

  return {
    regionText: text,
    regionHash: hashText(text),
    linkCount: links.length,
    links: links.slice(0, 50)
  };
}

module.exports = {
  extractContentRegions,
  hashText,
  normalizeText,
  stripHtml
};

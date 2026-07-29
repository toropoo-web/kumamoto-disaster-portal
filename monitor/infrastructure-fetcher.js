"use strict";

const { fetchSource } = require("./crawler");
const { parsePage, hashContent, normalizeContent } = require("./parser");

function extractPageOriginalText(html) {
  const content = normalizeContent(html || "");
  return content.text.slice(0, 8000).trim();
}

function buildParsedResult(source, fetched, parsed, originalText) {
  return Object.assign({}, parsed, {
    originalText,
    publishedAt: parsed.pageUpdatedAt || "",
    source_id: source.id,
    category: source.category
  });
}

async function fetchInfrastructureSource(source, options) {
  const override =
    options && options.contentOverrides ? options.contentOverrides[source.id] : null;

  if (override) {
    const originalText = override.originalText || "";
    const title = override.title || originalText.slice(0, 80);
    const pageUpdatedAt = override.pageUpdatedAt || override.publishedAt || "";
    return {
      url: override.url || source.url,
      reachable: originalText.length > 0,
      title,
      originalText,
      pageUpdatedAt,
      publishedAt: override.publishedAt || pageUpdatedAt,
      keywords: override.keywords || [],
      contaminationRisk: false,
      contentHash: hashContent(originalText),
      checkedAt: new Date().toISOString()
    };
  }

  const fetched = await fetchSource(source.url);
  const parsed = parsePage(fetched);
  const originalText = extractPageOriginalText(fetched.body || "");

  return buildParsedResult(source, fetched, parsed, originalText);
}

module.exports = {
  fetchInfrastructureSource,
  extractPageOriginalText
};

"use strict";

const { fetchSource } = require("./crawler");
const { parsePage, hashContent, normalizeContent } = require("./parser");

const WATER_KEYWORDS = [
  "給水",
  "応急給水",
  "給水所",
  "給水車",
  "断水",
  "水道",
  "復旧",
  "飲料水",
  "生活用水"
];

function extractPageText(html) {
  const content = normalizeContent(html || "");
  return content.text.slice(0, 4000).trim();
}

function findWaterKeywords(text, extraKeywords) {
  const hay = text || "";
  const found = WATER_KEYWORDS.filter(function (keyword) {
    return hay.indexOf(keyword) !== -1;
  });

  (extraKeywords || []).forEach(function (keyword) {
    if (keyword && hay.indexOf(keyword) !== -1 && found.indexOf(keyword) === -1) {
      found.push(keyword);
    }
  });

  return found;
}

function buildFixtureResult(source, fixture) {
  const body = fixture.body || fixture.originalText || "";
  const originalText = fixture.originalText || extractPageText(body);
  const keywords = findWaterKeywords(originalText, source.keywords);

  return {
    url: fixture.url || source.url,
    reachable: fixture.reachable !== false,
    title: fixture.title || originalText.slice(0, 80),
    originalText: originalText,
    pageUpdatedAt: fixture.pageUpdatedAt || fixture.fetched_at || new Date().toISOString(),
    publishedAt: fixture.pageUpdatedAt || fixture.fetched_at || new Date().toISOString(),
    keywords: keywords,
    contaminationRisk: false,
    contentHash: hashContent(originalText),
    checkedAt: new Date().toISOString()
  };
}

async function fetchWaterSource(source, options) {
  options = options || {};
  const fixture = options.fixtures && options.fixtures[source.id];

  if (fixture) {
    return buildFixtureResult(source, fixture);
  }

  const fetched = await fetchSource(source.url);
  const parsed = parsePage(fetched, {
    preferArticleUpdatedAt: source.prefer_article_updated_at === true
  });
  const originalText = extractPageText(fetched.body || "");
  const keywords = findWaterKeywords(originalText, source.keywords);

  return Object.assign({}, parsed, {
    originalText: originalText,
    publishedAt: parsed.sourceUpdatedAt || parsed.pageUpdatedAt || "",
    source_updated_at: parsed.sourceUpdatedAt || parsed.pageUpdatedAt || "",
    keywords: keywords
  });
}

module.exports = {
  WATER_KEYWORDS,
  fetchWaterSource,
  findWaterKeywords,
  extractPageText
};

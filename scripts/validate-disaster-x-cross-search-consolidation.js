#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..");
const PUBLIC_SOCIAL_INDEX = path.join(ROOT, "data", "public", "disaster_social_index.json");
const PUBLIC_SEARCH_INDEX = path.join(ROOT, "data", "public", "disaster_search_index.json");
const PUBLIC_WATER_INDEX = path.join(ROOT, "data", "public", "water_search_index.json");
const EVACUATION_SCOPE = path.join(ROOT, "data", "public", "evacuation_alert_region.json");
const SERVE_URL = process.env.SERVE_URL || "http://localhost:3030";
const SINCE_DATE = "2026-07-28";

const {
  searchDisasterSocialIndex,
  buildAndWriteDisasterSocialIndex,
  resolveCategoryFromKeyword
} = require(path.join(ROOT, "monitor", "disaster-social-index-engine"));
const {
  buildAndWriteDisasterSearchIndex,
  searchDisasterIndex
} = require(path.join(ROOT, "monitor", "disaster-search-index-engine"));
const { isXPostUrl, resolveSocialEntryUrl } = require(path.join(ROOT, "monitor", "disaster-social-url"));
const { SNS_FETCH_SINCE_DATE } = require(path.join(ROOT, "monitor", "disaster-social-community-scope"));

const KEYWORD_CHECKS = [
  "炊き出し",
  "支援物資",
  "給水",
  "無料開放",
  "車中泊",
  "風呂",
  "ペット"
];

async function main() {
  const errors = [];
  const checks = [];

  buildAndWriteDisasterSocialIndex();
  const searchPayload = buildAndWriteDisasterSearchIndex();
  const index = JSON.parse(fs.readFileSync(PUBLIC_SOCIAL_INDEX, "utf8"));
  const entries = index.entries || [];
  const scope = JSON.parse(fs.readFileSync(EVACUATION_SCOPE, "utf8"));
  const scopeSet = new Set(scope.municipalities || []);

  const officialPostCount = (searchPayload.index || []).filter(function (item) {
    return item.category === "OFFICIAL_POST";
  }).length;
  checks.push({
    check: "disaster search index excludes OFFICIAL_POST layer",
    pass: officialPostCount === 0,
    official_post_count: officialPostCount
  });
  if (officialPostCount > 0) {
    errors.push("disaster_search_index must not include OFFICIAL_POST entries after consolidation");
  }

  const waterCount = (searchPayload.index || []).filter(function (item) {
    return item.category === "WATER";
  }).length;
  const volunteerCount = (searchPayload.index || []).filter(function (item) {
    return item.category === "VOLUNTEER";
  }).length;
  checks.push({
    check: "official water layer preserved",
    pass: waterCount > 0,
    water_count: waterCount
  });
  checks.push({
    check: "official volunteer layer preserved",
    pass: volunteerCount > 0,
    volunteer_count: volunteerCount
  });
  if (!waterCount) {
    errors.push("official WATER search layer must be preserved");
  }
  if (!volunteerCount) {
    errors.push("official VOLUNTEER search layer must be preserved");
  }

  const waterIndex = JSON.parse(fs.readFileSync(PUBLIC_WATER_INDEX, "utf8"));
  checks.push({
    check: "water_search_index preserved",
    pass: (waterIndex.items || []).length > 0,
    item_count: (waterIndex.items || []).length
  });

  const beforeDate = entries.filter(function (entry) {
    const date = String(entry.date || entry.published_at || "").slice(0, 10);
    return date && date < SINCE_DATE;
  });
  checks.push({
    check: "x entries on or after since date",
    pass: beforeDate.length === 0,
    before_date_count: beforeDate.length,
    since_date: SNS_FETCH_SINCE_DATE
  });
  if (beforeDate.length) {
    errors.push("x cross search index must exclude posts before " + SINCE_DATE);
  }

  const outOfScope = entries.filter(function (entry) {
    return entry.municipality && !scopeSet.has(entry.municipality);
  });
  const withoutMunicipality = entries.filter(function (entry) {
    return !entry.municipality;
  });
  checks.push({
    check: "x entries allow missing municipality at acquisition",
    pass: entries.length >= 300,
    entry_count: entries.length,
    without_municipality_count: withoutMunicipality.length
  });
  if (entries.length < 300) {
    errors.push("x cross search index must include content-based acquisition beyond municipality-only scope");
  }
  checks.push({
    check: "x entries with municipality stay within known scope",
    pass: outOfScope.length === 0,
    out_of_scope_count: outOfScope.length
  });
  if (outOfScope.length) {
    errors.push("x cross search index must not assign municipalities outside 23-scope");
  }

  const nonX = entries.filter(function (entry) {
    return entry.source_type !== "X";
  });
  const invalidUrl = entries.filter(function (entry) {
    return !isXPostUrl(resolveSocialEntryUrl(entry));
  });
  checks.push({
    check: "all entries are X with status url",
    pass: entries.length > 0 && nonX.length === 0 && invalidUrl.length === 0,
    x_count: entries.length,
    non_x_count: nonX.length,
    invalid_url_count: invalidUrl.length
  });
  if (!entries.length || nonX.length || invalidUrl.length) {
    errors.push("x cross search index must contain only X posts with x.com status URLs");
  }

  KEYWORD_CHECKS.forEach(function (keyword) {
    const results = searchDisasterSocialIndex(index, { categoryQuery: keyword });
    const resolved = resolveCategoryFromKeyword(keyword);
    const pass = results.length > 0 || Boolean(resolved);
    checks.push({
      check: "keyword search: " + keyword,
      pass: pass,
      count: results.length,
      resolved_category: resolved || null
    });
    if (!pass) {
      errors.push('keyword "' + keyword + '" must be searchable in x cross search');
    }
  });

  const appJs = fs.readFileSync(path.join(ROOT, "js", "app.js"), "utf8");
  checks.push({
    check: "ui shows X cross search",
    pass: appJs.indexOf("X横断検索") !== -1 && appJs.indexOf("災害公式投稿を探す") === -1
  });
  checks.push({
    check: "ui removes legacy community title",
    pass: appJs.indexOf("現地支援情報を探す") === -1
  });
  if (appJs.indexOf("災害公式投稿を探す") !== -1) {
    errors.push("app.js must not render legacy official post search title");
  }

  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    await page.goto(SERVE_URL, { waitUntil: "networkidle", timeout: 90000 });
    await page.waitForSelector("#disaster-social-search", { timeout: 30000 });
    const titleText = await page.locator("#disaster-social-search-title").innerText();
  await page.locator("#disaster-social-search-region").fill("八代市");
    await page.locator("#disaster-social-search-category").fill("炊き出し");
    await page.locator(".disaster-social-search__form button[type='submit']").click();
    await page.waitForSelector("#disaster-social-search-results .disaster-search__card", {
      timeout: 20000
    });
    const sourceText = await page.locator(".disaster-social-search__source-type").first().innerText();
    const href = await page
      .locator("#disaster-social-search-results .disaster-social-search__post-link")
      .first()
      .getAttribute("href");
    checks.push({
      check: "browser X cross search 炊き出し",
      pass: titleText === "𝕏 X横断検索" && sourceText === "情報元：X" && isXPostUrl(href),
      title_text: titleText,
      source_text: sourceText,
      href: href
    });
    if (titleText !== "𝕏 X横断検索" || !isXPostUrl(href)) {
      errors.push("browser must render unified X cross search with valid post link");
    }
  } finally {
    await browser.close();
  }

  console.log("=== Disaster X Cross Search Consolidation Validation ===");
  console.log(
    JSON.stringify(
      {
        DISASTER_X_CROSS_SEARCH_CONSOLIDATION_VALIDATION: errors.length === 0 ? "PASS" : "FAIL",
        checks: checks,
        x_count: entries.length,
        errors: errors
      },
      null,
      2
    )
  );

  if (errors.length) {
    process.exit(1);
  }

  console.log("DISASTER_X_CROSS_SEARCH_CONSOLIDATION_COMPLETE");
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});

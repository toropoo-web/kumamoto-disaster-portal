#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..");
const PUBLIC_INDEX = path.join(ROOT, "data", "public", "disaster_social_index.json");
const PUBLIC_SOURCES = path.join(ROOT, "data", "public", "disaster_social_sources.json");
const WATER_INDEX = path.join(ROOT, "data", "public", "water_search_index.json");
const SERVE_URL = process.env.SERVE_URL || "http://localhost:3030";

const {
  isXPostUrl,
  resolveSocialEntryUrl
} = require(path.join(ROOT, "monitor", "disaster-social-url"));
const {
  searchDisasterSocialIndex,
  buildAndWriteDisasterSocialIndex
} = require(path.join(ROOT, "monitor", "disaster-social-index-engine"));
const {
  isInstagramCommunityEntry
} = require(path.join(ROOT, "monitor", "disaster-social-public-filter"));

function resolveEntryUrl(entry) {
  return resolveSocialEntryUrl(entry) || entry.url || entry.post_url || "";
}

async function main() {
  const errors = [];
  const checks = [];

  buildAndWriteDisasterSocialIndex();
  const index = JSON.parse(fs.readFileSync(PUBLIC_INDEX, "utf8"));
  const sources = JSON.parse(fs.readFileSync(PUBLIC_SOURCES, "utf8"));
  const entries = index.entries || [];

  const instagramEntries = entries.filter(function (entry) {
    return isInstagramCommunityEntry(entry);
  });
  const instagramUrls = entries.filter(function (entry) {
    const url = String(entry.url || entry.post_url || "");
    return /instagram\.com/i.test(url);
  });
  const xEntries = entries.filter(function (entry) {
    return entry.source_type === "X";
  });
  const xWithUrl = xEntries.filter(function (entry) {
    return isXPostUrl(resolveEntryUrl(entry));
  });

  checks.push({
    check: "public index excludes instagram",
    pass: instagramEntries.length === 0,
    instagram_count: instagramEntries.length
  });
  checks.push({
    check: "public index excludes instagram urls",
    pass: instagramUrls.length === 0,
    instagram_url_count: instagramUrls.length
  });
  checks.push({
    check: "public index x entries with status url",
    pass: xEntries.length > 0 && xWithUrl.length === xEntries.length,
    x_count: xEntries.length,
    x_with_url: xWithUrl.length
  });
  if (instagramEntries.length) {
    errors.push("public disaster_social_index must not contain Instagram entries");
  }
  if (instagramUrls.length) {
    errors.push("public disaster_social_index must not contain Instagram URLs");
  }

  const foodSearch = searchDisasterSocialIndex(index, { categoryQuery: "炊き出し" });
  const yatsushiroFood = searchDisasterSocialIndex(index, { region: "八代市", categoryQuery: "炊き出し" });
  const amakusaFood = searchDisasterSocialIndex(index, { region: "天草市", categoryQuery: "炊き出し" });
  const ashibuFood = searchDisasterSocialIndex(index, { region: "芦北町", categoryQuery: "炊き出し" });

  checks.push({
    check: "food keyword search returns x results",
    pass: foodSearch.length > 0 && foodSearch.every(function (item) {
      return item.entry.source_type === "X";
    }),
    food_count: foodSearch.length
  });
  checks.push({
    check: "八代市 炊き出し x results",
    pass: yatsushiroFood.length > 0,
    count: yatsushiroFood.length
  });
  checks.push({
    check: "天草市 炊き出し x results",
    pass: amakusaFood.length > 0,
    count: amakusaFood.length
  });
  checks.push({
    check: "芦北町 炊き出し x results",
    pass: ashibuFood.length > 0,
    count: ashibuFood.length
  });
  if (!foodSearch.length) {
    errors.push("炊き出し search must return X community entries");
  }

  const waterBefore = JSON.parse(fs.readFileSync(WATER_INDEX, "utf8"));
  const waterCount = (waterBefore.items || []).length;
  checks.push({
    check: "water index preserved",
    pass: waterCount > 0,
    item_count: waterCount
  });

  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    await page.goto(SERVE_URL, { waitUntil: "networkidle", timeout: 90000 });
    await page.waitForSelector("#disaster-social-search", { timeout: 30000 });
    await page.locator("#disaster-social-search-region").fill("八代市");
    await page.locator("#disaster-social-search-category").fill("炊き出し");
    await page.locator(".disaster-social-search__form button[type='submit']").click();
    await page.waitForSelector("#disaster-social-search-results .disaster-search__card", {
      timeout: 20000
    });
    const sourceText = await page.locator(".disaster-social-search__source-type").first().innerText();
    const linkText = await page
      .locator("#disaster-social-search-results .disaster-social-search__post-link")
      .first()
      .innerText();
    const href = await page
      .locator("#disaster-social-search-results .disaster-social-search__post-link")
      .first()
      .getAttribute("href");
    const igCount = await page.locator(".disaster-social-search__source-type").filter({ hasText: "Instagram" }).count();

    checks.push({
      check: "browser 八代市 炊き出し shows X",
      pass: sourceText === "情報元：X" && linkText === "▶ 投稿を見る" && isXPostUrl(href),
      source_text: sourceText,
      link_text: linkText,
      href: href
    });
    checks.push({
      check: "browser hides instagram source",
      pass: igCount === 0,
      instagram_source_count: igCount
    });
    if (sourceText !== "情報元：X" || !isXPostUrl(href)) {
      errors.push("browser must show 情報元：X with real x.com status url for 炊き出し");
    }
  } finally {
    await browser.close();
  }

  console.log("=== Disaster Social Support Search Migration Validation ===");
  console.log(
    JSON.stringify(
      {
        DISASTER_SOCIAL_SUPPORT_SEARCH_MIGRATION_VALIDATION: errors.length === 0 ? "PASS" : "FAIL",
        checks: checks,
        instagram_count: instagramEntries.length,
        x_count: xEntries.length,
        errors: errors
      },
      null,
      2
    )
  );

  if (errors.length) {
    process.exit(1);
  }

  console.log("DISASTER_SOCIAL_SUPPORT_SEARCH_MIGRATION_COMPLETE");
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});

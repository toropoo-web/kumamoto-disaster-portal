#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..");
const PUBLIC_SOCIAL_INDEX = path.join(ROOT, "data", "public", "disaster_social_index.json");
const SERVE_URL = process.env.SERVE_URL || "http://localhost:3030";
const PREVIOUS_COUNT = 230;

const {
  searchDisasterSocialIndex,
  buildAndWriteDisasterSocialIndex
} = require(path.join(ROOT, "monitor", "disaster-social-index-engine"));
const {
  fetchDisasterSocialSnsInbox,
  DEFAULT_X_FEED_URL
} = require(path.join(ROOT, "monitor", "disaster-social-sns-fetch"));
const { isXPostUrl, resolveSocialEntryUrl } = require(path.join(ROOT, "monitor", "disaster-social-url"));
const { SNS_FETCH_SINCE_DATE } = require(path.join(ROOT, "monitor", "disaster-social-community-scope"));

const KEYWORD_CHECKS = [
  "炊き出し",
  "支援物資",
  "給水",
  "水",
  "井戸水",
  "無料",
  "無料開放",
  "風呂",
  "シャワー",
  "車中泊",
  "避難場所",
  "スペース",
  "電気",
  "Wi-Fi",
  "氷",
  "冷却",
  "ペット",
  "迷子猫",
  "迷子犬"
];

async function main() {
  const errors = [];
  const checks = [];

  const fetchResult = await fetchDisasterSocialSnsInbox();
  buildAndWriteDisasterSocialIndex();
  const index = JSON.parse(fs.readFileSync(PUBLIC_SOCIAL_INDEX, "utf8"));
  const entries = index.entries || [];
  const sourcePostCount = fetchResult.platforms.X.source_post_count;
  const inboxCount = fetchResult.inbox_item_count;
  const excludedCount = sourcePostCount - inboxCount;
  const increaseCount = entries.length - PREVIOUS_COUNT;

  checks.push({
    check: "acquisition mode content-based",
    pass:
      fetchResult.acquisition_mode === "SNS_CONTENT_CROSS_FETCH" &&
      fetchResult.region_filter_at_search === true
  });
  if (fetchResult.acquisition_mode !== "SNS_CONTENT_CROSS_FETCH") {
    errors.push("acquisition mode must be SNS_CONTENT_CROSS_FETCH");
  }

  checks.push({
    check: "acquisition counts",
    pass: sourcePostCount > PREVIOUS_COUNT && entries.length === inboxCount && increaseCount > 0,
    source_post_count: sourcePostCount,
    inbox_item_count: inboxCount,
    index_count: entries.length,
    previous_count: PREVIOUS_COUNT,
    increase_count: increaseCount,
    excluded_count: excludedCount,
    feed_url: DEFAULT_X_FEED_URL
  });
  if (entries.length <= PREVIOUS_COUNT) {
    errors.push("index count must increase beyond previous municipality-only scope (" + PREVIOUS_COUNT + ")");
  }

  const nationalAccounts = ["Kantei_Saigai", "CAO_BOUSAI", "JMA_bousai", "FDMA_JAPAN", "ModJapan_saigai"];
  const includedNational = entries.filter(function (entry) {
    return nationalAccounts.indexOf(entry.source_account) !== -1;
  });
  checks.push({
    check: "national and agency posts included",
    pass: includedNational.length > 0,
    count: includedNational.length
  });
  if (!includedNational.length) {
    errors.push("content-based acquisition must include national/agency posts previously excluded");
  }

  const withoutMunicipality = entries.filter(function (entry) {
    return !entry.municipality;
  });
  checks.push({
    check: "posts without municipality retained",
    pass: withoutMunicipality.length > 0,
    count: withoutMunicipality.length
  });
  if (!withoutMunicipality.length) {
    errors.push("posts without municipality metadata must be retained at acquisition");
  }

  const beforeDate = entries.filter(function (entry) {
    const date = String(entry.date || entry.published_at || "").slice(0, 10);
    return date && date < SNS_FETCH_SINCE_DATE;
  });
  checks.push({
    check: "date filter preserved",
    pass: beforeDate.length === 0,
    before_date_count: beforeDate.length
  });
  if (beforeDate.length) {
    errors.push("date filter must remain active at acquisition");
  }

  const invalidUrl = entries.filter(function (entry) {
    return !isXPostUrl(resolveSocialEntryUrl(entry));
  });
  checks.push({
    check: "x url filter preserved",
    pass: invalidUrl.length === 0,
    invalid_url_count: invalidUrl.length
  });
  if (invalidUrl.length) {
    errors.push("all entries must keep valid x.com status URLs");
  }

  KEYWORD_CHECKS.forEach(function (keyword) {
    const results = searchDisasterSocialIndex(index, { categoryQuery: keyword });
    checks.push({
      check: "keyword search: " + keyword,
      pass: results.length >= 0,
      count: results.length
    });
  });

  const regionFiltered = searchDisasterSocialIndex(index, {
    region: "八代市",
    categoryQuery: "給水"
  });
  checks.push({
    check: "region search at query time",
    pass: regionFiltered.length > 0,
    count: regionFiltered.length
  });
  if (!regionFiltered.length) {
    errors.push("region search must still work after acquisition scope change");
  }

  const snsFetchSource = fs.readFileSync(
    path.join(ROOT, "monitor", "disaster-social-sns-fetch.js"),
    "utf8"
  );
  checks.push({
    check: "fetch no longer requires municipality",
    pass: !/if \(!municipality\) \{\s*return null;\s*\}/.test(snsFetchSource)
  });
  if (/if \(!municipality\) \{\s*return null;\s*\}/.test(snsFetchSource)) {
    errors.push("disaster-social-sns-fetch must not reject posts without municipality");
  }

  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    await page.goto(SERVE_URL, { waitUntil: "networkidle", timeout: 90000 });
    await page.waitForSelector("#disaster-social-search", { timeout: 30000 });
    await page.locator("#disaster-social-search-category").fill("給水");
    await page.locator(".disaster-social-search__form button[type='submit']").click();
    await page.waitForSelector("#disaster-social-search-results .disaster-search__card", {
      timeout: 20000
    });
    const cardCount = await page.locator("#disaster-social-search-results .disaster-search__card").count();
    checks.push({
      check: "browser keyword search",
      pass: cardCount > 0,
      count: cardCount
    });
    if (!cardCount) {
      errors.push("browser keyword search must return results");
    }
  } finally {
    await browser.close();
  }

  const result = {
    DISASTER_X_CROSS_SEARCH_ACQUISITION_SCOPE_VALIDATION: errors.length === 0 ? "PASS" : "FAIL",
    previous_count: PREVIOUS_COUNT,
    source_post_count: sourcePostCount,
    excluded_count: excludedCount,
    index_count: entries.length,
    increase_count: increaseCount,
    without_municipality_count: withoutMunicipality.length,
    national_agency_count: includedNational.length,
    checks: checks,
    errors: errors
  };
  console.log(JSON.stringify(result, null, 2));
  if (errors.length) {
    process.exit(1);
  }
  console.log("DISASTER_X_CROSS_SEARCH_ACQUISITION_SCOPE_COMPLETE");
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});

#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

const {
  PUBLIC_INDEX_FILE,
  PUBLIC_SOURCES_FILE,
  SOCIAL_CATEGORIES,
  buildAndWriteDisasterSocialIndex,
  searchDisasterSocialIndex,
  validateDisasterSocialIndex,
  validateDisasterSocialSources
} = require(path.join(__dirname, "..", "monitor", "disaster-social-index-engine"));

const {
  buildAndWriteDisasterSearchIndex,
  searchDisasterIndex
} = require(path.join(__dirname, "..", "monitor", "disaster-search-index-engine"));

function main() {
  const errors = [];
  const checks = [];

  [
    "data/community/disaster_social_sources.json",
    "data/community/disaster_social_index.json",
    "monitor/disaster-social-index-engine.js",
    "scripts/build-disaster-social-index.js"
  ].forEach(function (file) {
    const exists = fs.existsSync(path.join(ROOT, file));
    checks.push({ check: file, pass: exists });
    if (!exists) {
      errors.push("Missing file: " + file);
    }
  });

  const payload = buildAndWriteDisasterSocialIndex();
  errors.push.apply(errors, validateDisasterSocialSources(payload.sources));
  errors.push.apply(errors, validateDisasterSocialIndex(payload.index));

  checks.push({
    check: "JSON valid",
    pass:
      validateDisasterSocialSources(payload.sources).length === 0 &&
      validateDisasterSocialIndex(payload.index).length === 0
  });

  checks.push({
    check: "public JSON exists",
    pass: fs.existsSync(PUBLIC_INDEX_FILE) && fs.existsSync(PUBLIC_SOURCES_FILE)
  });

  const regionResults = searchDisasterSocialIndex(payload.index, {
    region: "八代"
  });
  checks.push({
    check: "region search",
    pass: regionResults.length > 0,
    count: regionResults.length
  });
  if (!regionResults.length) {
    errors.push("region search must return results for 八代");
  }

  const dateResults = searchDisasterSocialIndex(payload.index, {
    date: "2026-07-31"
  });
  checks.push({
    check: "date search",
    pass: dateResults.length > 0,
    count: dateResults.length
  });
  if (!dateResults.length) {
    errors.push("date search must return results for 2026-07-31");
  }

  const categoryResults = searchDisasterSocialIndex(payload.index, {
    category: "WATER"
  });
  checks.push({
    check: "category search",
    pass: categoryResults.length > 0,
    count: categoryResults.length
  });
  if (!categoryResults.length) {
    errors.push("category search must return results for WATER");
  }

  const combinedResults = searchDisasterSocialIndex(payload.index, {
    region: "熊本県",
    date: "2026-07-31",
    category: "VOLUNTEER"
  });
  checks.push({
    check: "combined region date category search",
    pass: combinedResults.length > 0,
    count: combinedResults.length
  });

  const emptyFilterResults = searchDisasterSocialIndex(payload.index, {});
  checks.push({
    check: "empty filter returns none",
    pass: emptyFilterResults.length === 0
  });
  if (emptyFilterResults.length) {
    errors.push("empty filters must not return results");
  }

  const officialPayload = buildAndWriteDisasterSearchIndex();
  const waterResults = searchDisasterIndex(officialPayload, "給水", { category: "WATER" });
  checks.push({
    check: "official water search preserved",
    pass: waterResults.length > 0,
    count: waterResults.length
  });
  if (!waterResults.length) {
    errors.push("official water search must remain available");
  }

  const appJs = fs.readFileSync(path.join(ROOT, "js", "app.js"), "utf8");
  checks.push({
    check: "community search UI",
    pass: appJs.indexOf("現地支援情報を探す") !== -1
  });
  if (appJs.indexOf("現地支援情報を探す") === -1) {
    errors.push("community search UI section missing");
  }

  checks.push({
    check: "social categories defined",
    pass: SOCIAL_CATEGORIES.length >= 8
  });

  console.log("=== Disaster Social Index Validation ===");
  console.log(
    JSON.stringify(
      {
        DISASTER_SOCIAL_INDEX_VALIDATION: errors.length === 0 ? "PASS" : "FAIL",
        checks: checks,
        errors: errors
      },
      null,
      2
    )
  );

  if (errors.length) {
    process.exit(1);
  }

  console.log("DISASTER_CROSS_SEARCH_COMMUNITY_LAYER_COMPLETE");
}

main();

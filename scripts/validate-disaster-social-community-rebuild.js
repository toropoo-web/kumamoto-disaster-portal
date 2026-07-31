#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const {
  INBOX_FILE,
  INBOX_TEST_FILE
} = require(path.join(__dirname, "..", "monitor", "disaster-social-pipeline"));
const { INDEX_FILE } = require(path.join(__dirname, "..", "monitor", "disaster-social-index-engine"));
const {
  COMMUNITY_FETCH_CATEGORIES,
  COMMUNITY_SCOPE_MUNICIPALITY_COUNT,
  SNS_FETCH_SINCE_DATE
} = require(path.join(__dirname, "..", "monitor", "disaster-social-community-scope"));

function main() {
  const errors = [];
  const checks = [];

  if (!fs.existsSync(INBOX_TEST_FILE)) {
    errors.push("missing disaster_social_inbox_test.json");
  } else {
    checks.push({ check: "test inbox exists", pass: true });
  }

  const inbox = JSON.parse(fs.readFileSync(INBOX_FILE, "utf8"));
  const index = JSON.parse(fs.readFileSync(INDEX_FILE, "utf8"));
  const items = inbox.items || [];
  const entries = index.entries || [];

  checks.push({
    check: "production inbox acquisition mode",
    pass: inbox.acquisition_mode === "SNS_AUTO_FETCH"
  });
  if (inbox.acquisition_mode !== "SNS_AUTO_FETCH") {
    errors.push("production inbox must use SNS_AUTO_FETCH acquisition mode");
  }

  const snsItems = items.filter(function (item) {
    return item.import_format === "SNS";
  });
  const manualItems = items.filter(function (item) {
    return item.import_format === "MANUAL";
  });
  checks.push({
    check: "sns-dominant production inbox",
    pass: snsItems.length > 0 && snsItems.length >= manualItems.length,
    sns_count: snsItems.length,
    manual_count: manualItems.length,
    total_count: items.length
  });
  if (!snsItems.length || snsItems.length < manualItems.length) {
    errors.push("production inbox must be SNS-dominant");
  }

  const platformCounts = { X: 0 };
  snsItems.forEach(function (item) {
    if (item.source_type === "X") {
      platformCounts.X += 1;
    } else if (item.source_type === "Instagram") {
      errors.push("production inbox must not include Instagram sns items");
    }
  });
  checks.push({
    check: "sns platform coverage",
    pass: platformCounts.X > 0,
    platform_counts: platformCounts
  });
  if (!platformCounts.X) {
    errors.push("production inbox must include X SNS items");
  }

  const municipalitySet = new Set();
  snsItems.forEach(function (item) {
    if (item.municipality) {
      municipalitySet.add(item.municipality);
    }
  });
  checks.push({
    check: "sns municipality coverage",
    pass: municipalitySet.size >= 10,
    municipality_count: municipalitySet.size
  });
  if (municipalitySet.size < 10) {
    errors.push("sns fetch must cover multiple municipalities");
  }

  const outOfCategory = snsItems.filter(function (item) {
    return COMMUNITY_FETCH_CATEGORIES.indexOf(item.category) === -1;
  });
  checks.push({
    check: "fetch categories restricted",
    pass: outOfCategory.length === 0,
    invalid_count: outOfCategory.length
  });
  if (outOfCategory.length) {
    errors.push("sns fetch categories must stay within community fetch categories");
  }

  const beforeDate = snsItems.filter(function (item) {
    return String(item.date || "").slice(0, 10) < SNS_FETCH_SINCE_DATE;
  });
  checks.push({
    check: "sns since date",
    pass: beforeDate.length === 0,
    before_date_count: beforeDate.length
  });
  if (beforeDate.length) {
    errors.push("sns items must be on or after " + SNS_FETCH_SINCE_DATE);
  }

  checks.push({
    check: "index rebuilt from sns pipeline",
    pass: entries.length > 0 && entries.length >= Math.floor(snsItems.length * 0.8),
    index_entry_count: entries.length,
    sns_item_count: snsItems.length
  });
  if (!entries.length) {
    errors.push("community index must be rebuilt from sns pipeline");
  }

  const indexSns = entries.filter(function (entry) {
    return entry.source_type === "X";
  });
  const indexInstagram = entries.filter(function (entry) {
    return entry.source_type === "Instagram";
  });
  checks.push({
    check: "index sns source types",
    pass: indexSns.length > 0 && indexInstagram.length === 0,
    index_sns_count: indexSns.length,
    index_instagram_count: indexInstagram.length
  });
  if (indexInstagram.length) {
    errors.push("community index must not contain Instagram entries");
  }

  checks.push({
    check: "minimum fetch volume",
    pass: items.length >= 100,
    inbox_item_count: items.length
  });
  if (items.length < 100) {
    errors.push("sns fetch volume is too limited for cross-search rebuild");
  }

  console.log("=== Disaster Social Community Rebuild Validation ===");
  console.log(
    JSON.stringify(
      {
        DISASTER_SOCIAL_COMMUNITY_REBUILD_VALIDATION: errors.length === 0 ? "PASS" : "FAIL",
        scope_municipality_count: COMMUNITY_SCOPE_MUNICIPALITY_COUNT,
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

  console.log("DISASTER_CROSS_SEARCH_COMMUNITY_DATA_REBUILD_COMPLETE");
}

main();

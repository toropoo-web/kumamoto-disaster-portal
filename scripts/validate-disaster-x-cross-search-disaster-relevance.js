#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const FETCH_JS = path.join(ROOT, "monitor", "disaster-social-sns-fetch.js");
const PUBLIC_INDEX = path.join(ROOT, "data", "public", "disaster_social_index.json");
const PUBLIC_WATER_INDEX = path.join(ROOT, "data", "public", "water_search_index.json");
const PUBLIC_SEARCH_INDEX = path.join(ROOT, "data", "public", "disaster_search_index.json");
const { matchesSocialSearchQuery } = require(path.join(
  ROOT,
  "monitor",
  "disaster-social-search-match"
));
const { searchDisasterSocialIndex } = require(path.join(
  ROOT,
  "monitor",
  "disaster-social-index-engine"
));
const { SNS_FETCH_SINCE_DATE } = require(path.join(
  ROOT,
  "monitor",
  "disaster-social-community-scope"
));

const MIN_INDEX_COUNT = Number(process.env.MIN_INDEX_COUNT || 3222);

function main() {
  const errors = [];
  const checks = [];
  const fetchJs = fs.readFileSync(FETCH_JS, "utf8");

  checks.push({
    check: "acquisition does not use disaster relevance filter",
    pass: !/isDisasterRelevantPostText/.test(fetchJs)
  });
  if (/isDisasterRelevantPostText/.test(fetchJs)) {
    errors.push("isDisasterRelevantPostText must be removed from acquisition");
  }

  checks.push({
    check: "acquisition keeps since-date filter",
    pass: /isOnOrAfterSnsFetchSinceDate/.test(fetchJs)
  });
  checks.push({
    check: "acquisition keeps municipality scope filter",
    pass: /matchesMunicipalityScope/.test(fetchJs)
  });
  checks.push({
    check: "acquisition keeps X post url filter",
    pass: /isXPostUrl/.test(fetchJs)
  });

  const index = JSON.parse(fs.readFileSync(PUBLIC_INDEX, "utf8"));
  const entries = index.entries || [];
  checks.push({
    check: "index count preserved",
    pass: entries.length >= MIN_INDEX_COUNT,
    index_count: entries.length,
    min_index_count: MIN_INDEX_COUNT
  });
  if (entries.length < MIN_INDEX_COUNT) {
    errors.push("index count must not decrease below " + MIN_INDEX_COUNT);
  }

  const searchQueries = [
    { label: "給水", options: { categoryQuery: "給水" } },
    { label: "炊き出し", options: { categoryQuery: "炊き出し" } },
    { label: "支援物資", options: { categoryQuery: "支援物資" } },
    { label: "八代市", options: { region: "八代市" } }
  ];
  searchQueries.forEach(function (item) {
    const count = searchDisasterSocialIndex(index, item.options).length;
    checks.push({
      check: "search works: " + item.label,
      pass: count > 0,
      count: count
    });
    if (!count) {
      errors.push("search must return results for " + item.label);
    }
  });

  const regionOnlyCount = searchDisasterSocialIndex(index, { region: "八代市" }).length;
  checks.push({
    check: "search scans full index by region",
    pass: regionOnlyCount > 0,
    count: regionOnlyCount
  });

  const waterIndex = JSON.parse(fs.readFileSync(PUBLIC_WATER_INDEX, "utf8"));
  const searchPayload = JSON.parse(fs.readFileSync(PUBLIC_SEARCH_INDEX, "utf8"));
  const waterCount = (searchPayload.index || []).filter(function (item) {
    return item.category === "WATER";
  }).length;
  const volunteerCount = (searchPayload.index || []).filter(function (item) {
    return item.category === "VOLUNTEER";
  }).length;
  checks.push({
    check: "official water layer preserved",
    pass: waterCount > 0 && waterCount === waterIndex.item_count,
    water_count: waterCount
  });
  checks.push({
    check: "official volunteer layer preserved",
    pass: volunteerCount > 0,
    volunteer_count: volunteerCount
  });
  if (!waterCount || waterCount !== waterIndex.item_count) {
    errors.push("official WATER layer must be preserved");
  }
  if (!volunteerCount) {
    errors.push("official VOLUNTEER layer must be preserved");
  }

  const ashikitaEntries = entries.filter(function (entry) {
    return matchesSocialSearchQuery(entry, "", "芦北町", []);
  }).length;
  checks.push({
    check: "full index includes municipality-only matches",
    pass: ashikitaEntries > 0,
    ashikita_count: ashikitaEntries
  });

  const result = {
    DISASTER_X_CROSS_SEARCH_OPEN_INDEX_VALIDATION: errors.length === 0 ? "PASS" : "FAIL",
    acquisition: {
      since_date: SNS_FETCH_SINCE_DATE,
      municipality_scope_count: 23,
      sender_restriction: false,
      disaster_relevance_filter_at_acquisition: false
    },
    index_entry_count: entries.length,
    checks: checks,
    errors: errors
  };

  console.log(JSON.stringify(result, null, 2));
  if (errors.length) {
    process.exit(1);
  }
  console.log("DISASTER_X_CROSS_SEARCH_OPEN_INDEX_VALIDATION_COMPLETE");
}

main();

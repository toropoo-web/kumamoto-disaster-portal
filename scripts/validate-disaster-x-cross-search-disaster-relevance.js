#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const {
  evaluateDisasterRelevance,
  isDisasterRelevantEntry
} = require(path.join(ROOT, "monitor", "disaster-social-disaster-relevance"));
const { matchesSocialSearchQuery } = require(path.join(
  ROOT,
  "monitor",
  "disaster-social-search-match"
));

const PUBLIC_INDEX = path.join(ROOT, "data", "public", "disaster_social_index.json");

function main() {
  const errors = [];
  const index = JSON.parse(fs.readFileSync(PUBLIC_INDEX, "utf8"));
  const entries = index.entries || [];

  const noiseSamples = [
    "芦北町の観光スポットがおすすめです。旅行記です。",
    "芦北町限定 楽天通販アフィリエイト案件",
    "芦北町だけど新作ゲーム紹介 Steam攻略"
  ];
  noiseSamples.forEach(function (text) {
    const result = evaluateDisasterRelevance(text);
    if (result.pass) {
      errors.push("noise sample should be rejected: " + text);
    }
  });

  const ashikitaEntries = entries.filter(function (entry) {
    return matchesSocialSearchQuery(entry, "", "芦北町", []);
  });
  const ashikitaNoise = ashikitaEntries.filter(function (entry) {
    return !isDisasterRelevantEntry(entry);
  });

  const searchQueries = [
    "給水",
    "炊き出し",
    "支援物資",
    "風呂",
    "車中泊",
    "Wi-Fi",
    "ペット",
    "迷子"
  ];
  const searchCounts = {};
  searchQueries.forEach(function (query) {
    searchCounts[query] = entries.filter(function (entry) {
      return matchesSocialSearchQuery(entry, "", query, []);
    }).length;
  });

  const irrelevantInIndex = entries.filter(function (entry) {
    return !isDisasterRelevantEntry(entry);
  }).length;

  const result = {
    DISASTER_X_CROSS_SEARCH_DISASTER_RELEVANCE_VALIDATION:
      errors.length === 0 ? "PASS" : "FAIL",
    index_entry_count: entries.length,
    irrelevant_in_index: irrelevantInIndex,
    ashikita_entry_count: ashikitaEntries.length,
    ashikita_noise_count: ashikitaNoise.length,
    search_counts: searchCounts,
    errors: errors
  };

  console.log(JSON.stringify(result, null, 2));
  if (errors.length) {
    process.exit(1);
  }
  console.log("DISASTER_X_CROSS_SEARCH_DISASTER_RELEVANCE_VALIDATION_COMPLETE");
}

main();

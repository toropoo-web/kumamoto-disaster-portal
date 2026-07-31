#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PUBLIC_SOCIAL_INDEX = path.join(ROOT, "data", "public", "disaster_social_index.json");

const { searchDisasterSocialIndex } = require(path.join(ROOT, "monitor", "disaster-social-index-engine"));
const {
  SEARCH_DICTIONARIES,
  buildEntryContentHaystack,
  matchesPreciseSearchQuery,
  expandSearchDictionaryKeywords
} = require(path.join(ROOT, "monitor", "disaster-social-search-match"));

const VALIDATION_QUERIES = [
  "炊き出し",
  "支援物資",
  "給水",
  "風呂",
  "車中泊",
  "Wi-Fi",
  "ペット",
  "迷子",
  "氷"
];

const MAINTAIN_QUERIES = ["給水", "支援物資", "炊き出し", "風呂"];

function loadIndex() {
  return JSON.parse(fs.readFileSync(PUBLIC_SOCIAL_INDEX, "utf8"));
}

function search(index, categoryQuery) {
  return searchDisasterSocialIndex(index, { categoryQuery: categoryQuery });
}

function isPetFalsePositive(entry) {
  const hay = buildEntryContentHaystack(entry);
  if (/ペットボトル/.test(hay) && !matchesPreciseSearchQuery(hay, "ペット")) {
    return true;
  }
  if (/警備犬|救助犬/.test(hay) && !/迷子犬|迷い犬|犬を探|犬が迷|保護犬/.test(hay)) {
    return true;
  }
  return false;
}

function isIceFalsePositive(entry) {
  const hay = buildEntryContentHaystack(entry);
  if (!/氷川[町村]?/.test(hay)) {
    return false;
  }
  const stripped = hay.replace(/氷川[町村]?/g, "");
  return /氷/.test(hay) && !/氷/.test(stripped) && !matchesPreciseSearchQuery(hay, "氷");
}

function isWifiFalsePositive(entry) {
  const hay = buildEntryContentHaystack(entry);
  return (
    (/インターネット/.test(hay) || /(?<![ァ-ヶー])ネット(?!ワーク)/.test(hay)) &&
    !/wi-?fi|wifi|ワイファイ|ｗｉ-?ｆｉ/i.test(hay)
  );
}

function isCarShelterFalsePositive(entry) {
  const hay = buildEntryContentHaystack(entry);
  return /避難/.test(hay) && !/車中泊|車で避難|車避難|車両避難|車内避難/.test(hay);
}

function collectFalsePositives(query, results) {
  return results.filter(function (item) {
    const entry = item.entry;
    if (query === "ペット" || query === "迷子") {
      return isPetFalsePositive(entry);
    }
    if (query === "氷" || query === "冷却") {
      return isIceFalsePositive(entry);
    }
    if (query === "Wi-Fi") {
      return isWifiFalsePositive(entry);
    }
    if (query === "車中泊") {
      return isCarShelterFalsePositive(entry);
    }
    return false;
  });
}

function hasContentMatch(entry, query) {
  return matchesPreciseSearchQuery(buildEntryContentHaystack(entry), query);
}

function main() {
  const errors = [];
  const checks = [];
  const index = loadIndex();
  const entries = index.entries || [];
  const queryResults = {};

  checks.push({
    check: "index count preserved",
    pass: entries.length === 366,
    count: entries.length
  });
  if (entries.length !== 366) {
    errors.push("index count must remain 366");
  }

  checks.push({
    check: "search dictionaries defined",
    pass: SEARCH_DICTIONARIES.length >= 7,
    count: SEARCH_DICTIONARIES.length
  });

  VALIDATION_QUERIES.forEach(function (query) {
    const results = search(index, query);
    const falsePositives = collectFalsePositives(query, results);
    const withoutContentMatch = results.filter(function (item) {
      return !hasContentMatch(item.entry, query);
    });
    const expansion = expandSearchDictionaryKeywords(query);

    queryResults[query] = {
      count: results.length,
      false_positive_count: falsePositives.length,
      content_match_count: results.length - withoutContentMatch.length,
      dictionary_expanded: Boolean(expansion),
      expanded_keyword_count: expansion ? expansion.keywords.length : 0
    };

    checks.push({
      check: "search " + query,
      pass: falsePositives.length === 0,
      count: results.length,
      false_positive_count: falsePositives.length,
      dictionary_expanded: Boolean(expansion)
    });

    if (falsePositives.length) {
      errors.push(query + " has " + falsePositives.length + " false positives");
    }
    if (withoutContentMatch.length) {
      errors.push(query + " has " + withoutContentMatch.length + " results without content match");
    }
  });

  MAINTAIN_QUERIES.forEach(function (query) {
    const count = search(index, query).length;
    checks.push({
      check: "maintain " + query,
      pass: count > 0,
      count: count
    });
    if (!count) {
      errors.push(query + " must keep returning results");
    }
  });

  const wellWaterCount = search(index, "井戸水").length;
  checks.push({
    check: "井戸水 no full water expansion",
    pass: wellWaterCount <= 20,
    count: wellWaterCount
  });
  if (wellWaterCount > 20) {
    errors.push("井戸水 expanded too broadly: " + wellWaterCount);
  }

  const result = {
    PHASE_RESULT:
      errors.length === 0
        ? "DISASTER_X_CROSS_SEARCH_DICTIONARY_EXPANSION_COMPLETE"
        : "FAIL",
    index_count: entries.length,
    dictionaries: SEARCH_DICTIONARIES.map(function (dict) {
      return {
        id: dict.id,
        expand_queries: dict.expandQueries,
        keyword_count: dict.keywords.length
      };
    }),
    query_results: queryResults,
    well_water_count: wellWaterCount,
    checks: checks,
    errors: errors
  };

  console.log(JSON.stringify(result, null, 2));
  if (errors.length) {
    process.exit(1);
  }
  console.log("DISASTER_X_CROSS_SEARCH_DICTIONARY_EXPANSION_COMPLETE");
}

main();

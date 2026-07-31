#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PUBLIC_SOCIAL_INDEX = path.join(ROOT, "data", "public", "disaster_social_index.json");

const { searchDisasterSocialIndex } = require(path.join(ROOT, "monitor", "disaster-social-index-engine"));
const {
  buildEntryContentHaystack,
  matchesPreciseSearchQuery
} = require(path.join(ROOT, "monitor", "disaster-social-search-match"));

const PRECISION_QUERIES = [
  "ペット",
  "迷子",
  "迷子猫",
  "迷子犬",
  "氷",
  "冷却",
  "電気",
  "Wi-Fi",
  "車中泊"
];

const MAINTAIN_QUERIES = ["給水", "支援物資", "炊き出し", "風呂"];

function loadIndex() {
  return JSON.parse(fs.readFileSync(PUBLIC_SOCIAL_INDEX, "utf8"));
}

function search(index, categoryQuery, extraOptions) {
  return searchDisasterSocialIndex(index, Object.assign({ categoryQuery: categoryQuery }, extraOptions || {}));
}

function isPetFalsePositive(entry) {
  const hay = buildEntryContentHaystack(entry);
  if (/ペットボトル/.test(hay) && !matchesPreciseSearchQuery(hay, "ペット")) {
    return true;
  }
  if (/(?<![迷子保護])猫(?!を探|が迷)/.test(hay) && !/迷子猫|迷い猫|猫を探|猫が迷/.test(hay)) {
    return /猫/.test(hay) && !matchesPreciseSearchQuery(hay, "迷子猫");
  }
  if (/(?<![迷子保護])犬(?!を探|が迷)/.test(hay) && !/迷子犬|迷い犬|犬を探|犬が迷/.test(hay)) {
    return /犬/.test(hay) && !matchesPreciseSearchQuery(hay, "迷子犬");
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
  return /避難/.test(hay) && !/車中泊|車で避難|車避難|車両避難/.test(hay);
}

function isWellWaterOverExpansion(results) {
  return results.length > 20;
}

function collectFalsePositives(query, results) {
  return results.filter(function (item) {
    const entry = item.entry;
    if (query === "ペット" || query === "迷子" || query === "迷子猫" || query === "迷子犬") {
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
    if (query === "電気") {
      const hay = buildEntryContentHaystack(entry);
      return !matchesPreciseSearchQuery(hay, "電気") && !matchesPreciseSearchQuery(hay, "冷却");
    }
    return false;
  });
}

function main() {
  const errors = [];
  const checks = [];
  const index = loadIndex();
  const precisionResults = {};
  const maintainResults = {};

  if ((index.entries || []).length !== 366) {
    errors.push("index must remain 366 entries, got " + (index.entries || []).length);
  }

  PRECISION_QUERIES.forEach(function (query) {
    const results = search(index, query);
    const falsePositives = collectFalsePositives(query, results);
    precisionResults[query] = {
      count: results.length,
      false_positive_count: falsePositives.length,
      false_positive_ids: falsePositives.slice(0, 5).map(function (item) {
        return item.entry.id;
      })
    };
    checks.push({
      check: "precision " + query,
      pass: falsePositives.length === 0,
      count: results.length,
      false_positive_count: falsePositives.length
    });
    if (falsePositives.length) {
      errors.push(query + " has " + falsePositives.length + " false positives");
    }
  });

  const wellWaterResults = search(index, "井戸水");
  checks.push({
    check: "井戸水 no category expansion",
    pass: !isWellWaterOverExpansion(wellWaterResults),
    count: wellWaterResults.length
  });
  if (isWellWaterOverExpansion(wellWaterResults)) {
    errors.push("井戸水 expanded to " + wellWaterResults.length + " (category over-match)");
  }

  MAINTAIN_QUERIES.forEach(function (query) {
    const results = search(index, query);
    maintainResults[query] = results.length;
    checks.push({
      check: "maintain " + query,
      pass: results.length > 0,
      count: results.length
    });
    if (!results.length) {
      errors.push(query + " must return results");
    }
  });

  const yatsushiroRegion = search(index, "", { region: "八代市" });
  const yatsushiroContentOnly = yatsushiroRegion.filter(function (item) {
    return !item.entry.municipality && /八代/.test(buildEntryContentHaystack(item.entry));
  });
  checks.push({
    check: "八代市 region content match",
    pass: yatsushiroContentOnly.length > 0,
    region_count: yatsushiroRegion.length,
    content_only_count: yatsushiroContentOnly.length
  });
  if (!yatsushiroContentOnly.length) {
    errors.push("八代市 region search must match posts mentioning 八代 in content without municipality metadata");
  }

  const yatsushiroMuni = search(index, "", { municipality: "八代市" });
  checks.push({
    check: "八代市 municipality filter",
    pass: yatsushiroMuni.length > 0,
    count: yatsushiroMuni.length
  });
  if (!yatsushiroMuni.length) {
    errors.push("八代市 municipality filter must return results");
  }

  const result = {
    PHASE_RESULT: errors.length === 0 ? "DISASTER_X_CROSS_SEARCH_MATCH_PRECISION_COMPLETE" : "FAIL",
    index_count: (index.entries || []).length,
    precision: precisionResults,
    maintain: maintainResults,
    well_water_count: wellWaterResults.length,
    yatsushiro_region_count: yatsushiroRegion.length,
    yatsushiro_content_only_count: yatsushiroContentOnly.length,
    checks: checks,
    errors: errors
  };

  console.log(JSON.stringify(result, null, 2));
  if (errors.length) {
    process.exit(1);
  }
  console.log("DISASTER_X_CROSS_SEARCH_MATCH_PRECISION_COMPLETE");
}

main();

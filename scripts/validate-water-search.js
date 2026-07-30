#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

const {
  WATER_SOURCES_FILE,
  OUTPUT_FILE,
  PUBLIC_OUTPUT_FILE,
  buildAndWriteWaterSearchIndex,
  validateWaterSources,
  validateWaterSearchIndex
} = require(path.join(__dirname, "..", "monitor", "water-search-index-engine"));

function normalizeSearchText(value) {
  if (!value) {
    return "";
  }

  return String(value)
    .toLowerCase()
    .replace(/\u3000/g, " ")
    .replace(/[\uff01-\uff5e]/g, function (ch) {
      return String.fromCharCode(ch.charCodeAt(0) - 0xfee0);
    })
    .replace(/\s+/g, " ")
    .trim();
}

function searchItems(items, keyword) {
  const tokens = normalizeSearchText(keyword).split(" ").filter(Boolean);
  if (!tokens.length) {
    return [];
  }

  return items.filter(function (item) {
    const hay = normalizeSearchText(
      [
        item.region,
        item.municipality,
        item.organization,
        item.location,
        item.title,
        item.search_text
      ].join(" ")
    );
    return tokens.every(function (token) {
      return hay.indexOf(token) !== -1;
    });
  });
}

function main() {
  const errors = [];

  [
    "data/water_sources.json",
    "monitor/water-search-index-engine.js",
    "scripts/build-water-search-index.js"
  ].forEach(function (file) {
    if (!fs.existsSync(path.join(ROOT, file))) {
      errors.push("Missing file: " + file);
    }
  });

  const registry = JSON.parse(fs.readFileSync(WATER_SOURCES_FILE, "utf8"));
  errors.push.apply(errors, validateWaterSources(registry));

  const payload = buildAndWriteWaterSearchIndex();
  errors.push.apply(errors, validateWaterSearchIndex(payload));

  if (!fs.existsSync(OUTPUT_FILE)) {
    errors.push("Missing output: data/water_search_index.json");
  }
  if (!fs.existsSync(PUBLIC_OUTPUT_FILE)) {
    errors.push("Missing output: data/public/water_search_index.json");
  }

  const appJs = fs.readFileSync(path.join(ROOT, "js", "app.js"), "utf8");
  const css = fs.readFileSync(path.join(ROOT, "css", "styles.css"), "utf8");

  [
    { name: "water search load", pattern: /loadWaterSearchIndex/ },
    { name: "water search function", pattern: /function searchWater/ },
    { name: "water search render", pattern: /renderWaterSearchResult/ },
    { name: "water search section", pattern: /water-search/ }
  ].forEach(function (check) {
    if (!check.pattern.test(appJs)) {
      errors.push("JS check failed: " + check.name);
    }
  });

  [
    { name: "water search styles", pattern: /\.water-search/ },
    { name: "water search form", pattern: /\.water-search__form/ }
  ].forEach(function (check) {
    if (!check.pattern.test(css)) {
      errors.push("CSS check failed: " + check.name);
    }
  });

  const kumamotoResults = searchItems(payload.items, "熊本 給水");
  if (!kumamotoResults.length) {
    errors.push("search check failed: 熊本 給水");
  }

  const kagoshimaResults = searchItems(payload.items, "霧島 給水");
  if (!kagoshimaResults.length) {
    errors.push("search check failed: 霧島 給水");
  }

  const outageResults = searchItems(payload.items, "断水");
  if (!outageResults.length) {
    errors.push("search check failed: 断水");
  }

  const truckResults = searchItems(payload.items, "給水車");
  if (!truckResults.length) {
    errors.push("search check failed: 給水車");
  }

  const ukiResults = searchItems(payload.items, "宇城 給水");
  if (!ukiResults.length) {
    errors.push("search check failed: 宇城 給水");
  }

  const kirishimaOfficial = kagoshimaResults.some(function (item) {
    return item.region === "鹿児島県" && /霧島/.test(item.municipality) && item.source_type === "official";
  });
  if (!kirishimaOfficial) {
    errors.push("search check failed: 霧島 official registry item");
  }

  payload.items.forEach(function (item, index) {
    if (item.source_type !== "official") {
      errors.push("items[" + index + "]: source_type must be official");
    }
    if (item.source_url && /x\.com|twitter\.com|instagram\.com|facebook\.com/i.test(item.source_url)) {
      errors.push("items[" + index + "]: personal SNS URL is not allowed");
    }
  });

  const output = {
    WATER_SEARCH_VALIDATION: errors.length === 0 ? "PASS" : "FAIL",
    VERSION: payload.version,
    ITEM_COUNT: payload.item_count,
    LOCATION_ITEM_COUNT: payload.location_item_count,
    REGISTRY_ITEM_COUNT: payload.registry_item_count,
    KUMAMOTO_SEARCH_COUNT: kumamotoResults.length,
    KAGOSHIMA_SEARCH_COUNT: kagoshimaResults.length,
    OUTAGE_SEARCH_COUNT: outageResults.length,
    UKI_SEARCH_COUNT: ukiResults.length,
    TRUCK_SEARCH_COUNT: truckResults.length,
    errors: errors
  };

  console.log("=== Water Search Validation ===");
  console.log(JSON.stringify(output, null, 2));

  if (errors.length) {
    process.exit(1);
  }

  console.log("PHASE27_WATER_SEARCH_INDEX_V2_IMPLEMENTATION_COMPLETE");
}

main();

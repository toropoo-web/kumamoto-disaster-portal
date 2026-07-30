#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

const {
  OUTPUT_FILE,
  PUBLIC_OUTPUT_FILE,
  buildAndWriteWaterSearchIndex,
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
      [item.region, item.municipality, item.location, item.title, item.search_text].join(" ")
    );
    return tokens.every(function (token) {
      return hay.indexOf(token) !== -1;
    });
  });
}

function main() {
  const errors = [];

  ["monitor/water-search-index-engine.js", "scripts/build-water-search-index.js"].forEach(function (file) {
    if (!fs.existsSync(path.join(ROOT, file))) {
      errors.push("Missing file: " + file);
    }
  });

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

  const ukiResults = searchItems(payload.items, "宇城 給水");
  if (!ukiResults.length) {
    errors.push("search check failed: 宇城 給水");
  }

  const truckResults = searchItems(payload.items, "給水車");
  if (!truckResults.length) {
    errors.push("search check failed: 給水車");
  }

  const kagoshimaRegion = payload.regions.indexOf("鹿児島県");
  if (kagoshimaRegion === -1) {
    errors.push("regions must include 鹿児島県 for Kagoshima search support");
  }

  const output = {
    WATER_SEARCH_VALIDATION: errors.length === 0 ? "PASS" : "FAIL",
    ITEM_COUNT: payload.item_count,
    UKI_SEARCH_COUNT: ukiResults.length,
    TRUCK_SEARCH_COUNT: truckResults.length,
    errors: errors
  };

  console.log("=== Water Search Validation ===");
  console.log(JSON.stringify(output, null, 2));

  if (errors.length) {
    process.exit(1);
  }

  console.log("PHASE27_WATER_SEARCH_IMPLEMENTATION_COMPLETE");
}

main();

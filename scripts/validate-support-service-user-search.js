#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");

const {
  buildAndWriteDisasterSearchIndex,
  buildDisasterSearchIndex,
  searchDisasterIndex,
  getSupportServiceDisplayCategoryLabel,
  getSupportServiceStatusLabel,
  SUPPORT_SERVICE_SEARCH_DICTIONARY,
  SUPPORT_SERVICE_USER_SEARCH_CAUTION
} = require(path.join(ROOT, "monitor", "disaster-search-index-engine"));

const { AUTO_PUBLISH } = require(path.join(ROOT, "monitor", "support-service-discovery-engine"));

const PUBLIC_WATER_FILES = [
  "data/water_search_index.json",
  "data/public/water_search_index.json",
  "data/water_cross_view.json",
  "data/public/water_cross_view.json"
];

function hashFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function runCase(name, fn) {
  const result = fn();
  return {
    case: name,
    pass: result.pass,
    detail: result.detail || null
  };
}

function buildExpiredFixtureIndex(baseIndex) {
  const payload = JSON.parse(JSON.stringify(baseIndex));
  payload.index.push(
    Object.assign({}, payload.index[0], {
      index_id: "DIDX-EXPIRED-FIXTURE",
      information_status: "EXPIRED",
      title: "終了したシャワー支援",
      municipality: "益城町",
      area: "益城町",
      available_until: "2026-07-30",
      status: "EXPIRED"
    })
  );
  payload.meta.item_count = payload.index.length;
  return payload;
}

function main() {
  const errors = [];
  const checks = [];

  [
    "monitor/support-service-search-dictionary.js",
    "monitor/disaster-search-index-engine.js",
    "js/app.js",
    "css/styles.css"
  ].forEach(function (file) {
    const exists = fs.existsSync(path.join(ROOT, file));
    checks.push({ check: "file exists: " + file, pass: exists });
    if (!exists) {
      errors.push("Missing file: " + file);
    }
  });

  const publicHashesBefore = {};
  PUBLIC_WATER_FILES.forEach(function (file) {
    const fullPath = path.join(ROOT, file);
    if (fs.existsSync(fullPath)) {
      publicHashesBefore[file] = hashFile(fullPath);
    }
  });

  const waterSearchIndex = JSON.parse(
    fs.readFileSync(path.join(ROOT, "data", "public", "water_search_index.json"), "utf8")
  );
  const indexPayload = buildAndWriteDisasterSearchIndex();
  const categories = {};
  indexPayload.index.forEach(function (entry) {
    categories[entry.category] = (categories[entry.category] || 0) + 1;
  });

  const case1 = runCase("case1 shower search returns bath", function () {
    const results = searchDisasterIndex(indexPayload, "シャワー", {
      category: "SUPPORT_SERVICE"
    });
    return {
      pass:
        results.length > 0 &&
        results.every(function (item) {
          return item.category === "SUPPORT_SERVICE" && item.subcategory === "BATH";
        }),
      detail: {
        count: results.length,
        subcategories: results.map(function (item) {
          return item.subcategory;
        })
      }
    };
  });
  checks.push(case1);
  if (!case1.pass) {
    errors.push("case1 failed: シャワー search must return BATH results");
  }

  const case2 = runCase("case2 car camp search returns vehicle", function () {
    const results = searchDisasterIndex(indexPayload, "車中泊", {
      category: "SUPPORT_SERVICE"
    });
    return {
      pass:
        results.length > 0 &&
        results.every(function (item) {
          return item.subcategory === "VEHICLE";
        }),
      detail: {
        count: results.length,
        subcategories: results.map(function (item) {
          return item.subcategory;
        })
      }
    };
  });
  checks.push(case2);
  if (!case2.pass) {
    errors.push("case2 failed: 車中泊 search must return VEHICLE results");
  }

  const case3 = runCase("case3 region filter returns local results only", function () {
    const results = searchDisasterIndex(indexPayload, "シャワー", {
      category: "SUPPORT_SERVICE",
      municipality: "熊本市"
    });
    return {
      pass:
        results.length > 0 &&
        results.every(function (item) {
          return String(item.municipality || "").indexOf("熊本市") !== -1;
        }) &&
        results.every(function (item) {
          return String(item.municipality || "").indexOf("合志市") === -1;
        }),
      detail: results.map(function (item) {
        return item.municipality;
      })
    };
  });
  checks.push(case3);
  if (!case3.pass) {
    errors.push("case3 failed: region filter must return only matching municipality");
  }

  const case4 = runCase("case4 expired status label", function () {
    const fixtureIndex = buildExpiredFixtureIndex(indexPayload);
    const expiredItem = fixtureIndex.index.find(function (item) {
      return item.information_status === "EXPIRED";
    });
    return {
      pass:
        expiredItem &&
        getSupportServiceStatusLabel(expiredItem.information_status) === "終了情報",
      detail: {
        status: expiredItem && expiredItem.information_status,
        label: getSupportServiceStatusLabel(expiredItem && expiredItem.information_status)
      }
    };
  });
  checks.push(case4);
  if (!case4.pass) {
    errors.push("case4 failed: EXPIRED must display as 終了情報");
  }

  const case5 = runCase("case5 checked_at available on support service index", function () {
    const supportItems = indexPayload.index.filter(function (item) {
      return item.category === "SUPPORT_SERVICE";
    });
    return {
      pass:
        supportItems.length > 0 &&
        supportItems.every(function (item) {
          return item.checked_at;
        }),
      detail: supportItems.map(function (item) {
        return {
          title: item.title,
          checked_at: item.checked_at,
          published_at: item.published_at
        };
      })
    };
  });
  checks.push(case5);
  if (!case5.pass) {
    errors.push("case5 failed: checked_at must be present on SUPPORT_SERVICE index entries");
  }

  const appJs = fs.readFileSync(path.join(ROOT, "js", "app.js"), "utf8");
  const css = fs.readFileSync(path.join(ROOT, "css", "styles.css"), "utf8");

  checks.push({
    check: "dictionary module has shower keywords",
    pass: (SUPPORT_SERVICE_SEARCH_DICTIONARY.BATH || []).indexOf("シャワー") !== -1
  });
  checks.push({
    check: "dictionary module has car camp keywords",
    pass: (SUPPORT_SERVICE_SEARCH_DICTIONARY.VEHICLE || []).indexOf("車中泊") !== -1
  });
  checks.push({
    check: "UI title 生活支援を探す",
    pass: appJs.indexOf("生活支援を探す") !== -1
  });
  checks.push({
    check: "UI caution text",
    pass: appJs.indexOf(SUPPORT_SERVICE_USER_SEARCH_CAUTION) !== -1
  });
  checks.push({
    check: "UI search dictionary mirrored",
    pass: appJs.indexOf("SUPPORT_SERVICE_SEARCH_DICTIONARY") !== -1
  });
  checks.push({
    check: "UI status labels mirrored",
    pass: appJs.indexOf("終了情報") !== -1 && appJs.indexOf("利用可能情報") !== -1
  });
  checks.push({
    check: "UI support status css",
    pass: css.indexOf("disaster-search__support-status") !== -1
  });
  checks.push({
    check: "UI forbidden trust field absent",
    pass: !/trust|confidence|rank|score/.test(
      appJs.match(/appendSupportServiceCardDetails[\s\S]*?function appendVolunteerCapabilityStatus/)?.[0] || ""
    )
  });
  checks.push({
    check: "display category label for free open",
    pass: getSupportServiceDisplayCategoryLabel("BATH", "SHOWER", "FREE_OPEN") === "無料開放"
  });

  if (!(SUPPORT_SERVICE_SEARCH_DICTIONARY.BATH || []).includes("シャワー")) {
    errors.push("dictionary missing シャワー keyword");
  }
  if (!appJs.includes(SUPPORT_SERVICE_USER_SEARCH_CAUTION)) {
    errors.push("UI missing SUPPORT_SERVICE caution text");
  }

  const indexAfter = buildDisasterSearchIndex();
  const categoriesAfter = {};
  indexAfter.index.forEach(function (entry) {
    categoriesAfter[entry.category] = (categoriesAfter[entry.category] || 0) + 1;
  });

  checks.push({
    check: "case6 WATER index count preserved",
    pass: categoriesAfter.WATER === waterSearchIndex.item_count,
    waterCount: categoriesAfter.WATER,
    expectedWaterCount: waterSearchIndex.item_count
  });
  checks.push({
    check: "case6 VOLUNTEER index count preserved",
    pass: categoriesAfter.VOLUNTEER === 20,
    volunteerCount: categoriesAfter.VOLUNTEER
  });
  checks.push({
    check: "case6 SUPPORT_SERVICE search preserved",
    pass: categoriesAfter.SUPPORT_SERVICE === 5,
    supportServiceCount: categoriesAfter.SUPPORT_SERVICE
  });

  if (categoriesAfter.WATER !== waterSearchIndex.item_count) {
    errors.push("case6 failed: WATER count changed");
  }
  if (categoriesAfter.VOLUNTEER !== 20) {
    errors.push("case6 failed: VOLUNTEER count changed");
  }
  if (categoriesAfter.SUPPORT_SERVICE !== 5) {
    errors.push("case6 failed: SUPPORT_SERVICE count changed");
  }

  PUBLIC_WATER_FILES.forEach(function (file) {
    const fullPath = path.join(ROOT, file);
    if (!fs.existsSync(fullPath) || !publicHashesBefore[file]) {
      return;
    }
    const pass = hashFile(fullPath) === publicHashesBefore[file];
    checks.push({ check: "case6 untouched file: " + file, pass: pass });
    if (!pass) {
      errors.push("case6 failed: protected file changed during validation: " + file);
    }
  });

  checks.push({
    check: "AUTO_PUBLISH false",
    pass: AUTO_PUBLISH === false
  });

  const output = {
    SUPPORT_SERVICE_USER_SEARCH_VALIDATION: errors.length === 0 ? "PASS" : "FAIL",
    AUTO_PUBLISH: false,
    indexCategories: categories,
    checks: checks,
    errors: errors
  };

  console.log("=== SUPPORT_SERVICE User Search Validation (Phase25) ===");
  console.log(JSON.stringify(output, null, 2));

  if (errors.length) {
    process.exit(1);
  }

  console.log("PHASE25_SUPPORT_SERVICE_USER_SEARCH_COMPLETE");
}

main();

#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

const {
  PUBLIC_OUTPUT_FILE,
  buildAndWriteDisasterSearchIndex,
  searchDisasterIndex
} = require(path.join(__dirname, "..", "monitor", "disaster-search-index-engine"));

function main() {
  const errors = [];
  const checks = [];

  [
    "js/app.js",
    "css/styles.css",
    "monitor/disaster-search-index-engine.js",
    "scripts/build-disaster-search-index.js",
    "scripts/validate-disaster-search-index.js"
  ].forEach(function (file) {
    const exists = fs.existsSync(path.join(ROOT, file));
    checks.push({ check: file, pass: exists });
    if (!exists) {
      errors.push("Missing file: " + file);
    }
  });

  const payload = buildAndWriteDisasterSearchIndex();
  if (!fs.existsSync(PUBLIC_OUTPUT_FILE)) {
    errors.push("Missing output: data/public/disaster_search_index.json");
  }
  checks.push({
    check: "public disaster search index exists",
    pass: fs.existsSync(PUBLIC_OUTPUT_FILE)
  });

  const appJs = fs.readFileSync(path.join(ROOT, "js", "app.js"), "utf8");
  const css = fs.readFileSync(path.join(ROOT, "css", "styles.css"), "utf8");

  [
    { name: "disaster search load", pattern: /loadDisasterSearchIndex/ },
    { name: "disaster search function", pattern: /function searchDisasterIndex/ },
    { name: "disaster search render", pattern: /renderDisasterSearchResult/ },
    { name: "disaster search section", pattern: /disaster-search/ },
    { name: "disaster search promo", pattern: /renderDisasterSearchPromo/ },
    { name: "disaster search category config", pattern: /DISASTER_SEARCH_CATEGORY_CONFIG/ },
    { name: "disaster search guidance", pattern: /DISASTER_SEARCH_GUIDANCE/ },
    { name: "disaster search volunteer category", pattern: /VOLUNTEER:\s*\{/ },
    { name: "disaster search volunteer section id", pattern: /DISASTER_SEARCH_VOLUNTEER_ID/ },
    { name: "disaster search support service category", pattern: /SUPPORT_SERVICE:\s*\{/ },
    { name: "disaster search support service section id", pattern: /DISASTER_SEARCH_SUPPORT_SERVICE_ID/ },
    { name: "disaster search official post category", pattern: /OFFICIAL_POST:\s*\{/ },
    { name: "disaster search official post section id", pattern: /DISASTER_SEARCH_OFFICIAL_POST_ID/ },
    { name: "official post render init", pattern: /renderDisasterSearch\(page, disasterSearchIndex, "OFFICIAL_POST"\)/ },
    { name: "support service caution notice", pattern: /掲載情報は自治体・施設・団体・SNS等から収集しています/ },
    { name: "support service caution constant", pattern: /var SUPPORT_SERVICE_USER_SEARCH_CAUTION\s*=/ },
    { name: "support service card meta", pattern: /disaster-search__support-meta/ },
    { name: "support service render init", pattern: /renderDisasterSearch\(page, disasterSearchIndex, "SUPPORT_SERVICE"\)/ },
    { name: "volunteer capability status labels", pattern: /現在対応情報確認済み/ },
    { name: "volunteer capability unconfirmed note", pattern: /現在の募集状況は公式情報をご確認ください/ },
    { name: "volunteer search timestamps", pattern: /category === "VOLUNTEER"[\s\S]*appendSearchResultTimestamps/ },
    { name: "portal quick access volunteer card", pattern: /災害ボランティア募集を探す/ },
    { name: "page navigation render", pattern: /renderPageNavigation/ },
    { name: "x feed section render", pattern: /renderXFeedSection/ },
    { name: "emergency summary removed", pattern: /renderEmergencySummary/, invert: true },
    { name: "cross search hub removed", pattern: /renderCrossSearchHub/, invert: true },
    { name: "official information group removed", pattern: /renderOfficialInformationGroup/, invert: true },
    { name: "municipality detail section removed", pattern: /renderMunicipalityDetailSection/, invert: true },
    { name: "portal quick access no duplicate area card", pattern: /portal-quick-access__card-note/, invert: true },
    { name: "disaster search planned categories", pattern: /DISASTER_SEARCH_PLANNED_CATEGORIES/ },
    { name: "disaster search guide block", pattern: /disaster-search__guide/ },
    { name: "disaster search scope block", pattern: /disaster-search__scope/ }
  ].forEach(function (check) {
    const matched = check.pattern.test(appJs);
    const pass = check.invert ? !matched : matched;
    checks.push({ check: "JS: " + check.name, pass: pass });
    if (!pass) {
      errors.push("JS check failed: " + check.name);
    }
  });

  [
    { name: "water search preserved", pattern: /function searchWater/ },
    { name: "water cross view preserved", pattern: /renderWaterCrossView/ },
    { name: "water search section preserved", pattern: /WATER_SEARCH_ID/ }
  ].forEach(function (check) {
    const pass = check.pattern.test(appJs);
    checks.push({ check: "JS preserve: " + check.name, pass: pass });
    if (!pass) {
      errors.push("Existing WATER UI check failed: " + check.name);
    }
  });

  [
    { name: "portal quick access styles", pattern: /\.portal-quick-access/ },
    { name: "portal quick access card", pattern: /\.portal-quick-access__card/ },
    { name: "disaster search styles", pattern: /\.disaster-search/ },
    { name: "disaster search form", pattern: /\.disaster-search__form/ },
    { name: "disaster search mobile input", pattern: /\.disaster-search__input[\s\S]*min-height:\s*44px/ },
    { name: "disaster search desktop layout", pattern: /@media \(min-width: 768px\)[\s\S]*\.disaster-search__form/ },
    { name: "disaster search guide styles", pattern: /\.disaster-search__guide/ },
    { name: "disaster search scope styles", pattern: /\.disaster-search__scope/ },
    { name: "volunteer capability status styles", pattern: /\.disaster-search__capability-status/ },
    { name: "support service caution styles", pattern: /\.disaster-search__caution/ },
    { name: "support service meta styles", pattern: /\.disaster-search__support-meta/ }
  ].forEach(function (check) {
    const pass = check.pattern.test(css);
    checks.push({ check: "CSS: " + check.name, pass: pass });
    if (!pass) {
      errors.push("CSS check failed: " + check.name);
    }
  });

  const ukiResults = searchDisasterIndex(payload, "宇城 給水", { category: "WATER" });
  const kagoshimaResults = searchDisasterIndex(payload, "霧島 給水", { category: "WATER" });
  const kikuyoResults = searchDisasterIndex(payload, "菊陽 給水", { category: "WATER" });
  const waterCount = payload.index.filter(function (item) {
    return item.category === "WATER";
  }).length;
  const waterSearchIndex = JSON.parse(
    fs.readFileSync(path.join(ROOT, "data", "public", "water_search_index.json"), "utf8")
  );
  const expectedWaterCount = waterSearchIndex.item_count;
  const volunteerKumamotoResults = searchDisasterIndex(payload, "熊本 ボランティア", { category: "VOLUNTEER" });
  const volunteerKagoshimaResults = searchDisasterIndex(payload, "鹿児島 災害VC", { category: "VOLUNTEER" });
  const volunteerKirishimaResults = searchDisasterIndex(payload, "霧島 ボランティア", { category: "VOLUNTEER" });
  const volunteerUkiResults = searchDisasterIndex(payload, "宇城 災害VC", { category: "VOLUNTEER" });
  const volunteerCount = payload.index.filter(function (item) {
    return item.category === "VOLUNTEER";
  }).length;
  const supportShowerResults = searchDisasterIndex(payload, "シャワー", { category: "SUPPORT_SERVICE" });
  const supportCarCampResults = searchDisasterIndex(payload, "車中泊", { category: "SUPPORT_SERVICE" });
  const supportServiceCount = payload.index.filter(function (item) {
    return item.category === "SUPPORT_SERVICE";
  }).length;
  checks.push({
    check: "search engine usable",
    pass: ukiResults.length > 0 && kagoshimaResults.length > 0 && kikuyoResults.length > 0,
    ukiCount: ukiResults.length,
    kagoshimaCount: kagoshimaResults.length,
    kikuyoCount: kikuyoResults.length
  });
  checks.push({
    check: "water index count preserved",
    pass: waterCount === expectedWaterCount,
    waterCount: waterCount,
    expectedWaterCount: expectedWaterCount
  });
  checks.push({
    check: "volunteer search examples usable",
    pass:
      volunteerKumamotoResults.length > 0 &&
      volunteerKagoshimaResults.length > 0 &&
      volunteerKirishimaResults.length > 0 &&
      volunteerUkiResults.length > 0,
    kumamotoCount: volunteerKumamotoResults.length,
    kagoshimaCount: volunteerKagoshimaResults.length,
    kirishimaCount: volunteerKirishimaResults.length,
    ukiCount: volunteerUkiResults.length
  });
  checks.push({
    check: "volunteer index count preserved",
    pass: volunteerCount === 20,
    volunteerCount: volunteerCount
  });
  checks.push({
    check: "support service search examples usable",
    pass: supportShowerResults.length > 0 && supportCarCampResults.length > 0,
    showerCount: supportShowerResults.length,
    carCampCount: supportCarCampResults.length
  });
  const xSupportServiceCount = payload.index.filter(function (item) {
    return (
      item.category === "SUPPORT_SERVICE" &&
      item.source_url &&
      /x\.com/i.test(item.source_url)
    );
  }).length;
  checks.push({
    check: "support service index count",
    pass: supportServiceCount >= 6 && xSupportServiceCount >= 1,
    supportServiceCount: supportServiceCount,
    xSupportServiceCount: xSupportServiceCount
  });
  if (!ukiResults.length) {
    errors.push("search engine check failed: 宇城 給水");
  }
  if (!kagoshimaResults.length) {
    errors.push("search engine check failed: 霧島 給水");
  }
  if (!kikuyoResults.length) {
    errors.push("search engine check failed: 菊陽 給水");
  }
  if (waterCount !== expectedWaterCount) {
    errors.push(
      "water index count check failed: expected " +
      expectedWaterCount +
      ", got " +
      waterCount
    );
  }
  if (!volunteerKumamotoResults.length) {
    errors.push("volunteer search check failed: 熊本 ボランティア");
  }
  if (!volunteerKagoshimaResults.length) {
    errors.push("volunteer search check failed: 鹿児島 災害VC");
  }
  if (!volunteerKirishimaResults.length) {
    errors.push("volunteer search check failed: 霧島 ボランティア");
  }
  if (!volunteerUkiResults.length) {
    errors.push("volunteer search check failed: 宇城 災害VC");
  }
  if (volunteerCount !== 20) {
    errors.push("volunteer index count check failed: expected 20, got " + volunteerCount);
  }
  if (!supportShowerResults.length) {
    errors.push("support service search check failed: シャワー");
  }
  if (!supportCarCampResults.length) {
    errors.push("support service search check failed: 車中泊");
  }
  if (supportServiceCount < 6 || xSupportServiceCount < 1) {
    errors.push(
      "support service index count check failed: expected >=6 with X>=1, got " +
        supportServiceCount +
        " (X=" +
        xSupportServiceCount +
        ")"
    );
  }

  const output = {
    DISASTER_SEARCH_UI_VALIDATION: errors.length === 0 ? "PASS" : "FAIL",
    indexCount: payload.index.length,
    checks: checks,
    errors: errors
  };

  console.log("=== Disaster Search UI Validation ===");
  console.log(JSON.stringify(output, null, 2));

  if (errors.length) {
    process.exit(1);
  }

  console.log("PHASE27_DISASTER_SEARCH_UI_INTEGRATION_COMPLETE");
}

main();

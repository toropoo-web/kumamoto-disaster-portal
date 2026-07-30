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
    { name: "volunteer capability status labels", pattern: /現在対応情報確認済み/ },
    { name: "volunteer capability unconfirmed note", pattern: /現在の募集状況は公式情報をご確認ください/ },
    { name: "portal quick access volunteer card", pattern: /ボランティアを探す/ },
    { name: "emergency summary section", pattern: /renderEmergencySummary/ },
    { name: "cross search hub section", pattern: /renderCrossSearchHub/ },
    { name: "municipality detail collapse", pattern: /renderMunicipalityDetailSection/ },
    { name: "official information group", pattern: /renderOfficialInformationGroup/ },
    { name: "infrastructure collapse", pattern: /infrastructure-info__collapse/ },
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
    { name: "emergency summary styles", pattern: /\.emergency-summary/ },
    { name: "cross search hub styles", pattern: /\.cross-search-hub/ },
    { name: "municipality detail styles", pattern: /\.municipality-detail/ },
    { name: "official information styles", pattern: /\.official-information/ },
    { name: "infrastructure collapse styles", pattern: /\.infrastructure-info__collapse/ }
  ].forEach(function (check) {
    const pass = check.pattern.test(css);
    checks.push({ check: "CSS: " + check.name, pass: pass });
    if (!pass) {
      errors.push("CSS check failed: " + check.name);
    }
  });

  const ukiResults = searchDisasterIndex(payload, "宇城 給水", { category: "WATER" });
  const kagoshimaResults = searchDisasterIndex(payload, "霧島 給水", { category: "WATER" });
  const waterCount = payload.index.filter(function (item) {
    return item.category === "WATER";
  }).length;
  const volunteerKumamotoResults = searchDisasterIndex(payload, "熊本 ボランティア", { category: "VOLUNTEER" });
  const volunteerKagoshimaResults = searchDisasterIndex(payload, "鹿児島 災害VC", { category: "VOLUNTEER" });
  const volunteerKirishimaResults = searchDisasterIndex(payload, "霧島 ボランティア", { category: "VOLUNTEER" });
  const volunteerUkiResults = searchDisasterIndex(payload, "宇城 災害VC", { category: "VOLUNTEER" });
  checks.push({
    check: "search engine usable",
    pass: ukiResults.length > 0 && kagoshimaResults.length > 0,
    ukiCount: ukiResults.length,
    kagoshimaCount: kagoshimaResults.length
  });
  checks.push({
    check: "water index count preserved",
    pass: waterCount === 33,
    waterCount: waterCount
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
  if (!ukiResults.length) {
    errors.push("search engine check failed: 宇城 給水");
  }
  if (!kagoshimaResults.length) {
    errors.push("search engine check failed: 霧島 給水");
  }
  if (waterCount !== 33) {
    errors.push("water index count check failed: expected 33, got " + waterCount);
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

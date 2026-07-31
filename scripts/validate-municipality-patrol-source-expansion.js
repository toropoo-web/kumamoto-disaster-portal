#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");

const {
  MUNICIPALITY_SOURCE_TYPES,
  getMunicipalityPatrolSources,
  getMunicipalityTopPatrolSources,
  loadMunicipalityTopPageRegistry,
  countSourcesByMunicipality
} = require(path.join(ROOT, "monitor", "municipality-patrol-sources"));

const { parsePage } = require(path.join(ROOT, "monitor", "parser"));
const { findWaterKeywords } = require(path.join(ROOT, "monitor", "water-fetcher"));
const { getActiveWaterSources } = require(path.join(ROOT, "monitor", "water-sources"));
const {
  buildDisasterSearchIndex,
  searchDisasterIndex
} = require(path.join(ROOT, "monitor", "disaster-search-index-engine"));

const EXPECTED_MUNICIPALITY_COUNT = 23;
const EXPECTED_TOP_PAGE_SOURCE_COUNT = 69;
const PARSER_FIXTURE = path.join(
  ROOT,
  "monitor",
  "fixtures",
  "municipality-patrol",
  "parser-fixture.json"
);

const PUBLIC_WATER_FILES = [
  "data/water_search_index.json",
  "data/public/water_search_index.json",
  "data/water_cross_view.json",
  "data/public/water_cross_view.json"
];

function hashFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function main() {
  const errors = [];
  const checks = [];

  [
    "monitor/municipality-patrol-sources.js",
    "data/municipality_patrol/municipality_top_page_sources.json",
    "monitor/fixtures/municipality-patrol/parser-fixture.json"
  ].forEach(function (file) {
    const exists = fs.existsSync(path.join(ROOT, file));
    checks.push({ check: file, pass: exists });
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

  const waterSourceCountBefore = getActiveWaterSources().length;
  const registry = loadMunicipalityTopPageRegistry();
  const topSources = getMunicipalityTopPatrolSources();
  const allSources = getMunicipalityPatrolSources();
  const municipalityCounts = countSourcesByMunicipality(allSources);

  checks.push({
    check: "23 municipalities in registry",
    pass: (registry.municipalities || []).length === EXPECTED_MUNICIPALITY_COUNT
  });
  if ((registry.municipalities || []).length !== EXPECTED_MUNICIPALITY_COUNT) {
    errors.push("registry municipality count is not 23");
  }

  checks.push({
    check: "top page patrol source count preserved",
    pass: topSources.length === EXPECTED_TOP_PAGE_SOURCE_COUNT,
    topSourceCount: topSources.length
  });
  if (topSources.length !== EXPECTED_TOP_PAGE_SOURCE_COUNT) {
    errors.push("top page patrol source count changed");
  }

  Object.keys(municipalityCounts).forEach(function (areaId) {
    if (municipalityCounts[areaId] < 3) {
      errors.push("municipality " + areaId + " has fewer than 3 patrol sources");
    }
  });
  checks.push({
    check: "all municipalities have composite patrol coverage",
    pass: Object.keys(municipalityCounts).length === EXPECTED_MUNICIPALITY_COUNT
  });

  const primaryTypes = [
    MUNICIPALITY_SOURCE_TYPES.DISASTER_PAGE,
    MUNICIPALITY_SOURCE_TYPES.EMERGENCY_TOP,
    MUNICIPALITY_SOURCE_TYPES.IMPORTANT_NOTICE,
    MUNICIPALITY_SOURCE_TYPES.DISASTER_RADIO
  ];
  const secondaryTypes = [
    MUNICIPALITY_SOURCE_TYPES.WATER_OFFICIAL,
    MUNICIPALITY_SOURCE_TYPES.SOCIAL_WELFARE
  ];

  primaryTypes.forEach(function (sourceType) {
    const count = allSources.filter(function (source) {
      return source.municipality_source_type === sourceType;
    }).length;
    checks.push({
      check: "primary source type present: " + sourceType,
      pass: count >= EXPECTED_MUNICIPALITY_COUNT,
      count: count
    });
    if (count < EXPECTED_MUNICIPALITY_COUNT) {
      errors.push("primary source type missing coverage: " + sourceType);
    }
  });

  secondaryTypes.forEach(function (sourceType) {
    const count = allSources.filter(function (source) {
      return source.municipality_source_type === sourceType;
    }).length;
    checks.push({
      check: "secondary source type present: " + sourceType,
      pass: count > 0,
      count: count
    });
  });

  allSources.forEach(function (source, index) {
    if (!source.municipality_source_type) {
      errors.push("source[" + index + "] missing municipality_source_type");
    }
    if (!source.priority) {
      errors.push("source[" + index + "] missing priority");
    }
    if (source.source_type !== "official") {
      errors.push("source[" + index + "] must remain official");
    }
  });

  const parserFixture = JSON.parse(fs.readFileSync(PARSER_FIXTURE, "utf8"));
  const kashimaParsed = parsePage(
    {
      ok: true,
      status: 200,
      url: "https://www.town.kumamoto-kashima.lg.jp/q/aview/55/6037.html",
      body: parserFixture.kashima_water_page,
      headers: {}
    },
    { preferArticleUpdatedAt: true }
  );
  const kashimaKeywords = findWaterKeywords(
    parserFixture.kashima_water_page,
    ["飲料水", "自衛隊", "給水"]
  );

  checks.push({
    check: "kashima water keywords detected",
    pass:
      kashimaKeywords.indexOf("飲料水") !== -1 &&
      /自衛隊|給水/.test(kashimaKeywords.join(" ")),
    keywords: kashimaKeywords
  });
  checks.push({
    check: "kashima source_updated_at on 2026-07-31",
    pass: String(kashimaParsed.sourceUpdatedAt).indexOf("2026-07-31") !== -1,
    sourceUpdatedAt: kashimaParsed.sourceUpdatedAt
  });
  checks.push({
    check: "kashima checked_at separated from source_updated_at",
    pass:
      kashimaParsed.checkedAt &&
      kashimaParsed.sourceUpdatedAt &&
      kashimaParsed.checkedAt !== kashimaParsed.sourceUpdatedAt
  });
  if (String(kashimaParsed.sourceUpdatedAt).indexOf("2026-07-31") === -1) {
    errors.push("kashima verification failed: expected 2026-07-31 source_updated_at");
  }

  const ukiParsed = parsePage(
    {
      ok: true,
      status: 200,
      url: "https://www.city.uki.kumamoto.jp/toppage/important/2606682",
      body: parserFixture.uki_water_page,
      headers: {}
    },
    { preferArticleUpdatedAt: true }
  );
  checks.push({
    check: "uki prefers article date over parent meta",
    pass:
      String(ukiParsed.sourceUpdatedAt).indexOf("2026-07-31") !== -1 &&
      String(ukiParsed.pageUpdatedAt).indexOf("2026-07-28") !== -1,
    sourceUpdatedAt: ukiParsed.sourceUpdatedAt,
    pageUpdatedAt: ukiParsed.pageUpdatedAt
  });
  if (String(ukiParsed.sourceUpdatedAt).indexOf("2026-07-31") === -1) {
    errors.push("uki verification failed: article date not preferred");
  }

  const kashimaSources = allSources.filter(function (source) {
    return source.area_id === "KM012";
  });
  checks.push({
    check: "kashima disaster page source registered",
    pass: kashimaSources.some(function (source) {
      return (
        source.municipality_source_type === MUNICIPALITY_SOURCE_TYPES.DISASTER_PAGE &&
        /6037\.html/.test(source.url)
      );
    })
  });

  const ukiWaterSource = allSources.find(function (source) {
    return source.area_id === "KM003" && source.municipality_source_type === "WATER_OFFICIAL";
  });
  checks.push({
    check: "uki water source prefers article updated_at",
    pass: ukiWaterSource && ukiWaterSource.prefer_article_updated_at === true
  });

  const runMonitor = fs.readFileSync(path.join(ROOT, "scripts", "run-monitor.js"), "utf8");
  checks.push({
    check: "run-monitor loads municipality patrol sources",
    pass: /getMunicipalityPatrolSources/.test(runMonitor)
  });

  const waterSourceCountAfter = getActiveWaterSources().length;
  checks.push({
    check: "WATER registry count preserved",
    pass: waterSourceCountAfter === waterSourceCountBefore,
    waterSourceCount: waterSourceCountAfter
  });
  if (waterSourceCountAfter !== waterSourceCountBefore) {
    errors.push("WATER registry count changed");
  }

  const indexPayload = buildDisasterSearchIndex();
  const categories = {};
  indexPayload.index.forEach(function (entry) {
    categories[entry.category] = (categories[entry.category] || 0) + 1;
  });
  checks.push({
    check: "VOLUNTEER search preserved",
    pass: categories.VOLUNTEER === 20,
    volunteerCount: categories.VOLUNTEER
  });
  const xSupportServiceCount = indexPayload.index.filter(function (entry) {
    return (
      entry.category === "SUPPORT_SERVICE" &&
      entry.source_url &&
      /x\.com/i.test(entry.source_url)
    );
  }).length;
  checks.push({
    check: "SUPPORT_SERVICE search preserved",
    pass: categories.SUPPORT_SERVICE >= 6 && xSupportServiceCount >= 1,
    supportServiceCount: categories.SUPPORT_SERVICE,
    xSupportServiceCount: xSupportServiceCount
  });

  const showerResults = searchDisasterIndex(indexPayload, "シャワー", {
    category: "SUPPORT_SERVICE"
  });
  checks.push({
    check: "SUPPORT_SERVICE shower search preserved",
    pass: showerResults.length > 0
  });

  const xFeedFailOpen = fs.readFileSync(path.join(ROOT, "scripts", "sync-x-feed.js"), "utf8");
  checks.push({
    check: "x feed fail-open preserved",
    pass: /FAIL_OPEN/.test(xFeedFailOpen) && /retainStalePreview/.test(xFeedFailOpen)
  });

  PUBLIC_WATER_FILES.forEach(function (file) {
    const fullPath = path.join(ROOT, file);
    if (!fs.existsSync(fullPath) || !publicHashesBefore[file]) {
      return;
    }
    const pass = hashFile(fullPath) === publicHashesBefore[file];
    checks.push({ check: "water file unchanged: " + file, pass: pass });
    if (!pass) {
      errors.push("water file changed: " + file);
    }
  });

  const output = {
    PHASE29_MUNICIPALITY_PATROL_SOURCE_EXPANSION: errors.length === 0 ? "PASS" : "FAIL",
    municipalityCount: (registry.municipalities || []).length,
    topPagePatrolSourceCount: topSources.length,
    expandedPatrolSourceCount: allSources.length,
    waterRegistryCount: waterSourceCountAfter,
    indexCategories: categories,
    checks: checks,
    errors: errors
  };

  console.log("=== Municipality Patrol Source Expansion Validation ===");
  console.log(JSON.stringify(output, null, 2));

  if (errors.length) {
    process.exit(1);
  }

  console.log("PHASE29_MUNICIPALITY_PATROL_SOURCE_EXPANSION_COMPLETE");
}

main();

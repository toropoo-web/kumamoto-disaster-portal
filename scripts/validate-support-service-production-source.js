#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");

const {
  loadSupportServiceSourceRegistry,
  validateSupportServiceSourceRegistry
} = require(path.join(ROOT, "monitor", "support-service-source-registry"));

const {
  PRODUCTION_WEB_POSTS_FIXTURE,
  PRODUCTION_X_FEED_FIXTURE,
  validateProductionSourceRegistry,
  assertProductionSourceRegistration,
  runProductionSourceDiscovery,
  loadProductionRegistryFixture,
  findSourceByAccount
} = require(path.join(ROOT, "monitor", "support-service-production-source"));

const {
  buildDisasterSearchIndex
} = require(path.join(ROOT, "monitor", "disaster-search-index-engine"));

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

function main() {
  const errors = [];
  const checks = [];

  [
    "monitor/support-service-production-source.js",
    "monitor/support-service-patrol-fetcher.js",
    "data/support_service_discovery/source_registry.json",
    "monitor/fixtures/support-service-production-source/production-registry-fixture.json",
    "monitor/fixtures/support-service-production-source/x-feed-fixture.json",
    "monitor/fixtures/support-service-production-source/web-posts-fixture.json"
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
  const indexBefore = buildDisasterSearchIndex();
  const categoriesBefore = {};
  indexBefore.index.forEach(function (entry) {
    categoriesBefore[entry.category] = (categoriesBefore[entry.category] || 0) + 1;
  });

  const productionRegistry = loadSupportServiceSourceRegistry();
  const case1 = runCase("case1 production source registry load", function () {
    const registryErrors = validateProductionSourceRegistry(productionRegistry);
    const baseErrors = validateSupportServiceSourceRegistry(productionRegistry);
    return {
      pass:
        registryErrors.length === 0 &&
        baseErrors.length === 0 &&
        (productionRegistry.sources || []).length >= 6,
      detail: {
        sourceCount: (productionRegistry.sources || []).length,
        registryErrors: registryErrors,
        baseErrors: baseErrors
      }
    };
  });
  checks.push(case1);
  if (!case1.pass) {
    errors.push("case1 failed: production source registry must load and validate");
  }

  const fixtureRegistry = loadProductionRegistryFixture();
  const discoveryResult = runProductionSourceDiscovery(fixtureRegistry, {
    fixturePath: PRODUCTION_WEB_POSTS_FIXTURE,
    xFeedPath: PRODUCTION_X_FEED_FIXTURE,
    referenceDate: "2026-07-31"
  });

  const case2 = runCase("case2 x source account match generates candidate", function () {
    const xCandidate = (discoveryResult.batch.candidates || []).find(function (candidate) {
      return candidate.source_id === "SSRC-PROD-X0001";
    });
    const xSource = findSourceByAccount(fixtureRegistry, "kumamotocity_");
    return {
      pass: Boolean(
        discoveryResult.ok === true &&
          Boolean(xSource) &&
          Boolean(xCandidate) &&
          xCandidate.source_id === "SSRC-PROD-X0001" &&
          xCandidate.checked_at
      ),
      detail: xCandidate || null
    };
  });
  checks.push(case2);
  if (!case2.pass) {
    errors.push("case2 failed: X source account match must generate candidate");
  }

  const case3 = runCase("case3 web source generates candidate", function () {
    const webCandidate = (discoveryResult.batch.candidates || []).find(function (candidate) {
      return candidate.source_id === "SSRC-PROD-W0001";
    });
    return {
      pass: Boolean(
        discoveryResult.ok === true &&
          Boolean(webCandidate) &&
          webCandidate.source_type === "WEB" &&
          webCandidate.published_at
      ),
      detail: webCandidate || null
    };
  });
  checks.push(case3);
  if (!case3.pass) {
    errors.push("case3 failed: WEB source must generate candidate");
  }

  const case4 = runCase("case4 out of area preserved", function () {
    const outOfAreaCandidate = (discoveryResult.batch.candidates || []).find(function (candidate) {
      return candidate.source_id === "SSRC-PROD-W0002";
    });
    return {
      pass:
        Boolean(outOfAreaCandidate) &&
        outOfAreaCandidate.status === "OUT_OF_AREA" &&
        (discoveryResult.batch.out_of_area_count || 0) >= 1,
      detail: outOfAreaCandidate || null
    };
  });
  checks.push(case4);
  if (!case4.pass) {
    errors.push("case4 failed: out of area candidate must remain OUT_OF_AREA");
  }

  const case5 = runCase("case5 duplicate source registration rejected", function () {
    const duplicateAttempt = assertProductionSourceRegistration(productionRegistry, {
      source_id: "SSRC-DUP-TEST01",
      source_name: productionRegistry.sources[0].source_name,
      platform: "WEB",
      url: "https://example.invalid/support-service/duplicate-test",
      account: "",
      area: "熊本県熊本市",
      categories: ["SPACE"]
    });
    const duplicateAccountAttempt = assertProductionSourceRegistration(productionRegistry, {
      source_id: "SSRC-DUP-TEST02",
      source_name: "重複アカウントテスト",
      platform: "X",
      url: "https://x.com/duplicate_test_account",
      account: productionRegistry.sources.find(function (entry) {
        return entry.platform === "X";
      }).account,
      area: "熊本県熊本市",
      categories: ["BATH"]
    });
    return {
      pass:
        duplicateAttempt.ok === false &&
        duplicateAccountAttempt.ok === false &&
        (duplicateAttempt.errors || []).length > 0 &&
        (duplicateAccountAttempt.errors || []).length > 0,
      detail: {
        duplicateName: duplicateAttempt.errors,
        duplicateAccount: duplicateAccountAttempt.errors
      }
    };
  });
  checks.push(case5);
  if (!case5.pass) {
    errors.push("case5 failed: duplicate source registration must be rejected");
  }

  const traceCandidate = (discoveryResult.batch.candidates || []).find(function (candidate) {
    return candidate.source_id === "SSRC-PROD-X0001";
  });
  const traceSource = fixtureRegistry.sources.find(function (source) {
    return source.source_id === "SSRC-PROD-X0001";
  });
  checks.push({
    check: "discovery preserves source_id area category checked_at",
    pass:
      Boolean(traceCandidate) &&
      traceCandidate.source_id === traceSource.source_id &&
      traceCandidate.area === traceSource.area &&
      traceCandidate.checked_at &&
      Array.isArray(traceSource.categories) &&
      traceSource.categories.length > 0,
    detail: {
      source_id: traceCandidate && traceCandidate.source_id,
      area: traceCandidate && traceCandidate.area,
      checked_at: traceCandidate && traceCandidate.checked_at,
      categories: traceSource && traceSource.categories
    }
  });
  if (!traceCandidate || !traceCandidate.checked_at) {
    errors.push("discovery flow failed: source_id/area/checked_at not preserved");
  }

  const indexAfter = buildDisasterSearchIndex();
  const categoriesAfter = {};
  indexAfter.index.forEach(function (entry) {
    categoriesAfter[entry.category] = (categoriesAfter[entry.category] || 0) + 1;
  });

  const case6 = runCase("case6 water volunteer unchanged", function () {
    return {
      pass:
        categoriesAfter.WATER === waterSearchIndex.item_count &&
        categoriesAfter.VOLUNTEER === 20 &&
        categoriesAfter.SUPPORT_SERVICE === 5,
      detail: {
        water: categoriesAfter.WATER,
        volunteer: categoriesAfter.VOLUNTEER,
        supportService: categoriesAfter.SUPPORT_SERVICE
      }
    };
  });
  checks.push(case6);
  if (!case6.pass) {
    errors.push("case6 failed: WATER/VOLUNTEER/SUPPORT_SERVICE counts changed");
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
    pass: productionRegistry.AUTO_PUBLISH === false && discoveryResult.AUTO_PUBLISH === false
  });
  if (productionRegistry.AUTO_PUBLISH !== false) {
    errors.push("AUTO_PUBLISH must remain false");
  }

  const output = {
    SUPPORT_SERVICE_PRODUCTION_SOURCE_VALIDATION: errors.length === 0 ? "PASS" : "FAIL",
    AUTO_PUBLISH: false,
    productionSourceCount: (productionRegistry.sources || []).length,
    discoveryCandidateCount: discoveryResult.batch && discoveryResult.batch.candidate_count,
    indexCategoriesBefore: categoriesBefore,
    indexCategoriesAfter: categoriesAfter,
    checks: checks,
    errors: errors
  };

  console.log("=== SUPPORT_SERVICE Production Source Validation (Phase26) ===");
  console.log(JSON.stringify(output, null, 2));

  if (errors.length) {
    process.exit(1);
  }

  console.log("PHASE26_SUPPORT_SERVICE_PRODUCTION_SOURCE_COMPLETE");
}

main();

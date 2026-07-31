#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");

const {
  runSupportServiceXPublicSearchPipeline,
  assertCandidateFields,
  REQUIRED_CANDIDATE_FIELDS,
  FORBIDDEN_CANDIDATE_FIELDS
} = require(path.join(ROOT, "monitor", "support-service-x-public-pipeline"));

const { AUTO_PUBLISH } = require(path.join(ROOT, "monitor", "support-service-discovery-engine"));

const {
  buildDisasterSearchIndex,
  searchDisasterIndex
} = require(path.join(ROOT, "monitor", "disaster-search-index-engine"));

const FIXTURE_PATH = path.join(
  ROOT,
  "monitor",
  "fixtures",
  "support-service-x-discovery",
  "posts-fixture.json"
);

const PUBLIC_WATER_FILES = [
  "data/water_search_index.json",
  "data/public/water_search_index.json",
  "data/water_cross_view.json",
  "data/public/water_cross_view.json"
];

const PHASE1_FILES = ["data/public/phase1_updates.json"];

const CASE_POSTS = {
  A: "熊本市 被災者向けに無料シャワーを開放しています。利用できます。",
  B: "宇城市 駐車場を車中泊利用できます。被災された方はご利用ください。",
  C: "八代市 井戸水を提供しています。飲料水として利用できます。",
  D: "益城町 本日炊き出しを実施します。食事提供します。"
};

function hashFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function findCandidateByText(batch, textFragment) {
  return (batch.candidates || []).find(function (candidate) {
    return candidate && String(candidate.text || "").indexOf(textFragment) !== -1;
  });
}

function findPublicEntryByUrl(publicPayload, url) {
  return (publicPayload.informations || []).find(function (entry) {
    return entry && entry.source_url === url;
  });
}

function main() {
  const errors = [];
  const checks = [];

  [
    "monitor/support-service-x-public-pipeline.js",
    "monitor/support-service-x-discovery.js",
    "monitor/support-service-search-dictionary.js",
    FIXTURE_PATH
  ].forEach(function (file) {
    const relative = file.indexOf(ROOT) === 0 ? path.relative(ROOT, file) : file;
    const exists = fs.existsSync(path.join(ROOT, relative));
    checks.push({ check: "file exists: " + relative, pass: exists });
    if (!exists) {
      errors.push("Missing file: " + relative);
    }
  });

  const publicHashesBefore = {};
  PUBLIC_WATER_FILES.concat(PHASE1_FILES).forEach(function (file) {
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

  const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));
  const pipeline = runSupportServiceXPublicSearchPipeline({
    posts: fixture.posts,
    referenceDate: fixture.referenceDate,
    sourceRegistry: { sources: [] }
  });

  checks.push({
    check: "AUTO_PUBLISH false",
    pass: pipeline.AUTO_PUBLISH === false && AUTO_PUBLISH === false
  });
  if (pipeline.AUTO_PUBLISH !== false) {
    errors.push("AUTO_PUBLISH must remain false");
  }

  const caseACandidate = findCandidateByText(pipeline.discoveryBatch, "無料シャワーを開放");
  checks.push({
    case: "Case1",
    check: "X無料シャワー検出",
    pass:
      caseACandidate &&
      caseACandidate.status === "NEW" &&
      caseACandidate.subcategory === "BATH" &&
      caseACandidate.source_type === "X"
  });
  if (!caseACandidate || caseACandidate.subcategory !== "BATH") {
    errors.push("Case1 failed: expected BATH candidate from X shower post");
  }

  const caseBCandidate = findCandidateByText(pipeline.discoveryBatch, "宇城市 駐車場");
  checks.push({
    case: "Case2",
    check: "X車中泊検出",
    pass: caseBCandidate && caseBCandidate.subcategory === "VEHICLE"
  });
  if (!caseBCandidate || caseBCandidate.subcategory !== "VEHICLE") {
    errors.push("Case2 failed: expected VEHICLE candidate");
  }

  const approvedCount = (pipeline.candidateReviewQueue.items || []).filter(function (item) {
    return item.status === "APPROVED";
  }).length;
  const changeApprovedCount = (pipeline.changeReviewQueue.items || []).filter(function (item) {
    return item.status === "APPROVED";
  }).length;
  checks.push({
    case: "Case3",
    check: "Review経由（Candidate→Change Review APPROVED）",
    pass:
      approvedCount > 0 &&
      changeApprovedCount > 0 &&
      pipeline.applyQueue.item_count > 0 &&
      pipeline.applyQueue.AUTO_PUBLISH === false
  });
  if (!approvedCount || !changeApprovedCount) {
    errors.push("Case3 failed: review approval path missing");
  }

  const caseAPublic = findPublicEntryByUrl(
    pipeline.publicPayload,
    "https://x.com/example/status/phase27-case-a"
  );
  const caseCPublic = findPublicEntryByUrl(
    pipeline.publicPayload,
    "https://x.com/example/status/phase27-case-c"
  );
  checks.push({
    case: "Case4",
    check: "Public反映",
    pass:
      pipeline.appliedCount >= 4 &&
      pipeline.publicValidationErrors.length === 0 &&
      caseAPublic &&
      caseAPublic.subcategory === "BATH" &&
      caseCPublic &&
      caseCPublic.subcategory === "WATER_SUPPORT"
  });
  if (!caseAPublic || !caseCPublic) {
    errors.push("Case4 failed: X posts not applied to public payload");
  }
  if (pipeline.publicValidationErrors.length) {
    errors.push.apply(errors, pipeline.publicValidationErrors);
  }
  if (caseCPublic && caseCPublic.subcategory !== "WATER_SUPPORT") {
    errors.push("Case4 failed: water post must map to WATER_SUPPORT");
  }

  const xPublicEntries = (pipeline.publicPayload.informations || []).filter(function (entry) {
    return entry && entry.source_type === "X";
  });
  const xKeywordEntries = (pipeline.publicPayload.informations || []).filter(function (entry) {
    return (
      entry &&
      Array.isArray(entry.detected_keywords) &&
      entry.detected_keywords.length > 0
    );
  });
  const xTraceEntries = (pipeline.publicPayload.informations || []).filter(function (entry) {
    return (
      entry &&
      entry.source_trace &&
      entry.source_trace.platform === "X" &&
      Array.isArray(entry.source_trace.detected_keywords) &&
      entry.source_trace.detected_keywords.length > 0
    );
  });
  const xIndexEntries = (pipeline.indexPayload.index || []).filter(function (entry) {
    return (
      entry &&
      entry.category === "SUPPORT_SERVICE" &&
      (entry.source_platform === "X" ||
        (entry.source_url && /x\.com/i.test(entry.source_url)))
    );
  });
  checks.push({
    case: "Case4b",
    check: "Public trace retention after X apply",
    pass:
      xPublicEntries.length >= 1 &&
      xKeywordEntries.length >= 1 &&
      xTraceEntries.length >= 1,
    sourceTypeXCount: xPublicEntries.length,
    detectedKeywordsCount: xKeywordEntries.length,
    sourceTraceCount: xTraceEntries.length
  });
  if (xPublicEntries.length < 1 || xKeywordEntries.length < 1 || xTraceEntries.length < 1) {
    errors.push("Case4b failed: public X trace fields not retained after apply");
  }
  checks.push({
    case: "Case5b",
    check: "Search index X SUPPORT_SERVICE retained",
    pass: xIndexEntries.length >= 1,
    xSupportServiceCount: xIndexEntries.length
  });
  if (xIndexEntries.length < 1) {
    errors.push("Case5b failed: X-derived SUPPORT_SERVICE index entries missing");
  }

  const xPublicWithTrace = (pipeline.publicPayload.informations || []).filter(function (entry) {
    return entry && entry.source_type === "X" && entry.source_url;
  });
  const xIndexTraceEntries = (pipeline.indexPayload.index || []).filter(function (entry) {
    return (
      entry &&
      entry.category === "SUPPORT_SERVICE" &&
      entry.source_type === "X" &&
      entry.source_platform === "X" &&
      entry.source_url &&
      Array.isArray(entry.detected_keywords) &&
      entry.detected_keywords.length > 0 &&
      entry.source_trace &&
      entry.source_trace.platform === "X"
    );
  });
  const traceRetentionPass =
    xPublicWithTrace.length > 0 &&
    xIndexTraceEntries.length >= xPublicWithTrace.length &&
    xPublicWithTrace.every(function (publicEntry) {
      return xIndexTraceEntries.some(function (indexEntry) {
        return (
          indexEntry.source_url === publicEntry.source_url &&
          indexEntry.source_type === "X" &&
          indexEntry.source_platform === "X"
        );
      });
    });
  checks.push({
    case: "Case4c",
    check: "Search index trace retention from public X entries",
    pass: traceRetentionPass,
    xPublicCount: xPublicWithTrace.length,
    xIndexTraceCount: xIndexTraceEntries.length
  });
  if (!traceRetentionPass) {
    errors.push("Case4c failed: disaster_search_index missing X trace fields from public");
  }

  const muryoSearch = pipeline.searchDisasterIndex("無料", {
    category: "SUPPORT_SERVICE"
  });
  const muryoXResults = muryoSearch.filter(function (item) {
    return item && item.source_type === "X" && item.source_platform === "X";
  });
  checks.push({
    case: "Case4d",
    check: "Search 無料 returns X-derived SUPPORT_SERVICE",
    pass: muryoXResults.length >= 1,
    muryoResultCount: muryoSearch.length,
    muryoXResultCount: muryoXResults.length
  });
  if (muryoXResults.length < 1) {
    errors.push("Case4d failed: 無料 search did not return X-derived SUPPORT_SERVICE");
  }

  const committedPublic = JSON.parse(
    fs.readFileSync(path.join(ROOT, "data", "public", "support_information.json"), "utf8")
  );
  const committedIndex = buildDisasterSearchIndex();
  const committedXPublic = (committedPublic.informations || []).filter(function (entry) {
    return entry && entry.source_type === "X" && entry.source_url;
  });
  const committedXIndex = (committedIndex.index || []).filter(function (entry) {
    return (
      entry &&
      entry.category === "SUPPORT_SERVICE" &&
      entry.source_type === "X" &&
      entry.source_platform === "X" &&
      entry.source_url &&
      Array.isArray(entry.detected_keywords) &&
      entry.detected_keywords.length > 0 &&
      entry.source_trace &&
      entry.source_trace.platform === "X"
    );
  });
  const committedMuryoX = searchDisasterIndex(committedIndex, "無料", {
    category: "SUPPORT_SERVICE"
  }).filter(function (item) {
    return item && item.source_type === "X" && item.source_platform === "X";
  });
  const committedTracePass =
    committedXPublic.length > 0 &&
    committedXIndex.length >= committedXPublic.length &&
    committedMuryoX.length >= 1;
  checks.push({
    case: "Case4e",
    check: "Committed public/index X trace + 無料 search",
    pass: committedTracePass,
    committedXPublicCount: committedXPublic.length,
    committedXIndexCount: committedXIndex.length,
    committedMuryoXCount: committedMuryoX.length
  });
  if (!committedTracePass) {
    errors.push("Case4e failed: committed disaster_search_index missing X trace/search");
  }

  const showerSearch = pipeline.searchDisasterIndex("無料シャワー", {
    category: "SUPPORT_SERVICE"
  });
  const carCampSearch = pipeline.searchDisasterIndex("車中泊できます", {
    category: "SUPPORT_SERVICE"
  });
  const waterSearch = pipeline.searchDisasterIndex("井戸水あります", {
    category: "SUPPORT_SERVICE"
  });
  checks.push({
    case: "Case5",
    check: "検索表示",
    pass:
      showerSearch.length > 0 &&
      carCampSearch.length > 0 &&
      waterSearch.length > 0 &&
      showerSearch.some(function (item) {
        return item.subcategory === "BATH";
      }) &&
      waterSearch.some(function (item) {
        return item.subcategory === "WATER_SUPPORT";
      })
  });
  if (!showerSearch.length || !carCampSearch.length || !waterSearch.length) {
    errors.push("Case5 failed: X-derived SUPPORT_SERVICE entries not searchable");
  }

  [caseACandidate, caseBCandidate].forEach(function (candidate, index) {
    if (!candidate) {
      return;
    }
    const fieldErrors = assertCandidateFields(candidate);
    checks.push({
      check: "candidate required fields preserved[" + index + "]",
      pass: fieldErrors.length === 0,
      fields: REQUIRED_CANDIDATE_FIELDS,
      forbidden: FORBIDDEN_CANDIDATE_FIELDS,
      errors: fieldErrors
    });
    errors.push.apply(errors, fieldErrors.map(function (message) {
      return "candidate field validation: " + message;
    }));
  });

  Object.keys(CASE_POSTS).forEach(function (caseKey) {
    const candidate = findCandidateByText(pipeline.discoveryBatch, CASE_POSTS[caseKey].slice(0, 8));
    const expected = {
      A: "BATH",
      B: "VEHICLE",
      C: "WATER_SUPPORT",
      D: "FOOD"
    }[caseKey];
    checks.push({
      check: "fixture case " + caseKey + " subcategory",
      pass: candidate && candidate.subcategory === expected,
      subcategory: candidate && candidate.subcategory
    });
    if (!candidate || candidate.subcategory !== expected) {
      errors.push("fixture case " + caseKey + " failed: expected " + expected);
    }
  });

  const indexAfterCommitted = buildDisasterSearchIndex();
  const categoriesAfter = {};
  indexAfterCommitted.index.forEach(function (entry) {
    categoriesAfter[entry.category] = (categoriesAfter[entry.category] || 0) + 1;
  });

  const case6Pass =
    categoriesAfter.WATER === waterSearchIndex.item_count &&
    categoriesAfter.VOLUNTEER === categoriesBefore.VOLUNTEER &&
    categoriesAfter.SUPPORT_SERVICE === categoriesBefore.SUPPORT_SERVICE;
  checks.push({
    case: "Case6",
    check: "WATER/VOLUNTEER/SUPPORT_SERVICE committed index unchanged",
    pass: case6Pass,
    categoriesBefore: categoriesBefore,
    categoriesAfter: categoriesAfter
  });
  if (!case6Pass) {
    errors.push("Case6 failed: committed disaster index layers changed during validation");
  }

  PUBLIC_WATER_FILES.concat(PHASE1_FILES).forEach(function (file) {
    const fullPath = path.join(ROOT, file);
    if (!fs.existsSync(fullPath) || !publicHashesBefore[file]) {
      return;
    }
    const pass = hashFile(fullPath) === publicHashesBefore[file];
    checks.push({ case: "Case6", check: "file unchanged: " + file, pass: pass });
    if (!pass) {
      errors.push("Case6 failed: file changed during validation: " + file);
    }
  });

  const output = {
    SUPPORT_SERVICE_X_PUBLIC_SEARCH_VALIDATION: errors.length === 0 ? "PASS" : "FAIL",
    AUTO_PUBLISH: false,
    appliedCount: pipeline.appliedCount,
    approvedCandidateCount: approvedCount,
    approvedChangeReviewCount: changeApprovedCount,
    publicInformationCount: pipeline.publicPayload.information_count,
    searchSamples: {
      shower: showerSearch.length,
      carCamp: carCampSearch.length,
      water: waterSearch.length
    },
    checks: checks,
    errors: errors
  };

  console.log("=== SUPPORT_SERVICE X Public Search Validation (Phase27.1) ===");
  console.log(JSON.stringify(output, null, 2));

  if (errors.length) {
    process.exit(1);
  }
}

main();

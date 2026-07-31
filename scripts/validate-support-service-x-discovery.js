#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");

const {
  OPENING_TYPE,
  buildCandidateFromPost,
  discoverSupportServiceCandidates,
  validateSupportServiceCandidateBatch
} = require(path.join(ROOT, "monitor", "support-service-discovery-engine"));

const {
  buildSupportServiceReviewQueue,
  validateSupportServiceReviewQueue
} = require(path.join(ROOT, "monitor", "support-service-review-queue"));

const {
  evaluateXDiscoveryText,
  isDiscoverableSupportServicePost,
  isExcludedDiscoveryText,
  loadXFeedPosts,
  discoverXFeedSupportServiceCandidates,
  TOPIC_KEYWORD_GROUPS,
  SUPPORT_STATE_KEYWORDS
} = require(path.join(ROOT, "monitor", "support-service-source-discovery"));

const {
  buildDisasterSearchIndex
} = require(path.join(ROOT, "monitor", "disaster-search-index-engine"));

const PUBLIC_WATER_FILES = [
  "data/water_search_index.json",
  "data/public/water_search_index.json",
  "data/water_cross_view.json",
  "data/public/water_cross_view.json"
];

const FIXTURE_PATH = path.join(
  ROOT,
  "monitor",
  "fixtures",
  "support-service-x-discovery",
  "posts-fixture.json"
);

function hashFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function main() {
  const errors = [];
  const checks = [];

  [
    "monitor/support-service-x-discovery.js",
    "monitor/support-service-source-discovery.js",
    "monitor/support-service-discovery-engine.js",
    "monitor/fixtures/support-service-x-discovery/posts-fixture.json",
    "data/support_service_discovery/source_registry.json",
    "data/public/x_feed_preview.json"
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

  const registry = JSON.parse(
    fs.readFileSync(path.join(ROOT, "data", "support_service_discovery", "source_registry.json"), "utf8")
  );
  const xSources = (registry.sources || []).filter(function (source) {
    return source && source.platform === "X";
  });
  checks.push({
    check: "source registry includes platform:X",
    pass: xSources.length > 0,
    xSourceCount: xSources.length
  });
  if (!xSources.length) {
    errors.push("source_registry.json must include platform:X sources");
  }

  const xFeedPosts = loadXFeedPosts();
  checks.push({
    check: "x feed posts loadable",
    pass: Array.isArray(xFeedPosts),
    postCount: xFeedPosts.length
  });

  const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));
  const batch = discoverSupportServiceCandidates(fixture.posts, {
    referenceDate: fixture.referenceDate,
    persistSourceRegistry: false
  });
  const candidateErrors = validateSupportServiceCandidateBatch(batch);
  checks.push({
    check: "candidate batch schema valid",
    pass: candidateErrors.length === 0,
    errors: candidateErrors
  });
  errors.push.apply(errors, candidateErrors);

  checks.push({
    check: "AUTO_PUBLISH false",
    pass: batch.AUTO_PUBLISH === false && batch.auto_publish === false
  });
  if (batch.AUTO_PUBLISH !== false || batch.auto_publish !== false) {
    errors.push("candidate batch AUTO_PUBLISH must be false");
  }

  const case1Evaluation = evaluateXDiscoveryText("無料シャワー");
  const case1Candidate = buildCandidateFromPost({
    source_type: "X",
    source_url: "https://x.com/example/status/shower",
    account: "kumamoto_support",
    text: "熊本市で無料シャワー提供",
    published_at: "2026-07-31",
    municipality: "熊本市"
  });
  checks.push({
    case: "Case1",
    check: "無料シャワー discoverable",
    pass:
      case1Evaluation.discoverable === true &&
      case1Candidate.status === "NEW" &&
      case1Candidate.subcategory === "BATH" &&
      case1Candidate.subcategory_detail === "SHOWER"
  });
  if (!case1Evaluation.discoverable) {
    errors.push("Case1 failed: 無料シャワー must be discoverable");
  }

  const case2Evaluation = evaluateXDiscoveryText("車中泊できます");
  const case2Candidate = batch.candidates.find(function (entry) {
    return /車中泊/.test(entry.text || "");
  });
  checks.push({
    case: "Case2",
    check: "車中泊できます",
    pass:
      case2Evaluation.discoverable === true &&
      case2Candidate &&
      case2Candidate.status === "NEW" &&
      case2Candidate.subcategory === "VEHICLE"
  });
  if (!case2Evaluation.discoverable || !case2Candidate) {
    errors.push("Case2 failed: 車中泊できます must become in-area candidate");
  }

  const case3Evaluation = evaluateXDiscoveryText("井戸水あります");
  const case3Candidate = batch.candidates.find(function (entry) {
    return /井戸水/.test(entry.text || "");
  });
  checks.push({
    case: "Case3",
    check: "井戸水あります",
    pass:
      case3Evaluation.discoverable === true &&
      case3Candidate &&
      case3Candidate.status === "NEW" &&
      Array.isArray(case3Candidate.detected_keywords) &&
      case3Candidate.detected_keywords.length > 0
  });
  if (!case3Evaluation.discoverable || !case3Candidate) {
    errors.push("Case3 failed: 井戸水あります must become in-area candidate");
  }

  const case4Texts = ["温泉営業しています", "通常営業温泉"];
  const case4Pass = case4Texts.every(function (text) {
    return (
      !isDiscoverableSupportServicePost({ text: text }) &&
      isExcludedDiscoveryText(text)
    );
  });
  checks.push({
    case: "Case4",
    check: "通常営業温泉 excluded",
    pass: case4Pass && batch.excluded_count >= 2
  });
  if (!case4Pass) {
    errors.push("Case4 failed: normal business onsen posts must be excluded");
  }
  if (!isDiscoverableSupportServicePost({ text: "温泉" })) {
    checks.push({ case: "Case4b", check: "単語温泉 excluded", pass: true });
  } else {
    checks.push({ case: "Case4b", check: "単語温泉 excluded", pass: false });
    errors.push("Case4 failed: standalone 温泉 must not become candidate");
  }

  const case5Candidate = batch.candidates.find(function (entry) {
    return /大阪/.test(entry.text || "");
  });
  checks.push({
    case: "Case5",
    check: "地域外投稿 OUT_OF_AREA",
    pass: case5Candidate && case5Candidate.status === "OUT_OF_AREA"
  });
  if (!case5Candidate || case5Candidate.status !== "OUT_OF_AREA") {
    errors.push("Case5 failed: out-of-area post must be OUT_OF_AREA");
  }

  const showerFixtureCandidate = batch.candidates.find(function (entry) {
    return /無料シャワー/.test(entry.text || "");
  });
  if (showerFixtureCandidate) {
    const requiredFields = [
      "source_type",
      "account",
      "post_url",
      "text",
      "detected_keywords",
      "subcategory",
      "municipality",
      "published_at",
      "checked_at"
    ];
    requiredFields.forEach(function (field) {
      const value = showerFixtureCandidate[field];
      const pass =
        field === "detected_keywords"
          ? Array.isArray(value) && value.length > 0
          : value !== undefined && value !== null && value !== "";
      checks.push({
        check: "candidate field preserved: " + field,
        pass: pass
      });
      if (!pass) {
        errors.push("candidate missing required field: " + field);
      }
    });
    if (showerFixtureCandidate.source_type !== "X") {
      errors.push("candidate source_type must be X");
    }
    if (showerFixtureCandidate.post_url !== showerFixtureCandidate.source_url) {
      errors.push("candidate post_url must mirror source_url for X posts");
    }
  } else {
    errors.push("fixture shower candidate missing");
  }

  const unknownMunicipalityCandidate = buildCandidateFromPost({
    source_type: "X",
    source_url: "https://x.com/example/status/unknown-region",
    account: "unknown_user",
    text: "被災者向け無料入浴を提供します",
    published_at: "2026-07-31"
  });
  checks.push({
    check: "unknown municipality defaults to UNKNOWN",
    pass: unknownMunicipalityCandidate.municipality === "UNKNOWN"
  });
  if (unknownMunicipalityCandidate.municipality !== "UNKNOWN") {
    errors.push("municipality must be UNKNOWN when region cannot be extracted");
  }

  const reviewQueue = buildSupportServiceReviewQueue(batch);
  const reviewErrors = validateSupportServiceReviewQueue(reviewQueue);
  checks.push({
    check: "review queue schema valid",
    pass: reviewErrors.length === 0,
    errors: reviewErrors
  });
  errors.push.apply(errors, reviewErrors);

  const reviewItem = reviewQueue.items.find(function (item) {
    return /無料シャワー/.test(item.text || "");
  });
  checks.push({
    check: "review queue NEW status only for in-area",
    pass:
      reviewQueue.AUTO_PUBLISH === false &&
      reviewQueue.item_count === batch.in_area_count &&
      reviewItem &&
      reviewItem.status === "NEW" &&
      Array.isArray(reviewItem.source_trace.detected_keywords)
  });
  if (!reviewItem || reviewItem.status !== "NEW") {
    errors.push("review queue must receive in-area candidates as NEW");
  }

  if (isDiscoverableSupportServicePost({ text: "温泉無料開放しています" })) {
    checks.push({ check: "disaster support onsen included", pass: true });
  } else {
    checks.push({ check: "disaster support onsen included", pass: false });
    errors.push("温泉無料開放しています must remain discoverable");
  }

  const feedDiscoveryBatch = discoverXFeedSupportServiceCandidates({
    feedPath: FIXTURE_PATH,
    referenceDate: fixture.referenceDate,
    persistSourceRegistry: false
  });
  checks.push({
    check: "x feed discovery adapter",
    pass: feedDiscoveryBatch.candidate_count >= 3
  });
  if (feedDiscoveryBatch.candidate_count < 3) {
    errors.push("x feed discovery adapter failed");
  }

  const indexPayload = buildDisasterSearchIndex();
  const categories = {};
  indexPayload.index.forEach(function (entry) {
    categories[entry.category] = (categories[entry.category] || 0) + 1;
  });
  const waterSearchIndex = JSON.parse(
    fs.readFileSync(path.join(ROOT, "data", "public", "water_search_index.json"), "utf8")
  );

  const xSupportServiceCount = indexPayload.index.filter(function (entry) {
    return (
      entry.category === "SUPPORT_SERVICE" &&
      entry.source_url &&
      /x\.com/i.test(entry.source_url)
    );
  }).length;

  const case6Pass =
    categories.WATER === waterSearchIndex.item_count &&
    categories.VOLUNTEER === 20 &&
    categories.SUPPORT_SERVICE >= 6 &&
    xSupportServiceCount >= 1;
  checks.push({
    case: "Case6",
    check: "existing WATER/VOLUNTEER/SUPPORT_SERVICE layers unchanged",
    pass: case6Pass,
    categories: categories
  });
  if (!case6Pass) {
    errors.push("Case6 failed: existing index layers changed");
  }

  PUBLIC_WATER_FILES.forEach(function (file) {
    const fullPath = path.join(ROOT, file);
    if (!fs.existsSync(fullPath) || !publicHashesBefore[file]) {
      return;
    }
    const after = hashFile(fullPath);
    const pass = after === publicHashesBefore[file];
    checks.push({ case: "Case6", check: "water file unchanged: " + file, pass: pass });
    if (!pass) {
      errors.push("Case6 failed: water file changed during validation: " + file);
    }
  });

  const output = {
    SUPPORT_SERVICE_X_DISCOVERY_VALIDATION: errors.length === 0 ? "PASS" : "FAIL",
    AUTO_PUBLISH: false,
    keywordStructure: {
      support_state_keywords: SUPPORT_STATE_KEYWORDS.length,
      topic_groups: Object.keys(TOPIC_KEYWORD_GROUPS)
    },
    fixtureSummary: {
      candidateCount: batch.candidate_count,
      inAreaCount: batch.in_area_count,
      outOfAreaCount: batch.out_of_area_count,
      excludedCount: batch.excluded_count
    },
    reviewItemCount: reviewQueue.item_count,
    checks: checks,
    errors: errors
  };

  console.log("=== SUPPORT_SERVICE X Discovery Validation (Phase27) ===");
  console.log(JSON.stringify(output, null, 2));

  if (errors.length) {
    process.exit(1);
  }
}

main();

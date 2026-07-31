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
  isDiscoverableSupportServicePost,
  isExcludedDiscoveryText,
  loadXFeedDiscoveryPosts,
  normalizeXFeedPost
} = require(path.join(ROOT, "monitor", "support-service-source-discovery"));

const {
  buildDisasterSearchIndex,
  searchDisasterIndex
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

function main() {
  const errors = [];
  const checks = [];

  [
    "monitor/support-service-discovery-engine.js",
    "monitor/support-service-source-discovery.js",
    "monitor/support-service-review-queue.js",
    "scripts/discover-support-service.js",
    "scripts/build-support-service-review-queue.js",
    "data/candidates/support_service_candidates.json",
    "data/review/support_service/support_service_review_queue.json",
    "data/support_service_discovery/source_registry.json",
    "data/support_service_discovery/source_tier_registry.json",
    "data/support_service_discovery/support_information_candidates.json",
    "monitor/fixtures/support-service-discovery/posts-fixture.json",
    "monitor/fixtures/support-service-discovery/x-feed-fixture.json"
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

  const fixturePath = path.join(
    ROOT,
    "monitor",
    "fixtures",
    "support-service-discovery",
    "posts-fixture.json"
  );
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
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

  checks.push({
    check: "fixture excluded commercial post",
    pass: batch.excluded_count === 1,
    excludedCount: batch.excluded_count
  });
  if (batch.excluded_count !== 1) {
    errors.push("fixture 4 failed: expected excluded_count 1 for 通常営業 温泉割引");
  }
  if (isDiscoverableSupportServicePost({ text: "通常営業 温泉割引" })) {
    errors.push("fixture 4 failed: commercial discount post must be excluded");
  }
  if (!isExcludedDiscoveryText("通常営業 温泉割引")) {
    errors.push("fixture 4 failed: exclusion pattern not detected");
  }

  checks.push({
    check: "fixture candidate count",
    pass: batch.candidate_count === 3,
    candidateCount: batch.candidate_count
  });
  if (batch.candidate_count !== 3) {
    errors.push("expected 3 candidates from fixture (excluding commercial post)");
  }

  const bathCandidate = batch.candidates.find(function (entry) {
    return /○○温泉/.test(entry.text);
  });
  checks.push({
    check: "fixture bath free open",
    pass:
      bathCandidate &&
      bathCandidate.status === "NEW" &&
      bathCandidate.subcategory === "BATH" &&
      bathCandidate.opening_type === OPENING_TYPE.FREE_OPEN
  });
  if (!bathCandidate || bathCandidate.subcategory !== "BATH") {
    errors.push("fixture 1 failed: expected SUPPORT_SERVICE/BATH/FREE_OPEN");
  }
  if (bathCandidate && bathCandidate.opening_type !== OPENING_TYPE.FREE_OPEN) {
    errors.push("fixture 1 failed: expected opening_type FREE_OPEN");
  }
  if (bathCandidate && bathCandidate.web_complement_status !== "RESOLVED") {
    errors.push("fixture 1 failed: expected facility web complement RESOLVED");
  }
  if (bathCandidate && !/熊本県熊本市/.test(bathCandidate.address || "")) {
    errors.push("fixture 1 failed: expected facility address from registry");
  }

  const xFeedFixturePath = path.join(
    ROOT,
    "monitor",
    "fixtures",
    "support-service-discovery",
    "x-feed-fixture.json"
  );
  const xFeedPosts = loadXFeedDiscoveryPosts({ feedPath: xFeedFixturePath });
  checks.push({
    check: "x-feed discovery adapter",
    pass: xFeedPosts.length >= 2,
    xFeedPostCount: xFeedPosts.length
  });
  if (xFeedPosts.length < 2) {
    errors.push("x-feed fixture discovery failed");
  }
  const normalizedX = normalizeXFeedPost({
    account_handle: "kumamotocity_",
    account_name: "熊本市公式X",
    text: "熊本市内の○○温泉を被災者向けに無料開放します。",
    url: "https://x.com/kumamotocity_/status/1",
    post_time: "2026-07-31T08:00:00.000Z",
    source_type: "LOCAL_GOVERNMENT",
    municipality: "熊本市"
  });
  checks.push({
    check: "x-feed post normalization",
    pass: normalizedX && normalizedX.source_type === "X" && normalizedX.account === "kumamotocity_"
  });
  if (!normalizedX || normalizedX.source_type !== "X") {
    errors.push("x-feed post normalization failed");
  }

  const carCampCandidate = batch.candidates.find(function (entry) {
    return /車中泊/.test(entry.text);
  });
  checks.push({
    check: "fixture vehicle car camp",
    pass:
      carCampCandidate &&
      carCampCandidate.status === "NEW" &&
      carCampCandidate.subcategory === "VEHICLE" &&
      carCampCandidate.subcategory_detail === "CAR_CAMP"
  });
  if (!carCampCandidate || carCampCandidate.subcategory !== "VEHICLE") {
    errors.push("fixture 2 failed: expected VEHICLE/CAR_CAMP");
  }
  if (carCampCandidate && carCampCandidate.subcategory_detail !== "CAR_CAMP") {
    errors.push("fixture 2 failed: expected subcategory_detail CAR_CAMP");
  }

  const outOfAreaCandidate = batch.candidates.find(function (entry) {
    return /大阪/.test(entry.text);
  });
  checks.push({
    check: "fixture out of area preserved",
    pass: outOfAreaCandidate && outOfAreaCandidate.status === "OUT_OF_AREA"
  });
  if (!outOfAreaCandidate || outOfAreaCandidate.status !== "OUT_OF_AREA") {
    errors.push("fixture 3 failed: expected OUT_OF_AREA preserved");
  }

  const showerSearch = buildCandidateFromPost({
    source_type: "X",
    text: "熊本市でシャワー無料開放",
    account: "kumamoto_support",
    published_at: "2026-07-31"
  });
  checks.push({
    check: "keyword shower detection",
    pass: showerSearch.subcategory === "BATH" && showerSearch.subcategory_detail === "SHOWER"
  });
  if (showerSearch.subcategory_detail !== "SHOWER") {
    errors.push("keyword detection failed: シャワー");
  }

  const reviewQueue = buildSupportServiceReviewQueue(batch);
  const reviewErrors = validateSupportServiceReviewQueue(reviewQueue);
  checks.push({
    check: "review queue schema valid",
    pass: reviewErrors.length === 0,
    errors: reviewErrors
  });
  errors.push.apply(errors, reviewErrors);

  checks.push({
    check: "review queue AUTO_PUBLISH false",
    pass: reviewQueue.AUTO_PUBLISH === false && reviewQueue.auto_publish === false
  });
  if (reviewQueue.AUTO_PUBLISH !== false || reviewQueue.auto_publish !== false) {
    errors.push("review queue AUTO_PUBLISH must be false");
  }

  checks.push({
    check: "review queue in-area items only",
    pass: reviewQueue.item_count === batch.in_area_count,
    reviewCount: reviewQueue.item_count,
    inAreaCount: batch.in_area_count
  });
  if (reviewQueue.item_count !== batch.in_area_count) {
    errors.push("review queue should include in-area candidates only");
  }

  reviewQueue.items.forEach(function (item, index) {
    if (item.auto_publish !== false) {
      errors.push("review item[" + index + "]: auto_publish must be false");
    }
    ["source", "content", "region", "period", "location", "conditions"].forEach(function (field) {
      if (!item.review_checklist || typeof item.review_checklist[field] !== "boolean") {
        errors.push("review item[" + index + "]: review_checklist." + field + " missing");
      }
    });
  });

  const indexPayload = buildDisasterSearchIndex();
  const categories = {};
  indexPayload.index.forEach(function (entry) {
    categories[entry.category] = (categories[entry.category] || 0) + 1;
  });

  const waterSearchIndex = JSON.parse(
    fs.readFileSync(path.join(ROOT, "data", "public", "water_search_index.json"), "utf8")
  );

  checks.push({
    check: "WATER index count preserved",
    pass: categories.WATER === waterSearchIndex.item_count,
    waterCount: categories.WATER,
    expectedWaterCount: waterSearchIndex.item_count
  });
  checks.push({
    check: "VOLUNTEER index count preserved",
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
    check: "SUPPORT_SERVICE registry count preserved",
    pass: categories.SUPPORT_SERVICE >= 6 && xSupportServiceCount >= 1,
    supportServiceCount: categories.SUPPORT_SERVICE,
    xSupportServiceCount: xSupportServiceCount
  });

  if (categories.WATER !== waterSearchIndex.item_count) {
    errors.push("WATER count changed");
  }
  if (categories.VOLUNTEER !== 20) {
    errors.push("VOLUNTEER count changed");
  }
  if (categories.SUPPORT_SERVICE < 6 || xSupportServiceCount < 1) {
    errors.push("SUPPORT_SERVICE registry count changed");
  }

  const supportShowerResults = searchDisasterIndex(indexPayload, "シャワー", {
    category: "SUPPORT_SERVICE"
  });
  checks.push({
    check: "existing SUPPORT_SERVICE search preserved",
    pass: supportShowerResults.length > 0,
    showerCount: supportShowerResults.length
  });
  if (!supportShowerResults.length) {
    errors.push("existing SUPPORT_SERVICE search failed");
  }

  PUBLIC_WATER_FILES.forEach(function (file) {
    const fullPath = path.join(ROOT, file);
    if (!fs.existsSync(fullPath) || !publicHashesBefore[file]) {
      return;
    }
    const after = hashFile(fullPath);
    const pass = after === publicHashesBefore[file];
    checks.push({ check: "water file unchanged: " + file, pass: pass });
    if (!pass) {
      errors.push("water file changed during validation: " + file);
    }
  });

  const output = {
    SUPPORT_SERVICE_PATROL_VALIDATION: errors.length === 0 ? "PASS" : "FAIL",
    AUTO_PUBLISH: false,
    candidateCount: batch.candidate_count,
    inAreaCount: batch.in_area_count,
    outOfAreaCount: batch.out_of_area_count,
    reviewItemCount: reviewQueue.item_count,
    indexCategories: categories,
    checks: checks,
    errors: errors
  };

  console.log("=== SUPPORT_SERVICE Patrol Validation ===");
  console.log(JSON.stringify(output, null, 2));

  if (errors.length) {
    process.exit(1);
  }

  console.log("SUPPORT_SERVICE_PATROL_VALIDATION_COMPLETE");
}

main();

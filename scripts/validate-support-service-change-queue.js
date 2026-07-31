#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");

const {
  compareSupportInformationChanges,
  detectChangeType
} = require(path.join(ROOT, "monitor", "support-service-diff-engine"));

const {
  buildSupportServiceChangeQueue,
  buildSupportServiceChangeReviewQueue,
  validateSupportServiceChangeQueue,
  validateSupportServiceChangeReviewQueue
} = require(path.join(ROOT, "monitor", "support-service-change-queue"));

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

function baseInformation(overrides) {
  return Object.assign(
    {
      information_id: "SSINF-TEST0001",
      source_id: "SSRC-TEST0001",
      category: "SUPPORT_SERVICE",
      subcategory: "BATH",
      subcategory_detail: "SHOWER",
      title: "無料シャワー",
      facility_name: "熊本市総合体育館",
      address: "熊本県熊本市中央区",
      municipality: "熊本市",
      opening_type: "FREE_OPEN",
      published_at: "2026-07-28",
      available_from: "2026-07-28",
      available_until: "UNKNOWN",
      checked_at: "2026-07-31T03:00:00.000Z",
      status: "ACTIVE"
    },
    overrides || {}
  );
}

function main() {
  const errors = [];
  const checks = [];

  [
    "monitor/support-service-diff-engine.js",
    "monitor/support-service-change-queue.js",
    "data/support_service_discovery/support_service_change_queue.json",
    "data/review/support_service/support_service_change_review_queue.json",
    "scripts/build-support-service-change-queue.js"
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

  const case1 = compareSupportInformationChanges([], [baseInformation({ information_id: "SSINF-NEW0001" })]);
  checks.push({
    check: "case1 new information",
    pass:
      case1.changes.length === 1 &&
      case1.changes[0].change_type === "NEW" &&
      case1.changes[0].status === "NEW_CHANGE"
  });
  if (case1.changes[0] && case1.changes[0].change_type !== "NEW") {
    errors.push("case1 failed: expected change_type NEW");
  }

  const beforeUpdated = baseInformation({
    information_id: "SSINF-UPD0001",
    available_until: "UNKNOWN"
  });
  const afterUpdated = baseInformation({
    information_id: "SSINF-UPD0001",
    available_until: "2026-08-02"
  });
  const case2 = compareSupportInformationChanges([beforeUpdated], [afterUpdated]);
  checks.push({
    check: "case2 period update",
    pass:
      case2.changes.length === 1 &&
      case2.changes[0].change_type === "UPDATED" &&
      case2.changes[0].changed_fields.indexOf("available_until") !== -1
  });
  if (case2.changes[0] && case2.changes[0].change_type !== "UPDATED") {
    errors.push("case2 failed: expected change_type UPDATED");
  }

  const beforeEnded = baseInformation({
    information_id: "SSINF-END0001",
    status: "ACTIVE"
  });
  const afterEnded = baseInformation({
    information_id: "SSINF-END0001",
    status: "EXPIRED",
    available_until: "2026-07-30"
  });
  const case3 = compareSupportInformationChanges([beforeEnded], [afterEnded]);
  checks.push({
    check: "case3 ended information",
    pass:
      case3.changes.length === 1 &&
      case3.changes[0].change_type === "ENDED" &&
      case3.changes[0].after.status === "EXPIRED"
  });
  if (case3.changes[0] && case3.changes[0].change_type !== "ENDED") {
    errors.push("case3 failed: expected change_type ENDED");
  }
  if (case3.changes[0] && case3.changes[0].after.status !== "EXPIRED") {
    errors.push("case3 failed: expired information must be retained as EXPIRED");
  }

  const unchanged = baseInformation({ information_id: "SSINF-UNC0001" });
  const case4 = compareSupportInformationChanges([unchanged], [Object.assign({}, unchanged)]);
  checks.push({
    check: "case4 unchanged information",
    pass: case4.changes.length === 1 && case4.changes[0].change_type === "UNCHANGED"
  });
  if (case4.changes[0] && case4.changes[0].change_type !== "UNCHANGED") {
    errors.push("case4 failed: expected change_type UNCHANGED");
  }

  const endedType = detectChangeType(
    baseInformation({ status: "ACTIVE" }),
    baseInformation({ status: "EXPIRED" })
  );
  checks.push({ check: "detectChangeType ended", pass: endedType === "ENDED" });
  if (endedType !== "ENDED") {
    errors.push("detectChangeType failed for ENDED");
  }

  const changeQueue = buildSupportServiceChangeQueue(
    [beforeUpdated, beforeEnded],
    [afterUpdated, afterEnded, baseInformation({ information_id: "SSINF-NEW0002" })]
  );
  const changeQueueErrors = validateSupportServiceChangeQueue(changeQueue);
  checks.push({
    check: "change queue schema valid",
    pass: changeQueueErrors.length === 0,
    errors: changeQueueErrors
  });
  errors.push.apply(errors, changeQueueErrors);

  checks.push({
    check: "change queue AUTO_PUBLISH false",
    pass: changeQueue.AUTO_PUBLISH === false && changeQueue.auto_publish === false
  });
  if (changeQueue.AUTO_PUBLISH !== false || changeQueue.auto_publish !== false) {
    errors.push("change queue AUTO_PUBLISH must be false");
  }

  const changeReviewQueue = buildSupportServiceChangeReviewQueue(changeQueue);
  const changeReviewErrors = validateSupportServiceChangeReviewQueue(changeReviewQueue);
  checks.push({
    check: "change review queue schema valid",
    pass: changeReviewErrors.length === 0,
    errors: changeReviewErrors
  });
  errors.push.apply(errors, changeReviewErrors);

  checks.push({
    check: "change review queue excludes UNCHANGED",
    pass:
      changeReviewQueue.items.every(function (item) {
        return item.change_type !== "UNCHANGED";
      }) && changeReviewQueue.item_count >= 2
  });
  if (changeReviewQueue.item_count < 2) {
    errors.push("change review queue should include reviewable changes only");
  }

  changeReviewQueue.items.forEach(function (item, index) {
    if (item.auto_publish !== false) {
      errors.push("change review item[" + index + "]: auto_publish must be false");
    }
    if (item.status !== "NEW") {
      errors.push("change review item[" + index + "]: initial status must be NEW");
    }
  });

  const seedChangeQueuePath = path.join(
    ROOT,
    "data",
    "support_service_discovery",
    "support_service_change_queue.json"
  );
  if (fs.existsSync(seedChangeQueuePath)) {
    const seedQueue = JSON.parse(fs.readFileSync(seedChangeQueuePath, "utf8"));
    const seedErrors = validateSupportServiceChangeQueue(seedQueue);
    checks.push({
      check: "seed change queue valid",
      pass: seedErrors.length === 0,
      errors: seedErrors
    });
    errors.push.apply(errors, seedErrors);
  }

  const indexPayload = buildDisasterSearchIndex();
  const categories = {};
  indexPayload.index.forEach(function (entry) {
    categories[entry.category] = (categories[entry.category] || 0) + 1;
  });

  const waterSearchIndex = JSON.parse(
    fs.readFileSync(path.join(ROOT, "data", "public", "water_search_index.json"), "utf8")
  );

  checks.push({
    check: "case5 WATER index count preserved",
    pass: categories.WATER === waterSearchIndex.item_count,
    waterCount: categories.WATER,
    expectedWaterCount: waterSearchIndex.item_count
  });
  checks.push({
    check: "case5 VOLUNTEER index count preserved",
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
    check: "case5 SUPPORT_SERVICE search preserved",
    pass: categories.SUPPORT_SERVICE >= 6 && xSupportServiceCount >= 1,
    supportServiceCount: categories.SUPPORT_SERVICE,
    xSupportServiceCount: xSupportServiceCount
  });

  if (categories.WATER !== waterSearchIndex.item_count) {
    errors.push("case5 failed: WATER count changed");
  }
  if (categories.VOLUNTEER !== 20) {
    errors.push("case5 failed: VOLUNTEER count changed");
  }
  if (categories.SUPPORT_SERVICE < 6 || xSupportServiceCount < 1) {
    errors.push("case5 failed: SUPPORT_SERVICE count changed");
  }

  const supportShowerResults = searchDisasterIndex(indexPayload, "シャワー", {
    category: "SUPPORT_SERVICE"
  });
  checks.push({
    check: "case5 SUPPORT_SERVICE shower search preserved",
    pass: supportShowerResults.length > 0,
    showerCount: supportShowerResults.length
  });
  if (!supportShowerResults.length) {
    errors.push("case5 failed: SUPPORT_SERVICE shower search broken");
  }

  PUBLIC_WATER_FILES.forEach(function (file) {
    const fullPath = path.join(ROOT, file);
    if (!fs.existsSync(fullPath) || !publicHashesBefore[file]) {
      return;
    }
    const after = hashFile(fullPath);
    const pass = after === publicHashesBefore[file];
    checks.push({ check: "case5 water file unchanged: " + file, pass: pass });
    if (!pass) {
      errors.push("case5 failed: water file changed during validation: " + file);
    }
  });

  const output = {
    SUPPORT_SERVICE_CHANGE_QUEUE_VALIDATION: errors.length === 0 ? "PASS" : "FAIL",
    AUTO_PUBLISH: false,
    changeTypeSummary: changeQueue.change_type_summary,
    reviewItemCount: changeReviewQueue.item_count,
    indexCategories: categories,
    checks: checks,
    errors: errors
  };

  console.log("=== SUPPORT_SERVICE Change Queue Validation ===");
  console.log(JSON.stringify(output, null, 2));

  if (errors.length) {
    process.exit(1);
  }

  console.log("PHASE11_SUPPORT_SERVICE_CHANGE_QUEUE_COMPLETE");
}

main();

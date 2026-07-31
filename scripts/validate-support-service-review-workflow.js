#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");

const {
  buildSupportServiceChangeQueue
} = require(path.join(ROOT, "monitor", "support-service-change-queue"));

const {
  syncChangeReviewWorkflow,
  buildChangeReviewDisplayData,
  transitionReviewStatus,
  isApplyReadyReviewItem,
  validateChangeReviewQueue,
  validateReviewLog,
  validateAlertQueue,
  buildReviewLogEntry
} = require(path.join(ROOT, "monitor", "support-service-change-review"));

const {
  compareSupportInformationChanges
} = require(path.join(ROOT, "monitor", "support-service-diff-engine"));

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

function baseInformation(overrides) {
  return Object.assign(
    {
      information_id: "SSINF-RVWF0001",
      source_id: "SSRC-7E2F4A91B0",
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
    "monitor/support-service-change-review.js",
    "data/review/support_service/support_service_change_review_queue.json",
    "data/review/support_service/support_service_review_log.json",
    "data/review/support_service/support_service_alert_queue.json"
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

  const indexBefore = buildDisasterSearchIndex();
  const categoriesBefore = {};
  indexBefore.index.forEach(function (entry) {
    categoriesBefore[entry.category] = (categoriesBefore[entry.category] || 0) + 1;
  });

  const newInformation = baseInformation({ information_id: "SSINF-RVNEW001" });
  const changeQueue = buildSupportServiceChangeQueue([], [newInformation]);
  const workflow = syncChangeReviewWorkflow(changeQueue, {
    discoveredInformations: [newInformation],
    currentInformations: []
  });

  checks.push({
    check: "case1 NEW change creates review queue",
    pass: workflow.reviewQueue.item_count === 1 && workflow.reviewQueue.items[0].status === "NEW",
    itemCount: workflow.reviewQueue.item_count,
    status: workflow.reviewQueue.items[0] && workflow.reviewQueue.items[0].status
  });
  if (workflow.reviewQueue.item_count !== 1) {
    errors.push("case1 failed: expected one review queue item for NEW change");
  }

  const reviewQueueErrors = validateChangeReviewQueue(workflow.reviewQueue);
  checks.push({
    check: "review queue schema valid",
    pass: reviewQueueErrors.length === 0,
    errors: reviewQueueErrors
  });
  errors.push.apply(errors, reviewQueueErrors);

  const alertQueueErrors = validateAlertQueue(workflow.alertQueue);
  checks.push({
    check: "alert queue schema valid",
    pass: alertQueueErrors.length === 0,
    errors: alertQueueErrors
  });
  errors.push.apply(errors, alertQueueErrors);

  const beforeUpdated = baseInformation({
    information_id: "SSINF-RVUPD001",
    available_until: "UNKNOWN"
  });
  const afterUpdated = baseInformation({
    information_id: "SSINF-RVUPD001",
    available_until: "2026-08-02"
  });
  const updatedQueue = buildSupportServiceChangeQueue([beforeUpdated], [afterUpdated]);
  const updatedWorkflow = syncChangeReviewWorkflow(updatedQueue, {
    discoveredInformations: [afterUpdated],
    currentInformations: [beforeUpdated]
  });
  const updatedItem = updatedWorkflow.reviewQueue.items[0];
  const updatedDisplay = buildChangeReviewDisplayData(updatedItem);
  checks.push({
    check: "case2 UPDATED keeps before/after",
    pass:
      updatedItem &&
      updatedItem.change_type === "UPDATED" &&
      updatedItem.before &&
      updatedItem.after &&
      updatedDisplay.before &&
      updatedDisplay.after
  });
  if (!updatedItem || updatedItem.change_type !== "UPDATED") {
    errors.push("case2 failed: expected UPDATED review item");
  }

  const beforeEnded = baseInformation({
    information_id: "SSINF-RVEND001",
    status: "ACTIVE"
  });
  const afterEnded = baseInformation({
    information_id: "SSINF-RVEND001",
    status: "EXPIRED",
    available_until: "2026-07-30"
  });
  const endedQueue = buildSupportServiceChangeQueue([beforeEnded], [afterEnded]);
  const endedWorkflow = syncChangeReviewWorkflow(endedQueue, {
    discoveredInformations: [afterEnded],
    currentInformations: [beforeEnded]
  });
  const endedDisplay = buildChangeReviewDisplayData(endedWorkflow.reviewQueue.items[0]);
  checks.push({
    check: "case3 ENDED shows EXPIRED diff",
    pass:
      endedWorkflow.reviewQueue.items[0] &&
      endedWorkflow.reviewQueue.items[0].change_type === "ENDED" &&
      endedDisplay.after.status === "EXPIRED"
  });
  if (endedDisplay.after.status !== "EXPIRED") {
    errors.push("case3 failed: expected EXPIRED in ENDED display after snapshot");
  }

  const unchangedEntry = baseInformation({ information_id: "SSINF-RVUNC001" });
  const unchangedDiff = compareSupportInformationChanges(
    [unchangedEntry],
    [Object.assign({}, unchangedEntry)]
  );
  const unchangedQueue = buildSupportServiceChangeQueue([unchangedEntry], [Object.assign({}, unchangedEntry)]);
  const unchangedWorkflow = syncChangeReviewWorkflow(unchangedQueue);
  checks.push({
    check: "case4 UNCHANGED excluded from review queue",
    pass:
      unchangedDiff.changes[0].change_type === "UNCHANGED" &&
      unchangedWorkflow.reviewQueue.item_count === 0,
    reviewItemCount: unchangedWorkflow.reviewQueue.item_count
  });
  if (unchangedWorkflow.reviewQueue.item_count !== 0) {
    errors.push("case4 failed: UNCHANGED must not enter review queue");
  }

  const reviewItem = workflow.reviewQueue.items[0];
  const reviewing = transitionReviewStatus(reviewItem, "START", {
    reviewer: "reviewer-a",
    timestamp: "2026-07-31T10:00:00.000Z"
  });
  const approved = transitionReviewStatus(reviewing.item, "APPROVE", {
    reviewer: "reviewer-a",
    timestamp: "2026-07-31T10:05:00.000Z"
  });
  checks.push({
    check: "case5 APPROVED becomes apply-ready",
    pass:
      reviewing.item.status === "REVIEWING" &&
      approved.item.status === "APPROVED" &&
      isApplyReadyReviewItem(approved.item),
    reviewingStatus: reviewing.item.status,
    approvedStatus: approved.item.status
  });
  if (!isApplyReadyReviewItem(approved.item)) {
    errors.push("case5 failed: APPROVED item must be apply-ready");
  }

  const logEntry = buildReviewLogEntry(approved.item.review_id, "APPROVE", {
    reviewer: "reviewer-a",
    timestamp: "2026-07-31T10:05:00.000Z"
  });
  const logErrors = validateReviewLog({
    version: "1.0",
    entries: [logEntry]
  });
  checks.push({
    check: "review log entry valid",
    pass: logErrors.length === 0,
    errors: logErrors
  });
  errors.push.apply(errors, logErrors);

  const reviewLogPath = path.join(
    ROOT,
    "data",
    "review",
    "support_service",
    "support_service_review_log.json"
  );
  if (fs.existsSync(reviewLogPath)) {
    const reviewLog = JSON.parse(fs.readFileSync(reviewLogPath, "utf8"));
    const committedLogErrors = validateReviewLog(reviewLog);
    checks.push({
      check: "committed review log schema valid",
      pass: committedLogErrors.length === 0,
      errors: committedLogErrors
    });
    errors.push.apply(errors, committedLogErrors);
  }

  checks.push({
    check: "AUTO_PUBLISH false in review workflow",
    pass:
      workflow.reviewQueue.AUTO_PUBLISH === false &&
      workflow.alertQueue.AUTO_PUBLISH === false
  });
  if (workflow.reviewQueue.AUTO_PUBLISH !== false) {
    errors.push("review queue AUTO_PUBLISH must be false");
  }

  const indexAfter = buildDisasterSearchIndex();
  const categoriesAfter = {};
  indexAfter.index.forEach(function (entry) {
    categoriesAfter[entry.category] = (categoriesAfter[entry.category] || 0) + 1;
  });

  checks.push({
    check: "case6 WATER index count unchanged",
    pass: categoriesBefore.WATER === categoriesAfter.WATER,
    waterBefore: categoriesBefore.WATER,
    waterAfter: categoriesAfter.WATER
  });
  checks.push({
    check: "case6 VOLUNTEER index count unchanged",
    pass: categoriesBefore.VOLUNTEER === categoriesAfter.VOLUNTEER,
    volunteerBefore: categoriesBefore.VOLUNTEER,
    volunteerAfter: categoriesAfter.VOLUNTEER
  });
  if (categoriesBefore.WATER !== categoriesAfter.WATER) {
    errors.push("case6 failed: WATER index count changed");
  }
  if (categoriesBefore.VOLUNTEER !== categoriesAfter.VOLUNTEER) {
    errors.push("case6 failed: VOLUNTEER index count changed");
  }

  PUBLIC_WATER_FILES.forEach(function (file) {
    const fullPath = path.join(ROOT, file);
    if (!fs.existsSync(fullPath) || !publicHashesBefore[file]) {
      return;
    }
    const after = hashFile(fullPath);
    const pass = after === publicHashesBefore[file];
    checks.push({ check: "case6 water file unchanged: " + file, pass: pass });
    if (!pass) {
      errors.push("case6 failed: water file changed during validation: " + file);
    }
  });

  const output = {
    SUPPORT_SERVICE_REVIEW_WORKFLOW_VALIDATION: errors.length === 0 ? "PASS" : "FAIL",
    AUTO_PUBLISH: false,
    reviewItemCount: workflow.reviewQueue.item_count,
    alertCount: workflow.alertQueue.alert_count,
    indexCategoriesBefore: categoriesBefore,
    indexCategoriesAfter: categoriesAfter,
    checks: checks,
    errors: errors
  };

  console.log("=== SUPPORT_SERVICE Review Workflow Validation (Phase22) ===");
  console.log(JSON.stringify(output, null, 2));

  if (errors.length) {
    process.exit(1);
  }

  console.log("PHASE22_SUPPORT_SERVICE_REVIEW_WORKFLOW_COMPLETE");
}

main();

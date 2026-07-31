#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

const {
  CATEGORY_TARGET_LAYERS,
  DISASTER_CATEGORIES,
  convertApprovedQueueItems,
  validatePublicCandidate,
  validatePublicCandidateBatch,
  buildPublicCandidateBatch,
  queueItemToPublicCandidate,
  isApprovedQueueItem
} = require("../monitor/review-approved-converter");

function buildSampleQueueItem(overrides) {
  return Object.assign(
    {
      queue_id: "RQ-20260730-TEST-SAMPLE-WATER-01",
      municipality: "宇土市",
      category: "WATER",
      title: "水道の復旧状況について",
      source_url: "https://www.city.uto.lg.jp/article/view/1014/16317.html",
      detected_keywords: ["断水", "復旧"],
      status: "APPROVED",
      created_at: "2026-07-30T00:00:00.000Z",
      review_required: true,
      source_id: "KM002-uto-water",
      original_url: "https://www.city.uto.lg.jp/article/view/1014/16317.html",
      before_hash: "before-hash",
      after_hash: "after-hash",
      changed_text: "水道の復旧状況について",
      detected_at: "2026-07-30T00:00:00.000Z",
      diff_type: "CONTENT_CHANGED",
      auto_publish: false,
      source_trace: {
        classification_id: "CLS-20260730-TEST-SAMPLE-WATER-01",
        classification_file: "data/update_candidates/classified-test.json",
        source_change_log: "monitor/change-log/2026-07-30.json",
        diff_type: "CONTENT_CHANGED"
      }
    },
    overrides
  );
}

function main() {
  const errors = [];
  const checks = [];

  const modulePath = path.join(ROOT, "monitor", "review-approved-converter.js");
  const scriptPath = path.join(ROOT, "scripts", "convert-approved-updates.js");
  checks.push({ check: "monitor/review-approved-converter.js exists", pass: fs.existsSync(modulePath) });
  checks.push({ check: "scripts/convert-approved-updates.js exists", pass: fs.existsSync(scriptPath) });

  if (!fs.existsSync(modulePath) || !fs.existsSync(scriptPath)) {
    errors.push("converter module or script missing");
  }

  DISASTER_CATEGORIES.forEach(function (category) {
    const pass = Boolean(CATEGORY_TARGET_LAYERS[category]);
    checks.push({ check: "category mapping: " + category, pass: pass });
    if (!pass) {
      errors.push("missing target_layer mapping for category: " + category);
    }
  });

  const approvedItem = buildSampleQueueItem({ status: "APPROVED" });
  const pendingItem = buildSampleQueueItem({
    queue_id: "RQ-20260730-TEST-SAMPLE-PENDING-01",
    status: "PENDING"
  });
  const rejectedItem = buildSampleQueueItem({
    queue_id: "RQ-20260730-TEST-SAMPLE-REJECTED-01",
    status: "REJECTED"
  });

  const converted = convertApprovedQueueItems([approvedItem, pendingItem, rejectedItem]);
  const approvedOnlyPass = converted.length === 1 && converted[0].update_id === "UPD-20260730-TEST-SAMPLE-WATER-01";
  checks.push({ check: "APPROVED only conversion", pass: approvedOnlyPass });
  if (!approvedOnlyPass) {
    errors.push("APPROVED-only conversion failed");
  }

  const pendingExcludedPass = converted.every(function (item) {
    return item.source_trace.queue_id !== pendingItem.queue_id;
  });
  checks.push({ check: "PENDING excluded", pass: pendingExcludedPass });
  if (!pendingExcludedPass) {
    errors.push("PENDING item was converted");
  }

  const rejectedExcludedPass = converted.every(function (item) {
    return item.source_trace.queue_id !== rejectedItem.queue_id;
  });
  checks.push({ check: "REJECTED excluded", pass: rejectedExcludedPass });
  if (!rejectedExcludedPass) {
    errors.push("REJECTED item was converted");
  }

  const candidate = queueItemToPublicCandidate(approvedItem);
  const mappingPass =
    candidate.target_layer === "water_search_index" &&
    candidate.status === "READY" &&
    candidate.auto_publish === false;
  checks.push({ check: "category to target_layer mapping", pass: mappingPass });
  if (!mappingPass) {
    errors.push("category to target_layer mapping failed");
  }

  const schemaErrors = validatePublicCandidate(candidate);
  checks.push({ check: "public candidate schema validation", pass: schemaErrors.length === 0, schemaErrors: schemaErrors });
  if (schemaErrors.length) {
    errors.push.apply(errors, schemaErrors);
  }

  const tracePass =
    candidate.source_trace.queue_id === approvedItem.queue_id &&
    candidate.source_trace.classification_id === approvedItem.source_trace.classification_id &&
    candidate.source_trace.change_log === approvedItem.source_trace.source_change_log &&
    candidate.source_trace.before_hash === approvedItem.before_hash &&
    candidate.source_trace.after_hash === approvedItem.after_hash &&
    candidate.source_trace.changed_text === approvedItem.changed_text;
  checks.push({ check: "source trace preserved", pass: tracePass });
  if (!tracePass) {
    errors.push("source trace not preserved");
  }

  const reviewQueuePath = path.join(ROOT, "data", "review_queue", "patrol_review_queue.json");
  if (fs.existsSync(reviewQueuePath)) {
    const reviewQueue = JSON.parse(fs.readFileSync(reviewQueuePath, "utf8"));
    const approvedFromQueue = (reviewQueue.items || []).filter(isApprovedQueueItem);
    const convertedFromQueue = convertApprovedQueueItems(reviewQueue.items || []);
    checks.push({
      check: "live review queue does not auto-convert pending items",
      pass: convertedFromQueue.length === approvedFromQueue.length
    });
    if (convertedFromQueue.length !== approvedFromQueue.length) {
      errors.push("live review queue conversion count mismatch");
    }
  }

  const batch = buildPublicCandidateBatch(converted);
  const batchErrors = validatePublicCandidateBatch(batch);
  checks.push({
    check: "converted batch schema validation",
    pass: batchErrors.length === 0,
    batchErrors: batchErrors
  });
  if (batchErrors.length) {
    errors.push.apply(errors, batchErrors);
  }

  const result = {
    REVIEW_APPROVED_CONVERTER_VALIDATION: errors.length === 0 ? "PASS" : "FAIL",
    checks: checks,
    errors: errors
  };

  console.log("=== Review Approved Converter Validation ===");
  console.log(JSON.stringify(result, null, 2));

  if (errors.length) {
    process.exit(1);
  }
}

main();

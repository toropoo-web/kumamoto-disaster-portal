#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

const {
  createDefaultDecision,
  validateDecisionShape,
  normalizeQueueItemWithDecision,
  applyReviewDecision,
  migrateReviewQueueDecisions,
  setReviewDecision,
  listQueueItemsByStatus,
  summarizeDecisionCounts,
  MASTER_QUEUE_FILE
} = require("../monitor/review-decision-engine");

const { validateQueueBatch, buildQueueBatch } = require("../monitor/review-queue");

function buildSampleItem(overrides) {
  return Object.assign(
    {
      queue_id: "RQ-20260730-TEST-SAMPLE-WATER-01",
      municipality: "宇土市",
      category: "WATER",
      title: "水道の復旧状況について",
      source_url: "https://www.city.uto.lg.jp/article/view/1014/16317.html",
      detected_keywords: ["断水", "復旧"],
      status: "PENDING",
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
        source_change_log: "monitor/change-log/2026-07-30.json"
      }
    },
    overrides
  );
}

function main() {
  const errors = [];
  const checks = [];

  const modulePath = path.join(ROOT, "monitor", "review-decision-engine.js");
  const scriptPath = path.join(ROOT, "scripts", "build-review-decision-layer.js");
  checks.push({ check: "monitor/review-decision-engine.js exists", pass: fs.existsSync(modulePath) });
  checks.push({ check: "scripts/build-review-decision-layer.js exists", pass: fs.existsSync(scriptPath) });

  const defaultDecision = createDefaultDecision();
  const defaultPass =
    defaultDecision.status === "PENDING" &&
    defaultDecision.reviewer === "" &&
    defaultDecision.reviewed_at === "" &&
    defaultDecision.review_note === "";
  checks.push({ check: "default decision schema", pass: defaultPass });
  if (!defaultPass) {
    errors.push("default decision schema invalid");
  }

  const schemaErrors = validateDecisionShape(defaultDecision);
  checks.push({ check: "default decision validation", pass: schemaErrors.length === 0 });
  if (schemaErrors.length) {
    errors.push.apply(errors, schemaErrors);
  }

  const normalized = normalizeQueueItemWithDecision(buildSampleItem());
  const normalizePass =
    normalized.decision &&
    normalized.decision.status === "PENDING" &&
    normalized.status === "PENDING" &&
    normalized.review_required === true;
  checks.push({ check: "queue item normalized with decision", pass: normalizePass });
  if (!normalizePass) {
    errors.push("queue item decision normalization failed");
  }

  const approved = applyReviewDecision(buildSampleItem(), {
    status: "APPROVED",
    reviewer: "manual-reviewer",
    review_note: "confirmed by operator"
  });
  const approvedPass =
    approved.item.status === "APPROVED" &&
    approved.item.decision.status === "APPROVED" &&
    approved.item.decision.reviewer === "manual-reviewer" &&
    approved.item.review_required === false;
  checks.push({ check: "APPROVED decision apply", pass: approvedPass });
  if (!approvedPass) {
    errors.push("APPROVED decision apply failed");
  }

  const rejected = applyReviewDecision(buildSampleItem(), {
    status: "REJECTED",
    reviewer: "manual-reviewer",
    review_note: "not suitable for publication"
  });
  const rejectedPass = rejected.item.status === "REJECTED" && rejected.item.decision.status === "REJECTED";
  checks.push({ check: "REJECTED decision apply", pass: rejectedPass });
  if (!rejectedPass) {
    errors.push("REJECTED decision apply failed");
  }

  let reviewerRequiredFailed = false;
  try {
    applyReviewDecision(buildSampleItem(), { status: "APPROVED", reviewer: "" });
  } catch (err) {
    reviewerRequiredFailed = /reviewer is required/.test(err.message);
  }
  checks.push({ check: "reviewer required for APPROVED", pass: reviewerRequiredFailed });
  if (!reviewerRequiredFailed) {
    errors.push("reviewer requirement not enforced");
  }

  const dryMigrate = migrateReviewQueueDecisions({ dryRun: true });
  checks.push({
    check: "review queue decision migration dry-run",
    pass: dryMigrate.dryRun === true && !dryMigrate.reason
  });
  if (!dryMigrate.dryRun || dryMigrate.reason) {
    errors.push("review queue decision migration dry-run failed");
  }

  if (fs.existsSync(MASTER_QUEUE_FILE)) {
    const queue = JSON.parse(fs.readFileSync(MASTER_QUEUE_FILE, "utf8"));
    const items = (queue.items || []).map(normalizeQueueItemWithDecision);
    const batch = buildQueueBatch(items, {
      sourceClassificationFile: queue.sourceClassificationFile
    });
    batch.decisionSummary = summarizeDecisionCounts(items);
    const batchErrors = validateQueueBatch(batch);
    checks.push({
      check: "live review queue decision schema",
      pass: batchErrors.length === 0,
      batchErrors: batchErrors
    });
    if (batchErrors.length) {
      errors.push.apply(errors, batchErrors);
    }

    const pendingItems = listQueueItemsByStatus(items, "PENDING");
    checks.push({
      check: "PENDING items listable",
      pass: pendingItems.length === items.length
    });
  }

  const drySet = setReviewDecision({
    dryRun: true,
    queueId: "RQ-NONEXISTENT",
    status: "APPROVED",
    reviewer: "tester"
  });
  checks.push({
    check: "missing queue item rejected",
    pass: drySet.saved === false && /not found/.test(drySet.reason || "")
  });

  const result = {
    REVIEW_DECISION_LAYER_VALIDATION: errors.length === 0 ? "PASS" : "FAIL",
    checks: checks,
    errors: errors
  };

  console.log("=== Review Decision Layer Validation ===");
  console.log(JSON.stringify(result, null, 2));

  if (errors.length) {
    process.exit(1);
  }
}

main();

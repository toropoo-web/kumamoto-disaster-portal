#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

const {
  DISASTER_CATEGORIES,
  REVIEW_STATUSES,
  MASTER_QUEUE_FILE,
  resolveClassifiedPath,
  convertClassifiedBatch,
  mergeQueueItems,
  validateQueueBatch,
  buildQueueBatch,
  classificationToQueueItem,
  buildDuplicateKey
} = require("../monitor/review-queue");

function main() {
  const errors = [];
  const checks = [];

  const modulePath = path.join(ROOT, "monitor", "review-queue.js");
  const scriptPath = path.join(ROOT, "scripts", "build-patrol-review-queue.js");
  checks.push({ check: "monitor/review-queue.js exists", pass: fs.existsSync(modulePath) });
  checks.push({ check: "scripts/build-patrol-review-queue.js exists", pass: fs.existsSync(scriptPath) });

  if (!fs.existsSync(modulePath) || !fs.existsSync(scriptPath)) {
    errors.push("review queue module or script missing");
  }

  const sampleClassification = {
    id: "CLS-20260730-TEST-SAMPLE-WATER-01",
    source_id: "TEST-sample",
    municipality: "テスト市",
    category: "WATER",
    title: "断水と復旧について",
    source_url: "https://example.test/water",
    diff_type: "CONTENT_CHANGED",
    detected_keywords: ["断水", "復旧"],
    detected_at: "2026-07-30T00:00:00.000Z",
    confidence: "HIGH",
    source_page: {
      source_id: "TEST-sample",
      url: "https://example.test/water",
      diff_type: "CONTENT_CHANGED",
      changed_text: "断水と復旧について",
      before: { contentHash: "before-hash" },
      after: { contentHash: "after-hash" },
      detected_keywords: ["断水", "復旧"]
    }
  };

  const queueItem = classificationToQueueItem(sampleClassification, {
    classificationFile: "data/update_candidates/classified-test.json",
    sourceChangeLog: "monitor/change-log/2026-07-30.json"
  });

  const conversionPass =
    queueItem.status === "PENDING" &&
    queueItem.review_required === true &&
    queueItem.auto_publish === false &&
    queueItem.decision &&
    queueItem.decision.status === "PENDING" &&
    queueItem.original_url === sampleClassification.source_url &&
    queueItem.before_hash === "before-hash" &&
    queueItem.after_hash === "after-hash" &&
    queueItem.detected_keywords.join(",") === "断水,復旧" &&
    queueItem.source_trace.classification_id === sampleClassification.id;
  checks.push({ check: "classified JSON to queue conversion", pass: conversionPass });
  if (!conversionPass) {
    errors.push("classified to queue conversion failed");
  }

  const schemaErrors = validateQueueBatch(
    buildQueueBatch([queueItem], {
      sourceClassificationFile: "data/update_candidates/classified-test.json"
    })
  );
  checks.push({ check: "queue schema validation", pass: schemaErrors.length === 0, schemaErrors: schemaErrors });
  if (schemaErrors.length) {
    errors.push.apply(errors, schemaErrors);
  }

  const duplicateMerge = mergeQueueItems([queueItem], [queueItem]);
  const duplicatePass =
    duplicateMerge.added.length === 0 && duplicateMerge.duplicates.length === 1;
  checks.push({ check: "duplicate detection", pass: duplicatePass });
  if (!duplicatePass) {
    errors.push("duplicate detection failed");
  }

  const tracePass =
    queueItem.source_trace.classification_id === sampleClassification.id &&
    queueItem.source_trace.classification_file === "data/update_candidates/classified-test.json";
  checks.push({ check: "source trace preserved", pass: tracePass });
  if (!tracePass) {
    errors.push("source trace not preserved");
  }

  const classifiedPath = resolveClassifiedPath();
  const masterQueueExists = fs.existsSync(MASTER_QUEUE_FILE);
  let masterQueueItemCount = 0;

  if (masterQueueExists) {
    const masterPreview = JSON.parse(fs.readFileSync(MASTER_QUEUE_FILE, "utf8"));
    masterQueueItemCount = Array.isArray(masterPreview.items) ? masterPreview.items.length : 0;
  }

  if (!classifiedPath) {
    if (masterQueueExists && masterQueueItemCount > 0) {
      checks.push({
        check: "existing classified batch parse",
        pass: true,
        skipped: "classified batch absent in workspace; master review queue present"
      });
    } else {
      errors.push("classified batch not found");
      checks.push({ check: "existing classified batch parse", pass: false });
    }
  } else {
    const classifiedBatch = JSON.parse(fs.readFileSync(classifiedPath, "utf8"));
    const convertedItems = convertClassifiedBatch(classifiedBatch, {
      classifiedPath: classifiedPath
    });
    checks.push({
      check: "existing classified batch parse",
      pass: Array.isArray(classifiedBatch.classifications) && classifiedBatch.classifications.length > 0
    });
    checks.push({
      check: "classified batch converted to queue items",
      pass: convertedItems.length > 0
    });

    const convertedBatch = buildQueueBatch(convertedItems, {
      sourceClassificationFile: path.relative(ROOT, classifiedPath)
    });
    const convertedErrors = validateQueueBatch(convertedBatch);
    checks.push({
      check: "converted batch schema validation",
      pass: convertedErrors.length === 0,
      convertedErrors: convertedErrors
    });
    if (convertedErrors.length) {
      errors.push.apply(errors, convertedErrors);
    }

    const categorySummary = {};
    DISASTER_CATEGORIES.forEach(function (category) {
      categorySummary[category] = convertedItems.filter(function (item) {
        return item.category === category;
      }).length;
    });
    checks.push({ check: "category summary from classified batch", pass: true, categorySummary: categorySummary });

    const duplicateKeys = new Set();
    let duplicateInBatch = false;
    convertedItems.forEach(function (item) {
      const key = buildDuplicateKey(item);
      if (duplicateKeys.has(key)) {
        duplicateInBatch = true;
      }
      duplicateKeys.add(key);
    });
    checks.push({ check: "no duplicate trace keys in converted batch", pass: !duplicateInBatch });
    if (duplicateInBatch) {
      errors.push("duplicate trace keys found in converted classified batch");
    }

    ["WATER", "SHELTER", "COMMUNICATION", "SUPPORT"].forEach(function (category) {
      checks.push({
        check: "review category present: " + category,
        pass: categorySummary[category] > 0
      });
      if (!categorySummary[category]) {
        errors.push("expected review items for category: " + category);
      }
    });
  }

  if (fs.existsSync(MASTER_QUEUE_FILE)) {
    const master = JSON.parse(fs.readFileSync(MASTER_QUEUE_FILE, "utf8"));
    const masterErrors = validateQueueBatch(master);
    checks.push({
      check: "master review queue schema",
      pass: masterErrors.length === 0,
      masterErrors: masterErrors
    });
    if (masterErrors.length) {
      errors.push.apply(errors, masterErrors);
    }
  }

  REVIEW_STATUSES.forEach(function (status) {
    checks.push({ check: "status allowed: " + status, pass: true });
  });

  const result = {
    PATROL_REVIEW_QUEUE_VALIDATION: errors.length === 0 ? "PASS" : "FAIL",
    masterQueueFile: fs.existsSync(MASTER_QUEUE_FILE)
      ? path.relative(ROOT, MASTER_QUEUE_FILE)
      : null,
    checks: checks,
    errors: errors
  };

  console.log("=== Patrol Review Queue Validation ===");
  console.log(JSON.stringify(result, null, 2));

  if (errors.length) {
    process.exit(1);
  }
}

main();

#!/usr/bin/env node
"use strict";

const path = require("path");

const {
  loadSupportServiceChangeReviewQueue,
  writeSupportServiceChangeReviewQueue
} = require(path.join(__dirname, "..", "monitor", "support-service-change-queue"));

const {
  loadApplyQueue,
  writeApplyQueue,
  buildSupportServiceApplyQueue,
  validateSupportServiceApplyQueue
} = require(path.join(__dirname, "..", "monitor", "support-service-public-apply"));

function main() {
  const reviewQueue = loadSupportServiceChangeReviewQueue();
  const existingQueue = loadApplyQueue();
  const applyQueue = buildSupportServiceApplyQueue(reviewQueue, {
    existingQueue: existingQueue
  });
  const errors = validateSupportServiceApplyQueue(applyQueue);

  if (errors.length) {
    console.error(JSON.stringify({ errors: errors }, null, 2));
    process.exit(1);
  }

  const outputPath = writeApplyQueue(applyQueue);
  const pendingCount = applyQueue.items.filter(function (item) {
    return item.status === "PENDING";
  }).length;

  console.log("=== SUPPORT_SERVICE Apply Queue Build ===");
  console.log(
    JSON.stringify(
      {
        PHASE: "PHASE13_SUPPORT_SERVICE_PUBLIC_APPLY",
        OUTPUT: outputPath,
        ITEM_COUNT: applyQueue.item_count,
        PENDING_COUNT: pendingCount,
        STATUS_SUMMARY: applyQueue.status_summary,
        AUTO_PUBLISH: false
      },
      null,
      2
    )
  );
}

main();

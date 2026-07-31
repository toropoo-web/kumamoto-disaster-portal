#!/usr/bin/env node
"use strict";

const path = require("path");
const { convertApprovedUpdates } = require("../monitor/review-approved-converter");

function parseArgs(argv) {
  const options = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--review-queue" && argv[i + 1]) {
      options.reviewQueuePath = path.resolve(argv[i + 1]);
      i += 1;
    }
  }
  return options;
}

function main() {
  const result = convertApprovedUpdates(parseArgs(process.argv));

  if (result.reason) {
    console.error(result.reason);
    process.exit(1);
  }

  console.log("=== Review Approved Public Candidate Conversion ===");
  console.log(
    JSON.stringify(
      {
        saved: result.saved === true,
        dryRun: result.dryRun === true,
        reviewQueuePath: result.reviewQueuePath,
        masterOutputPath: result.masterOutputPath || null,
        runOutputPath: result.runOutputPath || null,
        reviewQueueCount: result.reviewQueueCount,
        approvedCount: result.approvedCount,
        pendingCount: result.pendingCount,
        rejectedCount: result.rejectedCount,
        convertedCount: result.convertedCount,
        addedCount: result.addedCount,
        duplicateCount: result.duplicateCount,
        updateCount: result.updateCount,
        categorySummary: result.categorySummary,
        duplicates: result.duplicates || [],
        errors: result.errors || []
      },
      null,
      2
    )
  );

  if (result.errors && result.errors.length) {
    process.exit(1);
  }
}

main();

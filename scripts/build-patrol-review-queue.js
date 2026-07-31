#!/usr/bin/env node
"use strict";

const path = require("path");
const { buildPatrolReviewQueue } = require("../monitor/review-queue");

function parseArgs(argv) {
  const options = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--classified" && argv[i + 1]) {
      options.classifiedPath = path.resolve(argv[i + 1]);
      i += 1;
    }
  }
  return options;
}

function main() {
  const result = buildPatrolReviewQueue(parseArgs(process.argv));

  if (result.reason) {
    console.error(result.reason);
    process.exit(1);
  }

  console.log("=== Patrol Review Queue ===");
  console.log(
    JSON.stringify(
      {
        saved: result.saved === true,
        dryRun: result.dryRun === true,
        classifiedPath: result.classifiedPath,
        masterQueuePath: result.masterQueuePath || null,
        runQueuePath: result.runQueuePath || null,
        incomingCount: result.incomingCount,
        addedCount: result.addedCount,
        duplicateCount: result.duplicateCount,
        queueCount: result.queueCount,
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

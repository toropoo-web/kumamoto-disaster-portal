#!/usr/bin/env node
"use strict";

const path = require("path");
const { classifyPatrolDiffs } = require("../monitor/diff-classification");

function parseArgs(argv) {
  const options = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--change-log" && argv[i + 1]) {
      options.changeLogPath = path.resolve(argv[i + 1]);
      i += 1;
    }
  }
  return options;
}

function main() {
  const result = classifyPatrolDiffs(parseArgs(process.argv));

  if (result.reason) {
    console.error(result.reason);
    process.exit(1);
  }

  console.log("=== Patrol Diff Classification ===");
  console.log(
    JSON.stringify(
      {
        saved: result.saved === true,
        dryRun: result.dryRun === true,
        changeLogPath: result.changeLogPath,
        entryCount: result.entryCount,
        classificationCount: result.classificationCount,
        categorySummary: result.categorySummary,
        outputPath: result.outputPath || null,
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

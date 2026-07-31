#!/usr/bin/env node
"use strict";

const path = require("path");
const { runPublicUpdateValidationGate } = require("../monitor/public-update-validation-gate");

function parseArgs(argv) {
  const options = {};

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--skip-url-check") {
      options.skipUrlCheck = true;
    } else if (arg === "--input" && argv[i + 1]) {
      options.inputPath = path.resolve(argv[i + 1]);
      i += 1;
    }
  }

  return options;
}

async function main() {
  const result = await runPublicUpdateValidationGate(parseArgs(process.argv));

  if (result.reason) {
    console.error(result.reason);
    process.exit(1);
  }

  console.log("=== Public Update Validation Gate ===");
  console.log(
    JSON.stringify(
      {
        saved: result.saved === true,
        dryRun: result.dryRun === true,
        inputPath: result.inputPath,
        masterOutputPath: result.masterOutputPath || null,
        runOutputPath: result.runOutputPath || null,
        updateCount: result.updateCount,
        gateSummary: result.gateSummary,
        categorySummary: result.categorySummary,
        passedCount: (result.passedUpdates || []).length,
        failedCount: (result.failedUpdates || []).length,
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

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});

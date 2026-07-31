#!/usr/bin/env node
"use strict";

const path = require("path");
const { rollbackProductionRun, ROLLBACK_DIR } = require("../monitor/patrol-production-controller");

function parseArgs(argv) {
  const options = { dryRun: false, runId: null };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--run-id" && argv[i + 1]) {
      options.runId = argv[i + 1];
      i += 1;
    }
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv);
  if (!options.runId) {
    console.error("Usage: node scripts/rollback-production-run.js --run-id PPR-...");
    process.exit(1);
  }

  const result = rollbackProductionRun(options.runId, { dryRun: options.dryRun });

  console.log("=== Production Run Rollback ===");
  console.log(
    JSON.stringify(
      {
        run_id: options.runId,
        rolledBack: result.rolledBack,
        dryRun: result.dryRun,
        bundlePath: result.bundlePath,
        errors: result.errors || []
      },
      null,
      2
    )
  );

  console.log("");
  console.log("ROLLBACK_DIR=" + ROLLBACK_DIR);

  if (!result.rolledBack) {
    process.exit(1);
  }
}

main();

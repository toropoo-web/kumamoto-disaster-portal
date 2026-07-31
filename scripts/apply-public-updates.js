#!/usr/bin/env node
"use strict";

const path = require("path");
const {
  preparePublicUpdateApply,
  confirmPublicUpdateApply,
  APPLY_QUEUE_FILE
} = require("../monitor/public-update-apply-engine");

function parseArgs(argv) {
  const options = {};

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--confirm") {
      options.confirm = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--gate" && argv[i + 1]) {
      options.gatePath = path.resolve(argv[i + 1]);
      i += 1;
    } else if (arg === "--queue" && argv[i + 1]) {
      options.applyQueuePath = path.resolve(argv[i + 1]);
      i += 1;
    }
  }

  return options;
}

async function main() {
  const options = parseArgs(process.argv);

  if (options.confirm) {
    const result = confirmPublicUpdateApply({
      gatePath: options.gatePath,
      applyQueuePath: options.applyQueuePath,
      dryRun: options.dryRun === true
    });

    console.log("=== Public Update Apply (Confirm) ===");
    console.log(
      JSON.stringify(
        {
          mode: options.dryRun ? "CONFIRM_DRY_RUN" : "CONFIRM_APPLY",
          applied: result.applied === true,
          dryRun: result.dryRun === true,
          appliedCount: result.appliedCount || 0,
          appliedItems: result.appliedItems || [],
          reason: result.reason || null,
          errors: result.errors || []
        },
        null,
        2
      )
    );

    if (result.errors && result.errors.length) {
      process.exit(1);
    }
    return;
  }

  const result = preparePublicUpdateApply({
    gatePath: options.gatePath,
    dryRun: false,
    writeDiffs: true,
    createdAt: new Date().toISOString()
  });

  if (result.reason && !result.prepared) {
    console.error(result.reason);
    process.exit(1);
  }

  console.log("=== Public Update Apply (Prepare) ===");
  console.log(
    JSON.stringify(
      {
        mode: "PREPARE",
        prepared: result.prepared === true,
        gatePath: result.gatePath,
        applyQueuePath: result.applyQueuePath || APPLY_QUEUE_FILE,
        itemCount: result.itemCount,
        pendingCount: result.pendingCount,
        blockedCount: result.blockedCount,
        rejectedCount: result.rejectedCount,
        rejected: result.rejected || [],
        diffCount: (result.diffs || []).length,
        awaitingConfirmation: true,
        nextStep: "npm run apply:public-updates -- --confirm",
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

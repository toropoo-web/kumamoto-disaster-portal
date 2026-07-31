#!/usr/bin/env node
"use strict";

const path = require("path");
const {
  runPatrolProductionFlow,
  REGISTRY_APPLY_HISTORY_FILE,
  RUNS_DIR,
  ROLLBACK_DIR
} = require("../monitor/patrol-production-controller");

function parseArgs(argv) {
  const options = {
    dryRun: true,
    live: false,
    sourceId: "KM002-uto-water"
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--live") {
      options.live = true;
      options.dryRun = false;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--source-id" && argv[i + 1]) {
      options.sourceId = argv[i + 1];
      i += 1;
    } else if (arg === "--fixture" && argv[i + 1]) {
      options.fixturePath = path.resolve(argv[i + 1]);
      i += 1;
    }
  }

  if (!options.fixturePath) {
    options.fixturePath = path.join(
      __dirname,
      "..",
      "monitor",
      "fixtures",
      "disaster-pipeline-e2e",
      "uto-water-change.json"
    );
  }

  return options;
}

async function main() {
  const options = parseArgs(process.argv);
  const result = await runPatrolProductionFlow({
    dryRun: options.dryRun,
    live: options.live,
    sourceIds: [options.sourceId],
    fixturePath: options.fixturePath,
    registryApplyHistoryFile: REGISTRY_APPLY_HISTORY_FILE
  });

  console.log("=== Patrol Production Flow ===");
  console.log(
    JSON.stringify(
      {
        run_id: result.run_id,
        status: result.run.status,
        dryRun: result.dryRun,
        saved: result.saved,
        patrol_result: result.run.patrol_result,
        snapshot_result: result.run.snapshot_result,
        classification_result: result.run.classification_result,
        review_queue_items: result.run.review_queue_result.item_count,
        rollback_bundle: result.rollback_bundle,
        errors: result.errors
      },
      null,
      2
    )
  );

  console.log("");
  console.log("RUNS_DIR=" + RUNS_DIR);
  console.log("ROLLBACK_DIR=" + ROLLBACK_DIR);
  console.log("REGISTRY_APPLY_HISTORY=" + REGISTRY_APPLY_HISTORY_FILE);

  if (result.errors.length) {
    process.exit(1);
  }
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});

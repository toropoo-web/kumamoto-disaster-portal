#!/usr/bin/env node
"use strict";

const path = require("path");
const {
  runPatrolDiscoveryPipeline,
  PIPELINE_TARGETS_FILE,
  REVIEW_QUEUE_FILE,
  REPORTS_DIR
} = require("../monitor/patrol-discovery-controller");

function parseArgs(argv) {
  const options = { live: false, dryRunOutput: false };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--live") {
      options.live = true;
      options.dryRunOutput = false;
    } else if (arg === "--dry-run") {
      options.dryRunOutput = true;
    } else if (arg === "--targets" && argv[i + 1]) {
      options.targetsPath = path.resolve(argv[i + 1]);
      i += 1;
    } else if (arg === "--max-candidates" && argv[i + 1]) {
      options.maxCandidates = Number(argv[i + 1]);
      i += 1;
    }
  }

  return options;
}

async function main() {
  const options = parseArgs(process.argv);
  const result = await runPatrolDiscoveryPipeline({
    live: options.live,
    dryRunOutput: options.dryRunOutput,
    targetsPath: options.targetsPath,
    maxCandidates: options.maxCandidates
  });

  console.log("=== Patrol Discovery Pipeline ===");
  console.log(
    JSON.stringify(
      {
        pipeline_run_id: result.pipeline_run_id,
        saved: result.saved,
        PATROL_DISCOVERY_PIPELINE: result.summary.PATROL_DISCOVERY_PIPELINE,
        primary_discovery_rate: result.summary.primary_discovery_rate,
        false_positive_rate: result.summary.false_positive_rate,
        totals: result.summary.totals,
        review_queue_items: result.review_queue.item_count,
        errors: result.errors
      },
      null,
      2
    )
  );

  if (result.run.output_files) {
    console.log("");
    console.log("OUTPUT_RUN=" + result.run.output_files.run);
    console.log("OUTPUT_SUMMARY=" + result.run.output_files.summary);
    console.log("OUTPUT_REVIEW_QUEUE=" + result.run.output_files.review_queue);
  } else {
    console.log("");
    console.log("TARGETS=" + (options.targetsPath || PIPELINE_TARGETS_FILE));
    console.log("REVIEW_QUEUE=" + REVIEW_QUEUE_FILE);
    console.log("REPORTS_DIR=" + REPORTS_DIR);
  }

  if (result.errors.length) {
    process.exit(1);
  }
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});

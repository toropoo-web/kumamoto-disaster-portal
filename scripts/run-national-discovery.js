#!/usr/bin/env node
"use strict";

const {
  runNationalDiscovery,
  validateRegistry,
  NATIONAL_RUNS_DIR
} = require("../monitor/municipality-registry");

function parseArgs(argv) {
  const options = {
    dryRunOutput: true,
    live: false,
    limit: null,
    priority: null,
    prefecture: "熊本県"
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--live") {
      options.live = true;
      options.dryRunOutput = false;
    } else if (arg === "--dry-run") {
      options.dryRunOutput = true;
    } else if (arg === "--prefecture" && argv[i + 1]) {
      options.prefecture = argv[i + 1];
      i += 1;
    } else if (arg === "--priority" && argv[i + 1]) {
      options.priority = argv[i + 1];
      i += 1;
    } else if (arg === "--limit" && argv[i + 1]) {
      options.limit = Number(argv[i + 1]);
      i += 1;
    }
  }

  return options;
}

async function main() {
  const options = parseArgs(process.argv);
  const validation = validateRegistry();
  if (!validation.valid) {
    console.error(JSON.stringify({ validation: validation }, null, 2));
    process.exit(1);
  }

  const result = await runNationalDiscovery({
    live: options.live,
    dryRunOutput: options.dryRunOutput,
    prefecture: options.prefecture,
    priority: options.priority,
    limit: options.limit,
    maxCandidates: 12
  });

  console.log("=== National Discovery Run ===");
  console.log(
    JSON.stringify(
      {
        discovery_run_id: result.discovery_run_id,
        pipeline_run_id: result.pipeline_run_id,
        saved: result.saved,
        dryRunOutput: result.dryRunOutput,
        target_count: result.target_count,
        review_queue_items: result.review_queue ? result.review_queue.item_count : 0,
        errors: result.errors || []
      },
      null,
      2
    )
  );

  if (result.national_run_path) {
    console.log("");
    console.log("NATIONAL_RUN=" + result.national_run_path);
    console.log("NATIONAL_RUNS_DIR=" + NATIONAL_RUNS_DIR);
  }

  if (result.errors && result.errors.length) {
    process.exit(1);
  }
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});

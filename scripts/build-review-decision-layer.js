#!/usr/bin/env node
"use strict";

const path = require("path");
const {
  migrateReviewQueueDecisions,
  setReviewDecision,
  listReviewDecisions
} = require("../monitor/review-decision-engine");

function parseArgs(argv) {
  const options = { action: "migrate" };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--apply") {
      options.action = "apply";
    } else if (arg === "--list") {
      options.action = "list";
    } else if (arg === "--queue-path" && argv[i + 1]) {
      options.queuePath = path.resolve(argv[i + 1]);
      i += 1;
    } else if (arg === "--queue-id" && argv[i + 1]) {
      options.queueId = argv[i + 1];
      i += 1;
    } else if (arg === "--status" && argv[i + 1]) {
      options.status = argv[i + 1];
      i += 1;
    } else if (arg === "--reviewer" && argv[i + 1]) {
      options.reviewer = argv[i + 1];
      i += 1;
    } else if (arg === "--note" && argv[i + 1]) {
      options.reviewNote = argv[i + 1];
      i += 1;
    }
  }

  return options;
}

function main() {
  const options = parseArgs(process.argv);
  let result;

  if (options.action === "apply") {
    result = setReviewDecision(options);
  } else if (options.action === "list") {
    result = listReviewDecisions(options);
    console.log("=== Patrol Review Decision List ===");
    console.log(
      JSON.stringify(
        {
          queuePath: result.queuePath,
          itemCount: result.itemCount,
          decisionSummary: result.decisionSummary,
          items: (result.items || []).map(function (item) {
            return {
              queue_id: item.queue_id,
              municipality: item.municipality,
              category: item.category,
              title: item.title,
              status: item.status,
              decision: item.decision
            };
          })
        },
        null,
        2
      )
    );
    return;
  } else {
    result = migrateReviewQueueDecisions(options);
  }

  if (result.reason) {
    console.error(result.reason);
    process.exit(1);
  }

  console.log("=== Patrol Review Decision Layer ===");
  console.log(JSON.stringify(result, null, 2));

  if (result.errors && result.errors.length) {
    process.exit(1);
  }
}

main();

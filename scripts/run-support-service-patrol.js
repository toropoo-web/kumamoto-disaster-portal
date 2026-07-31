#!/usr/bin/env node
"use strict";

const path = require("path");

const ROOT = path.join(__dirname, "..");

const { runSupportServicePatrol } = require(path.join(
  ROOT,
  "monitor",
  "support-service-patrol-engine"
));

function parseArgs(argv) {
  const options = {
    fixture: false,
    merge: false,
    xFeedPath: null
  };

  (argv || []).forEach(function (arg) {
    if (arg === "--fixture") {
      options.fixture = true;
    } else if (arg === "--merge") {
      options.merge = true;
    } else if (arg.indexOf("--x-feed-path=") === 0) {
      options.xFeedPath = arg.slice("--x-feed-path=".length);
    }
  });

  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = runSupportServicePatrol(
    Object.assign({}, options, {
      write: true,
      appendLog: true
    })
  );

  const output = {
    SUPPORT_SERVICE_PATROL: result.status,
    run_id: result.run_id,
    executed_at: result.executed_at,
    source_count: result.source_count,
    discovered_count: result.discovered_count,
    candidate_count: result.candidate_count,
    in_area_count: result.in_area_count,
    out_of_area_count: result.out_of_area_count,
    excluded_count: result.excluded_count,
    information_count: result.information_count,
    change_count: result.change_count,
    reviewable_change_count: result.reviewable_change_count,
    change_type_summary: result.change_type_summary,
    AUTO_PUBLISH: result.AUTO_PUBLISH,
    fixture: options.fixture === true,
    merge: options.merge === true,
    candidates: result.candidatesPath
      ? path.relative(ROOT, result.candidatesPath).split(path.sep).join("/")
      : null,
    information_candidates: result.informationPath
      ? path.relative(ROOT, result.informationPath).split(path.sep).join("/")
      : null,
    change_queue: result.changeQueuePath
      ? path.relative(ROOT, result.changeQueuePath).split(path.sep).join("/")
      : null,
    change_review_queue: result.changeReviewQueuePath
      ? path.relative(ROOT, result.changeReviewQueuePath).split(path.sep).join("/")
      : null,
    candidate_review_queue: result.candidateReviewQueuePath
      ? path.relative(ROOT, result.candidateReviewQueuePath).split(path.sep).join("/")
      : null,
    patrol_log: result.patrolLogPath
      ? path.relative(ROOT, result.patrolLogPath).split(path.sep).join("/")
      : null,
    errors: result.errors
  };

  console.log("=== SUPPORT_SERVICE Patrol ===");
  console.log(JSON.stringify(output, null, 2));

  if (result.status !== "SUCCESS") {
    process.exit(1);
  }

  console.log("SUPPORT_SERVICE_PATROL_COMPLETE");
}

main();

#!/usr/bin/env node
"use strict";

const path = require("path");

const {
  APPLY_QUEUE_FILE,
  applyDisasterSocialQueue,
  loadDisasterSocialApplyQueue
} = require(path.join(__dirname, "..", "monitor", "disaster-social-pipeline"));

function parseArgs(argv) {
  const options = {};
  (argv || []).forEach(function (arg) {
    if (arg.indexOf("--apply-queue=") === 0) {
      options.applyQueuePath = arg.slice("--apply-queue=".length);
    } else if (arg.indexOf("--sources=") === 0) {
      options.sourcesPath = arg.slice("--sources=".length);
    } else if (arg.indexOf("--index=") === 0) {
      options.indexPath = arg.slice("--index=".length);
    }
  });
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const applyQueue = loadDisasterSocialApplyQueue(options);
  const pendingCount = (applyQueue.items || []).filter(function (item) {
    return item.apply_status === "PENDING";
  }).length;

  if (!pendingCount) {
    console.log("=== Disaster Social Apply ===");
    console.log(JSON.stringify({ STATUS: "NO_PENDING_APPLY_ITEMS", pending_count: 0 }, null, 2));
    return;
  }

  const result = applyDisasterSocialQueue(options);

  console.log("=== Disaster Social Apply ===");
  console.log(
    JSON.stringify(
      {
        PHASE: "DISASTER_CROSS_SEARCH_COMMUNITY_PIPELINE_APPLY",
        APPLY_QUEUE_FILE: APPLY_QUEUE_FILE,
        applied_count: result.applied_count,
        entry_count: result.entry_count,
        source_count: result.source_count,
        AUTO_PUBLISH: false
      },
      null,
      2
    )
  );
  console.log("DISASTER_SOCIAL_APPLY_COMPLETE");
}

main();

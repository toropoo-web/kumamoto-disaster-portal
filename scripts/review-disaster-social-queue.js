#!/usr/bin/env node
"use strict";

const path = require("path");

const {
  INBOX_FILE,
  REVIEW_QUEUE_FILE,
  APPLY_QUEUE_FILE,
  runDisasterSocialReviewPipeline,
  validateDisasterSocialInbox,
  loadDisasterSocialInbox
} = require(path.join(__dirname, "..", "monitor", "disaster-social-pipeline"));

function parseArgs(argv) {
  const options = {};
  (argv || []).forEach(function (arg) {
    if (arg.indexOf("--inbox=") === 0) {
      options.inboxPath = arg.slice("--inbox=".length);
    } else if (arg.indexOf("--review-queue=") === 0) {
      options.reviewQueuePath = arg.slice("--review-queue=".length);
    } else if (arg.indexOf("--apply-queue=") === 0) {
      options.applyQueuePath = arg.slice("--apply-queue=".length);
    }
  });
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const inbox = loadDisasterSocialInbox(options);
  const inboxErrors = validateDisasterSocialInbox(inbox);
  if (inboxErrors.length) {
    console.error("=== Disaster Social Review Queue ===");
    console.error(JSON.stringify({ STATUS: "FAIL", errors: inboxErrors }, null, 2));
    process.exit(1);
  }

  const result = runDisasterSocialReviewPipeline(options);
  if (result.errors && result.errors.length) {
    console.error("=== Disaster Social Review Queue ===");
    console.error(JSON.stringify({ STATUS: "FAIL", errors: result.errors }, null, 2));
    process.exit(1);
  }

  console.log("=== Disaster Social Review Queue ===");
  console.log(
    JSON.stringify(
      {
        PHASE: "DISASTER_CROSS_SEARCH_COMMUNITY_PIPELINE_PHASE2",
        INBOX_FILE: INBOX_FILE,
        REVIEW_QUEUE_FILE: REVIEW_QUEUE_FILE,
        APPLY_QUEUE_FILE: APPLY_QUEUE_FILE,
        inbox_item_count: (result.inbox.items || []).length,
        review_item_count: result.review_queue.item_count,
        review_status_summary: result.review_queue.status_summary,
        apply_item_count: result.apply_queue.item_count,
        AUTO_PUBLISH: false
      },
      null,
      2
    )
  );
  console.log("DISASTER_SOCIAL_REVIEW_QUEUE_COMPLETE");
}

main();

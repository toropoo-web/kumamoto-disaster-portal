#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

const {
  CANDIDATES_FILE,
  loadSupportServiceCandidates,
  validateSupportServiceCandidateBatch
} = require(path.join(ROOT, "monitor", "support-service-discovery-engine"));

const {
  REVIEW_QUEUE_FILE,
  buildSupportServiceReviewQueue,
  validateSupportServiceReviewQueue,
  writeSupportServiceReviewQueue
} = require(path.join(ROOT, "monitor", "support-service-review-queue"));

function parseArgs(argv) {
  const options = {
    input: CANDIDATES_FILE,
    output: REVIEW_QUEUE_FILE
  };

  (argv || []).forEach(function (arg) {
    if (arg.indexOf("--input=") === 0) {
      options.input = arg.slice("--input=".length);
    } else if (arg.indexOf("--output=") === 0) {
      options.output = arg.slice("--output=".length);
    }
  });

  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const inputPath = path.isAbsolute(options.input)
    ? options.input
    : path.join(ROOT, options.input);
  const outputPath = path.isAbsolute(options.output)
    ? options.output
    : path.join(ROOT, options.output);

  const batch = loadSupportServiceCandidates({ inputPath: inputPath });
  const candidateErrors = validateSupportServiceCandidateBatch(batch);
  if (candidateErrors.length) {
    console.error("candidate batch validation failed");
    candidateErrors.forEach(function (message) {
      console.error(" - " + message);
    });
    process.exit(1);
  }

  const reviewQueue = buildSupportServiceReviewQueue(batch, {
    candidatesFile: path.relative(ROOT, inputPath).split(path.sep).join("/")
  });
  const reviewErrors = validateSupportServiceReviewQueue(reviewQueue);
  if (reviewErrors.length) {
    console.error("review queue validation failed");
    reviewErrors.forEach(function (message) {
      console.error(" - " + message);
    });
    process.exit(1);
  }

  writeSupportServiceReviewQueue(reviewQueue, { outputPath: outputPath });

  console.log("=== SUPPORT_SERVICE Review Queue Build ===");
  console.log(
    JSON.stringify(
      {
        SUPPORT_SERVICE_REVIEW_QUEUE: "PASS",
        input: path.relative(ROOT, inputPath).split(path.sep).join("/"),
        output: path.relative(ROOT, outputPath).split(path.sep).join("/"),
        item_count: reviewQueue.item_count,
        AUTO_PUBLISH: reviewQueue.AUTO_PUBLISH,
        status_summary: reviewQueue.status_summary
      },
      null,
      2
    )
  );
  console.log("SUPPORT_SERVICE_REVIEW_QUEUE_COMPLETE");
}

main();

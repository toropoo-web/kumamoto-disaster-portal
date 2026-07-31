#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

const {
  buildSupportInformationCandidates,
  loadSupportServiceCandidates,
  validateSupportServiceCandidateBatch
} = require(path.join(ROOT, "monitor", "support-service-discovery-engine"));

const {
  loadSupportInformationCandidates,
  validateSupportInformationCandidates
} = require(path.join(ROOT, "monitor", "support-service-information"));

const {
  CHANGE_QUEUE_FILE,
  CHANGE_REVIEW_QUEUE_FILE,
  buildSupportServiceChangeQueue,
  validateSupportServiceChangeQueue,
  writeSupportServiceChangeQueue
} = require(path.join(ROOT, "monitor", "support-service-change-queue"));

const {
  syncChangeReviewWorkflow,
  validateChangeReviewQueue,
  validateAlertQueue,
  writeSupportServiceChangeReviewQueue,
  writeSupportServiceAlertQueue
} = require(path.join(ROOT, "monitor", "support-service-change-review"));

const {
  loadSupportServiceSourceRegistry
} = require(path.join(ROOT, "monitor", "support-service-source-registry"));

function parseArgs(argv) {
  const options = {
    candidatesInput: path.join(ROOT, "data", "candidates", "support_service_candidates.json"),
    currentInformationInput: path.join(
      ROOT,
      "data",
      "support_service_discovery",
      "support_information_candidates.json"
    ),
    changeQueueOutput: CHANGE_QUEUE_FILE,
    changeReviewOutput: CHANGE_REVIEW_QUEUE_FILE
  };

  (argv || []).forEach(function (arg) {
    if (arg.indexOf("--candidates=") === 0) {
      options.candidatesInput = arg.slice("--candidates=".length);
    } else if (arg.indexOf("--current-information=") === 0) {
      options.currentInformationInput = arg.slice("--current-information=".length);
    } else if (arg.indexOf("--change-queue=") === 0) {
      options.changeQueueOutput = arg.slice("--change-queue=".length);
    } else if (arg.indexOf("--change-review=") === 0) {
      options.changeReviewOutput = arg.slice("--change-review=".length);
    }
  });

  return options;
}

function resolvePath(filePath) {
  return path.isAbsolute(filePath) ? filePath : path.join(ROOT, filePath);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const candidatesPath = resolvePath(options.candidatesInput);
  const currentInformationPath = resolvePath(options.currentInformationInput);
  const changeQueuePath = resolvePath(options.changeQueueOutput);
  const changeReviewPath = resolvePath(options.changeReviewOutput);

  const candidateBatch = loadSupportServiceCandidates({ inputPath: candidatesPath });
  const candidateErrors = validateSupportServiceCandidateBatch(candidateBatch);
  if (candidateErrors.length) {
    console.error("candidate batch validation failed");
    candidateErrors.forEach(function (message) {
      console.error(" - " + message);
    });
    process.exit(1);
  }

  const currentInformation = loadSupportInformationCandidates({
    inputPath: currentInformationPath
  });
  const sourceRegistry = loadSupportServiceSourceRegistry();
  const discoveredInformation = buildSupportInformationCandidates(candidateBatch, {
    sourceRegistry: sourceRegistry,
    candidatesFile: path.relative(ROOT, candidatesPath).split(path.sep).join("/")
  });
  const discoveredErrors = validateSupportInformationCandidates(discoveredInformation);
  if (discoveredErrors.length) {
    console.error("discovered information validation failed");
    discoveredErrors.forEach(function (message) {
      console.error(" - " + message);
    });
    process.exit(1);
  }

  const changeQueue = buildSupportServiceChangeQueue(
    currentInformation.informations || [],
    discoveredInformation.informations || [],
    {
      currentInformationFile: path.relative(ROOT, currentInformationPath).split(path.sep).join("/"),
      discoveredInformationFile: path.relative(ROOT, candidatesPath).split(path.sep).join("/")
    }
  );

  const changeQueueErrors = validateSupportServiceChangeQueue(changeQueue);
  if (changeQueueErrors.length) {
    console.error("change queue validation failed");
    changeQueueErrors.forEach(function (message) {
      console.error(" - " + message);
    });
    process.exit(1);
  }

  const workflow = syncChangeReviewWorkflow(changeQueue, {
    changeQueueFile: path.relative(ROOT, changeQueuePath).split(path.sep).join("/"),
    discoveredInformations: discoveredInformation.informations || [],
    currentInformations: currentInformation.informations || []
  });
  const changeReviewQueue = workflow.reviewQueue;
  const changeReviewErrors = validateChangeReviewQueue(changeReviewQueue);
  if (changeReviewErrors.length) {
    console.error("change review queue validation failed");
    changeReviewErrors.forEach(function (message) {
      console.error(" - " + message);
    });
    process.exit(1);
  }

  const alertErrors = validateAlertQueue(workflow.alertQueue);
  if (alertErrors.length) {
    console.error("alert queue validation failed");
    alertErrors.forEach(function (message) {
      console.error(" - " + message);
    });
    process.exit(1);
  }

  writeSupportServiceChangeQueue(changeQueue, { outputPath: changeQueuePath });
  writeSupportServiceChangeReviewQueue(changeReviewQueue, { outputPath: changeReviewPath });
  writeSupportServiceAlertQueue(workflow.alertQueue);

  console.log("=== SUPPORT_SERVICE Change Queue Build ===");
  console.log(
    JSON.stringify(
      {
        SUPPORT_SERVICE_CHANGE_QUEUE: "PASS",
        current_information: path.relative(ROOT, currentInformationPath).split(path.sep).join("/"),
        candidates: path.relative(ROOT, candidatesPath).split(path.sep).join("/"),
        change_queue: path.relative(ROOT, changeQueuePath).split(path.sep).join("/"),
        change_review_queue: path.relative(ROOT, changeReviewPath).split(path.sep).join("/"),
        change_count: changeQueue.change_count,
        reviewable_change_count: changeQueue.reviewable_change_count,
        change_type_summary: changeQueue.change_type_summary,
        AUTO_PUBLISH: changeQueue.AUTO_PUBLISH
      },
      null,
      2
    )
  );
  console.log("SUPPORT_SERVICE_CHANGE_QUEUE_COMPLETE");
}

main();

#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

const {
  CANDIDATES_FILE,
  discoverSupportServiceCandidates,
  discoverAndMergeSupportServiceCandidates,
  validateSupportServiceCandidateBatch,
  writeSupportServiceCandidates,
  loadSupportServiceCandidates,
  loadSupportServiceSourceRegistry,
  writeSupportServiceSourceRegistry,
  buildSupportInformationCandidates,
  writeSupportInformationCandidates
} = require(path.join(ROOT, "monitor", "support-service-discovery-engine"));

const {
  validateSupportInformationCandidates
} = require(path.join(ROOT, "monitor", "support-service-information"));

const {
  validateSupportServiceSourceRegistry
} = require(path.join(ROOT, "monitor", "support-service-source-registry"));

const {
  loadXFeedDiscoveryPosts
} = require(path.join(ROOT, "monitor", "support-service-source-discovery"));

const {
  buildSupportServiceReviewQueue,
  writeSupportServiceReviewQueue,
  validateSupportServiceReviewQueue
} = require(path.join(ROOT, "monitor", "support-service-review-queue"));

const {
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
  loadPublicSupportInformation
} = require(path.join(ROOT, "monitor", "support-service-public-apply"));

function parseArgs(argv) {
  const options = {
    fixture: false,
    xFeed: false,
    merge: false,
    input: null,
    xFeedPath: null,
    output: CANDIDATES_FILE,
    buildReviewQueue: true,
    buildChangeQueue: true
  };

  (argv || []).forEach(function (arg) {
    if (arg === "--fixture") {
      options.fixture = true;
    } else if (arg === "--x-feed") {
      options.xFeed = true;
    } else if (arg === "--merge") {
      options.merge = true;
    } else if (arg.indexOf("--input=") === 0) {
      options.input = arg.slice("--input=".length);
    } else if (arg.indexOf("--x-feed-path=") === 0) {
      options.xFeedPath = arg.slice("--x-feed-path=".length);
    } else if (arg.indexOf("--output=") === 0) {
      options.output = arg.slice("--output=".length);
    } else if (arg === "--no-review-queue") {
      options.buildReviewQueue = false;
    } else if (arg === "--no-change-queue") {
      options.buildChangeQueue = false;
    }
  });

  return options;
}

function loadPosts(options) {
  if (options.xFeed) {
    const feedPath = options.xFeedPath
      ? path.isAbsolute(options.xFeedPath)
        ? options.xFeedPath
        : path.join(ROOT, options.xFeedPath)
      : path.join(ROOT, "data", "public", "x_feed_preview.json");
    return {
      posts: loadXFeedDiscoveryPosts({ feedPath: feedPath }),
      referenceDate: new Date().toISOString().slice(0, 10),
      source: path.relative(ROOT, feedPath).split(path.sep).join("/")
    };
  }

  if (options.fixture) {
    const fixturePath = path.join(
      ROOT,
      "monitor",
      "fixtures",
      "support-service-discovery",
      "posts-fixture.json"
    );
    const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
    return {
      posts: fixture.posts || [],
      referenceDate: fixture.referenceDate || null,
      source: "monitor/fixtures/support-service-discovery/posts-fixture.json"
    };
  }

  if (options.input) {
    const inputPath = path.isAbsolute(options.input)
      ? options.input
      : path.join(ROOT, options.input);
    const payload = JSON.parse(fs.readFileSync(inputPath, "utf8"));
    return {
      posts: payload.posts || payload,
      referenceDate: payload.referenceDate || null,
      source: path.relative(ROOT, inputPath).split(path.sep).join("/")
    };
  }

  return { posts: [], referenceDate: null, source: null };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const loaded = loadPosts(options);

  const batch = options.merge
    ? discoverAndMergeSupportServiceCandidates(loaded.posts, {
        referenceDate: loaded.referenceDate,
        persistSourceRegistry: true
      })
    : discoverSupportServiceCandidates(loaded.posts, {
        referenceDate: loaded.referenceDate,
        persistSourceRegistry: true
      });

  const candidateErrors = validateSupportServiceCandidateBatch(batch);

  if (candidateErrors.length) {
    console.error("SUPPORT_SERVICE discovery validation failed:");
    candidateErrors.forEach(function (message) {
      console.error(" - " + message);
    });
    process.exit(1);
  }

  const outputPath = path.isAbsolute(options.output)
    ? options.output
    : path.join(ROOT, options.output);
  writeSupportServiceCandidates(batch, { outputPath: outputPath });

  const sourceRegistry = loadSupportServiceSourceRegistry();
  const sourceErrors = validateSupportServiceSourceRegistry(sourceRegistry);
  if (sourceErrors.length) {
    console.error("SUPPORT_SERVICE source registry validation failed:");
    sourceErrors.forEach(function (message) {
      console.error(" - " + message);
    });
    process.exit(1);
  }

  const publicInformation = loadPublicSupportInformation();
  const informationBatch = buildSupportInformationCandidates(batch, {
    sourceRegistry: sourceRegistry,
    candidatesFile: path.relative(ROOT, outputPath).split(path.sep).join("/")
  });
  const informationErrors = validateSupportInformationCandidates(informationBatch);
  if (informationErrors.length) {
    console.error("SUPPORT_SERVICE information validation failed:");
    informationErrors.forEach(function (message) {
      console.error(" - " + message);
    });
    process.exit(1);
  }
  const informationPath = writeSupportInformationCandidates(informationBatch);

  const result = {
    SUPPORT_SERVICE_DISCOVERY: "PASS",
    source: loaded.source,
    output: path.relative(ROOT, outputPath).split(path.sep).join("/"),
    source_registry: "data/support_service_discovery/source_registry.json",
    information_candidates: path.relative(ROOT, informationPath).split(path.sep).join("/"),
    candidate_count: batch.candidate_count,
    in_area_count: batch.in_area_count,
    out_of_area_count: batch.out_of_area_count,
    excluded_count: batch.excluded_count || 0,
    information_count: informationBatch.information_count,
    AUTO_PUBLISH: batch.AUTO_PUBLISH,
    merge: options.merge === true
  };

  if (options.buildChangeQueue) {
    const changeQueue = buildSupportServiceChangeQueue(
      publicInformation.informations || [],
      informationBatch.informations || [],
      {
        currentInformationFile: "data/public/support_information.json",
        discoveredInformationFile: path.relative(ROOT, outputPath).split(path.sep).join("/")
      }
    );
    const workflow = syncChangeReviewWorkflow(changeQueue, {
      changeQueueFile: "data/support_service_discovery/support_service_change_queue.json",
      discoveredInformations: informationBatch.informations || [],
      currentInformations: publicInformation.informations || []
    });
    const changeQueueErrors = validateSupportServiceChangeQueue(changeQueue);
    if (changeQueueErrors.length) {
      console.error("SUPPORT_SERVICE change queue validation failed:");
      changeQueueErrors.forEach(function (message) {
        console.error(" - " + message);
      });
      process.exit(1);
    }

    const changeReviewQueue = workflow.reviewQueue;
    const changeReviewErrors = validateChangeReviewQueue(changeReviewQueue);
    if (changeReviewErrors.length) {
      console.error("SUPPORT_SERVICE change review queue validation failed:");
      changeReviewErrors.forEach(function (message) {
        console.error(" - " + message);
      });
      process.exit(1);
    }

    const alertErrors = validateAlertQueue(workflow.alertQueue);
    if (alertErrors.length) {
      console.error("SUPPORT_SERVICE alert queue validation failed:");
      alertErrors.forEach(function (message) {
        console.error(" - " + message);
      });
      process.exit(1);
    }

    const changeQueuePath = writeSupportServiceChangeQueue(changeQueue);
    const changeReviewPath = writeSupportServiceChangeReviewQueue(changeReviewQueue);
    writeSupportServiceAlertQueue(workflow.alertQueue);
    result.change_queue = path.relative(ROOT, changeQueuePath).split(path.sep).join("/");
    result.change_review_queue = path.relative(ROOT, changeReviewPath).split(path.sep).join("/");
    result.change_count = changeQueue.change_count;
    result.reviewable_change_count = changeQueue.reviewable_change_count;
    result.change_type_summary = changeQueue.change_type_summary;
  }

  if (options.buildReviewQueue) {
    const reviewQueue = buildSupportServiceReviewQueue(batch, {
      candidatesFile: path.relative(ROOT, outputPath).split(path.sep).join("/")
    });
    const reviewErrors = validateSupportServiceReviewQueue(reviewQueue);
    if (reviewErrors.length) {
      console.error("SUPPORT_SERVICE review queue validation failed:");
      reviewErrors.forEach(function (message) {
        console.error(" - " + message);
      });
      process.exit(1);
    }
    const reviewPath = writeSupportServiceReviewQueue(reviewQueue);
    result.review_queue = path.relative(ROOT, reviewPath).split(path.sep).join("/");
    result.review_item_count = reviewQueue.item_count;
  }

  console.log("=== SUPPORT_SERVICE Discovery ===");
  console.log(JSON.stringify(result, null, 2));
  console.log("SUPPORT_SERVICE_DISCOVERY_COMPLETE");
}

main();

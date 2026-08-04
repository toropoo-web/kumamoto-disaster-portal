"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { AUTO_PUBLISH } = require("./support-service-discovery-engine");
const {
  discoverSupportServiceCandidates,
  discoverAndMergeSupportServiceCandidates,
  validateSupportServiceCandidateBatch,
  writeSupportServiceCandidates,
  loadSupportServiceCandidates,
  CANDIDATES_FILE
} = require("./support-service-discovery-engine");

const {
  loadSupportServiceSourceRegistry,
  validateSupportServiceSourceRegistry
} = require("./support-service-source-registry");

const { collectPatrolPostsFromRegistry } = require("./support-service-patrol-fetcher");

const {
  buildSupportInformationCandidates,
  loadSupportInformationCandidates,
  writeSupportInformationCandidates,
  validateSupportInformationCandidates,
  INFORMATION_FILE,
  INFORMATION_LATEST_FILE
} = require("./support-service-information");

const {
  buildSupportServiceChangeQueue,
  validateSupportServiceChangeQueue,
  writeSupportServiceChangeQueue,
  CHANGE_QUEUE_FILE,
  CHANGE_REVIEW_QUEUE_FILE
} = require("./support-service-change-queue");

const {
  syncChangeReviewWorkflow,
  validateChangeReviewQueue,
  validateAlertQueue,
  writeSupportServiceChangeReviewQueue,
  writeSupportServiceAlertQueue
} = require("./support-service-change-review");

const {
  buildSupportServiceReviewQueue,
  writeSupportServiceReviewQueue,
  validateSupportServiceReviewQueue
} = require("./support-service-review-queue");

const ROOT = path.join(__dirname, "..");
const PATROL_LOG_FILE = path.join(
  ROOT,
  "data",
  "support_service_discovery",
  "support_service_patrol_log.json"
);

const PATROL_STATUSES = ["SUCCESS", "FAILED"];

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function buildPatrolRunId(executedAt) {
  return (
    "SSPTR-" +
    crypto
      .createHash("sha256")
      .update(String(executedAt || new Date().toISOString()))
      .digest("hex")
      .slice(0, 10)
      .toUpperCase()
  );
}

function buildSourceLookup(registry) {
  const lookup = {};
  (registry.sources || []).forEach(function (source) {
    lookup[source.source_id] = source;
  });
  return lookup;
}

function enrichCandidateBatch(batch, sourceRegistry) {
  const lookup = buildSourceLookup(sourceRegistry);
  const candidates = (batch.candidates || []).map(function (candidate) {
    const source = lookup[candidate.source_id] || null;
    return Object.assign({}, candidate, {
      area: source && source.area ? source.area : candidate.area || "UNKNOWN",
      category: candidate.category || "SUPPORT_SERVICE",
      published_at: candidate.published_at || "UNKNOWN",
      checked_at: candidate.checked_at || new Date().toISOString()
    });
  });

  return Object.assign({}, batch, {
    candidates: candidates,
    candidate_count: candidates.length,
    in_area_count: candidates.filter(function (entry) {
      return entry.status === "NEW";
    }).length,
    out_of_area_count: candidates.filter(function (entry) {
      return entry.status === "OUT_OF_AREA";
    }).length
  });
}

function loadSupportServicePatrolLog(options) {
  options = options || {};
  return readJson(options.logPath || PATROL_LOG_FILE, {
    version: "1.0",
    description: "SUPPORT_SERVICE patrol execution log",
    runs: []
  });
}

function validateSupportServicePatrolLogEntry(entry, index) {
  const label = "runs[" + index + "]";
  const errors = [];

  if (!entry || typeof entry !== "object") {
    errors.push(label + ": entry missing");
    return errors;
  }

  ["run_id", "executed_at", "status"].forEach(function (field) {
    if (!entry[field]) {
      errors.push(label + ": missing " + field);
    }
  });

  ["source_count", "discovered_count", "candidate_count", "change_count"].forEach(function (field) {
    if (typeof entry[field] !== "number") {
      errors.push(label + ": " + field + " must be a number");
    }
  });

  if (PATROL_STATUSES.indexOf(entry.status) === -1) {
    errors.push(label + ": invalid status " + entry.status);
  }

  return errors;
}

function validateSupportServicePatrolLog(log) {
  const errors = [];

  if (!log || log.version !== "1.0") {
    errors.push("patrol log version must be 1.0");
  }
  if (!Array.isArray(log.runs)) {
    errors.push("patrol log runs must be an array");
    return errors;
  }

  log.runs.forEach(function (entry, index) {
    errors.push.apply(errors, validateSupportServicePatrolLogEntry(entry, index));
  });

  return errors;
}

function appendSupportServicePatrolLog(entry, options) {
  options = options || {};
  const log = loadSupportServicePatrolLog(options);
  const runs = (log.runs || []).slice();
  runs.push(entry);
  const nextLog = Object.assign({}, log, { runs: runs });
  const outputPath = options.logPath || PATROL_LOG_FILE;
  writeJson(outputPath, nextLog);
  return outputPath;
}

function writeSupportServicePatrolLog(entry, options) {
  options = options || {};
  if (options.append === false) {
    const nextLog = {
      version: "1.0",
      description: "SUPPORT_SERVICE patrol execution log",
      runs: [entry]
    };
    const outputPath = options.logPath || PATROL_LOG_FILE;
    writeJson(outputPath, nextLog);
    return outputPath;
  }
  return appendSupportServicePatrolLog(entry, options);
}

function runSupportServicePatrol(options) {
  options = options || {};
  const executedAt = options.executedAt || new Date().toISOString();
  const runId = options.runId || buildPatrolRunId(executedAt);
  const errors = [];

  const sourceRegistry = options.sourceRegistry || loadSupportServiceSourceRegistry(options);
  const registryErrors = validateSupportServiceSourceRegistry(sourceRegistry);
  if (registryErrors.length) {
    return {
      run_id: runId,
      executed_at: executedAt,
      status: "FAILED",
      errors: registryErrors,
      AUTO_PUBLISH: false
    };
  }

  const collected = options.posts
    ? {
        posts: options.posts,
        source_count: (sourceRegistry.sources || []).length,
        discovered_count: options.posts.length,
        referenceDate: options.referenceDate || executedAt.slice(0, 10),
        source_results: []
      }
    : collectPatrolPostsFromRegistry(sourceRegistry, options);

  const discoveryOptions = {
    referenceDate: collected.referenceDate,
    persistSourceRegistry: false,
    sourceRegistry: sourceRegistry
  };

  const batch = options.merge
    ? discoverAndMergeSupportServiceCandidates(collected.posts, discoveryOptions)
    : discoverSupportServiceCandidates(collected.posts, discoveryOptions);

  const enrichedBatch = enrichCandidateBatch(batch, sourceRegistry);
  const candidateErrors = validateSupportServiceCandidateBatch(enrichedBatch);
  errors.push.apply(errors, candidateErrors);

  const currentInformation = options.currentInformation
    ? options.currentInformation
    : loadSupportInformationCandidates(options);

  const discoveredInformation = buildSupportInformationCandidates(enrichedBatch, {
    sourceRegistry: sourceRegistry,
    checkedAt: executedAt,
    candidatesFile:
      options.candidatesOutputPath ||
      path.relative(ROOT, CANDIDATES_FILE).split(path.sep).join("/")
  });
  const informationErrors = validateSupportInformationCandidates(discoveredInformation);
  errors.push.apply(errors, informationErrors);

  const changeQueue = buildSupportServiceChangeQueue(
    currentInformation.informations || [],
    discoveredInformation.informations || [],
    {
      detectedAt: executedAt,
      currentInformationFile: path
        .relative(ROOT, options.currentInformationPath || INFORMATION_FILE)
        .split(path.sep)
        .join("/"),
      discoveredInformationFile: path
        .relative(ROOT, options.discoveredInformationPath || INFORMATION_FILE)
        .split(path.sep)
        .join("/")
    }
  );
  const changeQueueErrors = validateSupportServiceChangeQueue(changeQueue);
  errors.push.apply(errors, changeQueueErrors);

  const workflow = syncChangeReviewWorkflow(changeQueue, {
    discoveredInformations: discoveredInformation.informations || [],
    currentInformations: currentInformation.informations || []
  });
  const changeReviewQueue = workflow.reviewQueue;
  const changeReviewErrors = validateChangeReviewQueue(changeReviewQueue);
  errors.push.apply(errors, changeReviewErrors);

  const alertQueueErrors = validateAlertQueue(workflow.alertQueue);
  errors.push.apply(errors, alertQueueErrors);

  const reviewQueue = buildSupportServiceReviewQueue(enrichedBatch, {
    candidatesFile: path.relative(ROOT, CANDIDATES_FILE).split(path.sep).join("/")
  });
  const reviewErrors = validateSupportServiceReviewQueue(reviewQueue);
  errors.push.apply(errors, reviewErrors);

  const patrolStatus = errors.length ? "FAILED" : "SUCCESS";
  const patrolLogEntry = {
    run_id: runId,
    executed_at: executedAt,
    source_count: collected.source_count,
    discovered_count: collected.discovered_count,
    candidate_count: enrichedBatch.candidate_count,
    change_count: changeQueue.change_count,
    status: patrolStatus
  };

  let candidatesPath = null;
  let informationPath = null;
  let changeQueuePath = null;
  let changeReviewPath = null;
  let reviewPath = null;
  let patrolLogPath = null;

  if (options.write !== false && patrolStatus === "SUCCESS") {
    candidatesPath = writeSupportServiceCandidates(enrichedBatch, {
      outputPath: options.candidatesOutputPath || CANDIDATES_FILE
    });
    informationPath = writeSupportInformationCandidates(discoveredInformation, {
      outputPath: options.discoveredInformationPath || INFORMATION_LATEST_FILE
    });
    changeQueuePath = writeSupportServiceChangeQueue(changeQueue, {
      outputPath: options.changeQueuePath || CHANGE_QUEUE_FILE
    });
    changeReviewPath = writeSupportServiceChangeReviewQueue(changeReviewQueue, {
      outputPath: options.changeReviewQueuePath || CHANGE_REVIEW_QUEUE_FILE
    });
    writeSupportServiceAlertQueue(workflow.alertQueue, {
      outputPath: options.alertQueuePath
    });
    reviewPath = writeSupportServiceReviewQueue(reviewQueue, {
      outputPath: options.reviewQueuePath
    });
    patrolLogPath = writeSupportServicePatrolLog(patrolLogEntry, {
      logPath: options.logPath,
      append: options.appendLog !== false
    });
  }

  return {
    run_id: runId,
    executed_at: executedAt,
    status: patrolStatus,
    source_count: collected.source_count,
    discovered_count: collected.discovered_count,
    candidate_count: enrichedBatch.candidate_count,
    in_area_count: enrichedBatch.in_area_count,
    out_of_area_count: enrichedBatch.out_of_area_count,
    excluded_count: enrichedBatch.excluded_count || 0,
    information_count: discoveredInformation.information_count,
    change_count: changeQueue.change_count,
    reviewable_change_count: changeQueue.reviewable_change_count,
    change_type_summary: changeQueue.change_type_summary,
    source_results: collected.source_results || [],
    AUTO_PUBLISH: AUTO_PUBLISH,
    auto_publish: false,
    candidatesPath: candidatesPath,
    informationPath: informationPath,
    changeQueuePath: changeQueuePath,
    changeReviewQueuePath: changeReviewPath,
    candidateReviewQueuePath: reviewPath,
    patrolLogPath: patrolLogPath,
    batch: enrichedBatch,
    discoveredInformation: discoveredInformation,
    changeQueue: changeQueue,
    changeReviewQueue: changeReviewQueue,
    reviewQueue: reviewQueue,
    errors: errors
  };
}

module.exports = {
  PATROL_LOG_FILE,
  PATROL_STATUSES,
  buildPatrolRunId,
  enrichCandidateBatch,
  loadSupportServicePatrolLog,
  validateSupportServicePatrolLogEntry,
  validateSupportServicePatrolLog,
  writeSupportServicePatrolLog,
  appendSupportServicePatrolLog,
  runSupportServicePatrol
};

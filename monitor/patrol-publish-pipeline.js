"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const CANDIDATE_DIR = path.join(ROOT, "data", "update_candidates");
const APPROVED_DIR = path.join(ROOT, "data", "approved");
const REVIEW_QUEUE = path.join(ROOT, "monitor", "reports", "review_queue.md");
const NORMALIZED_CANDIDATES = path.join(ROOT, "monitor", "reports", "normalized_candidates.json");
const STATUS_PATH = path.join(ROOT, "data", "public", "status.json");
const PUBLIC_TARGETS = [
  "data/public/phase1_updates.json",
  "data/public/disaster_locations.json",
  "data/public/status.json"
];

const { readPublicStatus, validatePublicStatus } = require("./public-status");
const { inspectSnapshotStore } = require("./patrol-snapshot-store");

function listJsonFiles(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  return fs
    .readdirSync(dirPath)
    .filter(function (name) {
      return name.endsWith(".json") && !name.startsWith("_");
    })
    .map(function (name) {
      return path.join(dirPath, name);
    });
}

function readLatestPatrolReport() {
  const reportsDir = path.join(ROOT, "monitor", "reports");
  if (!fs.existsSync(reportsDir)) {
    return null;
  }

  const patrolReports = fs
    .readdirSync(reportsDir)
    .filter(function (name) {
      return /^patrol-\d{4}-\d{2}-\d{2}T/.test(name) && name.endsWith(".json");
    })
    .sort()
    .reverse();

  if (!patrolReports.length) {
    return null;
  }

  const latestPath = path.join(reportsDir, patrolReports[0]);
  try {
    return JSON.parse(fs.readFileSync(latestPath, "utf8"));
  } catch (err) {
    return null;
  }
}

function inspectPublishPipeline() {
  const candidateFiles = listJsonFiles(CANDIDATE_DIR);
  const approvedFiles = listJsonFiles(APPROVED_DIR);
  const approvedLocationFiles = listJsonFiles(path.join(APPROVED_DIR, "locations"));
  const latestPatrol = readLatestPatrolReport();
  const status = readPublicStatus();
  const statusErrors = status ? validatePublicStatus(status) : ["status.json missing"];

  let highCandidateCount = 0;
  if (fs.existsSync(NORMALIZED_CANDIDATES)) {
    try {
      const normalized = JSON.parse(fs.readFileSync(NORMALIZED_CANDIDATES, "utf8"));
      highCandidateCount = (normalized.candidates || []).filter(function (item) {
        return item.priority === "HIGH";
      }).length;
    } catch (err) {
      highCandidateCount = 0;
    }
  }

  return {
    pipeline: {
      patrol: "READY",
      reviewQueue: fs.existsSync(REVIEW_QUEUE) ? "READY" : "MISSING",
      approvedGate: approvedFiles.length + approvedLocationFiles.length > 0 ? "PENDING_APPLY" : "NO_APPROVED",
      publicStatus: statusErrors.length === 0 ? "READY" : "INVALID"
    },
    counts: {
      updateCandidateBatches: candidateFiles.length,
      approvedPatrolFiles: approvedFiles.length,
      approvedLocationFiles: approvedLocationFiles.length,
      highCandidates: highCandidateCount
    },
    latestPatrol: latestPatrol
      ? {
          patrolAt: latestPatrol.patrolAt || null,
          successCount: latestPatrol.PATROL_SUCCESS_COUNT || 0,
          changeCount: latestPatrol.CHANGE_DETECTED_COUNT || 0,
          publicStatusUpdated: latestPatrol.publicStatusUpdated === true
        }
      : null,
    publicStatus: status,
    publicStatusErrors: statusErrors,
    snapshots: inspectSnapshotStore(),
    publicTargets: PUBLIC_TARGETS
  };
}

function syncPublicStatusFromLatestPatrol() {
  const latestPatrol = readLatestPatrolReport();
  if (!latestPatrol || !latestPatrol.patrolAt) {
    return { saved: false, reason: "latest patrol report missing" };
  }

  if (!latestPatrol.PATROL_SUCCESS_COUNT || latestPatrol.PATROL_SUCCESS_COUNT <= 0) {
    return { saved: false, reason: "latest patrol did not succeed" };
  }

  const { savePublicStatus } = require("./public-status");
  return savePublicStatus({
    patrolAt: latestPatrol.patrolAt,
    sourceCount: latestPatrol.PATROL_SOURCE_COUNT || 21,
    successCount: latestPatrol.PATROL_SUCCESS_COUNT,
    lastValidationAt:
      latestPatrol.currentStatus && latestPatrol.currentStatus.LAST_VALIDATION
        ? latestPatrol.currentStatus.LAST_VALIDATION
        : latestPatrol.patrolAt,
    systemStatus:
      latestPatrol.currentStatus && latestPatrol.currentStatus.PUBLIC_STATUS
        ? latestPatrol.currentStatus.PUBLIC_STATUS
        : "HEALTHY"
  });
}

module.exports = {
  inspectPublishPipeline,
  syncPublicStatusFromLatestPatrol,
  readLatestPatrolReport,
  STATUS_PATH,
  PUBLIC_TARGETS
};

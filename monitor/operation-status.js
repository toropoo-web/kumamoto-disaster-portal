"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const REPORTS_DIR = path.join(__dirname, "reports");
const PATROL_DIR = path.join(ROOT, "operations", "patrol");
const URL_AUDIT_DIR = path.join(ROOT, "operations", "url-audit");

const { getLatestUpdateHistory } = require("./update-history");
const { runPostApplyValidation } = require("./post-apply-validation");

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    return null;
  }
}

function getLatestTimestampFromDir(dirPath, fileName) {
  if (!fs.existsSync(dirPath)) {
    return null;
  }

  const dates = fs
    .readdirSync(dirPath)
    .filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name))
    .sort();

  if (!dates.length) {
    return null;
  }

  const latestDate = dates[dates.length - 1];
  const filePath = path.join(dirPath, latestDate, fileName);

  if (!fs.existsSync(filePath)) {
    return latestDate + "T00:00:00.000Z";
  }

  const data = readJsonIfExists(filePath);
  if (data && data.patrolAt) {
    return data.patrolAt;
  }
  if (data && data.auditedAt) {
    return data.auditedAt;
  }
  if (data && data.lastAppliedAt) {
    return data.lastAppliedAt;
  }

  return latestDate + "T00:00:00.000Z";
}

async function getOperationStatus(overrides) {
  overrides = overrides || {};
  const patrolSummary = readJsonIfExists(path.join(REPORTS_DIR, "patrol-summary.json"));
  const updateHistory = getLatestUpdateHistory();
  const validation = await runPostApplyValidation({ appliedUrls: [] });

  const lastPatrol =
    overrides.patrolAt ||
    (patrolSummary && patrolSummary.patrolAt) ||
    getLatestTimestampFromDir(PATROL_DIR, "result.json");
  const lastUrlAudit = getLatestTimestampFromDir(URL_AUDIT_DIR, "result.json");
  const lastUpdate = updateHistory ? updateHistory.lastAppliedAt : null;
  const lastValidation = validation.validatedAt;

  const publicHealthy =
    validation.POST_APPLY_VALIDATION === "PASS" &&
    validation.errors.length === 0;

  return {
    CURRENT_STATUS: {
      MONITORING: "ACTIVE",
      LAST_PATROL: lastPatrol,
      LAST_URL_AUDIT: lastUrlAudit,
      LAST_UPDATE: lastUpdate,
      LAST_VALIDATION: lastValidation,
      PUBLIC_STATUS: publicHealthy ? "HEALTHY" : "DEGRADED",
      AUTO_PUBLICATION: false
    },
    validation
  };
}

function renderOperationStatus(status) {
  const current = status.CURRENT_STATUS;
  const lines = [
    "## CURRENT_STATUS",
    "",
    "MONITORING: " + current.MONITORING,
    "LAST_PATROL: " + (current.LAST_PATROL || "（未実行）"),
    "LAST_URL_AUDIT: " + (current.LAST_URL_AUDIT || "（未実行）"),
    "LAST_UPDATE: " + (current.LAST_UPDATE || "（未反映）"),
    "LAST_VALIDATION: " + (current.LAST_VALIDATION || "（未実行）"),
    "PUBLIC_STATUS: " + current.PUBLIC_STATUS,
    "AUTO_PUBLICATION: false"
  ];

  return lines.join("\n");
}

async function saveOperationStatus(overrides) {
  const status = await getOperationStatus(overrides);
  const content = "# Operation Status\n\n" + renderOperationStatus(status) + "\n";
  const jsonPath = path.join(REPORTS_DIR, "operation-status.json");
  const mdPath = path.join(REPORTS_DIR, "operation-status.md");

  if (!fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
  }

  fs.writeFileSync(jsonPath, JSON.stringify(status, null, 2) + "\n", "utf8");
  fs.writeFileSync(mdPath, content, "utf8");

  return {
    statusPath: jsonPath,
    markdownPath: mdPath,
    currentStatus: status.CURRENT_STATUS
  };
}

module.exports = {
  getOperationStatus,
  renderOperationStatus,
  saveOperationStatus
};

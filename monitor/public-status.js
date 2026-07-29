"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const STATUS_PATH = path.join(ROOT, "data", "public", "status.json");

const VALID_SYSTEM_STATUSES = new Set(["HEALTHY", "DEGRADED"]);

function readPublicStatus() {
  if (!fs.existsSync(STATUS_PATH)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(STATUS_PATH, "utf8"));
  } catch (err) {
    return null;
  }
}

function validatePublicStatus(status) {
  const errors = [];

  if (!status || typeof status !== "object") {
    errors.push("status payload missing");
    return errors;
  }

  if (!status.last_patrol_at) {
    errors.push("last_patrol_at missing");
  }

  if (!status.system_status || !VALID_SYSTEM_STATUSES.has(status.system_status)) {
    errors.push("system_status invalid");
  }

  if (typeof status.source_count !== "number" || status.source_count <= 0) {
    errors.push("source_count invalid");
  }

  if (!status.last_validation_at) {
    errors.push("last_validation_at missing");
  }

  return errors;
}

function savePublicStatus(options) {
  options = options || {};

  if (!options.patrolAt) {
    return { saved: false, reason: "patrolAt missing" };
  }

  if (!options.successCount || options.successCount <= 0) {
    return { saved: false, reason: "Patrol did not succeed" };
  }

  const status = {
    last_patrol_at: options.patrolAt,
    system_status: options.systemStatus || "HEALTHY",
    source_count: options.sourceCount || 20,
    last_validation_at: options.lastValidationAt || options.patrolAt
  };

  const validationErrors = validatePublicStatus(status);
  if (validationErrors.length) {
    return { saved: false, reason: validationErrors.join(", ") };
  }

  const dir = path.dirname(STATUS_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(STATUS_PATH, JSON.stringify(status, null, 2) + "\n", "utf8");

  return {
    saved: true,
    statusPath: STATUS_PATH,
    status
  };
}

module.exports = {
  STATUS_PATH,
  VALID_SYSTEM_STATUSES,
  readPublicStatus,
  validatePublicStatus,
  savePublicStatus
};

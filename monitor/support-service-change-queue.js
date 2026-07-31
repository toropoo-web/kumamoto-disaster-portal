"use strict";

const fs = require("fs");
const path = require("path");

const { AUTO_PUBLISH } = require("./support-service-discovery-engine");
const {
  compareSupportInformationChanges,
  CHANGE_TYPES
} = require("./support-service-diff-engine");
const {
  buildChangeReviewQueue,
  validateChangeReviewQueue,
  writeSupportServiceChangeReviewQueue,
  loadSupportServiceChangeReviewQueue: loadChangeReviewQueueFromModule
} = require("./support-service-change-review");
const ROOT = path.join(__dirname, "..");
const CHANGE_QUEUE_FILE = path.join(
  ROOT,
  "data",
  "support_service_discovery",
  "support_service_change_queue.json"
);
const CHANGE_REVIEW_DIR = path.join(ROOT, "data", "review", "support_service");
const CHANGE_REVIEW_QUEUE_FILE = path.join(
  CHANGE_REVIEW_DIR,
  "support_service_change_review_queue.json"
);

const CHANGE_QUEUE_STATUSES = ["NEW_CHANGE"];
const CHANGE_REVIEW_STATUSES = ["NEW", "REVIEWING", "APPROVED", "REJECTED", "APPLIED"];
const REVIEWABLE_CHANGE_TYPES = ["NEW", "UPDATED", "ENDED"];

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

function buildSupportServiceChangeQueue(currentInformations, discoveredInformations, options) {
  options = options || {};
  const comparison = compareSupportInformationChanges(
    currentInformations,
    discoveredInformations,
    options
  );

  const summary = CHANGE_TYPES.reduce(function (acc, changeType) {
    acc[changeType] = 0;
    return acc;
  }, {});
  comparison.changes.forEach(function (entry) {
    summary[entry.change_type] = (summary[entry.change_type] || 0) + 1;
  });

  return {
    version: "1.0",
    category: "SUPPORT_SERVICE",
    generated_at: comparison.detected_at,
    AUTO_PUBLISH: AUTO_PUBLISH,
    auto_publish: AUTO_PUBLISH,
    change_count: comparison.changes.length,
    reviewable_change_count: comparison.changes.filter(function (entry) {
      return REVIEWABLE_CHANGE_TYPES.indexOf(entry.change_type) !== -1;
    }).length,
    change_type_summary: summary,
    source_information_file:
      options.currentInformationFile ||
      "data/support_service_discovery/support_information_candidates.json",
    discovered_information_file:
      options.discoveredInformationFile ||
      "data/support_service_discovery/support_information_candidates.json",
    changes: comparison.changes,
    updated_informations: comparison.updatedInformations
  };
}

function buildSupportServiceChangeReviewQueue(changeQueue, options) {
  return buildChangeReviewQueue(changeQueue, options);
}

function validateSupportServiceChangeEntry(entry, index) {
  const label = "changes[" + index + "]";
  const errors = [];

  if (!entry || typeof entry !== "object") {
    errors.push(label + ": entry missing");
    return errors;
  }

  ["change_id", "information_id", "change_type", "after", "detected_at", "status"].forEach(
    function (field) {
      if (!entry[field]) {
        errors.push(label + ": missing " + field);
      }
    }
  );

  if (CHANGE_TYPES.indexOf(entry.change_type) === -1) {
    errors.push(label + ": invalid change_type " + entry.change_type);
  }
  if (CHANGE_QUEUE_STATUSES.indexOf(entry.status) === -1) {
    errors.push(label + ": invalid status " + entry.status);
  }
  if (entry.change_type === "NEW") {
    if (!entry.after || Object.keys(entry.after).length === 0) {
      errors.push(label + ": NEW change requires after snapshot");
    }
  } else if (!entry.before || Object.keys(entry.before).length === 0) {
    errors.push(label + ": non-NEW change requires before snapshot");
  }
  if (!entry.checked_at || !entry.checked_at.current_checked_at) {
    errors.push(label + ": checked_at.current_checked_at missing");
  }

  return errors;
}

function validateSupportServiceChangeQueue(queue) {
  const errors = [];

  if (!queue || queue.version !== "1.0") {
    errors.push("change queue version must be 1.0");
  }
  if (queue.category !== "SUPPORT_SERVICE") {
    errors.push("change queue category must be SUPPORT_SERVICE");
  }
  if (queue.AUTO_PUBLISH !== false || queue.auto_publish !== false) {
    errors.push("change queue AUTO_PUBLISH must be false");
  }
  if (!Array.isArray(queue.changes)) {
    errors.push("change queue changes must be an array");
    return errors;
  }
  if (queue.change_count !== queue.changes.length) {
    errors.push("change queue change_count mismatch");
  }

  const ids = new Set();
  queue.changes.forEach(function (entry, index) {
    errors.push.apply(errors, validateSupportServiceChangeEntry(entry, index));
    if (entry.change_id) {
      if (ids.has(entry.change_id)) {
        errors.push("duplicate change_id: " + entry.change_id);
      }
      ids.add(entry.change_id);
    }
  });

  return errors;
}

function validateSupportServiceChangeReviewItem(item, index) {
  return validateChangeReviewQueue({
    version: "1.0",
    category: "SUPPORT_SERVICE",
    queue_type: "CHANGE_REVIEW",
    AUTO_PUBLISH: false,
    auto_publish: false,
    item_count: 1,
    items: [item]
  }).map(function (message) {
    return message.replace("items[0]", "items[" + index + "]");
  });
}

function validateSupportServiceChangeReviewQueue(queue) {
  return validateChangeReviewQueue(queue);
}

function writeSupportServiceChangeQueue(queue, options) {
  options = options || {};
  const outputPath = options.outputPath || CHANGE_QUEUE_FILE;
  writeJson(outputPath, queue);
  return outputPath;
}

function loadSupportServiceChangeQueue(options) {
  options = options || {};
  return readJson(options.inputPath || CHANGE_QUEUE_FILE, {
    version: "1.0",
    category: "SUPPORT_SERVICE",
    AUTO_PUBLISH: AUTO_PUBLISH,
    auto_publish: AUTO_PUBLISH,
    change_count: 0,
    reviewable_change_count: 0,
    change_type_summary: {
      NEW: 0,
      UPDATED: 0,
      ENDED: 0,
      UNCHANGED: 0
    },
    changes: []
  });
}

function loadSupportServiceChangeReviewQueue(options) {
  return loadChangeReviewQueueFromModule(options);
}

module.exports = {
  AUTO_PUBLISH,
  CHANGE_QUEUE_FILE,
  CHANGE_REVIEW_QUEUE_FILE,
  CHANGE_REVIEW_DIR,
  CHANGE_QUEUE_STATUSES,
  CHANGE_REVIEW_STATUSES,
  REVIEWABLE_CHANGE_TYPES,
  buildSupportServiceChangeQueue,
  buildSupportServiceChangeReviewQueue,
  validateSupportServiceChangeEntry,
  validateSupportServiceChangeQueue,
  validateSupportServiceChangeReviewItem,
  validateSupportServiceChangeReviewQueue,
  writeSupportServiceChangeQueue,
  writeSupportServiceChangeReviewQueue,
  loadSupportServiceChangeQueue,
  loadSupportServiceChangeReviewQueue
};

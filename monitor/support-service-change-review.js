"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { AUTO_PUBLISH } = require("./support-service-discovery-engine");

const ROOT = path.join(__dirname, "..");
const CHANGE_REVIEW_DIR = path.join(ROOT, "data", "review", "support_service");
const CHANGE_REVIEW_QUEUE_FILE = path.join(
  CHANGE_REVIEW_DIR,
  "support_service_change_review_queue.json"
);
const REVIEW_LOG_FILE = path.join(CHANGE_REVIEW_DIR, "support_service_review_log.json");
const ALERT_QUEUE_FILE = path.join(CHANGE_REVIEW_DIR, "support_service_alert_queue.json");

const REVIEWABLE_CHANGE_TYPES = ["NEW", "UPDATED", "ENDED"];

const REVIEW_STATUSES = ["NEW", "REVIEWING", "APPROVED", "REJECTED", "APPLIED"];
const REVIEW_ACTIONS = ["START", "APPROVE", "REJECT", "APPLY"];
const ALERT_STATUSES = ["NEW", "RESOLVED"];
const APPLY_READY_STATUSES = ["APPROVED", "APPLIED"];

const REVIEW_TRANSITIONS = {
  NEW: {
    START: "REVIEWING",
    REJECT: "REJECTED"
  },
  REVIEWING: {
    APPROVE: "APPROVED",
    REJECT: "REJECTED"
  },
  APPROVED: {
    APPLY: "APPLIED"
  },
  REJECTED: {},
  APPLIED: {}
};

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

function normalizeReviewStatus(status) {
  if (status === "NEW_CHANGE") {
    return "NEW";
  }
  return status;
}

function buildReviewId(change) {
  return (
    "SSREV-" +
    crypto
      .createHash("sha256")
      .update([change.change_id, change.information_id || ""].join("|"))
      .digest("hex")
      .slice(0, 10)
      .toUpperCase()
  );
}

function buildAlertId(change) {
  return (
    "SSALT-" +
    crypto
      .createHash("sha256")
      .update([change.change_id, change.detected_at || ""].join("|"))
      .digest("hex")
      .slice(0, 10)
      .toUpperCase()
  );
}

function buildInformationLookup(informations) {
  const lookup = {};
  (informations || []).forEach(function (entry) {
    if (entry && entry.information_id) {
      lookup[entry.information_id] = entry;
    }
  });
  return lookup;
}

function resolveSourceId(change, informationLookup) {
  const information = informationLookup[change.information_id] || null;
  if (information && information.source_id) {
    return information.source_id;
  }
  return null;
}

function resolveMunicipality(change, informationLookup) {
  const information = informationLookup[change.information_id] || null;
  if (information && information.municipality) {
    return information.municipality;
  }
  return "UNKNOWN";
}

function changeToReviewItem(change, options) {
  options = options || {};
  const informationLookup = options.informationLookup || {};
  const reviewId = buildReviewId(change);

  return {
    review_id: reviewId,
    queue_id: reviewId,
    change_id: change.change_id,
    information_id: change.information_id,
    change_type: change.change_type,
    before: change.before || {},
    after: change.after || {},
    source_id: resolveSourceId(change, informationLookup),
    municipality: resolveMunicipality(change, informationLookup),
    detected_at: change.detected_at,
    status: "NEW",
    auto_publish: AUTO_PUBLISH,
    reviewer: "",
    reviewed_at: "",
    review_note: "",
    created_at: options.createdAt || new Date().toISOString()
  };
}

function buildChangeReviewQueue(changeQueue, options) {
  options = options || {};
  const informationLookup = Object.assign(
    {},
    buildInformationLookup(options.discoveredInformations),
    buildInformationLookup(options.currentInformations)
  );

  const reviewItems = (changeQueue.changes || [])
    .filter(function (change) {
      return REVIEWABLE_CHANGE_TYPES.indexOf(change.change_type) !== -1;
    })
    .map(function (change) {
      return changeToReviewItem(change, {
        informationLookup: informationLookup,
        createdAt: options.createdAt
      });
    });

  const statusSummary = REVIEW_STATUSES.reduce(function (acc, status) {
    acc[status] = 0;
    return acc;
  }, {});
  reviewItems.forEach(function (item) {
    const status = normalizeReviewStatus(item.status);
    statusSummary[status] = (statusSummary[status] || 0) + 1;
  });

  return {
    version: "1.0",
    category: "SUPPORT_SERVICE",
    queue_type: "CHANGE_REVIEW",
    generated_at: new Date().toISOString(),
    AUTO_PUBLISH: AUTO_PUBLISH,
    auto_publish: AUTO_PUBLISH,
    item_count: reviewItems.length,
    status_summary: statusSummary,
    source_change_queue_file:
      options.changeQueueFile ||
      "data/support_service_discovery/support_service_change_queue.json",
    items: reviewItems
  };
}

function buildChangeReviewDisplayData(reviewItem) {
  const after = reviewItem.after || {};
  const before = reviewItem.before || {};

  return {
    review_id: reviewItem.review_id || reviewItem.queue_id,
    title: after.title || before.title || "UNKNOWN",
    facility_name: after.facility_name || before.facility_name || "UNKNOWN",
    municipality: reviewItem.municipality || "UNKNOWN",
    change_type: reviewItem.change_type,
    before: reviewItem.before || {},
    after: reviewItem.after || {},
    source_id: reviewItem.source_id || null,
    detected_at: reviewItem.detected_at
  };
}

function buildChangeReviewDisplayBatch(reviewQueue) {
  return (reviewQueue.items || []).map(buildChangeReviewDisplayData);
}

function buildAlertFromChange(change, options) {
  options = options || {};
  return {
    alert_id: buildAlertId(change),
    change_id: change.change_id,
    change_type: change.change_type,
    created_at: options.createdAt || change.detected_at || new Date().toISOString(),
    status: "NEW"
  };
}

function buildSupportServiceAlertQueue(changeQueue, options) {
  options = options || {};
  const alerts = (changeQueue.changes || [])
    .filter(function (change) {
      return REVIEWABLE_CHANGE_TYPES.indexOf(change.change_type) !== -1;
    })
    .map(function (change) {
      return buildAlertFromChange(change, options);
    });

  const statusSummary = ALERT_STATUSES.reduce(function (acc, status) {
    acc[status] = 0;
    return acc;
  }, {});
  alerts.forEach(function (alert) {
    statusSummary[alert.status] = (statusSummary[alert.status] || 0) + 1;
  });

  return {
    version: "1.0",
    category: "SUPPORT_SERVICE",
    generated_at: new Date().toISOString(),
    AUTO_PUBLISH: AUTO_PUBLISH,
    auto_publish: AUTO_PUBLISH,
    alert_count: alerts.length,
    status_summary: statusSummary,
    source_change_queue_file:
      options.changeQueueFile ||
      "data/support_service_discovery/support_service_change_queue.json",
    alerts: alerts
  };
}

function buildReviewLogEntry(reviewId, action, options) {
  options = options || {};
  return {
    review_id: reviewId,
    action: action,
    reviewer: options.reviewer || "",
    timestamp: options.timestamp || new Date().toISOString()
  };
}

function transitionReviewStatus(reviewItem, action, options) {
  options = options || {};
  const currentStatus = normalizeReviewStatus(reviewItem.status);
  const allowed = REVIEW_TRANSITIONS[currentStatus] || {};
  const nextStatus = allowed[action];

  if (!nextStatus) {
    return {
      item: reviewItem,
      logEntry: null,
      error: "invalid transition from " + currentStatus + " via " + action
    };
  }

  const timestamp = options.timestamp || new Date().toISOString();
  const updatedItem = Object.assign({}, reviewItem, {
    status: nextStatus,
    reviewer: options.reviewer || reviewItem.reviewer || "",
    reviewed_at:
      action === "APPROVE" || action === "REJECT" || action === "APPLY"
        ? timestamp
        : reviewItem.reviewed_at || "",
    review_note: options.reviewNote || reviewItem.review_note || ""
  });

  return {
    item: updatedItem,
    logEntry: buildReviewLogEntry(updatedItem.review_id || updatedItem.queue_id, action, options),
    error: null
  };
}

function isApplyReadyReviewItem(reviewItem) {
  return APPLY_READY_STATUSES.indexOf(normalizeReviewStatus(reviewItem.status)) !== -1;
}

function syncChangeReviewWorkflow(changeQueue, options) {
  options = options || {};
  const reviewQueue = buildChangeReviewQueue(changeQueue, options);
  const alertQueue = buildSupportServiceAlertQueue(changeQueue, options);
  const displayItems = buildChangeReviewDisplayBatch(reviewQueue);

  return {
    reviewQueue: reviewQueue,
    alertQueue: alertQueue,
    displayItems: displayItems
  };
}

function validateReviewItem(item, index) {
  const label = "items[" + index + "]";
  const errors = [];

  if (!item || typeof item !== "object") {
    errors.push(label + ": entry missing");
    return errors;
  }

  [
    "review_id",
    "change_id",
    "information_id",
    "change_type",
    "after",
    "detected_at",
    "status"
  ].forEach(function (field) {
    if (!item[field]) {
      errors.push(label + ": missing " + field);
    }
  });

  if (REVIEWABLE_CHANGE_TYPES.indexOf(item.change_type) === -1) {
    errors.push(label + ": invalid reviewable change_type " + item.change_type);
  }
  if (REVIEW_STATUSES.indexOf(normalizeReviewStatus(item.status)) === -1) {
    errors.push(label + ": invalid status " + item.status);
  }
  if (item.auto_publish !== false) {
    errors.push(label + ": auto_publish must be false");
  }
  if (item.change_type !== "NEW" && (!item.before || Object.keys(item.before).length === 0)) {
    errors.push(label + ": non-NEW review requires before snapshot");
  }

  return errors;
}

function validateChangeReviewQueue(queue) {
  const errors = [];

  if (!queue || queue.version !== "1.0") {
    errors.push("change review queue version must be 1.0");
  }
  if (queue.category !== "SUPPORT_SERVICE") {
    errors.push("change review queue category must be SUPPORT_SERVICE");
  }
  if (queue.queue_type !== "CHANGE_REVIEW") {
    errors.push("change review queue queue_type must be CHANGE_REVIEW");
  }
  if (queue.AUTO_PUBLISH !== false || queue.auto_publish !== false) {
    errors.push("change review queue AUTO_PUBLISH must be false");
  }
  if (!Array.isArray(queue.items)) {
    errors.push("change review queue items must be an array");
    return errors;
  }
  if (queue.item_count !== queue.items.length) {
    errors.push("change review queue item_count mismatch");
  }

  const ids = new Set();
  queue.items.forEach(function (item, index) {
    errors.push.apply(errors, validateReviewItem(item, index));
    const reviewId = item.review_id || item.queue_id;
    if (reviewId) {
      if (ids.has(reviewId)) {
        errors.push("duplicate review_id: " + reviewId);
      }
      ids.add(reviewId);
    }
  });

  return errors;
}

function validateReviewLogEntry(entry, index) {
  const label = "entries[" + index + "]";
  const errors = [];

  if (!entry || typeof entry !== "object") {
    errors.push(label + ": entry missing");
    return errors;
  }

  if (!entry.review_id) {
    errors.push(label + ": missing review_id");
  }
  if (REVIEW_ACTIONS.indexOf(entry.action) === -1) {
    errors.push(label + ": invalid action " + entry.action);
  }
  if (!entry.timestamp) {
    errors.push(label + ": missing timestamp");
  }

  return errors;
}

function validateReviewLog(log) {
  const errors = [];

  if (!log || log.version !== "1.0") {
    errors.push("review log version must be 1.0");
  }
  if (!Array.isArray(log.entries)) {
    errors.push("review log entries must be an array");
    return errors;
  }

  log.entries.forEach(function (entry, index) {
    errors.push.apply(errors, validateReviewLogEntry(entry, index));
  });

  return errors;
}

function validateAlertEntry(alert, index) {
  const label = "alerts[" + index + "]";
  const errors = [];

  if (!alert || typeof alert !== "object") {
    errors.push(label + ": entry missing");
    return errors;
  }

  ["alert_id", "change_id", "change_type", "created_at", "status"].forEach(function (field) {
    if (!alert[field]) {
      errors.push(label + ": missing " + field);
    }
  });

  if (ALERT_STATUSES.indexOf(alert.status) === -1) {
    errors.push(label + ": invalid status " + alert.status);
  }

  return errors;
}

function validateAlertQueue(queue) {
  const errors = [];

  if (!queue || queue.version !== "1.0") {
    errors.push("alert queue version must be 1.0");
  }
  if (queue.AUTO_PUBLISH !== false || queue.auto_publish !== false) {
    errors.push("alert queue AUTO_PUBLISH must be false");
  }
  if (!Array.isArray(queue.alerts)) {
    errors.push("alert queue alerts must be an array");
    return errors;
  }
  if (queue.alert_count !== queue.alerts.length) {
    errors.push("alert queue alert_count mismatch");
  }

  queue.alerts.forEach(function (alert, index) {
    errors.push.apply(errors, validateAlertEntry(alert, index));
  });

  return errors;
}

function loadSupportServiceReviewLog(options) {
  options = options || {};
  return readJson(options.inputPath || REVIEW_LOG_FILE, {
    version: "1.0",
    description: "SUPPORT_SERVICE change review action log",
    entries: []
  });
}

function loadSupportServiceAlertQueue(options) {
  options = options || {};
  return readJson(options.inputPath || ALERT_QUEUE_FILE, {
    version: "1.0",
    category: "SUPPORT_SERVICE",
    AUTO_PUBLISH: false,
    auto_publish: false,
    alert_count: 0,
    status_summary: {
      NEW: 0,
      RESOLVED: 0
    },
    alerts: []
  });
}

function appendReviewLogEntries(entries, options) {
  options = options || {};
  const log = loadSupportServiceReviewLog(options);
  const nextEntries = (log.entries || []).concat(entries || []);
  const nextLog = Object.assign({}, log, { entries: nextEntries });
  const outputPath = options.outputPath || REVIEW_LOG_FILE;
  writeJson(outputPath, nextLog);
  return outputPath;
}

function writeSupportServiceReviewLog(log, options) {
  options = options || {};
  const outputPath = options.outputPath || REVIEW_LOG_FILE;
  writeJson(outputPath, log);
  return outputPath;
}

function writeSupportServiceAlertQueue(queue, options) {
  options = options || {};
  const outputPath = options.outputPath || ALERT_QUEUE_FILE;
  writeJson(outputPath, queue);
  return outputPath;
}

function writeSupportServiceChangeReviewQueue(queue, options) {
  options = options || {};
  const outputPath = options.outputPath || CHANGE_REVIEW_QUEUE_FILE;
  writeJson(outputPath, queue);
  return outputPath;
}

function loadSupportServiceChangeReviewQueue(options) {
  options = options || {};
  return readJson(options.inputPath || CHANGE_REVIEW_QUEUE_FILE, {
    version: "1.0",
    category: "SUPPORT_SERVICE",
    queue_type: "CHANGE_REVIEW",
    AUTO_PUBLISH: AUTO_PUBLISH,
    auto_publish: AUTO_PUBLISH,
    item_count: 0,
    status_summary: {
      NEW: 0,
      REVIEWING: 0,
      APPROVED: 0,
      REJECTED: 0,
      APPLIED: 0
    },
    items: []
  });
}

module.exports = {
  REVIEW_LOG_FILE,
  ALERT_QUEUE_FILE,
  REVIEW_STATUSES,
  REVIEW_ACTIONS,
  ALERT_STATUSES,
  APPLY_READY_STATUSES,
  REVIEW_TRANSITIONS,
  normalizeReviewStatus,
  buildReviewId,
  buildAlertId,
  changeToReviewItem,
  buildChangeReviewQueue,
  buildChangeReviewDisplayData,
  buildChangeReviewDisplayBatch,
  buildAlertFromChange,
  buildSupportServiceAlertQueue,
  buildReviewLogEntry,
  transitionReviewStatus,
  isApplyReadyReviewItem,
  syncChangeReviewWorkflow,
  validateReviewItem,
  validateChangeReviewQueue,
  validateReviewLogEntry,
  validateReviewLog,
  validateAlertEntry,
  validateAlertQueue,
  loadSupportServiceReviewLog,
  loadSupportServiceAlertQueue,
  appendReviewLogEntries,
  writeSupportServiceReviewLog,
  writeSupportServiceAlertQueue,
  writeSupportServiceChangeReviewQueue,
  loadSupportServiceChangeReviewQueue
};

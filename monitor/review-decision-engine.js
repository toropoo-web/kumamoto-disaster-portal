"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const REVIEW_QUEUE_DIR = path.join(ROOT, "data", "review_queue");
const MASTER_QUEUE_FILE = path.join(REVIEW_QUEUE_DIR, "patrol_review_queue.json");
const DECISION_LOG_FILE = path.join(REVIEW_QUEUE_DIR, "patrol_review_decision_log.json");

const { REVIEW_STATUSES, validateQueueBatch, buildQueueBatch, createDefaultDecision } = require("./review-queue");

const DECISION_STATUSES = REVIEW_STATUSES.slice();

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

function validateDecisionShape(decision) {
  const errors = [];
  const required = ["status", "reviewer", "reviewed_at", "review_note"];

  if (!decision || typeof decision !== "object") {
    errors.push("decision object missing");
    return errors;
  }

  required.forEach(function (key) {
    if (!Object.prototype.hasOwnProperty.call(decision, key)) {
      errors.push("missing decision field: " + key);
    }
  });

  if (decision.status && DECISION_STATUSES.indexOf(decision.status) < 0) {
    errors.push("invalid decision.status: " + decision.status);
  }

  if (decision.status === "APPROVED" || decision.status === "REJECTED") {
    if (!decision.reviewer) {
      errors.push("reviewer is required for " + decision.status);
    }
    if (!decision.reviewed_at) {
      errors.push("reviewed_at is required for " + decision.status);
    }
  }

  return errors;
}

function syncQueueItemStatus(item) {
  const next = Object.assign({}, item);
  if (!next.decision) {
    next.decision = createDefaultDecision(next.status || "PENDING");
  }

  if (!next.status) {
    next.status = next.decision.status || "PENDING";
  }

  if (!next.decision.status) {
    next.decision.status = next.status;
  }

  if (next.decision.status !== next.status) {
    next.status = next.decision.status;
  }

  return next;
}

function normalizeQueueItemWithDecision(item) {
  const next = syncQueueItemStatus(Object.assign({}, item));
  if (!next.decision) {
    next.decision = createDefaultDecision(next.status || "PENDING");
  }
  next.decision = {
    status: next.decision.status || next.status || "PENDING",
    reviewer: next.decision.reviewer || "",
    reviewed_at: next.decision.reviewed_at || "",
    review_note: next.decision.review_note || ""
  };
  next.status = next.decision.status;
  next.review_required = next.status === "PENDING";
  next.auto_publish = false;
  return next;
}

function summarizeDecisionCounts(items) {
  const summary = {
    PENDING: 0,
    APPROVED: 0,
    REJECTED: 0
  };
  (items || []).forEach(function (item) {
    const status = (item.decision && item.decision.status) || item.status || "PENDING";
    summary[status] = (summary[status] || 0) + 1;
  });
  return summary;
}

function buildDecisionLogEntry(queueItem, previousDecision, input) {
  return {
    logged_at: new Date().toISOString(),
    queue_id: queueItem.queue_id,
    municipality: queueItem.municipality,
    category: queueItem.category,
    source_id: queueItem.source_id,
    previous_status: previousDecision ? previousDecision.status : null,
    new_status: queueItem.decision.status,
    reviewer: queueItem.decision.reviewer,
    reviewed_at: queueItem.decision.reviewed_at,
    review_note: queueItem.decision.review_note,
    source_trace: queueItem.source_trace || null,
    input: {
      status: input.status,
      reviewer: input.reviewer || "",
      review_note: input.review_note || ""
    }
  };
}

function appendDecisionLog(entry) {
  ensureDir(REVIEW_QUEUE_DIR);
  const existing = readJson(DECISION_LOG_FILE, { version: 1, entries: [] });
  existing.entries = existing.entries || [];
  existing.entries.push(entry);
  existing.lastUpdatedAt = new Date().toISOString();
  fs.writeFileSync(DECISION_LOG_FILE, JSON.stringify(existing, null, 2) + "\n", "utf8");
  return DECISION_LOG_FILE;
}

function applyReviewDecision(item, input) {
  if (!item) {
    throw new Error("queue item missing");
  }

  const status = input && input.status;
  if (DECISION_STATUSES.indexOf(status) < 0) {
    throw new Error("invalid decision status: " + status);
  }

  if ((status === "APPROVED" || status === "REJECTED") && !(input.reviewer && String(input.reviewer).trim())) {
    throw new Error("reviewer is required for " + status);
  }

  const previousDecision = item.decision ? Object.assign({}, item.decision) : createDefaultDecision(item.status);
  const reviewedAt =
    status === "PENDING"
      ? ""
      : input.reviewed_at || new Date().toISOString();

  const next = normalizeQueueItemWithDecision(item);
  next.decision = {
    status: status,
    reviewer: status === "PENDING" ? "" : String(input.reviewer).trim(),
    reviewed_at: reviewedAt,
    review_note: input.review_note ? String(input.review_note) : ""
  };
  next.status = status;
  next.review_required = status === "PENDING";
  next.auto_publish = false;

  return {
    item: next,
    logEntry: buildDecisionLogEntry(next, previousDecision, input)
  };
}

function findQueueItemIndex(items, queueId) {
  return (items || []).findIndex(function (item) {
    return item.queue_id === queueId;
  });
}

function listQueueItemsByStatus(items, status) {
  return (items || []).filter(function (item) {
    const currentStatus = (item.decision && item.decision.status) || item.status || "PENDING";
    return currentStatus === status;
  });
}

function migrateReviewQueueDecisions(options) {
  options = options || {};
  const queuePath = options.queuePath || MASTER_QUEUE_FILE;
  if (!fs.existsSync(queuePath)) {
    return { saved: false, reason: "review queue not found" };
  }

  const queue = readJson(queuePath, { items: [] });
  const beforeCounts = summarizeDecisionCounts(queue.items || []);
  const migratedItems = (queue.items || []).map(normalizeQueueItemWithDecision);
  const afterCounts = summarizeDecisionCounts(migratedItems);

  const nextBatch = buildQueueBatch(migratedItems, {
    incidentScope: queue.incidentScope,
    sourceClassificationFile: queue.sourceClassificationFile
  });
  nextBatch.decisionSummary = afterCounts;
  nextBatch.generatedAt = new Date().toISOString();

  const errors = validateQueueBatch(nextBatch);
  if (errors.length) {
    return { saved: false, queuePath: queuePath, errors: errors };
  }

  if (!options.dryRun) {
    ensureDir(REVIEW_QUEUE_DIR);
    fs.writeFileSync(queuePath, JSON.stringify(nextBatch, null, 2) + "\n", "utf8");
  }

  return {
    saved: !options.dryRun,
    dryRun: options.dryRun === true,
    queuePath: queuePath,
    itemCount: migratedItems.length,
    migratedCount: migratedItems.filter(function (item, index) {
      const original = (queue.items || [])[index];
      return !original || !original.decision;
    }).length,
    beforeCounts: beforeCounts,
    afterCounts: afterCounts,
    errors: []
  };
}

function setReviewDecision(options) {
  options = options || {};
  const queuePath = options.queuePath || MASTER_QUEUE_FILE;
  const queueId = options.queueId;

  if (!queueId) {
    return { saved: false, reason: "queue_id is required" };
  }
  if (!fs.existsSync(queuePath)) {
    return { saved: false, reason: "review queue not found" };
  }

  const queue = readJson(queuePath, { items: [] });
  const items = (queue.items || []).map(normalizeQueueItemWithDecision);
  const index = findQueueItemIndex(items, queueId);
  if (index < 0) {
    return { saved: false, reason: "queue item not found: " + queueId };
  }

  let applied;
  try {
    applied = applyReviewDecision(items[index], {
      status: options.status,
      reviewer: options.reviewer,
      review_note: options.reviewNote,
      reviewed_at: options.reviewedAt
    });
  } catch (err) {
    return { saved: false, reason: err.message };
  }

  items[index] = applied.item;
  const nextBatch = buildQueueBatch(items, {
    incidentScope: queue.incidentScope,
    sourceClassificationFile: queue.sourceClassificationFile
  });
  nextBatch.decisionSummary = summarizeDecisionCounts(items);

  const errors = validateQueueBatch(nextBatch);
  if (errors.length) {
    return { saved: false, queuePath: queuePath, errors: errors };
  }

  if (!options.dryRun) {
    fs.writeFileSync(queuePath, JSON.stringify(nextBatch, null, 2) + "\n", "utf8");
    appendDecisionLog(applied.logEntry);
  }

  return {
    saved: !options.dryRun,
    dryRun: options.dryRun === true,
    queuePath: queuePath,
    queueId: queueId,
    status: applied.item.decision.status,
    reviewer: applied.item.decision.reviewer,
    reviewed_at: applied.item.decision.reviewed_at,
    review_note: applied.item.decision.review_note,
    decisionSummary: nextBatch.decisionSummary,
    logEntry: applied.logEntry,
    errors: []
  };
}

function listReviewDecisions(options) {
  options = options || {};
  const queuePath = options.queuePath || MASTER_QUEUE_FILE;
  if (!fs.existsSync(queuePath)) {
    return { items: [], reason: "review queue not found" };
  }

  const queue = readJson(queuePath, { items: [] });
  const items = (queue.items || []).map(normalizeQueueItemWithDecision);
  const status = options.status || null;

  return {
    queuePath: queuePath,
    itemCount: items.length,
    decisionSummary: summarizeDecisionCounts(items),
    items: status ? listQueueItemsByStatus(items, status) : items
  };
}

module.exports = {
  DECISION_STATUSES,
  MASTER_QUEUE_FILE,
  DECISION_LOG_FILE,
  createDefaultDecision,
  validateDecisionShape,
  normalizeQueueItemWithDecision,
  applyReviewDecision,
  migrateReviewQueueDecisions,
  setReviewDecision,
  listReviewDecisions,
  listQueueItemsByStatus,
  summarizeDecisionCounts,
  appendDecisionLog
};

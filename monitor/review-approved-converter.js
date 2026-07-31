"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const REVIEW_QUEUE_FILE = path.join(ROOT, "data", "review_queue", "patrol_review_queue.json");
const OUTPUT_DIR = path.join(ROOT, "data", "public_update_queue");
const MASTER_OUTPUT_FILE = path.join(OUTPUT_DIR, "patrol_public_update_queue.json");

const { DISASTER_CATEGORIES } = require("./diff-classification");

const CATEGORY_TARGET_LAYERS = {
  WATER: "water_search_index",
  SHELTER: "shelter_search_index",
  COMMUNICATION: "communication_status",
  VOLUNTEER: "volunteer_search_index",
  ROAD: "road_information",
  SUPPORT: "support_information"
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

function copyKeywords(keywords) {
  return Array.isArray(keywords) ? keywords.slice() : [];
}

function buildUpdateId(queueItem) {
  const queueId = queueItem.queue_id || "";
  if (queueId.indexOf("RQ-") === 0) {
    return queueId.replace(/^RQ-/, "UPD-");
  }
  const stamp = (queueItem.detected_at || new Date().toISOString())
    .slice(0, 10)
    .replace(/-/g, "");
  const source = String(queueItem.source_id || "SRC")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase();
  return "UPD-" + stamp + "-" + source + "-" + queueItem.category;
}

function buildSourceTrace(queueItem) {
  const trace = queueItem.source_trace || {};
  return {
    queue_id: queueItem.queue_id || null,
    classification_id: trace.classification_id || null,
    change_log: trace.source_change_log || null,
    classification_file: trace.classification_file || null,
    diff_type: trace.diff_type || queueItem.diff_type || null,
    before_hash: queueItem.before_hash || null,
    after_hash: queueItem.after_hash || null,
    changed_text: queueItem.changed_text || "",
    detected_at: queueItem.detected_at || null
  };
}

function isApprovedQueueItem(item) {
  if (!item) {
    return false;
  }
  const decisionStatus = item.decision && item.decision.status;
  if (decisionStatus) {
    return decisionStatus === "APPROVED" && item.status === "APPROVED";
  }
  return item.status === "APPROVED";
}

function queueItemToPublicCandidate(queueItem, options) {
  options = options || {};
  const targetLayer = CATEGORY_TARGET_LAYERS[queueItem.category];
  if (!targetLayer) {
    return null;
  }

  return {
    update_id: buildUpdateId(queueItem),
    municipality: queueItem.municipality,
    category: queueItem.category,
    title: queueItem.title,
    source_url: queueItem.source_url,
    source_id: queueItem.source_id,
    area_id: queueItem.area_id || null,
    detected_keywords: copyKeywords(queueItem.detected_keywords),
    target_layer: targetLayer,
    status: "READY",
    created_at: options.createdAt || new Date().toISOString(),
    auto_publish: false,
    source_trace: buildSourceTrace(queueItem)
  };
}

function convertApprovedQueueItems(items, options) {
  options = options || {};
  const converted = [];

  (items || []).forEach(function (item) {
    if (!isApprovedQueueItem(item)) {
      return;
    }
    const candidate = queueItemToPublicCandidate(item, options);
    if (candidate) {
      converted.push(candidate);
    }
  });

  return converted;
}

function buildDuplicateKey(candidate) {
  return [
    candidate.source_trace && candidate.source_trace.queue_id,
    candidate.update_id,
    candidate.source_id,
    candidate.category,
    candidate.source_trace && candidate.source_trace.after_hash
  ].join("|");
}

function summarizeByCategory(items) {
  const summary = {};
  DISASTER_CATEGORIES.forEach(function (category) {
    summary[category] = 0;
  });
  items.forEach(function (item) {
    summary[item.category] = (summary[item.category] || 0) + 1;
  });
  return summary;
}

function validatePublicCandidate(candidate) {
  const errors = [];
  const required = [
    "update_id",
    "municipality",
    "category",
    "title",
    "source_url",
    "source_id",
    "detected_keywords",
    "target_layer",
    "status",
    "created_at",
    "source_trace"
  ];

  required.forEach(function (key) {
    if (!Object.prototype.hasOwnProperty.call(candidate, key)) {
      errors.push("missing field: " + key);
    }
  });

  if (DISASTER_CATEGORIES.indexOf(candidate.category) < 0) {
    errors.push("invalid category: " + candidate.category);
  }

  if (CATEGORY_TARGET_LAYERS[candidate.category] !== candidate.target_layer) {
    errors.push(
      "target_layer mismatch: expected " +
        CATEGORY_TARGET_LAYERS[candidate.category] +
        ", got " +
        candidate.target_layer
    );
  }

  if (candidate.status !== "READY") {
    errors.push("status must be READY");
  }

  if (candidate.auto_publish !== false) {
    errors.push("auto_publish must be false");
  }

  if (!Array.isArray(candidate.detected_keywords) || !candidate.detected_keywords.length) {
    errors.push("detected_keywords must be a non-empty array");
  }

  if (!candidate.source_trace || !candidate.source_trace.queue_id) {
    errors.push("source_trace.queue_id is required");
  }

  if (!candidate.source_trace || !candidate.source_trace.classification_id) {
    errors.push("source_trace.classification_id is required");
  }

  return errors;
}

function validatePublicCandidateBatch(batch) {
  const errors = [];

  if (!batch || !Array.isArray(batch.updates)) {
    errors.push("updates array missing");
    return errors;
  }

  if (batch.autoPublish !== false) {
    errors.push("autoPublish must be false");
  }

  const seenUpdateIds = new Set();
  const seenDuplicateKeys = new Set();

  batch.updates.forEach(function (item, index) {
    const itemErrors = validatePublicCandidate(item);
    itemErrors.forEach(function (message) {
      errors.push("updates[" + index + "]: " + message);
    });

    if (seenUpdateIds.has(item.update_id)) {
      errors.push("updates[" + index + "]: duplicate update_id " + item.update_id);
    }
    seenUpdateIds.add(item.update_id);

    const duplicateKey = buildDuplicateKey(item);
    if (seenDuplicateKeys.has(duplicateKey)) {
      errors.push("updates[" + index + "]: duplicate trace key " + duplicateKey);
    }
    seenDuplicateKeys.add(duplicateKey);
  });

  return errors;
}

function mergePublicCandidates(existingItems, incomingItems) {
  const merged = Array.isArray(existingItems) ? existingItems.slice() : [];
  const indexByQueueId = new Map();
  const indexByDuplicateKey = new Map();

  merged.forEach(function (item, index) {
    const queueId = item.source_trace && item.source_trace.queue_id;
    if (queueId) {
      indexByQueueId.set(queueId, index);
    }
    indexByDuplicateKey.set(buildDuplicateKey(item), index);
  });

  const added = [];
  const duplicates = [];

  incomingItems.forEach(function (item) {
    const queueId = item.source_trace && item.source_trace.queue_id;
    const duplicateKey = buildDuplicateKey(item);

    if (queueId && indexByQueueId.has(queueId)) {
      duplicates.push({
        update_id: item.update_id,
        reason: "queue_id",
        existing_update_id: merged[indexByQueueId.get(queueId)].update_id
      });
      return;
    }

    if (indexByDuplicateKey.has(duplicateKey)) {
      duplicates.push({
        update_id: item.update_id,
        reason: "trace_key",
        existing_update_id: merged[indexByDuplicateKey.get(duplicateKey)].update_id
      });
      return;
    }

    merged.push(item);
    added.push(item);
    if (queueId) {
      indexByQueueId.set(queueId, merged.length - 1);
    }
    indexByDuplicateKey.set(duplicateKey, merged.length - 1);
  });

  return {
    items: merged,
    added: added,
    duplicates: duplicates
  };
}

function buildPublicCandidateBatch(items, options) {
  options = options || {};
  return {
    version: 1,
    generatedAt: options.generatedAt || new Date().toISOString(),
    incidentScope: options.incidentScope || "2026_KUMAMOTO_EARTHQUAKE",
    updateCount: items.length,
    readyCount: items.filter(function (item) {
      return item.status === "READY";
    }).length,
    categorySummary: summarizeByCategory(items),
    autoPublish: false,
    sourceReviewQueueFile: options.sourceReviewQueueFile || null,
    updates: items
  };
}

function writePublicCandidateBatch(batch, options) {
  options = options || {};
  ensureDir(OUTPUT_DIR);

  const errors = validatePublicCandidateBatch(batch);
  if (errors.length) {
    return { saved: false, errors: errors, batch: batch };
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputPath = path.join(
    OUTPUT_DIR,
    options.fileName || "approved-updates-" + stamp + ".json"
  );

  fs.writeFileSync(outputPath, JSON.stringify(batch, null, 2) + "\n", "utf8");
  return {
    saved: true,
    outputPath: outputPath,
    batch: batch,
    errors: []
  };
}

function convertApprovedUpdates(options) {
  options = options || {};
  const reviewQueuePath = options.reviewQueuePath || REVIEW_QUEUE_FILE;

  if (!fs.existsSync(reviewQueuePath)) {
    return { saved: false, reason: "review queue not found", updates: [] };
  }

  const reviewQueue = readJson(reviewQueuePath, { items: [] });
  const items = reviewQueue.items || [];
  const approvedItems = items.filter(isApprovedQueueItem);
  const pendingCount = items.filter(function (item) {
    return item.status === "PENDING";
  }).length;
  const rejectedCount = items.filter(function (item) {
    return item.status === "REJECTED";
  }).length;

  const incomingUpdates = convertApprovedQueueItems(approvedItems, {
    createdAt: options.createdAt
  });

  const existingMaster = readJson(MASTER_OUTPUT_FILE, { updates: [] });
  const mergeResult = mergePublicCandidates(existingMaster.updates, incomingUpdates);
  const masterBatch = buildPublicCandidateBatch(mergeResult.items, {
    incidentScope: reviewQueue.incidentScope,
    sourceReviewQueueFile: path.relative(ROOT, reviewQueuePath).split(path.sep).join("/")
  });

  const masterErrors = validatePublicCandidateBatch(masterBatch);
  if (masterErrors.length) {
    return {
      saved: false,
      reviewQueuePath: reviewQueuePath,
      errors: masterErrors,
      updates: []
    };
  }

  if (!options.dryRun) {
    ensureDir(OUTPUT_DIR);
    fs.writeFileSync(MASTER_OUTPUT_FILE, JSON.stringify(masterBatch, null, 2) + "\n", "utf8");

    const runBatch = buildPublicCandidateBatch(mergeResult.added, {
      incidentScope: reviewQueue.incidentScope,
      sourceReviewQueueFile: path.relative(ROOT, reviewQueuePath).split(path.sep).join("/")
    });
    const runWrite = writePublicCandidateBatch(runBatch, {
      fileName: options.fileName
    });

    return {
      saved: true,
      dryRun: false,
      reviewQueuePath: reviewQueuePath,
      masterOutputPath: MASTER_OUTPUT_FILE,
      runOutputPath: runWrite.outputPath,
      reviewQueueCount: items.length,
      approvedCount: approvedItems.length,
      pendingCount: pendingCount,
      rejectedCount: rejectedCount,
      convertedCount: incomingUpdates.length,
      addedCount: mergeResult.added.length,
      duplicateCount: mergeResult.duplicates.length,
      updateCount: masterBatch.updateCount,
      categorySummary: masterBatch.categorySummary,
      duplicates: mergeResult.duplicates,
      errors: []
    };
  }

  return {
    saved: false,
    dryRun: true,
    reviewQueuePath: reviewQueuePath,
    reviewQueueCount: items.length,
    approvedCount: approvedItems.length,
    pendingCount: pendingCount,
    rejectedCount: rejectedCount,
    convertedCount: incomingUpdates.length,
    addedCount: mergeResult.added.length,
    duplicateCount: mergeResult.duplicates.length,
    updateCount: mergeResult.items.length,
    categorySummary: summarizeByCategory(mergeResult.added),
    duplicates: mergeResult.duplicates,
    errors: []
  };
}

module.exports = {
  DISASTER_CATEGORIES,
  CATEGORY_TARGET_LAYERS,
  REVIEW_QUEUE_FILE,
  OUTPUT_DIR,
  MASTER_OUTPUT_FILE,
  isApprovedQueueItem,
  buildUpdateId,
  buildSourceTrace,
  queueItemToPublicCandidate,
  convertApprovedQueueItems,
  buildDuplicateKey,
  validatePublicCandidate,
  validatePublicCandidateBatch,
  mergePublicCandidates,
  buildPublicCandidateBatch,
  writePublicCandidateBatch,
  convertApprovedUpdates
};

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const CLASSIFIED_DIR = path.join(ROOT, "data", "update_candidates");
const REVIEW_QUEUE_DIR = path.join(ROOT, "data", "review_queue");
const MASTER_QUEUE_FILE = path.join(REVIEW_QUEUE_DIR, "patrol_review_queue.json");

const { DISASTER_CATEGORIES } = require("./diff-classification");

const REVIEW_STATUSES = ["PENDING", "APPROVED", "REJECTED"];

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function toRepoRelative(filePath) {
  if (!filePath) {
    return null;
  }
  return path.relative(ROOT, filePath).split(path.sep).join("/");
}

function normalizeRepoPath(value) {
  if (!value) {
    return null;
  }
  const absolute = path.isAbsolute(value) ? value : path.join(ROOT, value);
  return toRepoRelative(absolute);
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function listClassifiedFiles() {
  if (!fs.existsSync(CLASSIFIED_DIR)) {
    return [];
  }
  return fs
    .readdirSync(CLASSIFIED_DIR)
    .filter(function (name) {
      return /^classified-.*\.json$/.test(name);
    })
    .map(function (name) {
      return path.join(CLASSIFIED_DIR, name);
    })
    .sort();
}

function resolveClassifiedPath(options) {
  if (options && options.classifiedPath) {
    return options.classifiedPath;
  }
  const files = listClassifiedFiles();
  if (!files.length) {
    return null;
  }
  return files[files.length - 1];
}

function buildQueueId(classification) {
  const classificationId = classification.id || "";
  if (classificationId.indexOf("CLS-") === 0) {
    return classificationId.replace(/^CLS-/, "RQ-");
  }
  const stamp = (classification.detected_at || new Date().toISOString())
    .slice(0, 10)
    .replace(/-/g, "");
  const source = String(classification.source_id || "SRC")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase();
  return "RQ-" + stamp + "-" + source + "-" + classification.category;
}

function copyKeywords(keywords) {
  return Array.isArray(keywords) ? keywords.slice() : [];
}

function createDefaultDecision(status) {
  return {
    status: status || "PENDING",
    reviewer: "",
    reviewed_at: "",
    review_note: ""
  };
}

function classificationToQueueItem(classification, options) {
  options = options || {};
  const sourcePage = classification.source_page || {};
  const before = sourcePage.before || {};
  const after = sourcePage.after || {};

  return {
    queue_id: buildQueueId(classification),
    municipality: classification.municipality,
    category: classification.category,
    title: classification.title,
    source_url: classification.source_url,
    detected_keywords: copyKeywords(classification.detected_keywords),
    status: "PENDING",
    created_at: options.createdAt || new Date().toISOString(),
    review_required: true,
    source_id: classification.source_id,
    area_id: classification.area_id || null,
    original_url: classification.source_url,
    before_hash: before.contentHash || null,
    after_hash: after.contentHash || null,
    changed_text: sourcePage.changed_text || "",
    detected_at: classification.detected_at,
    diff_type: classification.diff_type || sourcePage.diff_type || null,
    confidence: classification.confidence || "HIGH",
    auto_publish: false,
    decision: createDefaultDecision("PENDING"),
    source_trace: {
      classification_id: classification.id || null,
      classification_file: options.classificationFile
        ? toRepoRelative(options.classificationFile)
        : null,
      source_change_log: normalizeRepoPath(options.sourceChangeLog),
      diff_type: classification.diff_type || sourcePage.diff_type || null
    }
  };
}

function buildDuplicateKey(item) {
  return [
    item.source_trace && item.source_trace.classification_id,
    item.source_id,
    item.category,
    item.after_hash,
    item.detected_at
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

function validateQueueItem(item) {
  const errors = [];
  const required = [
    "queue_id",
    "municipality",
    "category",
    "title",
    "source_url",
    "detected_keywords",
    "status",
    "created_at",
    "review_required",
    "source_id",
    "original_url",
    "before_hash",
    "after_hash",
    "changed_text",
    "detected_at"
  ];

  required.forEach(function (key) {
    if (!Object.prototype.hasOwnProperty.call(item, key)) {
      errors.push("missing field: " + key);
    }
  });

  if (DISASTER_CATEGORIES.indexOf(item.category) < 0) {
    errors.push("invalid category: " + item.category);
  }

  if (REVIEW_STATUSES.indexOf(item.status) < 0) {
    errors.push("invalid status: " + item.status);
  }

  if (item.status === "PENDING" && item.review_required !== true) {
    errors.push("review_required must be true for PENDING items");
  }

  if (item.status !== "PENDING" && item.review_required !== false) {
    errors.push("review_required must be false after review decision");
  }

  if (item.auto_publish !== false) {
    errors.push("auto_publish must be false");
  }

  if (!Array.isArray(item.detected_keywords) || !item.detected_keywords.length) {
    errors.push("detected_keywords must be a non-empty array");
  }

  if (!item.source_trace || !item.source_trace.classification_id) {
    errors.push("source_trace.classification_id is required");
  }

  if (!item.original_url || item.original_url !== item.source_url) {
    errors.push("original_url must match source_url");
  }

  if (!item.decision) {
    errors.push("decision object missing");
  } else {
    ["status", "reviewer", "reviewed_at", "review_note"].forEach(function (key) {
      if (!Object.prototype.hasOwnProperty.call(item.decision, key)) {
        errors.push("missing decision field: " + key);
      }
    });
    if (item.decision.status !== item.status) {
      errors.push("decision.status must match status");
    }
    if (REVIEW_STATUSES.indexOf(item.decision.status) < 0) {
      errors.push("invalid decision.status: " + item.decision.status);
    }
  }

  return errors;
}

function validateQueueBatch(batch) {
  const errors = [];

  if (!batch || !Array.isArray(batch.items)) {
    errors.push("items array missing");
    return errors;
  }

  if (batch.autoPublish !== false && batch.auto_publish !== false) {
    errors.push("autoPublish must be false");
  }

  const seenQueueIds = new Set();
  const seenDuplicateKeys = new Set();

  batch.items.forEach(function (item, index) {
    const itemErrors = validateQueueItem(item);
    itemErrors.forEach(function (message) {
      errors.push("items[" + index + "]: " + message);
    });

    if (seenQueueIds.has(item.queue_id)) {
      errors.push("items[" + index + "]: duplicate queue_id " + item.queue_id);
    }
    seenQueueIds.add(item.queue_id);

    const duplicateKey = buildDuplicateKey(item);
    if (seenDuplicateKeys.has(duplicateKey)) {
      errors.push("items[" + index + "]: duplicate trace key " + duplicateKey);
    }
    seenDuplicateKeys.add(duplicateKey);
  });

  return errors;
}

function convertClassifiedBatch(batch, options) {
  options = options || {};
  const classifications = (batch && batch.classifications) || [];
  const createdAt = options.createdAt || new Date().toISOString();
  const items = [];

  classifications.forEach(function (classification) {
    if (DISASTER_CATEGORIES.indexOf(classification.category) < 0) {
      return;
    }
    items.push(
      classificationToQueueItem(classification, {
        createdAt: createdAt,
        classificationFile: options.classifiedPath,
        sourceChangeLog: batch.sourceChangeLog || null
      })
    );
  });

  return items;
}

function mergeQueueItems(existingItems, incomingItems) {
  const merged = Array.isArray(existingItems) ? existingItems.slice() : [];
  const indexByClassificationId = new Map();
  const indexByDuplicateKey = new Map();

  merged.forEach(function (item, index) {
    if (item.source_trace && item.source_trace.classification_id) {
      indexByClassificationId.set(item.source_trace.classification_id, index);
    }
    indexByDuplicateKey.set(buildDuplicateKey(item), index);
  });

  const added = [];
  const duplicates = [];

  incomingItems.forEach(function (item) {
    const classificationId = item.source_trace && item.source_trace.classification_id;
    const duplicateKey = buildDuplicateKey(item);

    if (classificationId && indexByClassificationId.has(classificationId)) {
      duplicates.push({
        queue_id: item.queue_id,
        reason: "classification_id",
        existing_queue_id: merged[indexByClassificationId.get(classificationId)].queue_id
      });
      return;
    }

    if (indexByDuplicateKey.has(duplicateKey)) {
      duplicates.push({
        queue_id: item.queue_id,
        reason: "trace_key",
        existing_queue_id: merged[indexByDuplicateKey.get(duplicateKey)].queue_id
      });
      return;
    }

    merged.push(item);
    added.push(item);
    if (classificationId) {
      indexByClassificationId.set(classificationId, merged.length - 1);
    }
    indexByDuplicateKey.set(duplicateKey, merged.length - 1);
  });

  return {
    items: merged,
    added: added,
    duplicates: duplicates
  };
}

function buildQueueBatch(items, options) {
  options = options || {};
  return {
    version: 1,
    generatedAt: options.generatedAt || new Date().toISOString(),
    incidentScope: options.incidentScope || "2026_KUMAMOTO_EARTHQUAKE",
    itemCount: items.length,
    pendingCount: items.filter(function (item) {
      return item.status === "PENDING";
    }).length,
    categorySummary: summarizeByCategory(items),
    autoPublish: false,
    sourceClassificationFile: options.sourceClassificationFile || null,
    items: items
  };
}

function writeQueueBatch(batch, options) {
  options = options || {};
  ensureDir(REVIEW_QUEUE_DIR);

  const errors = validateQueueBatch(batch);
  if (errors.length) {
    return { saved: false, errors: errors, batch: batch };
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputPath = path.join(
    REVIEW_QUEUE_DIR,
    options.fileName || "patrol-review-queue-" + stamp + ".json"
  );

  fs.writeFileSync(outputPath, JSON.stringify(batch, null, 2) + "\n", "utf8");
  return {
    saved: true,
    outputPath: outputPath,
    batch: batch,
    errors: []
  };
}

function buildPatrolReviewQueue(options) {
  options = options || {};
  const classifiedPath = resolveClassifiedPath(options);
  if (!classifiedPath) {
    return { saved: false, reason: "classified batch not found", items: [] };
  }

  const classifiedBatch = readJson(classifiedPath, { classifications: [] });
  const incomingItems = convertClassifiedBatch(classifiedBatch, {
    classifiedPath: classifiedPath,
    createdAt: options.createdAt
  });

  const existingMaster = readJson(MASTER_QUEUE_FILE, { items: [] });
  const mergeResult = mergeQueueItems(existingMaster.items, incomingItems);
  const masterBatch = buildQueueBatch(mergeResult.items, {
    incidentScope: classifiedBatch.incidentScope,
    sourceClassificationFile: toRepoRelative(classifiedPath)
  });

  const masterErrors = validateQueueBatch(masterBatch);
  if (masterErrors.length) {
    return {
      saved: false,
      classifiedPath: classifiedPath,
      errors: masterErrors,
      items: []
    };
  }

  if (!options.dryRun) {
    ensureDir(REVIEW_QUEUE_DIR);
    fs.writeFileSync(MASTER_QUEUE_FILE, JSON.stringify(masterBatch, null, 2) + "\n", "utf8");

    const runBatch = buildQueueBatch(mergeResult.added, {
      incidentScope: classifiedBatch.incidentScope,
      sourceClassificationFile: toRepoRelative(classifiedPath)
    });
    const runWrite = writeQueueBatch(runBatch, {
      fileName: options.fileName
    });

    return {
      saved: true,
      dryRun: false,
      classifiedPath: classifiedPath,
      masterQueuePath: MASTER_QUEUE_FILE,
      runQueuePath: runWrite.outputPath,
      incomingCount: incomingItems.length,
      addedCount: mergeResult.added.length,
      duplicateCount: mergeResult.duplicates.length,
      queueCount: masterBatch.itemCount,
      categorySummary: masterBatch.categorySummary,
      duplicates: mergeResult.duplicates,
      errors: []
    };
  }

  return {
    saved: false,
    dryRun: true,
    classifiedPath: classifiedPath,
    incomingCount: incomingItems.length,
    addedCount: mergeResult.added.length,
    duplicateCount: mergeResult.duplicates.length,
    queueCount: mergeResult.items.length,
    categorySummary: summarizeByCategory(mergeResult.added),
    duplicates: mergeResult.duplicates,
    errors: []
  };
}

module.exports = {
  DISASTER_CATEGORIES,
  REVIEW_STATUSES,
  CLASSIFIED_DIR,
  REVIEW_QUEUE_DIR,
  MASTER_QUEUE_FILE,
  createDefaultDecision,
  listClassifiedFiles,
  resolveClassifiedPath,
  buildQueueId,
  classificationToQueueItem,
  buildDuplicateKey,
  convertClassifiedBatch,
  mergeQueueItems,
  validateQueueItem,
  validateQueueBatch,
  summarizeByCategory,
  buildQueueBatch,
  writeQueueBatch,
  buildPatrolReviewQueue
};

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { compareSource } = require("./diff-engine");
const { WATER_KEYWORDS, findWaterKeywords } = require("./water-fetcher");

const ROOT = path.join(__dirname, "..");
const SNAPSHOT_FILE = path.join(__dirname, "reports", "water-snapshots.json");
const REVIEW_DIR = path.join(ROOT, "data", "review", "water");
const REVIEW_QUEUE_FILE = path.join(REVIEW_DIR, "water_review_queue.json");

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function readSnapshots() {
  if (!fs.existsSync(SNAPSHOT_FILE)) {
    return { version: 1, category: "WATER", sources: {} };
  }
  return JSON.parse(fs.readFileSync(SNAPSHOT_FILE, "utf8"));
}

function writeSnapshots(data) {
  ensureDir(path.dirname(SNAPSHOT_FILE));
  fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function toSnapshotRecord(source, current) {
  const fetchedAt = current.checkedAt || new Date().toISOString();
  return {
    source_id: source.id,
    region: source.area_id || source.region || "",
    organization: source.name,
    url: current.url || source.url,
    fetched_at: fetchedAt,
    content_hash: current.contentHash || "",
    category: "WATER",
    contentHash: current.contentHash || "",
    reachable: current.reachable === true,
    title: current.title || "",
    originalText: current.originalText || "",
    keywords: Array.isArray(current.keywords) ? current.keywords.slice() : [],
    source_class: source.source_class || null,
    municipality: source.municipality || source.name
  };
}

function keywordSignature(keywords) {
  return (keywords || []).slice().sort().join("|");
}

function detectWaterChangeType(source, current, previous, changeEntries) {
  if (!previous) {
    return null;
  }

  if (previous.reachable && !current.reachable) {
    return "REMOVED";
  }

  if (!previous.reachable && current.reachable) {
    return "NEW_INFO";
  }

  const entry = changeEntries && changeEntries[0];
  if (entry && entry.changeType) {
    if (entry.changeType === "CONTENT_CHANGED" || entry.changeType === "CONTENT_AND_TITLE_CHANGED") {
      const prevKeywords = keywordSignature(previous.keywords);
      const nextKeywords = keywordSignature(current.keywords);
      if (prevKeywords !== nextKeywords) {
        return "KEYWORD_CHANGED";
      }
      return "CONTENT_CHANGED";
    }
    if (entry.changeType === "TITLE_CHANGED" || entry.changeType === "PAGE_UPDATED_AT_CHANGED") {
      return "UPDATED";
    }
    return "UPDATED";
  }

  return null;
}

function buildReviewItem(source, current, previous, changeType) {
  const detectedAt = new Date().toISOString();
  return {
    review_id:
      "WTRREV-" +
      detectedAt.slice(0, 10).replace(/-/g, "") +
      "-" +
      crypto.createHash("sha256").update(source.id + detectedAt).digest("hex").slice(0, 6).toUpperCase(),
    category: "WATER",
    region: source.area_id || source.region || "",
    municipality: source.municipality || source.name,
    source: source.name,
    source_id: source.id,
    source_class: source.source_class || null,
    source_url: current.url || source.url,
    change_type: changeType,
    detected_at: detectedAt,
    status: "PENDING",
    keywords: current.keywords || [],
    before: previous
      ? {
          content_hash: previous.content_hash || previous.contentHash || null,
          keywords: previous.keywords || []
        }
      : null,
    after: {
      content_hash: current.contentHash || null,
      keywords: current.keywords || []
    },
    auto_publish: false
  };
}

function writeReviewQueue(reviewItems) {
  ensureDir(REVIEW_DIR);

  const payload = {
    category: "WATER",
    generated_at: new Date().toISOString(),
    item_count: reviewItems.length,
    auto_publication: false,
    items: reviewItems
  };

  fs.writeFileSync(REVIEW_QUEUE_FILE, JSON.stringify(payload, null, 2) + "\n", "utf8");

  reviewItems.forEach(function (item) {
    const filePath = path.join(REVIEW_DIR, item.review_id + ".json");
    fs.writeFileSync(filePath, JSON.stringify(item, null, 2) + "\n", "utf8");
  });

  return {
    queuePath: REVIEW_QUEUE_FILE,
    itemPaths: reviewItems.map(function (item) {
      return path.join(REVIEW_DIR, item.review_id + ".json");
    })
  };
}

function processWaterResults(sources, parsedResults) {
  const snapshots = readSnapshots();
  const reviewItems = [];
  let successCount = 0;
  let failedCount = 0;
  let changeCount = 0;

  sources.forEach(function (source) {
    const current = parsedResults[source.id];
    const previous = snapshots.sources[source.id] || null;

    if (!current || !current.reachable) {
      failedCount += 1;
      if (previous && previous.reachable) {
        changeCount += 1;
        reviewItems.push(buildReviewItem(source, current || { reachable: false, url: source.url }, previous, "REMOVED"));
      }
      snapshots.sources[source.id] = toSnapshotRecord(source, current || {
        url: source.url,
        reachable: false,
        contentHash: "",
        keywords: [],
        checkedAt: new Date().toISOString()
      });
      return;
    }

    successCount += 1;
    const detected = previous ? compareSource(source, current, previous) : null;
    const changeType = detectWaterChangeType(source, current, previous, detected);

    if (changeType) {
      changeCount += 1;
      reviewItems.push(buildReviewItem(source, current, previous, changeType));
    }

    snapshots.sources[source.id] = toSnapshotRecord(source, current);
  });

  writeSnapshots(snapshots);

  const reviewResult = reviewItems.length ? writeReviewQueue(reviewItems) : { queuePath: null, itemPaths: [] };

  return {
    successCount: successCount,
    failedCount: failedCount,
    changeCount: changeCount,
    reviewCount: reviewItems.length,
    reviewQueuePath: reviewResult.queuePath,
    reviewItemPaths: reviewResult.itemPaths,
    snapshotPath: SNAPSHOT_FILE
  };
}

function validateWaterSnapshots() {
  const errors = [];
  const snapshots = readSnapshots();

  if (!snapshots.sources || typeof snapshots.sources !== "object") {
    errors.push("water snapshots missing sources map");
    return errors;
  }

  Object.keys(snapshots.sources).forEach(function (sourceId) {
    const entry = snapshots.sources[sourceId];
    ["source_id", "region", "organization", "url", "fetched_at", "content_hash", "category"].forEach(function (field) {
      if (!entry[field]) {
        errors.push(sourceId + ": missing " + field);
      }
    });
    if (entry.category !== "WATER") {
      errors.push(sourceId + ": category must be WATER");
    }
  });

  return errors;
}

module.exports = {
  SNAPSHOT_FILE,
  REVIEW_DIR,
  REVIEW_QUEUE_FILE,
  WATER_KEYWORDS,
  readSnapshots,
  writeSnapshots,
  toSnapshotRecord,
  detectWaterChangeType,
  processWaterResults,
  validateWaterSnapshots,
  findWaterKeywords
};

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const CHANGE_LOG_DIR = path.join(__dirname, "change-log");
const SNAPSHOT_FILE = path.join(__dirname, "reports", "snapshots.json");
const OUTPUT_DIR = path.join(ROOT, "data", "update_candidates");

const DISASTER_CATEGORIES = [
  "WATER",
  "SHELTER",
  "COMMUNICATION",
  "VOLUNTEER",
  "ROAD",
  "SUPPORT"
];

const CATEGORY_KEYWORDS = {
  WATER: ["給水", "断水", "水道", "復旧", "給水所", "応急給水"],
  SHELTER: ["避難所", "開設", "閉鎖", "避難場所"],
  COMMUNICATION: ["携帯", "通信", "電話", "復旧", "Wi-Fi"],
  VOLUNTEER: ["ボランティア", "募集", "受付"],
  ROAD: ["通行止め", "道路", "規制", "復旧"],
  SUPPORT: ["罹災", "支援", "申請", "ごみ"]
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

function listChangeLogFiles() {
  if (!fs.existsSync(CHANGE_LOG_DIR)) {
    return [];
  }
  return fs
    .readdirSync(CHANGE_LOG_DIR)
    .filter(function (name) {
      return /^\d{4}-\d{2}-\d{2}\.json$/.test(name);
    })
    .map(function (name) {
      return path.join(CHANGE_LOG_DIR, name);
    })
    .sort();
}

function resolveChangeLogPath(options) {
  if (options && options.changeLogPath) {
    return options.changeLogPath;
  }
  const files = listChangeLogFiles();
  if (!files.length) {
    return null;
  }
  return files[files.length - 1];
}

function normalizeChangeEntry(entry) {
  return {
    source_id: entry.source || entry.source_id || "",
    url: entry.url || "",
    diff_type: entry.changeType || entry.diff_type || "",
    changed_text: entry.changed_text || "",
    sourceName: entry.sourceName || entry.municipality || "",
    category: entry.category || "municipality",
    areaId: entry.areaId || null,
    detectedAt: entry.detectedAt || null,
    keywords: entry.keywords || [],
    titleChanged: entry.titleChanged || null,
    pageUpdatedAtChanged: entry.pageUpdatedAtChanged || null,
    previousHash: entry.previousHash || null,
    currentHash: entry.currentHash || null,
    status: entry.status || null,
    safetyFlags: entry.safetyFlags || []
  };
}

function buildChangedText(entry, snapshot) {
  const parts = [];

  if (entry.titleChanged) {
    if (entry.titleChanged.from) {
      parts.push(entry.titleChanged.from);
    }
    if (entry.titleChanged.to) {
      parts.push(entry.titleChanged.to);
    }
  }

  if (snapshot && snapshot.title) {
    parts.push(snapshot.title);
  }

  if (entry.keywords && entry.keywords.length) {
    parts.push(entry.keywords.join(" "));
  }

  if (entry.changed_text) {
    parts.push(entry.changed_text);
  }

  return parts.filter(Boolean).join("\n");
}

function buildSourcePage(entry, snapshot, changedText) {
  const beforeTitle = entry.titleChanged ? entry.titleChanged.from : snapshot ? snapshot.title : null;
  const afterTitle = entry.titleChanged ? entry.titleChanged.to : snapshot ? snapshot.title : null;

  return {
    source_id: entry.source_id,
    url: entry.url,
    diff_type: entry.diff_type,
    changed_text: changedText,
    before: {
      title: beforeTitle,
      contentHash: entry.previousHash,
      pageUpdatedAt: entry.pageUpdatedAtChanged ? entry.pageUpdatedAtChanged.from : null
    },
    after: {
      title: afterTitle,
      contentHash: entry.currentHash,
      pageUpdatedAt: entry.pageUpdatedAtChanged ? entry.pageUpdatedAtChanged.to : null
    },
    detected_keywords: entry.keywords || []
  };
}

function findMatchedKeywords(category, entry, changedText) {
  const categoryKeywords = CATEGORY_KEYWORDS[category] || [];
  const matched = [];

  categoryKeywords.forEach(function (keyword) {
    const inParserKeywords = (entry.keywords || []).includes(keyword);
    const inChangedText = changedText.includes(keyword);
    if (inParserKeywords || inChangedText) {
      matched.push(keyword);
    }
  });

  return Array.from(new Set(matched));
}

function buildClassificationId(entry, category, index) {
  const stamp = (entry.detectedAt || new Date().toISOString()).slice(0, 10).replace(/-/g, "");
  const source = String(entry.source_id || "SRC")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase();
  const seq = String(index + 1).padStart(2, "0");
  return "CLS-" + stamp + "-" + source + "-" + category + "-" + seq;
}

function classifyChangeEntry(entry, snapshot, indexBase) {
  const normalized = normalizeChangeEntry(entry);
  const changedText = buildChangedText(normalized, snapshot);
  const sourcePage = buildSourcePage(normalized, snapshot, changedText);
  const title = sourcePage.after.title || sourcePage.before.title || normalized.sourceName || "";
  const classifications = [];
  let index = indexBase || 0;

  DISASTER_CATEGORIES.forEach(function (category) {
    const detectedKeywords = findMatchedKeywords(category, normalized, changedText);
    if (!detectedKeywords.length) {
      return;
    }

    classifications.push({
      id: buildClassificationId(normalized, category, index),
      source_id: normalized.source_id,
      area_id: normalized.areaId || null,
      municipality: normalized.sourceName,
      category: category,
      title: title,
      source_url: normalized.url,
      diff_type: normalized.diff_type,
      detected_keywords: detectedKeywords,
      detected_at: normalized.detectedAt || new Date().toISOString(),
      confidence: "HIGH",
      autoPublish: false,
      source_page: sourcePage
    });
    index += 1;
  });

  return classifications;
}

function isClassifiableChangeEntry(entry) {
  const normalized = normalizeChangeEntry(entry);
  const changeType = entry.changeType || normalized.diff_type || "";

  if (changeType === "PAGE_UPDATED_AT_CHANGED") {
    return false;
  }

  if (
    normalized.previousHash &&
    normalized.currentHash &&
    normalized.previousHash === normalized.currentHash &&
    changeType !== "CONTENT_CHANGED" &&
    changeType !== "CONTENT_AND_TITLE_CHANGED"
  ) {
    return false;
  }

  return true;
}

function classifyChangeLogEntries(entries, snapshots) {
  const snapshotMap = (snapshots && snapshots.sources) || snapshots || {};
  const classifications = [];
  let indexBase = 0;

  entries.forEach(function (entry) {
    if (!isClassifiableChangeEntry(entry)) {
      return;
    }
    const normalized = normalizeChangeEntry(entry);
    const snapshot = snapshotMap[normalized.source_id] || null;
    const results = classifyChangeEntry(entry, snapshot, indexBase);
    classifications.push.apply(classifications, results);
    indexBase += results.length;
  });

  return classifications;
}

function validateClassificationShape(item) {
  const required = [
    "municipality",
    "category",
    "title",
    "source_url",
    "detected_keywords",
    "detected_at",
    "confidence"
  ];
  const errors = [];

  required.forEach(function (key) {
    if (!Object.prototype.hasOwnProperty.call(item, key)) {
      errors.push("missing field: " + key);
    }
  });

  if (item.category && DISASTER_CATEGORIES.indexOf(item.category) < 0) {
    errors.push("invalid category: " + item.category);
  }

  if (!Array.isArray(item.detected_keywords) || !item.detected_keywords.length) {
    errors.push("detected_keywords must be a non-empty array");
  }

  if (item.confidence !== "HIGH") {
    errors.push("confidence must be HIGH for keyword-based matches");
  }

  if (!item.source_page || !item.source_page.url) {
    errors.push("source_page.url is required");
  }

  item.detected_keywords.forEach(function (keyword) {
    const allowed = CATEGORY_KEYWORDS[item.category] || [];
    if (allowed.indexOf(keyword) < 0) {
      errors.push("keyword not allowed for category: " + keyword);
    }
  });

  return errors;
}

function validateClassificationBatch(batch) {
  const errors = [];

  if (!batch || !Array.isArray(batch.classifications)) {
    errors.push("classifications array missing");
    return errors;
  }

  if (batch.autoPublish !== false) {
    errors.push("autoPublish must be false");
  }

  batch.classifications.forEach(function (item, index) {
    const itemErrors = validateClassificationShape(item);
    itemErrors.forEach(function (message) {
      errors.push("classifications[" + index + "]: " + message);
    });
  });

  return errors;
}

function summarizeByCategory(classifications) {
  const summary = {};
  DISASTER_CATEGORIES.forEach(function (category) {
    summary[category] = 0;
  });
  classifications.forEach(function (item) {
    summary[item.category] = (summary[item.category] || 0) + 1;
  });
  return summary;
}

function writeClassificationBatch(classifications, options) {
  options = options || {};
  ensureDir(OUTPUT_DIR);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = options.fileName || "classified-" + stamp + ".json";
  const outputPath = path.join(OUTPUT_DIR, fileName);

  const batch = {
    generatedAt: new Date().toISOString(),
    incidentScope: "2026_KUMAMOTO_EARTHQUAKE",
    classificationCount: classifications.length,
    categorySummary: summarizeByCategory(classifications),
    autoPublish: false,
    sourceChangeLog: options.changeLogPath ? path.relative(ROOT, options.changeLogPath) : null,
    classifications: classifications
  };

  const errors = validateClassificationBatch(batch);
  if (errors.length) {
    return { saved: false, errors: errors, batch: batch };
  }

  fs.writeFileSync(outputPath, JSON.stringify(batch, null, 2) + "\n", "utf8");
  return {
    saved: true,
    outputPath: outputPath,
    batch: batch,
    errors: []
  };
}

function classifyPatrolDiffs(options) {
  options = options || {};
  const changeLogPath = resolveChangeLogPath(options);
  if (!changeLogPath) {
    return { saved: false, reason: "change-log not found", classifications: [] };
  }

  const entries = readJson(changeLogPath, []);
  const snapshots = readJson(SNAPSHOT_FILE, { sources: {} });
  const classifications = classifyChangeLogEntries(entries, snapshots);

  if (options.dryRun) {
    return {
      saved: false,
      dryRun: true,
      changeLogPath: changeLogPath,
      entryCount: entries.length,
      classificationCount: classifications.length,
      categorySummary: summarizeByCategory(classifications),
      classifications: classifications
    };
  }

  const writeResult = writeClassificationBatch(classifications, {
    changeLogPath: changeLogPath,
    fileName: options.fileName
  });

  return Object.assign(
    {
      changeLogPath: changeLogPath,
      entryCount: entries.length,
      classificationCount: classifications.length,
      categorySummary: summarizeByCategory(classifications)
    },
    writeResult
  );
}

module.exports = {
  DISASTER_CATEGORIES,
  CATEGORY_KEYWORDS,
  CHANGE_LOG_DIR,
  OUTPUT_DIR,
  SNAPSHOT_FILE,
  normalizeChangeEntry,
  buildChangedText,
  buildSourcePage,
  findMatchedKeywords,
  classifyChangeEntry,
  classifyChangeLogEntries,
  isClassifiableChangeEntry,
  validateClassificationShape,
  validateClassificationBatch,
  summarizeByCategory,
  writeClassificationBatch,
  classifyPatrolDiffs,
  resolveChangeLogPath,
  listChangeLogFiles
};

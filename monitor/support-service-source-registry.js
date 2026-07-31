"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const SOURCE_REGISTRY_FILE = path.join(
  ROOT,
  "data",
  "support_service_discovery",
  "source_registry.json"
);

const SOURCE_PLATFORMS = ["X", "WEB"];
const UNKNOWN_DATE = "UNKNOWN";

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

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function buildSourceId(parts) {
  return (
    "SSRC-" +
    crypto
      .createHash("sha256")
      .update(parts.filter(Boolean).join("|"))
      .digest("hex")
      .slice(0, 10)
      .toUpperCase()
  );
}

function buildSourceRecord(post) {
  const platform = post.source_type === "WEB" ? "WEB" : "X";
  const account = normalizeText(post.account || post.account_handle || "");
  const url = normalizeText(post.source_url || post.url || "");
  const sourceName =
    normalizeText(post.source_name) ||
    normalizeText(post.account_name) ||
    normalizeText(post.facility_name) ||
    account ||
    url ||
    "UNKNOWN";
  const area =
    normalizeText(post.area) ||
    [post.prefecture, post.municipality].filter(Boolean).join("") ||
    "UNKNOWN";
  const categories = Array.isArray(post.categories) ? post.categories.slice() : [];

  return {
    source_id: buildSourceId([platform, account || url, sourceName]),
    source_name: sourceName,
    platform: platform,
    url: url,
    account: account,
    area: area,
    categories: categories
  };
}

function sourceRecordKey(record) {
  return [record.platform, record.account || "", record.url || "", record.source_name || ""].join("|");
}

function loadSupportServiceSourceRegistry(options) {
  options = options || {};
  return readJson(options.registryPath || SOURCE_REGISTRY_FILE, {
    version: "1.0",
    description: "SUPPORT_SERVICE information source registry",
    AUTO_PUBLISH: false,
    sources: []
  });
}

function findSourceRecord(registry, record) {
  const key = sourceRecordKey(record);
  return (registry.sources || []).find(function (entry) {
    return sourceRecordKey(entry) === key;
  });
}

function findSourceById(registry, sourceId) {
  return (registry.sources || []).find(function (entry) {
    return entry.source_id === sourceId;
  });
}

function resolveSupportServiceSource(post, options) {
  options = options || {};
  const registry = options.registry || loadSupportServiceSourceRegistry(options);
  const record = buildSourceRecord(post);
  const existing = findSourceRecord(registry, record);
  if (existing) {
    return {
      registry: registry,
      source: existing,
      created: false
    };
  }

  const sources = (registry.sources || []).slice();
  sources.push(record);
  const nextRegistry = Object.assign({}, registry, { sources: sources });
  return {
    registry: nextRegistry,
    source: record,
    created: true
  };
}

function registerSupportServiceSources(posts, options) {
  options = options || {};
  let registry = loadSupportServiceSourceRegistry(options);

  (posts || []).forEach(function (post) {
    const resolved = resolveSupportServiceSource(post, { registry: registry });
    registry = resolved.registry;
  });

  return registry;
}

function validateSupportServiceSourceRecord(record, index) {
  const label = "sources[" + index + "]";
  const errors = [];

  if (!record || typeof record !== "object") {
    errors.push(label + ": entry missing");
    return errors;
  }

  ["source_id", "source_name", "platform", "url", "account", "area"].forEach(function (field) {
    if (record[field] === undefined || record[field] === null) {
      errors.push(label + ": missing " + field);
    }
  });

  if (SOURCE_PLATFORMS.indexOf(record.platform) === -1) {
    errors.push(label + ": invalid platform " + record.platform);
  }
  if (!Array.isArray(record.categories)) {
    errors.push(label + ": categories must be an array");
  }

  const forbidden = [
    "trust",
    "confidence",
    "rank",
    "score",
    "official",
    "official_flag",
    "provider_type",
    "tier"
  ];
  forbidden.forEach(function (field) {
    if (record[field] !== undefined) {
      errors.push(label + ": forbidden evaluation field " + field);
    }
  });

  return errors;
}

function validateSupportServiceSourceRegistry(registry) {
  const errors = [];

  if (!registry || registry.version !== "1.0") {
    errors.push("source registry version must be 1.0");
  }
  if (registry.AUTO_PUBLISH !== false) {
    errors.push("source registry AUTO_PUBLISH must be false");
  }
  if (!Array.isArray(registry.sources)) {
    errors.push("source registry sources must be an array");
    return errors;
  }

  const ids = new Set();
  const keys = new Set();
  registry.sources.forEach(function (record, index) {
    errors.push.apply(errors, validateSupportServiceSourceRecord(record, index));
    if (record.source_id) {
      if (ids.has(record.source_id)) {
        errors.push("duplicate source_id: " + record.source_id);
      }
      ids.add(record.source_id);
    }
    const key = sourceRecordKey(record);
    if (keys.has(key)) {
      errors.push("duplicate source key: " + key);
    }
    keys.add(key);
  });

  return errors;
}

function writeSupportServiceSourceRegistry(registry, options) {
  options = options || {};
  const outputPath = options.outputPath || SOURCE_REGISTRY_FILE;
  writeJson(outputPath, registry);
  return outputPath;
}

module.exports = {
  SOURCE_REGISTRY_FILE,
  SOURCE_PLATFORMS,
  UNKNOWN_DATE,
  buildSourceId,
  buildSourceRecord,
  sourceRecordKey,
  loadSupportServiceSourceRegistry,
  findSourceRecord,
  findSourceById,
  resolveSupportServiceSource,
  registerSupportServiceSources,
  validateSupportServiceSourceRecord,
  validateSupportServiceSourceRegistry,
  writeSupportServiceSourceRegistry
};

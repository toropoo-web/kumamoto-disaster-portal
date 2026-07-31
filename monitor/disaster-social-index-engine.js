"use strict";

const fs = require("fs");
const path = require("path");

const { REGION_KYUSHU_SOUTH, PREFECTURES } = require("./disaster-sources");

const ROOT = path.join(__dirname, "..");
const SOURCES_FILE = path.join(ROOT, "data", "community", "disaster_social_sources.json");
const INDEX_FILE = path.join(ROOT, "data", "community", "disaster_social_index.json");
const PUBLIC_SOURCES_FILE = path.join(ROOT, "data", "public", "disaster_social_sources.json");
const PUBLIC_INDEX_FILE = path.join(ROOT, "data", "public", "disaster_social_index.json");

const SOCIAL_CATEGORIES = [
  "WATER",
  "SHELTER",
  "FOOD",
  "SUPPLIES",
  "TRANSPORT",
  "VOLUNTEER",
  "MEDICAL",
  "TOILET",
  "CHARGING",
  "OTHER"
];

const SOCIAL_STATUS_VALUES = ["ACTIVE", "ARCHIVED", "incomplete"];

const SOCIAL_CATEGORY_LABELS = {
  WATER: "給水・水",
  SHELTER: "避難所",
  FOOD: "食料・炊き出し",
  SUPPLIES: "物資",
  TRANSPORT: "交通・輸送",
  VOLUNTEER: "ボランティア",
  MEDICAL: "医療",
  TOILET: "トイレ",
  CHARGING: "充電",
  OTHER: "その他"
};

const REQUIRED_ENTRY_FIELDS = [
  "id",
  "source",
  "category",
  "prefecture",
  "municipality",
  "district",
  "date",
  "title",
  "content",
  "url",
  "status"
];

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

function normalizeSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\u3000/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDateToken(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return normalized;
  }
  const parsed = Date.parse(normalized);
  if (Number.isNaN(parsed)) {
    return normalized.slice(0, 10);
  }
  return new Date(parsed).toISOString().slice(0, 10);
}

function buildRegionHaystack(entry) {
  return normalizeSearchText(
    [entry.prefecture, entry.municipality, entry.district].filter(Boolean).join(" ")
  );
}

function matchesRegion(entry, regionQuery) {
  const tokens = normalizeSearchText(regionQuery).split(" ").filter(Boolean);
  if (!tokens.length) {
    return true;
  }
  const hay = buildRegionHaystack(entry);
  return tokens.every(function (token) {
    return hay.indexOf(token) !== -1;
  });
}

function matchesDate(entry, dateQuery) {
  const normalized = normalizeDateToken(dateQuery);
  if (!normalized) {
    return true;
  }
  return normalizeDateToken(entry.date) === normalized;
}

function matchesCategory(entry, categoryQuery) {
  if (!categoryQuery) {
    return true;
  }
  return entry.category === categoryQuery;
}

function searchDisasterSocialIndex(indexPayload, options) {
  options = options || {};
  const entries = (indexPayload && indexPayload.entries) || [];

  const hasRegion = Boolean(normalizeSearchText(options.region));
  const hasDate = Boolean(normalizeDateToken(options.date));
  const hasCategory = Boolean(options.category);

  if (!hasRegion && !hasDate && !hasCategory) {
    return [];
  }

  return entries.filter(function (entry) {
    return (
      matchesRegion(entry, options.region) &&
      matchesDate(entry, options.date) &&
      matchesCategory(entry, options.category)
    );
  });
}

function validateSocialIndexEntry(entry, index) {
  const label = "entries[" + index + "]";
  const errors = [];

  if (!entry || typeof entry !== "object") {
    errors.push(label + ": entry missing");
    return errors;
  }

  if (!entry.id) {
    errors.push(label + ": missing id");
  }

  if (entry.status === "incomplete") {
    if (entry.status && SOCIAL_STATUS_VALUES.indexOf(entry.status) === -1) {
      errors.push(label + ": invalid status " + entry.status);
    }
    return errors;
  }

  REQUIRED_ENTRY_FIELDS.forEach(function (field) {
    if (!entry[field]) {
      errors.push(label + ": missing " + field);
    }
  });

  if (entry.category && SOCIAL_CATEGORIES.indexOf(entry.category) === -1) {
    errors.push(label + ": invalid category " + entry.category);
  }

  if (entry.status && SOCIAL_STATUS_VALUES.indexOf(entry.status) === -1) {
    errors.push(label + ": invalid status " + entry.status);
  }

  if (entry.prefecture && PREFECTURES[REGION_KYUSHU_SOUTH].indexOf(entry.prefecture) === -1) {
    errors.push(label + ": prefecture out of coverage");
  }

  if (entry.date && !/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) {
    errors.push(label + ": invalid date format");
  }

  return errors;
}

function validateDisasterSocialIndex(payload) {
  const errors = [];
  if (!payload || !Array.isArray(payload.entries)) {
    errors.push("entries must be an array");
    return errors;
  }

  const ids = new Set();
  payload.entries.forEach(function (entry, index) {
    errors.push.apply(errors, validateSocialIndexEntry(entry, index));
    if (entry.id) {
      if (ids.has(entry.id)) {
        errors.push("duplicate id: " + entry.id);
      }
      ids.add(entry.id);
    }
  });

  return errors;
}

function validateDisasterSocialSources(payload) {
  const errors = [];
  if (!payload || !Array.isArray(payload.sources)) {
    errors.push("sources must be an array");
    return errors;
  }
  return errors;
}

function buildAndWriteDisasterSocialIndex(options) {
  options = options || {};
  const sources = readJson(options.sourcesPath || SOURCES_FILE, {
    version: "1.0",
    region: REGION_KYUSHU_SOUTH,
    sources: []
  });
  const index = readJson(options.indexPath || INDEX_FILE, {
    version: "1.0",
    region: REGION_KYUSHU_SOUTH,
    entries: []
  });

  writeJson(options.publicSourcesPath || PUBLIC_SOURCES_FILE, sources);
  writeJson(options.publicIndexPath || PUBLIC_INDEX_FILE, index);

  return {
    sources: sources,
    index: index,
    meta: {
      source_count: (sources.sources || []).length,
      entry_count: (index.entries || []).length,
      last_updated: new Date().toISOString()
    }
  };
}

module.exports = {
  SOURCES_FILE,
  INDEX_FILE,
  PUBLIC_SOURCES_FILE,
  PUBLIC_INDEX_FILE,
  SOCIAL_CATEGORIES,
  SOCIAL_STATUS_VALUES,
  SOCIAL_CATEGORY_LABELS,
  REQUIRED_ENTRY_FIELDS,
  normalizeSearchText,
  normalizeDateToken,
  searchDisasterSocialIndex,
  validateSocialIndexEntry,
  validateDisasterSocialIndex,
  validateDisasterSocialSources,
  buildAndWriteDisasterSocialIndex
};

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const CROSS_VIEW_FILE = path.join(ROOT, "data", "water_cross_view.json");
const OUTPUT_FILE = path.join(ROOT, "data", "water_search_index.json");
const PUBLIC_OUTPUT_FILE = path.join(ROOT, "data", "public", "water_search_index.json");

const REGIONS = ["熊本県", "鹿児島県"];
const DEFAULT_REGION = "熊本県";

const TARGET_MUNICIPALITIES = new Set(["八代市", "宇城市", "人吉市"]);

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

function buildSearchText(entry, location) {
  const parts = [
    DEFAULT_REGION,
    entry.municipality,
    location.location_name,
    location.status_label || "給水対応中",
    "給水",
    "給水所"
  ];

  if (/給水車/.test(location.location_name)) {
    parts.push("給水車");
  } else {
    parts.push("応急給水");
  }

  return parts.filter(Boolean).join(" ");
}

function toSearchItem(entry, location) {
  const sourceLabel = entry.source_label || entry.municipality + "公式";

  return {
    region: DEFAULT_REGION,
    municipality: entry.municipality,
    location: location.location_name,
    title: location.status_label || "給水対応中",
    search_text: buildSearchText(entry, location),
    source_name: sourceLabel,
    source_type: "official",
    updated_at: location.updated_at || null
  };
}

function buildWaterSearchIndex(options) {
  options = options || {};
  const crossView = readJson(options.crossViewPath || CROSS_VIEW_FILE, { municipalities: [] });
  const items = [];

  (crossView.municipalities || []).forEach(function (entry) {
    if (!TARGET_MUNICIPALITIES.has(entry.municipality)) {
      return;
    }

    (entry.locations || []).forEach(function (location) {
      if (!location || location.source_type !== "official") {
        return;
      }
      items.push(toSearchItem(entry, location));
    });
  });

  return {
    category: "WATER",
    regions: REGIONS.slice(),
    item_count: items.length,
    last_updated: new Date().toISOString(),
    items: items
  };
}

function buildAndWriteWaterSearchIndex(options) {
  const payload = buildWaterSearchIndex(options);
  writeJson(OUTPUT_FILE, payload);
  writeJson(PUBLIC_OUTPUT_FILE, payload);
  return payload;
}

function validateWaterSearchIndex(payload) {
  const errors = [];

  if (!payload || payload.category !== "WATER") {
    errors.push("category must be WATER");
  }

  if (!Array.isArray(payload.regions) || payload.regions.indexOf("熊本県") === -1) {
    errors.push("regions must include 熊本県");
  }

  if (!Array.isArray(payload.regions) || payload.regions.indexOf("鹿児島県") === -1) {
    errors.push("regions must include 鹿児島県");
  }

  if (!Array.isArray(payload.items)) {
    errors.push("items must be an array");
    return errors;
  }

  const municipalities = new Set();

  payload.items.forEach(function (item, index) {
    const label = "items[" + index + "]";

    ["region", "municipality", "location", "title", "search_text", "source_name", "source_type"].forEach(function (field) {
      if (!item[field]) {
        errors.push(label + ": missing " + field);
      }
    });

    if (item.source_type !== "official") {
      errors.push(label + ": source_type must be official");
    }

    if (item.region !== "熊本県" && item.region !== "鹿児島県") {
      errors.push(label + ": invalid region");
    }

    municipalities.add(item.municipality);
  });

  ["八代市", "宇城市", "人吉市"].forEach(function (name) {
    if (!municipalities.has(name)) {
      errors.push("missing municipality items: " + name);
    }
  });

  if (payload.items.length === 0) {
    errors.push("items must not be empty");
  }

  return errors;
}

module.exports = {
  CROSS_VIEW_FILE,
  OUTPUT_FILE,
  PUBLIC_OUTPUT_FILE,
  buildWaterSearchIndex,
  buildAndWriteWaterSearchIndex,
  validateWaterSearchIndex
};

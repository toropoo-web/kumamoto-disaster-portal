"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PUBLIC_LOCATIONS = path.join(ROOT, "data", "public", "disaster_locations.json");
const OUTPUT_FILE = path.join(ROOT, "data", "water_cross_view.json");
const PUBLIC_OUTPUT_FILE = path.join(ROOT, "data", "public", "water_cross_view.json");

const TARGET_MUNICIPALITIES = [
  { area_id: "KM001", municipality: "熊本市", source_label: "熊本市公式" },
  { area_id: "KM005", municipality: "八代市", source_label: "八代市公式" },
  { area_id: "KM003", municipality: "宇城市", source_label: "宇城市公式" },
  { area_id: "KM006", municipality: "人吉市", source_label: "人吉市公式" },
  { area_id: "KM011", municipality: "菊陽町", source_label: "菊陽町公式" }
];

const ALLOWED_STATUS_LABELS = new Set(["給水情報あり", "給水対応中", "公式更新確認済み", "給水実施中"]);

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

function isPublicMunicipalWater(location) {
  if (!location || location.category !== "WATER") {
    return false;
  }
  if (location.status !== "ACTIVE" || location.verification_status !== "VERIFIED") {
    return false;
  }
  if (!location.source || location.source.type !== "MUNICIPALITY") {
    return false;
  }
  if (location.expires_at) {
    const expiresAt = new Date(location.expires_at);
    if (!Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() < Date.now()) {
      return false;
    }
  }
  return true;
}

function toCrossViewLocation(location) {
  var statusLabel = location.status_label || "給水対応中";
  if (statusLabel === "給水実施中") {
    statusLabel = "給水対応中";
  }

  return {
    location_id: location.location_id,
    location_name: location.name,
    municipality: location.area_name,
    source_type: "official",
    source_name: location.source && location.source.name ? location.source.name : location.area_name,
    source_url: location.source_url || null,
    status_label: statusLabel,
    updated_at: location.last_checked_at || location.verified_at || null
  };
}

function buildWaterCrossView(options) {
  options = options || {};
  const disasterLocations = readJson(options.publicPath || PUBLIC_LOCATIONS, { locations: [] });
  const locations = disasterLocations.locations || [];
  let latestUpdated = disasterLocations.confirmed_at || null;

  const municipalities = TARGET_MUNICIPALITIES.map((target) => {
    const municipalLocations = locations
      .filter(function (location) {
        return location.area_id === target.area_id && isPublicMunicipalWater(location);
      })
      .sort(function (left, right) {
        return String(left.name || "").localeCompare(String(right.name || ""), "ja");
      })
      .map(toCrossViewLocation);

    municipalLocations.forEach(function (entry) {
      if (entry.updated_at && (!latestUpdated || entry.updated_at > latestUpdated)) {
        latestUpdated = entry.updated_at;
      }
    });

    const sourceUrl = municipalLocations.find(function (entry) {
      return entry.source_url;
    });

    return {
      municipality: target.municipality,
      area_id: target.area_id,
      status: municipalLocations.length > 0 ? "ACTIVE" : "NO_LOCATIONS",
      status_label: municipalLocations.length > 0 ? "給水対応中" : "給水情報なし",
      location_count: municipalLocations.length,
      source_type: "official",
      source_label: target.source_label,
      source_url: sourceUrl ? sourceUrl.source_url : null,
      locations: municipalLocations
    };
  });

  return {
    category: "WATER",
    title: "給水情報",
    description: "現在利用可能な給水所",
    last_updated: latestUpdated || new Date().toISOString(),
    municipality_count: municipalities.filter(function (entry) {
      return entry.location_count > 0;
    }).length,
    municipalities
  };
}

function buildAndWriteWaterCrossView(options) {
  options = options || {};
  const payload = buildWaterCrossView(options);
  const outputPath = options.outputPath || OUTPUT_FILE;
  const publicOutputPath = options.publicOutputPath || PUBLIC_OUTPUT_FILE;

  writeJson(outputPath, payload);
  writeJson(publicOutputPath, payload);

  return payload;
}

function validateWaterCrossView(payload) {
  const errors = [];
  const data = payload || buildWaterCrossView();

  if (data.category !== "WATER") {
    errors.push("category must be WATER");
  }
  if (data.title !== "給水情報") {
    errors.push("title must be 給水情報");
  }
  if (!data.last_updated) {
    errors.push("last_updated is required");
  }
  if (!Array.isArray(data.municipalities) || data.municipalities.length !== TARGET_MUNICIPALITIES.length) {
    errors.push("municipalities must include all target municipalities");
  }

  const seen = new Set();
  (data.municipalities || []).forEach(function (entry) {
    if (seen.has(entry.municipality)) {
      errors.push("duplicate municipality: " + entry.municipality);
    }
    seen.add(entry.municipality);

    if (entry.source_type !== "official") {
      errors.push(entry.municipality + ": source_type must be official");
    }

    (entry.locations || []).forEach(function (location) {
      if (location.source_type !== "official") {
        errors.push(location.location_id + ": source_type must be official");
      }
      if (!location.source_url || !/^https:\/\//.test(location.source_url)) {
        errors.push(location.location_id + ": official source_url required");
      }
      if (location.status_label && !ALLOWED_STATUS_LABELS.has(location.status_label)) {
        errors.push(location.location_id + ": status_label not allowed");
      }
    });
  });

  function countPublicMunicipalWaterLocations(areaId) {
    const disasterLocations = readJson(PUBLIC_LOCATIONS, { locations: [] });
    return (disasterLocations.locations || []).filter(function (location) {
      return location.area_id === areaId && isPublicMunicipalWater(location);
    }).length;
  }

  TARGET_MUNICIPALITIES.forEach(function (target) {
    const entry = (data.municipalities || []).find(function (item) {
      return item.municipality === target.municipality;
    });
    const expectedCount = countPublicMunicipalWaterLocations(target.area_id);

    if (!entry) {
      errors.push(target.municipality + ": missing municipality entry");
      return;
    }

    if (entry.location_count !== expectedCount) {
      errors.push(
        target.municipality +
        " location_count must match disaster_locations (" +
        expectedCount +
        " official water locations, got " +
        entry.location_count +
        ")"
      );
    }

    if (entry.location_count !== (entry.locations || []).length) {
      errors.push(target.municipality + ": location_count must match locations length");
    }
  });

  return errors;
}

module.exports = {
  TARGET_MUNICIPALITIES,
  OUTPUT_FILE,
  PUBLIC_OUTPUT_FILE,
  buildWaterCrossView,
  buildAndWriteWaterCrossView,
  validateWaterCrossView,
  isPublicMunicipalWater
};

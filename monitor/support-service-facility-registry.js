"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const FACILITY_REGISTRY_FILE = path.join(
  ROOT,
  "data",
  "support_service_discovery",
  "facility_registry.json"
);

const FACILITY_CATEGORIES = [
  "BATH",
  "SHOWER",
  "SPACE",
  "TOILET",
  "VEHICLE",
  "FOOD",
  "SUPPLIES",
  "PET"
];

const FORBIDDEN_EVALUATION_FIELDS = ["trust", "rank", "score", "confidence", "official_flag"];

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

function buildFacilityId(parts) {
  return (
    "SFAC-" +
    crypto
      .createHash("sha256")
      .update(parts.filter(Boolean).join("|"))
      .digest("hex")
      .slice(0, 10)
      .toUpperCase()
  );
}

function loadSupportServiceFacilityRegistry(options) {
  options = options || {};
  return readJson(options.registryPath || FACILITY_REGISTRY_FILE, {
    version: "1.0",
    facilities: []
  });
}

function findFacilityRecord(registry, facilityName) {
  const normalizedName = normalizeText(facilityName);
  if (!normalizedName) {
    return null;
  }
  return (
    (registry.facilities || []).find(function (entry) {
      return entry && normalizeText(entry.facility_name) === normalizedName;
    }) || null
  );
}

function validateSupportServiceFacilityRecord(record, index) {
  const label = "facilities[" + index + "]";
  const errors = [];

  if (!record || typeof record !== "object") {
    errors.push(label + ": entry missing");
    return errors;
  }

  if (!record.facility_id) {
    errors.push(label + ": missing facility_id");
  }
  if (!record.facility_name) {
    errors.push(label + ": missing facility_name");
  }

  ["address", "municipality", "website", "x_account"].forEach(function (field) {
    if (record[field] === undefined || record[field] === null) {
      errors.push(label + ": missing " + field);
    }
  });

  if (!Array.isArray(record.categories)) {
    errors.push(label + ": categories must be an array");
  } else {
    record.categories.forEach(function (category, categoryIndex) {
      if (FACILITY_CATEGORIES.indexOf(category) === -1) {
        errors.push(label + ": invalid category at categories[" + categoryIndex + "]: " + category);
      }
    });
  }

  FORBIDDEN_EVALUATION_FIELDS.forEach(function (field) {
    if (record[field] !== undefined) {
      errors.push(label + ": forbidden evaluation field " + field);
    }
  });

  return errors;
}

function validateSupportServiceFacilityRegistry(registry) {
  const errors = [];

  if (!registry || registry.version !== "1.0") {
    errors.push("facility registry version must be 1.0");
  }
  if (!Array.isArray(registry.facilities)) {
    errors.push("facility registry facilities must be an array");
    return errors;
  }

  const ids = new Set();
  const names = new Set();
  registry.facilities.forEach(function (record, index) {
    errors.push.apply(errors, validateSupportServiceFacilityRecord(record, index));
    if (record.facility_id) {
      if (ids.has(record.facility_id)) {
        errors.push("duplicate facility_id: " + record.facility_id);
      }
      ids.add(record.facility_id);
    }
    const nameKey = normalizeText(record.facility_name);
    if (nameKey) {
      if (names.has(nameKey)) {
        errors.push("duplicate facility_name: " + nameKey);
      }
      names.add(nameKey);
    }
  });

  return errors;
}

function writeSupportServiceFacilityRegistry(registry, options) {
  options = options || {};
  const outputPath = options.outputPath || FACILITY_REGISTRY_FILE;
  writeJson(outputPath, registry);
  return outputPath;
}

module.exports = {
  FACILITY_REGISTRY_FILE,
  FACILITY_CATEGORIES,
  FORBIDDEN_EVALUATION_FIELDS,
  buildFacilityId,
  loadSupportServiceFacilityRegistry,
  findFacilityRecord,
  validateSupportServiceFacilityRecord,
  validateSupportServiceFacilityRegistry,
  writeSupportServiceFacilityRegistry,
  normalizeText
};

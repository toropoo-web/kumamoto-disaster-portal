"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const MUNICIPALITY_MASTER_FILE = path.join(ROOT, "data", "community", "municipality_master.json");

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function loadMunicipalityMaster(options) {
  options = options || {};
  return readJson(options.masterPath || MUNICIPALITY_MASTER_FILE, {
    version: "1.0",
    prefecture: "熊本県",
    municipalities: []
  });
}

function getKumamotoMunicipalitySet(masterPayload) {
  const master = masterPayload || loadMunicipalityMaster();
  const set = new Set();
  (master.municipalities || []).forEach(function (item) {
    if (item.municipality) {
      set.add(item.municipality);
    }
  });
  return set;
}

function isKumamotoMunicipality(municipality, masterPayload) {
  const name = String(municipality || "").trim();
  if (!name) {
    return false;
  }
  return getKumamotoMunicipalitySet(masterPayload).has(name);
}

function validateMunicipalityMaster(payload) {
  const errors = [];
  if (!payload || !Array.isArray(payload.municipalities)) {
    errors.push("municipality_master municipalities must be an array");
    return errors;
  }
  if (payload.prefecture !== "熊本県") {
    errors.push("municipality_master prefecture must be 熊本県");
  }
  const seen = new Set();
  payload.municipalities.forEach(function (item, index) {
    const label = "municipalities[" + index + "]";
    if (!item || item.prefecture !== "熊本県") {
      errors.push(label + ": prefecture must be 熊本県");
    }
    if (!item.municipality) {
      errors.push(label + ": municipality is required");
    } else if (seen.has(item.municipality)) {
      errors.push(label + ": duplicate municipality " + item.municipality);
    } else {
      seen.add(item.municipality);
    }
    if (!Array.isArray(item.districts)) {
      errors.push(label + ": districts must be an array");
    }
  });
  if (payload.municipality_count && payload.municipality_count !== payload.municipalities.length) {
    errors.push("municipality_count mismatch");
  }
  return errors;
}

module.exports = {
  MUNICIPALITY_MASTER_FILE,
  loadMunicipalityMaster,
  getKumamotoMunicipalitySet,
  isKumamotoMunicipality,
  validateMunicipalityMaster
};

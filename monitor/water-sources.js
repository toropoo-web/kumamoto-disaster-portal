"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const WATER_SOURCES_FILE = path.join(ROOT, "data", "water_sources.json");

const SOURCE_CLASSES = [
  "MUNICIPALITY",
  "WATERWORKS",
  "DISASTER",
  "SELF_DEFENSE",
  "FIRE",
  "COAST_GUARD"
];

function readWaterRegistry() {
  if (!fs.existsSync(WATER_SOURCES_FILE)) {
    return { category: "WATER", regions: [], sources: [] };
  }
  return JSON.parse(fs.readFileSync(WATER_SOURCES_FILE, "utf8"));
}

function inferSourceClass(organization) {
  if (!organization) {
    return "DISASTER";
  }
  if (/上下水道|水道企業団/.test(organization)) {
    return "WATERWORKS";
  }
  if (/自衛隊/.test(organization)) {
    return "SELF_DEFENSE";
  }
  if (/消防庁/.test(organization)) {
    return "FIRE";
  }
  if (/海上保安庁/.test(organization)) {
    return "COAST_GUARD";
  }
  if (/防災/.test(organization)) {
    return "DISASTER";
  }
  if (/市$|町$|村$/.test(organization)) {
    return "MUNICIPALITY";
  }
  return "DISASTER";
}

function buildSourceId(region, organization, url) {
  return (
    "WTR-" +
    crypto
      .createHash("sha256")
      .update([region, organization, url].join("|"))
      .digest("hex")
      .slice(0, 10)
      .toUpperCase()
  );
}

function resolveMunicipality(region, organization) {
  if (/市$|町$|村$/.test(organization)) {
    return organization;
  }
  if (/県/.test(organization)) {
    return region;
  }
  return organization;
}

function normalizeWaterSource(entry, index) {
  const organization = entry.organization || "";
  const url = entry.url || "";
  const region = entry.region || "";

  return {
    source_id: buildSourceId(region, organization, url),
    region: region,
    organization: organization,
    municipality: resolveMunicipality(region, organization),
    url: url,
    source_type: entry.source_type || "official",
    source_class: inferSourceClass(organization),
    keywords: Array.isArray(entry.keywords) ? entry.keywords.slice() : [],
    official: entry.official === true,
    category: "WATER",
    patrol_priority: index
  };
}

function getActiveWaterSources() {
  const registry = readWaterRegistry();
  return (registry.sources || [])
    .filter(function (entry) {
      return entry && entry.official === true && entry.source_type === "official" && entry.url;
    })
    .map(normalizeWaterSource);
}

function toPatrolSource(source) {
  return {
    id: source.source_id,
    name: source.organization,
    url: source.url,
    category: "WATER",
    area_id: source.region,
    source_class: source.source_class,
    municipality: source.municipality,
    keywords: source.keywords
  };
}

function validateWaterRegistry() {
  const errors = [];
  const registry = readWaterRegistry();

  if (registry.category !== "WATER") {
    errors.push("water_sources.json category must be WATER");
  }

  if (!Array.isArray(registry.regions) || registry.regions.indexOf("熊本県") === -1) {
    errors.push("water_sources.json must include 熊本県");
  }

  if (!Array.isArray(registry.regions) || registry.regions.indexOf("鹿児島県") === -1) {
    errors.push("water_sources.json must include 鹿児島県");
  }

  const sources = getActiveWaterSources();
  if (!sources.length) {
    errors.push("water_sources.json has no active official sources");
  }

  sources.forEach(function (source, index) {
    if (source.source_type !== "official") {
      errors.push("sources[" + index + "]: source_type must be official");
    }
    if (SOURCE_CLASSES.indexOf(source.source_class) === -1) {
      errors.push("sources[" + index + "]: invalid source_class");
    }
    if (/x\.com|twitter\.com|instagram\.com|facebook\.com/i.test(source.url)) {
      errors.push("sources[" + index + "]: personal SNS URL is not allowed");
    }
  });

  const classes = new Set(sources.map(function (source) {
    return source.source_class;
  }));

  ["MUNICIPALITY", "WATERWORKS", "DISASTER"].forEach(function (name) {
    if (!classes.has(name)) {
      errors.push("missing source_class coverage: " + name);
    }
  });

  return {
    errors: errors,
    sourceCount: sources.length,
    classCounts: SOURCE_CLASSES.reduce(function (acc, name) {
      acc[name] = sources.filter(function (source) {
        return source.source_class === name;
      }).length;
      return acc;
    }, {})
  };
}

function loadWaterSourcesFromDisasterRegistry() {
  return require("./disaster-sources").loadWaterSources();
}

module.exports = {
  WATER_SOURCES_FILE,
  SOURCE_CLASSES,
  readWaterRegistry,
  getActiveWaterSources,
  toPatrolSource,
  inferSourceClass,
  buildSourceId,
  validateWaterRegistry,
  loadWaterSourcesFromDisasterRegistry
};

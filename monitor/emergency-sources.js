"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const EMERGENCY_SOURCES_FILE = path.join(ROOT, "data", "public", "emergency_sources.json");

function loadEmergencySources() {
  if (!fs.existsSync(EMERGENCY_SOURCES_FILE)) {
    return { version: 1, sources: [] };
  }
  return JSON.parse(fs.readFileSync(EMERGENCY_SOURCES_FILE, "utf8"));
}

function normalizeUrl(url) {
  if (!url) {
    return "";
  }
  return url.split("#")[0];
}

function findEmergencySourcesByUrl(url) {
  const normalized = normalizeUrl(url);
  const data = loadEmergencySources();
  return (data.sources || []).filter((source) => {
    return source.status === "ACTIVE" && normalizeUrl(source.url) === normalized;
  });
}

function findEmergencySourceByUrl(url) {
  const matches = findEmergencySourcesByUrl(url);
  return matches.length ? matches[0] : null;
}

function findEmergencySourceById(sourceId) {
  const data = loadEmergencySources();
  return (data.sources || []).find((source) => source.source_id === sourceId) || null;
}

function getActiveEmergencySources() {
  const data = loadEmergencySources();
  return (data.sources || []).filter((source) => source.status === "ACTIVE");
}

function toPatrolSource(emergencySource) {
  return {
    id: emergencySource.source_id,
    area_id: emergencySource.area_id,
    name: emergencySource.municipality,
    category: "emergency",
    url: emergencySource.url,
    source_type: emergencySource.source_type,
    x_feed_source_id: emergencySource.x_feed_source_id || null,
    public_category_id: "EMERGENCY"
  };
}

module.exports = {
  EMERGENCY_SOURCES_FILE,
  loadEmergencySources,
  findEmergencySourceByUrl,
  findEmergencySourcesByUrl,
  findEmergencySourceById,
  getActiveEmergencySources,
  toPatrolSource
};

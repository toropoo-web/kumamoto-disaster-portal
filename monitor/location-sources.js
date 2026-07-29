"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const LOCATION_SOURCES_FILE = path.join(ROOT, "data", "public", "location_sources.json");

function loadLocationSources() {
  if (!fs.existsSync(LOCATION_SOURCES_FILE)) {
    return { version: 1, sources: [] };
  }
  return JSON.parse(fs.readFileSync(LOCATION_SOURCES_FILE, "utf8"));
}

function normalizeUrl(url) {
  if (!url) {
    return "";
  }
  return url.split("#")[0];
}

function findLocationSourcesByUrl(url) {
  const normalized = normalizeUrl(url);
  const data = loadLocationSources();
  return (data.sources || []).filter((source) => {
    return source.status === "ACTIVE" && normalizeUrl(source.url) === normalized;
  });
}

function findLocationSourceByUrl(url) {
  const matches = findLocationSourcesByUrl(url);
  return matches.length ? matches[0] : null;
}

function findLocationSourceByPatrolSource(patrolSource) {
  if (!patrolSource) {
    return null;
  }

  const data = loadLocationSources();
  const sources = data.sources || [];
  const byUrl = findLocationSourceByUrl(patrolSource.url);
  if (byUrl) {
    return byUrl;
  }

  return sources.find((source) => {
    return source.area_id === patrolSource.area_id && source.status === "ACTIVE";
  }) || null;
}

function getActiveLocationSourceIds() {
  const data = loadLocationSources();
  return new Set(
    (data.sources || [])
      .filter((source) => source.status === "ACTIVE")
      .map((source) => source.source_id)
  );
}

module.exports = {
  LOCATION_SOURCES_FILE,
  loadLocationSources,
  findLocationSourceByUrl,
  findLocationSourcesByUrl,
  findLocationSourceByPatrolSource,
  getActiveLocationSourceIds
};

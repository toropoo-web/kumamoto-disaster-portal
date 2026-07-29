"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const INFRASTRUCTURE_SOURCES_FILE = path.join(ROOT, "data", "public", "infrastructure_sources.json");

const PATROL_CATEGORIES = new Set(["ROAD", "WATER_SERVICE", "COMMUNICATION"]);
const EXCLUDED_PATROL_SOURCE_TYPES = new Set(["EXTERNAL_INFRA_MAP"]);

function loadInfrastructureSources() {
  if (!fs.existsSync(INFRASTRUCTURE_SOURCES_FILE)) {
    return { version: 1, sources: [] };
  }
  return JSON.parse(fs.readFileSync(INFRASTRUCTURE_SOURCES_FILE, "utf8"));
}

function normalizeUrl(url) {
  if (!url) {
    return "";
  }
  return url.split("#")[0];
}

function normalizeAreaScope(areaScope) {
  if (Array.isArray(areaScope)) {
    return areaScope;
  }
  if (typeof areaScope === "string" && areaScope.trim() !== "") {
    return [areaScope.trim()];
  }
  return [];
}

function findInfrastructureSourcesByUrl(url) {
  const normalized = normalizeUrl(url);
  const data = loadInfrastructureSources();
  return (data.sources || []).filter((source) => {
    return source.status === "ACTIVE" && normalizeUrl(source.url) === normalized;
  });
}

function findInfrastructureSourceByUrl(url) {
  const matches = findInfrastructureSourcesByUrl(url);
  return matches.length ? matches[0] : null;
}

function findInfrastructureSourceById(sourceId) {
  const data = loadInfrastructureSources();
  return (data.sources || []).find((source) => source.source_id === sourceId) || null;
}

function isPatrolEligibleSource(source) {
  if (!source || source.status !== "ACTIVE") {
    return false;
  }
  if (!PATROL_CATEGORIES.has(source.category)) {
    return false;
  }
  if (EXCLUDED_PATROL_SOURCE_TYPES.has(source.source_type)) {
    return false;
  }
  return Boolean(source.url);
}

function getPatrolInfrastructureSources() {
  const data = loadInfrastructureSources();
  return (data.sources || []).filter(isPatrolEligibleSource);
}

function toPatrolSource(infrastructureSource) {
  const areaScope = normalizeAreaScope(infrastructureSource.area_scope);
  return {
    id: infrastructureSource.source_id,
    area_id: areaScope[0] || null,
    area_scope: areaScope,
    name: infrastructureSource.provider,
    category: infrastructureSource.category,
    url: infrastructureSource.url,
    source_type: infrastructureSource.source_type,
    provider: infrastructureSource.provider
  };
}

module.exports = {
  INFRASTRUCTURE_SOURCES_FILE,
  PATROL_CATEGORIES,
  EXCLUDED_PATROL_SOURCE_TYPES,
  loadInfrastructureSources,
  findInfrastructureSourceByUrl,
  findInfrastructureSourcesByUrl,
  findInfrastructureSourceById,
  isPatrolEligibleSource,
  getPatrolInfrastructureSources,
  toPatrolSource,
  normalizeAreaScope
};

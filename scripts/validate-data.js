#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data", "public");

const EXPECTED_AREA_COUNT = 23;
const EXPECTED_PUBLIC_CARD_COUNT = 29;

const ALLOWED_CATEGORIES = new Set([
  "EMERGENCY", "SHELTER", "WATER", "LIFELINE",
  "ROAD", "CERTIFICATE", "IMPACT", "SUPPORT"
]);

const EXCLUDED_STATUSES = new Set([
  "REQUIRES_MANUAL_REVIEW", "NOT_FOUND", "NOT_APPLICABLE",
  "ARCHIVED", "SUPERSEDED", "ACCESS_ERROR", "VERIFIED_NO_CURRENT_INFORMATION"
]);

const INCIDENT_SCOPE = "2026_KUMAMOTO_EARTHQUAKE";
const PREF_DISASTER_HUB_URL = "https://www.pref.kumamoto.jp/soshiki/1/274517.html";

const AREA_RULES = {
  KM000: { allowed: ["EMERGENCY", "IMPACT", "ROAD", "LIFELINE", "SUPPORT"], blocked: ["SHELTER", "WATER", "CERTIFICATE"] },
  KM001: { allowed: ["EMERGENCY", "SHELTER", "WATER", "LIFELINE", "CERTIFICATE", "SUPPORT"], blocked: ["ROAD"] },
  KM002: { allowed: ["EMERGENCY", "SHELTER", "WATER", "CERTIFICATE", "IMPACT"], blocked: ["ROAD", "LIFELINE"], blockedHeadlines: ["宇土市の被害状況"] },
  KM003: { allowed: ["EMERGENCY", "SHELTER", "WATER"], blocked: ["ROAD", "CERTIFICATE", "IMPACT", "SUPPORT"] },
  KM004: { allowed: [], requireDirectVerification: true },
  KM005: { allowed: ["EMERGENCY", "SHELTER", "WATER", "SUPPORT"], blocked: ["ROAD", "CERTIFICATE", "IMPACT", "LIFELINE"] },
  KM006: { allowed: ["EMERGENCY", "SHELTER", "WATER", "SUPPORT"], blocked: ["ROAD", "CERTIFICATE", "IMPACT", "LIFELINE"] },
  KM007: { allowed: ["EMERGENCY", "SHELTER", "WATER", "SUPPORT"], blocked: ["ROAD", "CERTIFICATE", "IMPACT", "LIFELINE"] },
  KM008: { allowed: ["EMERGENCY", "SHELTER", "WATER", "SUPPORT"], blocked: ["ROAD", "CERTIFICATE", "IMPACT", "LIFELINE"] },
  KM009: { allowed: ["EMERGENCY", "SHELTER", "WATER", "SUPPORT"], blocked: ["ROAD", "CERTIFICATE", "IMPACT", "LIFELINE"] },
  KM010: { allowed: ["EMERGENCY", "SHELTER", "WATER", "SUPPORT"], blocked: ["ROAD", "CERTIFICATE", "IMPACT", "LIFELINE"] },
  KM011: { allowed: ["EMERGENCY", "SHELTER", "WATER", "SUPPORT"], blocked: ["ROAD", "CERTIFICATE", "IMPACT", "LIFELINE"] },
  KM012: { allowed: ["EMERGENCY", "SHELTER", "WATER", "SUPPORT"], blocked: ["ROAD", "CERTIFICATE", "IMPACT", "LIFELINE"] },
  KM013: { allowed: ["EMERGENCY", "SHELTER", "WATER", "SUPPORT"], blocked: ["ROAD", "CERTIFICATE", "IMPACT", "LIFELINE"] },
  KM014: { allowed: ["EMERGENCY", "SHELTER", "WATER", "SUPPORT"], blocked: ["ROAD", "CERTIFICATE", "IMPACT", "LIFELINE"] },
  KM015: { allowed: ["EMERGENCY", "SHELTER", "WATER", "SUPPORT"], blocked: ["ROAD", "CERTIFICATE", "IMPACT", "LIFELINE"] },
  KM016: { allowed: ["EMERGENCY", "SHELTER", "WATER", "SUPPORT"], blocked: ["ROAD", "CERTIFICATE", "IMPACT", "LIFELINE"] },
  KM017: { allowed: ["EMERGENCY", "SHELTER", "WATER", "SUPPORT"], blocked: ["ROAD", "CERTIFICATE", "IMPACT", "LIFELINE"] },
  KM018: { allowed: ["EMERGENCY", "SHELTER", "WATER", "SUPPORT"], blocked: ["ROAD", "CERTIFICATE", "IMPACT", "LIFELINE"] },
  KM019: { allowed: ["EMERGENCY", "SHELTER", "WATER", "SUPPORT"], blocked: ["ROAD", "CERTIFICATE", "IMPACT", "LIFELINE"] },
  KM020: { allowed: ["EMERGENCY", "SHELTER", "WATER", "SUPPORT"], blocked: ["ROAD", "CERTIFICATE", "IMPACT", "LIFELINE"] },
  KM021: { allowed: ["EMERGENCY", "SHELTER", "WATER", "SUPPORT"], blocked: ["ROAD", "CERTIFICATE", "IMPACT", "LIFELINE"] },
  KM022: { allowed: ["EMERGENCY", "SHELTER", "WATER", "SUPPORT"], blocked: ["ROAD", "CERTIFICATE", "IMPACT", "LIFELINE"] }
};

const CONTAMINATION_PATTERNS = [/2016/, /平成28/, /H28/];

const ALLOWED_LOCATION_CATEGORIES = new Set([
  "SHELTER", "WATER", "FOOD", "SUPPLY", "CHARGING", "ROAD", "SUPPORT", "LIFELINE", "MEDICAL", "OTHER"
]);

const ALLOWED_LOCATION_STATUS = new Set(["ACTIVE", "ENDED", "UNKNOWN", "PENDING_REVIEW"]);

const DISALLOWED_PUBLIC_LOCATION_STATUS = new Set(["ENDED", "UNKNOWN", "PENDING_REVIEW"]);

const ALLOWED_UPDATE_CYCLES = new Set(["DAILY", "EVENT"]);

const DAILY_UPDATE_CATEGORIES = new Set(["WATER", "FOOD", "SUPPLY", "CHARGING", "SUPPORT"]);

const OPERATION_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function getJstDateString(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}

function getExpectedUpdateCycle(category) {
  if (DAILY_UPDATE_CATEGORIES.has(category)) {
    return "DAILY";
  }
  return "EVENT";
}

function getLocationFreshness(location, now = new Date()) {
  if (!location || location.update_cycle !== "DAILY") {
    return "ACTIVE";
  }
  if (!location.operation_date) {
    return "STALE";
  }
  const today = getJstDateString(now);
  if (location.operation_date === today) {
    return "ACTIVE";
  }
  return "STALE";
}

function isPublicDisasterLocation(location, now = new Date()) {
  if (!location) {
    return false;
  }
  if (DISALLOWED_PUBLIC_LOCATION_STATUS.has(location.status)) {
    return false;
  }
  if (location.status !== "ACTIVE") {
    return false;
  }
  if (location.verification_status !== "VERIFIED") {
    return false;
  }
  if (location.expires_at) {
    const expiresAt = new Date(location.expires_at);
    if (!Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() < now.getTime()) {
      return false;
    }
  }
  return true;
}

const ALLOWED_SOURCE_TYPES = new Set([
  "MUNICIPALITY", "PREFECTURE", "NATIONAL", "JSDF", "JCG", "TELECOM", "OTHER",
  "official_disaster_portal", "official_emergency_portal", "official_portal"
]);

const ALLOWED_VERIFICATION_STATUS = new Set(["VERIFIED", "REQUIRES_MANUAL_REVIEW"]);

const ALLOWED_LOCATION_SOURCE_CATEGORIES = new Set([
  "WATER", "SHELTER", "ROAD", "LIFELINE", "EMERGENCY", "CHARGING", "FOOD", "SUPPLY", "MEDICAL", "OTHER"
]);

const ALLOWED_LOCATION_SOURCE_STATUS = new Set(["ACTIVE", "INACTIVE", "PENDING", "NOT_AVAILABLE"]);

const LOCATION_SOURCE_URL_REQUIRED_STATUS = new Set(["ACTIVE", "INACTIVE"]);

const DAILY_LOCATION_SOURCE_CATEGORIES = new Set(["WATER", "FOOD", "SUPPLY", "CHARGING", "SUPPORT"]);

function readJson(filename) {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, filename), "utf8"));
}

function isPublicRecord(record) {
  if (record.verification_status !== "VERIFIED") return false;
  if (record.incident_scope !== INCIDENT_SCOPE) return false;
  if (!record.source_url || !record.headline) return false;
  return true;
}

function isAllowedForArea(record) {
  const rules = AREA_RULES[record.area_id];
  if (!rules) return false;
  if (rules.blockedHeadlines && rules.blockedHeadlines.includes(record.headline)) return false;
  if (rules.requireDirectVerification) return false;
  if (rules.allowed.length === 0) return false;
  if (rules.blocked.includes(record.public_category_id)) return false;
  return rules.allowed.includes(record.public_category_id);
}

function isValidUrlFormat(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function validateXFeedPreview(errors) {
  const filePath = path.join(DATA_DIR, "x_feed_preview.json");
  if (!fs.existsSync(filePath)) {
    errors.push("x_feed_preview.json: file missing");
    return;
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    errors.push(`x_feed_preview.json: invalid JSON (${err.message})`);
    return;
  }

  if (!data.posts || !Array.isArray(data.posts)) {
    errors.push("x_feed_preview.json: posts array missing");
    return;
  }

  if (data.posts.length < 1 || data.posts.length > 8) {
    errors.push(`x_feed_preview.json: post count ${data.posts.length} (expected 1-8)`);
  }

  const seenUrls = new Set();
  data.posts.forEach((post, index) => {
    const required = ["source_id", "account_name", "post_time", "text", "url"];
    required.forEach((field) => {
      if (!post[field] || String(post[field]).trim() === "") {
        errors.push(`x_feed_preview.json[${index}]: missing ${field}`);
      }
    });

    if (post.url && !isValidUrlFormat(post.url)) {
      errors.push(`x_feed_preview.json[${index}]: invalid url`);
    }

    if (post.url) {
      if (seenUrls.has(post.url)) {
        errors.push(`x_feed_preview.json[${index}]: duplicate url`);
      }
      seenUrls.add(post.url);
    }

    if (post.source_id === "SRC-PER-001" || post.account_name === "小泉進次郎") {
      errors.push(`x_feed_preview.json[${index}]: personal source SRC-PER-001 must not appear in portal preview`);
    }
  });
}

function validateAreaNavigation(errors, areas) {
  const filePath = path.join(DATA_DIR, "area_navigation.json");
  if (!fs.existsSync(filePath)) {
    errors.push("area_navigation.json: file missing");
    return;
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    errors.push(`area_navigation.json: invalid JSON (${err.message})`);
    return;
  }

  if (!data.areas || !Array.isArray(data.areas)) {
    errors.push("area_navigation.json: areas array missing");
    return;
  }

  if (data.areas.length !== EXPECTED_AREA_COUNT) {
    errors.push(`area_navigation.json: area count ${data.areas.length} (expected ${EXPECTED_AREA_COUNT})`);
  }

  const areaIdSet = new Set(areas.map((area) => area.area_id));
  const navIds = new Set();

  data.areas.forEach((entry, index) => {
    if (!entry.area_id || !entry.name || !entry.navigation) {
      errors.push(`area_navigation.json[${index}]: required fields missing`);
      return;
    }

    if (!areaIdSet.has(entry.area_id)) {
      errors.push(`area_navigation.json[${index}]: unknown area_id ${entry.area_id}`);
    }

    if (navIds.has(entry.area_id)) {
      errors.push(`area_navigation.json: duplicate area_id ${entry.area_id}`);
    }
    navIds.add(entry.area_id);

    const requiredNav = ["water", "shelter", "road", "disaster_map"];
    requiredNav.forEach((field) => {
      if (!entry.navigation[field] || String(entry.navigation[field]).trim() === "") {
        errors.push(`area_navigation.json[${index}]: navigation.${field} missing`);
      }
    });

    if (entry.navigation.disaster_map && !isValidUrlFormat(entry.navigation.disaster_map)) {
      errors.push(`area_navigation.json[${index}]: invalid disaster_map URL`);
    }
  });

  areaIdSet.forEach((areaId) => {
    if (!navIds.has(areaId)) {
      errors.push(`area_navigation.json: missing area_id ${areaId}`);
    }
  });
}

function validateDisasterLocations(errors, areas) {
  const filePath = path.join(DATA_DIR, "disaster_locations.json");
  if (!fs.existsSync(filePath)) {
    errors.push("disaster_locations.json: file missing");
    return null;
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    errors.push(`disaster_locations.json: invalid JSON (${err.message})`);
    return null;
  }

  if (data.version !== 3) {
    errors.push(`disaster_locations.json: version ${data.version} (expected 23)`);
  }

  if (data.incident_scope !== INCIDENT_SCOPE) {
    errors.push(`disaster_locations.json: incident_scope mismatch (${data.incident_scope})`);
  }

  if (!data.locations || !Array.isArray(data.locations)) {
    errors.push("disaster_locations.json: locations array missing");
    return null;
  }

  const areaIdSet = new Set(areas.map((area) => area.area_id));
  const locationIds = new Set();
  const stats = {
    schemaVersion: data.version,
    locationCount: data.locations.length,
    areaIds: new Set(),
    categories: new Set(),
    activeCount: 0,
    endedCount: 0,
    unknownCount: 0,
    publicCount: 0,
    staleCount: 0,
    dailyCount: 0,
    eventCount: 0
  };

  data.locations.forEach((location, index) => {
    const label = location.location_id || `index ${index}`;
    const required = [
      "location_id", "area_id", "category", "name", "status", "update_cycle",
      "source", "source_url", "verified_at", "incident_scope", "verification_status"
    ];

    required.forEach((field) => {
      if (location[field] === undefined || location[field] === null || location[field] === "") {
        errors.push(`disaster_locations[${label}]: missing ${field}`);
      }
    });

    if (location.location_id) {
      if (locationIds.has(location.location_id)) {
        errors.push(`disaster_locations: duplicate location_id ${location.location_id}`);
      }
      locationIds.add(location.location_id);
    }

    if (location.area_id && !areaIdSet.has(location.area_id)) {
      errors.push(`disaster_locations[${label}]: unknown area_id ${location.area_id}`);
    }

    if (location.category && !ALLOWED_LOCATION_CATEGORIES.has(location.category)) {
      errors.push(`disaster_locations[${label}]: invalid category ${location.category}`);
    }

    if (location.status && !ALLOWED_LOCATION_STATUS.has(location.status)) {
      errors.push(`disaster_locations[${label}]: invalid status ${location.status}`);
    }

    if (location.verification_status && !ALLOWED_VERIFICATION_STATUS.has(location.verification_status)) {
      errors.push(`disaster_locations[${label}]: invalid verification_status ${location.verification_status}`);
    }

    if (location.source_url && !isValidUrlFormat(location.source_url)) {
      errors.push(`disaster_locations[${label}]: invalid source_url`);
    }

    if (location.source) {
      if (!location.source.type || !ALLOWED_SOURCE_TYPES.has(location.source.type)) {
        errors.push(`disaster_locations[${label}]: invalid source.type`);
      }
      if (!location.source.name) {
        errors.push(`disaster_locations[${label}]: missing source.name`);
      }
    }

    const hasLat = location.lat !== null && location.lat !== undefined;
    const hasLng = location.lng !== null && location.lng !== undefined;
    if (hasLat !== hasLng) {
      errors.push(`disaster_locations[${label}]: lat/lng must both be set or both null`);
    }
    if (hasLat && hasLng) {
      if (typeof location.lat !== "number" || typeof location.lng !== "number") {
        errors.push(`disaster_locations[${label}]: lat/lng must be numbers`);
      } else if (location.lat < -90 || location.lat > 90 || location.lng < -180 || location.lng > 180) {
        errors.push(`disaster_locations[${label}]: lat/lng out of range`);
      }
    }

    if (location.incident_scope && location.incident_scope !== INCIDENT_SCOPE) {
      errors.push(`disaster_locations[${label}]: incident_scope mismatch`);
    }

    const text = JSON.stringify(location);
    if (CONTAMINATION_PATTERNS.some((pattern) => pattern.test(text))) {
      errors.push(`disaster_locations[${label}]: 2016年情報混入の疑い`);
    }

    if (location.area_id) {
      stats.areaIds.add(location.area_id);
    }
    if (location.category) {
      stats.categories.add(location.category);
    }
    if (location.status === "PENDING_REVIEW") {
      errors.push(`disaster_locations[${label}]: PENDING_REVIEW must not appear in public JSON`);
    }

    if (location.update_cycle && !ALLOWED_UPDATE_CYCLES.has(location.update_cycle)) {
      errors.push(`disaster_locations[${label}]: invalid update_cycle ${location.update_cycle}`);
    }

    if (location.category && location.update_cycle) {
      const expectedCycle = getExpectedUpdateCycle(location.category);
      if (location.update_cycle !== expectedCycle) {
        errors.push(
          `disaster_locations[${label}]: update_cycle ${location.update_cycle} mismatches category ${location.category} (expected ${expectedCycle})`
        );
      }
    }

    if (location.update_cycle === "DAILY") {
      stats.dailyCount += 1;
      if (!location.operation_date) {
        errors.push(`disaster_locations[${label}]: DAILY requires operation_date`);
      } else if (!OPERATION_DATE_PATTERN.test(location.operation_date)) {
        errors.push(`disaster_locations[${label}]: invalid operation_date format`);
      } else if (location.operation_date > getJstDateString()) {
        errors.push(`disaster_locations[${label}]: operation_date is in the future`);
      }
    }

    if (location.update_cycle === "EVENT") {
      stats.eventCount += 1;
      if (location.operation_date !== null && location.operation_date !== undefined && location.operation_date !== "") {
        errors.push(`disaster_locations[${label}]: EVENT should not set operation_date`);
      }
    }

    if (location.status === "ACTIVE") {
      stats.activeCount += 1;
      ["verified_at", "last_checked_at"].forEach((field) => {
        if (!location[field]) {
          errors.push(`disaster_locations[${label}]: ACTIVE requires ${field}`);
        }
      });
      if (!location.source) {
        errors.push(`disaster_locations[${label}]: ACTIVE requires source`);
      }
    }

    if (location.status === "ENDED") {
      stats.endedCount += 1;
      if (!location.ended_at) {
        errors.push(`disaster_locations[${label}]: ENDED requires ended_at`);
      }
    }

    if (location.status === "UNKNOWN") {
      stats.unknownCount += 1;
      if (isPublicDisasterLocation(location)) {
        errors.push(`disaster_locations[${label}]: UNKNOWN must not be publicly visible`);
      }
    }

    if (isPublicDisasterLocation(location)) {
      stats.publicCount += 1;
      if (getLocationFreshness(location) === "STALE") {
        stats.staleCount += 1;
      }
    }
  });

  return stats;
}

function validateLocationSources(errors, areas) {
  const filePath = path.join(DATA_DIR, "location_sources.json");
  if (!fs.existsSync(filePath)) {
    errors.push("location_sources.json: file missing");
    return null;
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    errors.push(`location_sources.json: invalid JSON (${err.message})`);
    return null;
  }

  if (data.version !== 1) {
    errors.push(`location_sources.json: version ${data.version} (expected 23)`);
  }

  if (!data.sources || !Array.isArray(data.sources)) {
    errors.push("location_sources.json: sources array missing");
    return null;
  }

  const areaIdSet = new Set(areas.map((area) => area.area_id));
  const areaNameById = new Map(areas.map((area) => [area.area_id, area.name]));
  const sourceIds = new Set();
  const stats = {
    sourceCount: data.sources.length,
    areaIds: new Set(),
    categories: new Set(),
    activeCount: 0,
    pendingCount: 0,
    notAvailableCount: 0,
    registeredAreaIds: new Set(),
    pendingAreaIds: new Set()
  };

  data.sources.forEach((source, index) => {
    const label = source.source_id || `index ${index}`;
    const required = [
      "source_id", "area_id", "municipality", "category",
      "update_cycle", "source_type", "last_checked_at", "status"
    ];

    required.forEach((field) => {
      if (source[field] === undefined || source[field] === null || source[field] === "") {
        errors.push(`location_sources[${label}]: missing ${field}`);
      }
    });

    if (LOCATION_SOURCE_URL_REQUIRED_STATUS.has(source.status) && !source.url) {
      errors.push(`location_sources[${label}]: ${source.status} requires url`);
    }

    if ((source.status === "PENDING" || source.status === "NOT_AVAILABLE") && !source.status_reason) {
      errors.push(`location_sources[${label}]: ${source.status} requires status_reason`);
    }

    if ((source.status === "PENDING" || source.status === "NOT_AVAILABLE") && source.url) {
      errors.push(`location_sources[${label}]: ${source.status} must not set url`);
    }

    if (source.source_id) {
      if (sourceIds.has(source.source_id)) {
        errors.push(`location_sources: duplicate source_id ${source.source_id}`);
      }
      sourceIds.add(source.source_id);
    }

    if (source.area_id && !areaIdSet.has(source.area_id)) {
      errors.push(`location_sources[${label}]: unknown area_id ${source.area_id}`);
    }

    if (source.area_id && source.municipality && areaNameById.get(source.area_id) !== source.municipality) {
      errors.push(`location_sources[${label}]: municipality mismatch for ${source.area_id}`);
    }

    if (source.category && !ALLOWED_LOCATION_SOURCE_CATEGORIES.has(source.category)) {
      errors.push(`location_sources[${label}]: invalid category ${source.category}`);
    }

    if (source.update_cycle && !ALLOWED_UPDATE_CYCLES.has(source.update_cycle)) {
      errors.push(`location_sources[${label}]: invalid update_cycle ${source.update_cycle}`);
    }

    if (source.status === "ACTIVE" && source.category && source.update_cycle) {
      if (source.category === "EMERGENCY" && source.update_cycle !== "EVENT") {
        errors.push(`location_sources[${label}]: EMERGENCY requires update_cycle EVENT`);
      } else if (DAILY_LOCATION_SOURCE_CATEGORIES.has(source.category) && source.update_cycle !== "DAILY") {
        errors.push(`location_sources[${label}]: ${source.category} requires update_cycle DAILY`);
      } else if (
        !DAILY_LOCATION_SOURCE_CATEGORIES.has(source.category) &&
        source.category !== "EMERGENCY" &&
        source.update_cycle !== "EVENT"
      ) {
        errors.push(`location_sources[${label}]: ${source.category} requires update_cycle EVENT`);
      }
    }

    if (source.source_type && !ALLOWED_SOURCE_TYPES.has(source.source_type)) {
      errors.push(`location_sources[${label}]: invalid source_type ${source.source_type}`);
    }

    if (source.status && !ALLOWED_LOCATION_SOURCE_STATUS.has(source.status)) {
      errors.push(`location_sources[${label}]: invalid status ${source.status}`);
    }

    if (source.url && !isValidUrlFormat(source.url)) {
      errors.push(`location_sources[${label}]: invalid url`);
    }

    if (source.area_id) {
      stats.areaIds.add(source.area_id);
    }
    if (source.category) {
      stats.categories.add(source.category);
    }
    if (source.status === "ACTIVE") {
      stats.activeCount += 1;
      if (source.area_id) {
        stats.registeredAreaIds.add(source.area_id);
      }
    }
    if (source.status === "PENDING") {
      stats.pendingCount += 1;
      if (source.area_id) {
        stats.pendingAreaIds.add(source.area_id);
      }
    }
    if (source.status === "NOT_AVAILABLE") {
      stats.notAvailableCount += 1;
    }
  });

  if (stats.areaIds.size !== areas.length) {
    const missingAreas = areas
      .filter((area) => !stats.areaIds.has(area.area_id))
      .map((area) => area.area_id);
    if (missingAreas.length) {
      errors.push(`location_sources.json: missing area coverage (${missingAreas.join(", ")})`);
    }
  }

  return stats;
}

const ALLOWED_EMERGENCY_SOURCE_TYPES = new Set([
  "MUNICIPAL_X",
  "EMERGENCY_PAGE",
  "DISASTER_PAGE"
]);

function validateEmergencySources(errors, areas) {
  const filePath = path.join(DATA_DIR, "emergency_sources.json");
  if (!fs.existsSync(filePath)) {
    errors.push("emergency_sources.json: file missing");
    return null;
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    errors.push(`emergency_sources.json: invalid JSON (${err.message})`);
    return null;
  }

  if (data.version !== 1) {
    errors.push(`emergency_sources.json: version ${data.version} (expected 23)`);
  }

  if (!data.sources || !Array.isArray(data.sources)) {
    errors.push("emergency_sources.json: sources array missing");
    return null;
  }

  const areaIdSet = new Set(areas.map((area) => area.area_id));
  const areaNameById = new Map(areas.map((area) => [area.area_id, area.name]));
  const sourceIds = new Set();
  const stats = {
    sourceCount: data.sources.length,
    activeCount: 0,
    areaIds: new Set()
  };

  data.sources.forEach((source, index) => {
    const label = source.source_id || `index ${index}`;
    const required = ["source_id", "area_id", "municipality", "source_type", "url", "status"];

    required.forEach((field) => {
      if (!source[field]) {
        errors.push(`emergency_sources[${label}]: missing ${field}`);
      }
    });

    if (source.source_type && !ALLOWED_EMERGENCY_SOURCE_TYPES.has(source.source_type)) {
      errors.push(`emergency_sources[${label}]: invalid source_type ${source.source_type}`);
    }

    if (source.source_type === "MUNICIPAL_X" && !source.x_feed_source_id) {
      errors.push(`emergency_sources[${label}]: MUNICIPAL_X requires x_feed_source_id`);
    }

    if (source.source_id) {
      if (sourceIds.has(source.source_id)) {
        errors.push(`emergency_sources: duplicate source_id ${source.source_id}`);
      }
      sourceIds.add(source.source_id);
    }

    if (source.area_id && !areaIdSet.has(source.area_id)) {
      errors.push(`emergency_sources[${label}]: unknown area_id ${source.area_id}`);
    }

    if (source.area_id && source.municipality && areaNameById.get(source.area_id) !== source.municipality) {
      errors.push(`emergency_sources[${label}]: municipality mismatch for ${source.area_id}`);
    }

    if (source.area_id) {
      stats.areaIds.add(source.area_id);
    }

    if (source.status === "ACTIVE") {
      stats.activeCount += 1;
    }
  });

  return stats;
}

const ALLOWED_INFRASTRUCTURE_CATEGORIES = new Set([
  "ROAD",
  "POWER",
  "WATER_SERVICE",
  "COMMUNICATION"
]);

const ALLOWED_INFRASTRUCTURE_SOURCE_TYPES = new Set([
  "PREFECTURE_HAZARD_PORTAL",
  "MUNICIPAL_ROAD_PAGE",
  "MLIT_ROAD_INFO",
  "POWER_UTILITY_PAGE",
  "WATER_BUREAU_PAGE",
  "MUNICIPAL_WATER_PAGE",
  "CARRIER_STATUS_PAGE",
  "DISASTER_WIFI_PAGE",
  "DISASTER_MESSAGE_PAGE",
  "EXTERNAL_INFRA_MAP"
]);

const ALLOWED_INFRASTRUCTURE_SOURCE_STATUS = new Set([
  "ACTIVE",
  "PENDING",
  "NOT_AVAILABLE"
]);

const ALLOWED_INFRASTRUCTURE_ITEM_TYPES = new Set([
  "POINT",
  "LINE",
  "AREA",
  "STATUS",
  "EXTERNAL_LINK"
]);

const INFRASTRUCTURE_STATUS_BY_CATEGORY = {
  ROAD: new Set(["CLOSED", "RESTRICTED", "PASSABLE", "CHECK_OFFICIAL", "PENDING", "UNKNOWN"]),
  POWER: new Set(["OUTAGE", "PARTIAL_OUTAGE", "RESTORING", "RESTORED", "CHECK_OFFICIAL", "PENDING", "UNKNOWN"]),
  WATER_SERVICE: new Set([
    "SUSPENDED",
    "LOW_PRESSURE",
    "TURBID",
    "RESTORING",
    "RESTORED",
    "CHECK_OFFICIAL",
    "PENDING",
    "UNKNOWN"
  ]),
  COMMUNICATION: new Set(["OUTAGE", "PARTIAL_OUTAGE", "AVAILABLE", "CHECK_OFFICIAL", "PENDING", "UNKNOWN"])
};

const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function isValidIsoTimestamp(value) {
  if (value === null || value === undefined || value === "") {
    return true;
  }
  if (typeof value !== "string" || !ISO_TIMESTAMP_PATTERN.test(value)) {
    return false;
  }
  return !Number.isNaN(Date.parse(value));
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

function validateInfrastructureSources(errors, areas) {
  const filePath = path.join(DATA_DIR, "infrastructure_sources.json");
  if (!fs.existsSync(filePath)) {
    errors.push("infrastructure_sources.json: file missing");
    return null;
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    errors.push(`infrastructure_sources.json: invalid JSON (${err.message})`);
    return null;
  }

  if (data.version !== 1) {
    errors.push(`infrastructure_sources.json: version ${data.version} (expected 23)`);
  }

  if (!data.sources || !Array.isArray(data.sources)) {
    errors.push("infrastructure_sources.json: sources array missing");
    return null;
  }

  const areaIdSet = new Set(areas.map((area) => area.area_id));
  const sourceIds = new Set();
  const stats = {
    sourceCount: data.sources.length,
    activeCount: 0,
    pendingCount: 0,
    categories: new Set()
  };

  data.sources.forEach((source, index) => {
    const label = source.source_id || `index ${index}`;
    const required = ["source_id", "provider", "category", "area_scope", "source_type", "status"];

    required.forEach((field) => {
      if (source[field] === undefined || source[field] === null || source[field] === "") {
        errors.push(`infrastructure_sources[${label}]: missing ${field}`);
      }
    });

    const scope = normalizeAreaScope(source.area_scope);
    if (!scope.length) {
      errors.push(`infrastructure_sources[${label}]: area_scope must not be empty`);
    }
    scope.forEach((areaId) => {
      if (!areaIdSet.has(areaId)) {
        errors.push(`infrastructure_sources[${label}]: unknown area_scope ${areaId}`);
      }
    });

    if (source.category && !ALLOWED_INFRASTRUCTURE_CATEGORIES.has(source.category)) {
      errors.push(`infrastructure_sources[${label}]: invalid category ${source.category}`);
    }

    if (source.source_type && !ALLOWED_INFRASTRUCTURE_SOURCE_TYPES.has(source.source_type)) {
      errors.push(`infrastructure_sources[${label}]: invalid source_type ${source.source_type}`);
    }

    if (source.status && !ALLOWED_INFRASTRUCTURE_SOURCE_STATUS.has(source.status)) {
      errors.push(`infrastructure_sources[${label}]: invalid status ${source.status}`);
    }

    if (source.status === "ACTIVE") {
      stats.activeCount += 1;
      if (!source.url) {
        errors.push(`infrastructure_sources[${label}]: ACTIVE requires url`);
      }
    }

    if (source.status === "PENDING" || source.status === "NOT_AVAILABLE") {
      if (source.status === "PENDING") {
        stats.pendingCount += 1;
      }
      if (!source.status_reason) {
        errors.push(`infrastructure_sources[${label}]: ${source.status} requires status_reason`);
      }
      if (source.url) {
        errors.push(`infrastructure_sources[${label}]: ${source.status} must not set url`);
      }
    }

    if (source.url && !isValidUrlFormat(source.url)) {
      errors.push(`infrastructure_sources[${label}]: invalid url`);
    }

    if (source.source_id) {
      if (sourceIds.has(source.source_id)) {
        errors.push(`infrastructure_sources: duplicate source_id ${source.source_id}`);
      }
      sourceIds.add(source.source_id);
    }

    if (source.category) {
      stats.categories.add(source.category);
    }
  });

  stats.sourceIds = sourceIds;
  return stats;
}

function validateInfrastructureStatus(errors, areas, infrastructureSourceStats) {
  const filePath = path.join(DATA_DIR, "infrastructure_status.json");
  if (!fs.existsSync(filePath)) {
    errors.push("infrastructure_status.json: file missing");
    return null;
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    errors.push(`infrastructure_status.json: invalid JSON (${err.message})`);
    return null;
  }

  if (data.version !== 1) {
    errors.push(`infrastructure_status.json: version ${data.version} (expected 23)`);
  }

  if (!data.items || !Array.isArray(data.items)) {
    errors.push("infrastructure_status.json: items array missing");
    return null;
  }

  const areaIdSet = new Set(areas.map((area) => area.area_id));
  const sourceIds = infrastructureSourceStats ? infrastructureSourceStats.sourceIds : new Set();
  const statusIds = new Set();
  const stats = {
    itemCount: data.items.length,
    categories: new Set(),
    types: new Set()
  };

  data.items.forEach((item, index) => {
    const label = item.status_id || `index ${index}`;
    const required = [
      "status_id",
      "area_id",
      "category",
      "type",
      "title",
      "status",
      "source_id",
      "last_checked_at"
    ];

    required.forEach((field) => {
      if (item[field] === undefined || item[field] === null || item[field] === "") {
        errors.push(`infrastructure_status[${label}]: missing ${field}`);
      }
    });

    if (item.status_id) {
      if (statusIds.has(item.status_id)) {
        errors.push(`infrastructure_status: duplicate status_id ${item.status_id}`);
      }
      statusIds.add(item.status_id);
    }

    if (item.area_id && !areaIdSet.has(item.area_id)) {
      errors.push(`infrastructure_status[${label}]: unknown area_id ${item.area_id}`);
    }

    if (item.category && !ALLOWED_INFRASTRUCTURE_CATEGORIES.has(item.category)) {
      errors.push(`infrastructure_status[${label}]: invalid category ${item.category}`);
    }

    if (item.type && !ALLOWED_INFRASTRUCTURE_ITEM_TYPES.has(item.type)) {
      errors.push(`infrastructure_status[${label}]: invalid type ${item.type}`);
    }

    if (item.type === "EXTERNAL_LINK") {
      if (item.category !== "ROAD") {
        errors.push(`infrastructure_status[${label}]: EXTERNAL_LINK requires category ROAD`);
      }
      if (!item.provider) {
        errors.push(`infrastructure_status[${label}]: EXTERNAL_LINK requires provider`);
      }
    }

    if (item.category && item.status) {
      const allowedStatuses = INFRASTRUCTURE_STATUS_BY_CATEGORY[item.category];
      if (allowedStatuses && !allowedStatuses.has(item.status)) {
        errors.push(`infrastructure_status[${label}]: status ${item.status} invalid for ${item.category}`);
      }
    }

    if (item.source_id) {
      if (!sourceIds.has(item.source_id)) {
        errors.push(`infrastructure_status[${label}]: unknown source_id ${item.source_id}`);
      }
    }

    if (!isValidIsoTimestamp(item.last_checked_at)) {
      errors.push(`infrastructure_status[${label}]: invalid last_checked_at`);
    }

    if (!isValidIsoTimestamp(item.source_updated_at)) {
      errors.push(`infrastructure_status[${label}]: invalid source_updated_at`);
    }

    if (item.category) {
      stats.categories.add(item.category);
    }
    if (item.type) {
      stats.types.add(item.type);
    }
  });

  return stats;
}

function main() {
  const areas = readJson("phase1_areas.json");
  const navigation = readJson("phase1_navigation.json");
  const updates = readJson("phase1_updates.json");

  const errors = [];
  const areaIds = new Set();
  const updateIds = new Set();

  if (areas.length !== EXPECTED_AREA_COUNT) {
    errors.push(`公開地域数: ${areas.length} (期待値: ${EXPECTED_AREA_COUNT})`);
  }

  areas.forEach((area, i) => {
    if (!area.area_id || !area.name || !area.anchor) {
      errors.push(`地域 index ${i}: 必須フィールド欠落`);
    }
    if (areaIds.has(area.area_id)) {
      errors.push(`地域ID重複: ${area.area_id}`);
    }
    areaIds.add(area.area_id);
  });

  if (navigation.length !== EXPECTED_AREA_COUNT) {
    errors.push(`ナビゲーション数: ${navigation.length} (期待値: ${EXPECTED_AREA_COUNT})`);
  }

  navigation.forEach((item, i) => {
    const area = areas[i];
    if (!area || item.area_id !== area.area_id || item.name !== area.name || item.anchor !== area.anchor) {
      errors.push(`ナビゲーション不一致: index ${i}`);
    }
  });

  updates.forEach((record, i) => {
    const key = `${record.area_id}|${record.headline}|${record.source_url}`;
    if (updateIds.has(key)) {
      errors.push(`レコード重複: index ${i}`);
    }
    updateIds.add(key);

    if (!AREA_RULES[record.area_id] && record.area_id !== "KM004") {
      errors.push(`レコード${i}: 未定義 area_id=${record.area_id}`);
    }
    if (!ALLOWED_CATEGORIES.has(record.public_category_id)) {
      errors.push(`レコード${i}: 公開8カテゴリ以外 category=${record.public_category_id}`);
    }
    if (record.incident_scope && record.incident_scope !== INCIDENT_SCOPE) {
      errors.push(`レコード${i}: incident_scope不一致 (${record.incident_scope})`);
    }
    if (EXCLUDED_STATUSES.has(record.verification_status)) {
      errors.push(`レコード${i}: 除外ステータス (${record.verification_status})`);
    }

    const text = JSON.stringify(record);
    if (CONTAMINATION_PATTERNS.some((p) => p.test(text))) {
      errors.push(`レコード${i}: 2016年情報混入の疑い`);
    }
  });

  const publicRecords = updates.filter(isPublicRecord).filter(isAllowedForArea);
  const urlCounts = new Map();

  publicRecords.forEach((record, i) => {
    const label = record.headline || `index ${i}`;

    if (!record.source_url) {
      errors.push(`レコード「${label}」: source_url 欠落`);
    } else if (!isValidUrlFormat(record.source_url)) {
      errors.push(`レコード「${label}」: URL形式不正 (${record.source_url})`);
    }

    if (!record.headline || record.headline.trim() === "") {
      errors.push(`レコード${i}: 空見出し`);
    }

    if (!record.summary || record.summary.trim() === "") {
      if (!(record.update_type === "EMERGENCY_INFO" && record.original_text)) {
        errors.push(`レコード「${label}」: 空summary`);
      }
    }

    if (record.update_type === "EMERGENCY_INFO" && !record.original_text) {
      errors.push(`レコード「${label}」: EMERGENCY_INFO requires original_text`);
    }

    if (record.source_url) {
      const normalized = record.source_url.split("#")[0];
      urlCounts.set(normalized, (urlCounts.get(normalized) || 0) + 1);
    }
  });

  urlCounts.forEach((count, url) => {
    if (count > 1 && url !== PREF_DISASTER_HUB_URL) {
      errors.push(`source_url重複 (fragment除く): ${url} (${count}件)`);
    }
  });

  if (publicRecords.length !== EXPECTED_PUBLIC_CARD_COUNT) {
    errors.push(`公開カード数: ${publicRecords.length} (期待値: ${EXPECTED_PUBLIC_CARD_COUNT})`);
  }

  validateXFeedPreview(errors);
  validateAreaNavigation(errors, areas);
  const locationStats = validateDisasterLocations(errors, areas);
  const locationSourceStats = validateLocationSources(errors, areas);
  const emergencySourceStats = validateEmergencySources(errors, areas);
  const infrastructureSourceStats = validateInfrastructureSources(errors, areas);
  const infrastructureStatusStats = validateInfrastructureStatus(errors, areas, infrastructureSourceStats);

  const result = {
    AREA_COUNT: areas.length,
    PUBLIC_CARD_COUNT: publicRecords.length,
    LOCATION_COUNT: locationStats ? locationStats.locationCount : 0,
    LOCATION_AREA_COUNT: locationStats ? locationStats.areaIds.size : 0,
    LOCATION_CATEGORY_COUNT: locationStats ? locationStats.categories.size : 0,
    SCHEMA_VERSION: locationStats ? locationStats.schemaVersion : 0,
    LOCATION_ACTIVE_COUNT: locationStats ? locationStats.activeCount : 0,
    LOCATION_ENDED_COUNT: locationStats ? locationStats.endedCount : 0,
    LOCATION_UNKNOWN_COUNT: locationStats ? locationStats.unknownCount : 0,
    LOCATION_PUBLIC_COUNT: locationStats ? locationStats.publicCount : 0,
    LOCATION_STALE_COUNT: locationStats ? locationStats.staleCount : 0,
    LOCATION_DAILY_COUNT: locationStats ? locationStats.dailyCount : 0,
    LOCATION_EVENT_COUNT: locationStats ? locationStats.eventCount : 0,
    LOCATION_SOURCE_COUNT: locationSourceStats ? locationSourceStats.sourceCount : 0,
    LOCATION_SOURCE_AREA_COUNT: locationSourceStats ? locationSourceStats.areaIds.size : 0,
    LOCATION_SOURCE_CATEGORY_COUNT: locationSourceStats ? locationSourceStats.categories.size : 0,
    LOCATION_SOURCE_ACTIVE_COUNT: locationSourceStats ? locationSourceStats.activeCount : 0,
    LOCATION_SOURCE_REGISTERED_AREA_COUNT: locationSourceStats ? locationSourceStats.registeredAreaIds.size : 0,
    LOCATION_SOURCE_PENDING_AREA_COUNT: locationSourceStats ? locationSourceStats.pendingAreaIds.size : 0,
    EMERGENCY_SOURCE_COUNT: emergencySourceStats ? emergencySourceStats.sourceCount : 0,
    EMERGENCY_SOURCE_ACTIVE_COUNT: emergencySourceStats ? emergencySourceStats.activeCount : 0,
    INFRASTRUCTURE_SOURCE_COUNT: infrastructureSourceStats ? infrastructureSourceStats.sourceCount : 0,
    INFRASTRUCTURE_SOURCE_ACTIVE_COUNT: infrastructureSourceStats ? infrastructureSourceStats.activeCount : 0,
    INFRASTRUCTURE_STATUS_COUNT: infrastructureStatusStats ? infrastructureStatusStats.itemCount : 0,
    INFRASTRUCTURE_CATEGORY_COUNT: infrastructureStatusStats ? infrastructureStatusStats.categories.size : 0,
    DUPLICATE_MUNICIPALITY_ID: areaIds.size === areas.length ? 0 : 1,
    DUPLICATE_URL_COUNT: [...urlCounts.values()].filter((c) => c > 1).length,
    DATA_2016_CONTAMINATION: errors.some((e) => e.includes("2016")) ? "FOUND" : "NONE",
    DATA_VALIDATION: errors.length === 0 ? "PASS" : "FAIL",
    errors
  };

  console.log("=== Phase3 Data Validation ===");
  console.log(JSON.stringify(result, null, 2));

  if (errors.length > 0) {
    process.exit(1);
  }
}

main();

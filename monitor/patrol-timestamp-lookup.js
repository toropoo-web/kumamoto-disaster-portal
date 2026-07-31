"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PATROL_SNAPSHOT_FILE = path.join(__dirname, "reports", "snapshots.json");
const WATER_SNAPSHOT_FILE = path.join(__dirname, "reports", "water-snapshots.json");

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function normalizeUrl(url) {
  if (!url) {
    return "";
  }
  return String(url).trim().replace(/\/$/, "");
}

function normalizePageUpdatedAt(pageUpdatedAt) {
  if (!pageUpdatedAt) {
    return null;
  }
  const parsed = Date.parse(pageUpdatedAt);
  if (!Number.isNaN(parsed)) {
    return new Date(parsed).toISOString();
  }
  return pageUpdatedAt;
}

function mergeTimestampEntry(target, patch) {
  if (!target || !patch) {
    return;
  }
  if (patch.source_updated_at && !target.source_updated_at) {
    target.source_updated_at = patch.source_updated_at;
  }
  if (patch.checked_at && !target.checked_at) {
    target.checked_at = patch.checked_at;
  }
}

function buildPatrolTimestampLookup(options) {
  options = options || {};
  const lookup = {};

  function store(url, patch) {
    const key = normalizeUrl(url);
    if (!key || !patch) {
      return;
    }
    if (!lookup[key]) {
      lookup[key] = {};
    }
    mergeTimestampEntry(lookup[key], patch);
  }

  const patrolSnapshots = readJson(
    options.patrolSnapshotPath || PATROL_SNAPSHOT_FILE,
    { sources: {} }
  );
  Object.values(patrolSnapshots.sources || {}).forEach(function (entry) {
    if (!entry || entry.reachable !== true || !entry.url) {
      return;
    }
    const sourceUpdatedAt = normalizePageUpdatedAt(
      entry.sourceUpdatedAt || entry.pageUpdatedAt
    );
    store(entry.url, {
      source_updated_at: sourceUpdatedAt || null,
      checked_at: entry.checkedAt || null
    });
  });

  const waterSnapshots = readJson(
    options.waterSnapshotPath || WATER_SNAPSHOT_FILE,
    { sources: {} }
  );
  Object.values(waterSnapshots.sources || {}).forEach(function (entry) {
    if (!entry || entry.reachable !== true || !entry.url) {
      return;
    }
    store(entry.url, {
      checked_at: entry.fetched_at || entry.checkedAt || null
    });
  });

  return lookup;
}

function resolvePatrolTimestamps(lookup, url) {
  const key = normalizeUrl(url);
  if (!key || !lookup || !lookup[key]) {
    return {};
  }
  return lookup[key];
}

function applyPatrolTimestamps(entry, lookup) {
  if (!entry || !lookup) {
    return entry;
  }
  const timestamps = resolvePatrolTimestamps(lookup, entry.source_url || entry.url);
  if (!timestamps.source_updated_at && !timestamps.checked_at) {
    return entry;
  }

  const next = Object.assign({}, entry);
  if (timestamps.source_updated_at) {
    next.source_updated_at = timestamps.source_updated_at;
  }
  if (timestamps.checked_at) {
    next.checked_at = timestamps.checked_at;
  }
  return next;
}

function shouldApplyPatrolTimestamps(item, categories) {
  if (!categories || !categories.length) {
    return true;
  }
  if (!item.category) {
    return true;
  }
  return categories.indexOf(item.category) !== -1;
}

function applyPatrolTimestampsToItems(items, lookup, categories) {
  return (items || []).map(function (item) {
    if (!item || !shouldApplyPatrolTimestamps(item, categories)) {
      return item;
    }
    return applyPatrolTimestamps(item, lookup);
  });
}

module.exports = {
  PATROL_SNAPSHOT_FILE,
  WATER_SNAPSHOT_FILE,
  normalizeUrl,
  normalizePageUpdatedAt,
  buildPatrolTimestampLookup,
  resolvePatrolTimestamps,
  applyPatrolTimestamps,
  applyPatrolTimestampsToItems
};

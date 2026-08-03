"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PHASE1_UPDATES_FILE = path.join(ROOT, "data", "public", "phase1_updates.json");
const MUNICIPALITY_REGISTRY_FILE = path.join(
  ROOT,
  "data",
  "municipality_patrol",
  "municipality_top_page_sources.json"
);
const PORTAL_UI_TARGETS_FILE = path.join(
  ROOT,
  "data",
  "municipality_expansion",
  "portal_ui_targets.json"
);
const SOURCES_FILE = path.join(ROOT, "monitor", "sources.json");
const SNAPSHOT_FILE = path.join(ROOT, "monitor", "reports", "snapshots.json");
const DISASTER_SEARCH_PUBLIC_FILE = path.join(ROOT, "data", "public", "disaster_search_index.json");
const INCIDENT_SCOPE = "2026_KUMAMOTO_EARTHQUAKE";

const DEFAULT_SUMMARY =
  "避難所・断水・災害情報など、自治体公式の防災ページです。最新状況はリンク先でご確認ください。";

const MUNICIPALITY_SUMMARY_OVERRIDES = {
  KM004: "美里町の公式防災・緊急情報ページです。最新状況はリンク先でご確認ください。"
};

const DISASTER_SEARCH_FALLBACK_AREAS = new Set(["KM004"]);

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
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

function buildFallbackHeadline(name) {
  return "防災・緊急情報（" + name + "）";
}

function loadRegistryTargets() {
  const targets = new Map();
  const registry = readJson(MUNICIPALITY_REGISTRY_FILE, { municipalities: [] });

  (registry.municipalities || []).forEach(function (entry) {
    if (!entry.area_id || !entry.disaster_page_url) {
      return;
    }
    targets.set(entry.area_id, {
      area_id: entry.area_id,
      name: entry.municipality,
      disaster_url: entry.disaster_page_url
    });
  });

  const portalTargets = readJson(PORTAL_UI_TARGETS_FILE, { municipalities: [] });
  (portalTargets.municipalities || []).forEach(function (entry) {
    if (!entry.area_id || !entry.disaster_url) {
      return;
    }
    targets.set(entry.area_id, {
      area_id: entry.area_id,
      name: entry.name,
      disaster_url: entry.disaster_url
    });
  });

  return targets;
}

function loadPrimaryEmergencySources() {
  const data = readJson(SOURCES_FILE, { municipalities: [] });
  const byArea = new Map();

  (data.municipalities || []).forEach(function (source) {
    if (
      source.public_category_id !== "EMERGENCY" ||
      source.patrol_role !== "primary" ||
      source.status !== "ACTIVE"
    ) {
      return;
    }
    if (!source.area_id || !source.url) {
      return;
    }
    byArea.set(source.area_id, {
      source_id: source.id,
      area_id: source.area_id,
      name: source.name,
      disaster_url: source.url
    });
  });

  return byArea;
}

function loadPortalUiTargetAreaIds() {
  const portalTargets = readJson(PORTAL_UI_TARGETS_FILE, { municipalities: [] });
  const areaIds = new Set();

  (portalTargets.municipalities || []).forEach(function (entry) {
    if (entry.area_id) {
      areaIds.add(entry.area_id);
    }
  });

  return areaIds;
}

function resolveFallbackTargets() {
  const registryTargets = loadRegistryTargets();
  const primarySources = loadPrimaryEmergencySources();
  const portalAreaIds = loadPortalUiTargetAreaIds();
  const merged = new Map();

  portalAreaIds.forEach(function (areaId) {
    const registryTarget = registryTargets.get(areaId);
    const primaryTarget = primarySources.get(areaId);
    if (!registryTarget && !primaryTarget) {
      return;
    }
    merged.set(areaId, {
      area_id: areaId,
      name: (primaryTarget && primaryTarget.name) || (registryTarget && registryTarget.name),
      disaster_url:
        (primaryTarget && primaryTarget.disaster_url) ||
        (registryTarget && registryTarget.disaster_url),
      source_id: primaryTarget && primaryTarget.source_id
    });
  });

  return merged;
}

function findSnapshotForTarget(snapshots, target) {
  const sources = snapshots.sources || {};
  if (target.source_id && sources[target.source_id]) {
    return sources[target.source_id];
  }

  return Object.values(sources).find(function (entry) {
    return entry.url === target.disaster_url;
  });
}

function isUsablePageText(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) {
    return false;
  }
  if (text.length < 4) {
    return false;
  }
  return !/^(トップページ|ホーム|メインページ|index)$/i.test(text);
}

function resolveHeadlineAndSummary(target, snapshot) {
  const headline = buildFallbackHeadline(target.name);
  let summary = MUNICIPALITY_SUMMARY_OVERRIDES[target.area_id] || DEFAULT_SUMMARY;

  if (snapshot && snapshot.reachable === true) {
    const pageTitle = snapshot.title || snapshot.pageTitle;
    const pageSummary =
      snapshot.description || snapshot.summary || snapshot.excerpt || snapshot.originalText;

    if (isUsablePageText(pageSummary)) {
      summary = String(pageSummary).replace(/\s+/g, " ").trim().slice(0, 240);
    } else if (isUsablePageText(pageTitle) && target.area_id === "KM004") {
      summary =
        String(pageTitle).replace(/\s+/g, " ").trim() +
        "。最新状況はリンク先でご確認ください。";
    }
  }

  return { headline, summary };
}

function buildPhase1Record(target, snapshot, checkedAt) {
  const resolved = resolveHeadlineAndSummary(target, snapshot);
  const sourceUpdatedAt = normalizePageUpdatedAt(
    snapshot && (snapshot.sourceUpdatedAt || snapshot.pageUpdatedAt)
  );
  const displayedAt = sourceUpdatedAt || checkedAt;

  const record = {
    area_id: target.area_id,
    area_name: target.name,
    public_category_id: "EMERGENCY",
    public_category_label: "地震・緊急情報",
    headline: resolved.headline,
    summary: resolved.summary,
    displayed_updated_at: displayedAt,
    source_name: target.name,
    source_url: target.disaster_url,
    department: target.name,
    verification_status: "VERIFIED",
    incident_scope: INCIDENT_SCOPE,
    collected_at: checkedAt,
    display_priority: 1,
    checked_at: checkedAt
  };

  if (sourceUpdatedAt) {
    record.source_updated_at = sourceUpdatedAt;
  }

  return record;
}

function mergePhase1EmergencyRecord(existing, record) {
  if (!existing.headline || !String(existing.headline).trim()) {
    existing.headline = record.headline;
  }
  if (!existing.summary || !String(existing.summary).trim()) {
    existing.summary = record.summary;
  }
  if (!existing.source_url || existing.source_url !== record.source_url) {
    existing.source_url = record.source_url;
  }
  existing.checked_at = record.checked_at;
  if (record.source_updated_at) {
    existing.source_updated_at = record.source_updated_at;
    existing.displayed_updated_at = record.displayed_updated_at;
  }
  if (!existing.verification_status) {
    existing.verification_status = "VERIFIED";
  }
  if (!existing.incident_scope) {
    existing.incident_scope = INCIDENT_SCOPE;
  }
  return existing;
}

function ensureDisasterSearchEmergencyItem(record) {
  if (!fs.existsSync(DISASTER_SEARCH_PUBLIC_FILE)) {
    return false;
  }

  const payload = readJson(DISASTER_SEARCH_PUBLIC_FILE, { items: [] });
  const items = Array.isArray(payload.items) ? payload.items : [];
  const indexId = "DIDX-" + record.area_id + "-EMERGENCY-PORTAL";
  const keywords = ["防災", "緊急", "地震", "避難", "災害", "公式"];
  const content = [
    record.area_name,
    record.headline,
    record.summary,
    keywords.join(" ")
  ].join(" ");

  const nextItem = {
    index_id: indexId,
    category: "WATER",
    prefecture: "熊本県",
    municipality: record.area_name,
    organization: record.area_name + "公式",
    title: record.headline,
    content: content,
    keywords: keywords,
    source_type: "MUNICIPALITY",
    source_url: record.source_url,
    official: true,
    updated_at: record.displayed_updated_at || record.checked_at
  };

  const existingIndex = items.findIndex(function (item) {
    return item.index_id === indexId;
  });

  if (existingIndex === -1) {
    items.push(nextItem);
  } else {
    items[existingIndex] = Object.assign({}, items[existingIndex], nextItem);
  }

  payload.items = items;
  if (!payload.meta || typeof payload.meta !== "object") {
    payload.meta = {};
  }
  payload.meta.item_count = items.length;
  payload.meta.last_updated = record.checked_at;

  writeJson(DISASTER_SEARCH_PUBLIC_FILE, payload);
  return true;
}

function ensureMunicipalityEmergencyFallbacks(options) {
  options = options || {};
  const checkedAt = options.checkedAt || new Date().toISOString();
  const snapshots = options.snapshots || readJson(SNAPSHOT_FILE, { sources: {} });
  const updates = readJson(PHASE1_UPDATES_FILE, []);
  const targets = resolveFallbackTargets();

  let created = 0;
  let refreshed = 0;
  let searchIndexed = 0;

  targets.forEach(function (target) {
    const snapshot = findSnapshotForTarget(snapshots, target);
    const record = buildPhase1Record(target, snapshot, checkedAt);
    const existingIndex = updates.findIndex(function (entry) {
      return entry.area_id === target.area_id && entry.public_category_id === "EMERGENCY";
    });

    const scrapeFailed = !snapshot || snapshot.reachable !== true;
    const scrapeEmpty =
      snapshot &&
      snapshot.reachable === true &&
      !isUsablePageText(snapshot.title || snapshot.pageTitle) &&
      !isUsablePageText(
        snapshot.description || snapshot.summary || snapshot.excerpt || snapshot.originalText
      );

    if (existingIndex === -1) {
      updates.push(record);
      created += 1;
      if (
        DISASTER_SEARCH_FALLBACK_AREAS.has(target.area_id) &&
        ensureDisasterSearchEmergencyItem(record)
      ) {
        searchIndexed += 1;
      }
      return;
    }

    const existing = updates[existingIndex];
    existing.source_url = record.source_url;

    if (scrapeFailed || scrapeEmpty) {
      mergePhase1EmergencyRecord(existing, record);
      refreshed += 1;
    } else {
      existing.checked_at = checkedAt;
      if (record.source_updated_at) {
        existing.source_updated_at = record.source_updated_at;
        existing.displayed_updated_at = record.displayed_updated_at;
      }
      if (isUsablePageText(record.summary) && record.summary !== DEFAULT_SUMMARY) {
        existing.summary = record.summary;
      }
      refreshed += 1;
    }

    if (
      DISASTER_SEARCH_FALLBACK_AREAS.has(target.area_id) &&
      ensureDisasterSearchEmergencyItem(existing)
    ) {
      searchIndexed += 1;
    }
  });

  writeJson(PHASE1_UPDATES_FILE, updates);

  return {
    created: created,
    refreshed: refreshed,
    searchIndexed: searchIndexed,
    totalTargets: targets.size,
    checkedAt: checkedAt
  };
}

module.exports = {
  ensureMunicipalityEmergencyFallbacks,
  buildFallbackHeadline,
  DEFAULT_SUMMARY,
  MUNICIPALITY_SUMMARY_OVERRIDES
};

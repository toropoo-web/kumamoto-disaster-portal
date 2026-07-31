"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const COMMUNITY_REGION_MASTER_FILE = path.join(
  ROOT,
  "data",
  "community",
  "community_region_master.json"
);

const LAYER_SCOPE = "九州災害 Community Layer";

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function loadCommunityRegionMaster(options) {
  options = options || {};
  return readJson(options.masterPath || COMMUNITY_REGION_MASTER_FILE, {
    version: "1.0",
    layer_id: "KYUSHU_SOUTH_COMMUNITY",
    layer_scope: LAYER_SCOPE,
    region: "KYUSHU_SOUTH",
    extensible: true,
    prefectures: [],
    prefecture_groups: [],
    region_groups: []
  });
}

function loadPrefectureGroups(masterPayload) {
  return (masterPayload || loadCommunityRegionMaster()).prefecture_groups || [];
}

function loadRegionGroups(masterPayload) {
  return (masterPayload || loadCommunityRegionMaster()).region_groups || [];
}

function resolveRegionGroupLabel(regionGroupId, masterPayload) {
  const groups = loadRegionGroups(masterPayload);
  const match = groups.find(function (group) {
    return group.id === regionGroupId;
  });
  return match ? match.label : "";
}

function resolvePrefectureGroupLabel(prefectureGroupId, masterPayload) {
  const groups = loadPrefectureGroups(masterPayload);
  const match = groups.find(function (group) {
    return group.id === prefectureGroupId;
  });
  return match ? match.label : "";
}

function tokenMatchesField(token, fieldValue) {
  const normalizedToken = String(token || "").trim().toLowerCase();
  const normalizedField = String(fieldValue || "").trim().toLowerCase();
  if (!normalizedToken || !normalizedField) {
    return false;
  }
  return (
    normalizedField.indexOf(normalizedToken) !== -1 ||
    normalizedToken.indexOf(normalizedField) !== -1
  );
}

function matchesPrefectureGroupToken(entry, token, masterPayload) {
  const normalizedToken = String(token || "").trim();
  if (!normalizedToken) {
    return false;
  }
  if (entry.prefecture_group) {
    if (tokenMatchesField(normalizedToken, entry.prefecture_group)) {
      return true;
    }
    const label = resolvePrefectureGroupLabel(entry.prefecture_group, masterPayload);
    if (label && tokenMatchesField(normalizedToken, label)) {
      return true;
    }
  }
  const groups = loadPrefectureGroups(masterPayload);
  for (let i = 0; i < groups.length; i += 1) {
    const group = groups[i];
    if (entry.prefecture_group !== group.id) {
      continue;
    }
    if (
      tokenMatchesField(normalizedToken, group.id) ||
      tokenMatchesField(normalizedToken, group.label)
    ) {
      return true;
    }
  }
  return false;
}

function matchesCommunityRegionGroupToken(entry, token, masterPayload) {
  const normalizedToken = String(token || "").trim();
  if (!normalizedToken) {
    return false;
  }
  if (entry.region_group) {
    if (tokenMatchesField(normalizedToken, entry.region_group)) {
      return true;
    }
    const label = resolveRegionGroupLabel(entry.region_group, masterPayload);
    if (label && tokenMatchesField(normalizedToken, label)) {
      return true;
    }
  }
  const groups = loadRegionGroups(masterPayload);
  for (let i = 0; i < groups.length; i += 1) {
    const group = groups[i];
    if (entry.region_group !== group.id) {
      continue;
    }
    if (
      tokenMatchesField(normalizedToken, group.id) ||
      tokenMatchesField(normalizedToken, group.label)
    ) {
      return true;
    }
  }
  return false;
}

function buildCommunityRegionHaystack(entry, masterPayload) {
  const master = masterPayload || loadCommunityRegionMaster();
  const parts = [entry.prefecture, entry.municipality, entry.district, entry.region_group];
  if (entry.prefecture_group) {
    parts.push(entry.prefecture_group);
    parts.push(resolvePrefectureGroupLabel(entry.prefecture_group, master));
  }
  if (entry.region_group) {
    parts.push(resolveRegionGroupLabel(entry.region_group, master));
  }
  return parts.filter(Boolean).join(" ");
}

function validateCommunityRegionMaster(payload) {
  const errors = [];
  if (!payload || !Array.isArray(payload.prefectures)) {
    errors.push("community_region_master prefectures must be an array");
    return errors;
  }
  if (payload.extensible !== false) {
    errors.push("community_region_master extensible must be false");
  }
  if (payload.municipality_count !== 23) {
    errors.push("community_region_master municipality_count must be 23");
  }
  if (!payload.evacuation_alert_region_path) {
    errors.push("community_region_master evacuation_alert_region_path is required");
  }
  if (payload.layer_scope !== LAYER_SCOPE) {
    errors.push("community_region_master layer_scope must be " + LAYER_SCOPE);
  }
  (payload.region_groups || []).forEach(function (group, index) {
    const label = "region_groups[" + index + "]";
    if (!group || !group.id || !group.label) {
      errors.push(label + ": id and label are required");
    }
    if (!Array.isArray(group.prefectures)) {
      errors.push(label + ": prefectures must be an array");
    }
  });
  (payload.prefecture_groups || []).forEach(function (group, index) {
    const label = "prefecture_groups[" + index + "]";
    if (!group || !group.id || !group.label) {
      errors.push(label + ": id and label are required");
    }
    if (!Array.isArray(group.prefectures)) {
      errors.push(label + ": prefectures must be an array");
    }
  });
  return errors;
}

module.exports = {
  COMMUNITY_REGION_MASTER_FILE,
  LAYER_SCOPE,
  loadCommunityRegionMaster,
  loadPrefectureGroups,
  loadRegionGroups,
  resolvePrefectureGroupLabel,
  resolveRegionGroupLabel,
  matchesPrefectureGroupToken,
  matchesCommunityRegionGroupToken,
  buildCommunityRegionHaystack,
  validateCommunityRegionMaster
};

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
    prefecture_groups: []
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

function matchesPrefectureGroupToken(entry, token, masterPayload) {
  const normalizedToken = String(token || "").trim();
  if (!normalizedToken) {
    return false;
  }
  const groups = loadPrefectureGroups(masterPayload);
  for (let i = 0; i < groups.length; i += 1) {
    const group = groups[i];
    const groupLabel = String(group.label || "").trim();
    const groupId = String(group.id || "").trim();
    if (
      groupLabel.indexOf(normalizedToken) === -1 &&
      normalizedToken.indexOf(groupLabel) === -1 &&
      groupId.toLowerCase().indexOf(normalizedToken.toLowerCase()) === -1
    ) {
      continue;
    }
    const prefectures = group.prefectures || [];
    if (prefectures.indexOf(entry.prefecture) !== -1) {
      return true;
    }
    if (entry.prefecture_group && entry.prefecture_group === group.id) {
      return true;
    }
  }
  return matchesCommunityRegionGroupToken(entry, token, masterPayload);
}

function matchesCommunityRegionGroupToken(entry, token, masterPayload) {
  const normalizedToken = String(token || "").trim();
  if (!normalizedToken) {
    return false;
  }
  const master = masterPayload || loadCommunityRegionMaster();
  if (master.region_group) {
    const masterGroup = String(master.region_group).trim();
    if (
      masterGroup.toLowerCase().indexOf(normalizedToken.toLowerCase()) !== -1 ||
      normalizedToken.toLowerCase().indexOf(masterGroup.toLowerCase()) !== -1
    ) {
      const covered = master.prefectures || [];
      if (!entry.prefecture || covered.indexOf(entry.prefecture) !== -1) {
        return true;
      }
    }
  }
  const groups = loadRegionGroups(master);
  for (let i = 0; i < groups.length; i += 1) {
    const group = groups[i];
    const groupLabel = String(group.label || "").trim();
    const groupId = String(group.id || "").trim();
    if (
      groupLabel.indexOf(normalizedToken) === -1 &&
      normalizedToken.indexOf(groupLabel) === -1 &&
      groupId.toLowerCase().indexOf(normalizedToken.toLowerCase()) === -1
    ) {
      continue;
    }
    const prefectures = group.prefectures || [];
    if (prefectures.indexOf(entry.prefecture) !== -1) {
      return true;
    }
    if (entry.region_group && entry.region_group === group.id) {
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
  if (master.region_group) {
    parts.push(master.region_group);
    parts.push(resolveRegionGroupLabel(master.region_group, master));
  }
  return parts.filter(Boolean).join(" ");
}

function validateCommunityRegionMaster(payload) {
  const errors = [];
  if (!payload || !Array.isArray(payload.prefectures)) {
    errors.push("community_region_master prefectures must be an array");
    return errors;
  }
  if (!payload.extensible) {
    errors.push("community_region_master must remain extensible");
  }
  if (payload.layer_scope !== LAYER_SCOPE) {
    errors.push("community_region_master layer_scope must be " + LAYER_SCOPE);
  }
  if (!payload.region_group) {
    errors.push("community_region_master region_group is required");
  }
  (payload.region_groups || []).forEach(function (group, index) {
    const label = "region_groups[" + index + "]";
    if (!group || !group.id || !group.label) {
      errors.push(label + ": id and label are required");
    }
    if (!Array.isArray(group.prefectures) || !group.prefectures.length) {
      errors.push(label + ": prefectures must be a non-empty array");
    }
  });
  (payload.prefecture_groups || []).forEach(function (group, index) {
    const label = "prefecture_groups[" + index + "]";
    if (!group || !group.id || !group.label) {
      errors.push(label + ": id and label are required");
    }
    if (!Array.isArray(group.prefectures) || !group.prefectures.length) {
      errors.push(label + ": prefectures must be a non-empty array");
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

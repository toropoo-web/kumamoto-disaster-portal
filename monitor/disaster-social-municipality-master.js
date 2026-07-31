"use strict";

const fs = require("fs");
const path = require("path");

const {
  loadEvacuationAlertScope,
  getScopeMunicipalitySet,
  isInCommunityScope,
  validateCommunityScopeMaster,
  COMMUNITY_SCOPE_MUNICIPALITY_COUNT,
  resolveMunicipalityPrefecture,
  EVACUATION_ALERT_REGION_FILE
} = require("./disaster-social-community-scope");

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
  const payload = readJson(options.masterPath || MUNICIPALITY_MASTER_FILE, {
    version: "1.1",
    municipality_count: COMMUNITY_SCOPE_MUNICIPALITY_COUNT,
    municipalities: []
  });
  const scope = loadEvacuationAlertScope();
  return Object.assign({}, payload, {
    municipality_count: scope.municipality_count,
    scope_source: scope.source_path
  });
}

function getCommunityMunicipalitySet(masterPayload) {
  return getScopeMunicipalitySet();
}

function isKumamotoMunicipality(municipality, masterPayload) {
  return isInCommunityScope(municipality);
}

function isCommunityScopeMunicipality(municipality, masterPayload) {
  return isInCommunityScope(municipality);
}

function loadRegionGroups(masterPayload) {
  const master = masterPayload || loadMunicipalityMaster();
  return master.region_groups || [];
}

function matchesRegionGroupToken(entry, token, masterPayload) {
  const normalizedToken = String(token || "").trim();
  if (!normalizedToken) {
    return false;
  }
  const groups = loadRegionGroups(masterPayload);
  for (let i = 0; i < groups.length; i += 1) {
    const group = groups[i];
    const groupLabel = String(group.label || "").trim();
    if (!groupLabel) {
      continue;
    }
    if (groupLabel.indexOf(normalizedToken) === -1 && normalizedToken.indexOf(groupLabel) === -1) {
      continue;
    }
    const municipalities = group.municipalities || [];
    if (municipalities.indexOf(entry.municipality) !== -1) {
      return true;
    }
  }
  return false;
}

function validateMunicipalityMaster(payload) {
  const errors = [];
  const scopeErrors = validateCommunityScopeMaster();
  errors.push.apply(errors, scopeErrors);

  if (!payload || !Array.isArray(payload.municipalities)) {
    errors.push("municipality_master municipalities must be an array");
    return errors;
  }
  if (payload.extensible !== false) {
    errors.push("municipality_master extensible must be false");
  }
  if (payload.municipality_count !== COMMUNITY_SCOPE_MUNICIPALITY_COUNT) {
    errors.push("municipality_master municipality_count must be " + COMMUNITY_SCOPE_MUNICIPALITY_COUNT);
  }
  const scopeSet = getScopeMunicipalitySet();
  const seen = new Set();
  payload.municipalities.forEach(function (item, index) {
    const label = "municipalities[" + index + "]";
    if (!item || !item.municipality) {
      errors.push(label + ": municipality is required");
      return;
    }
    const expectedPrefecture = resolveMunicipalityPrefecture(item.municipality);
    if (item.prefecture !== expectedPrefecture) {
      errors.push(label + ": prefecture must be " + expectedPrefecture);
    }
    if (!scopeSet.has(item.municipality)) {
      errors.push(label + ": municipality out of evacuation alert scope " + item.municipality);
    }
    if (seen.has(item.municipality)) {
      errors.push(label + ": duplicate municipality " + item.municipality);
    } else {
      seen.add(item.municipality);
    }
    if (!Array.isArray(item.districts)) {
      errors.push(label + ": districts must be an array");
    }
  });
  if (seen.size !== COMMUNITY_SCOPE_MUNICIPALITY_COUNT) {
    errors.push("municipality_master must include all evacuation alert municipalities");
  }
  (payload.region_groups || []).forEach(function (group, index) {
    const label = "region_groups[" + index + "]";
    if (!group || !group.label) {
      errors.push(label + ": label is required");
    }
    if (!Array.isArray(group.municipalities) || !group.municipalities.length) {
      errors.push(label + ": municipalities must be a non-empty array");
      return;
    }
    group.municipalities.forEach(function (name) {
      if (!scopeSet.has(name)) {
        errors.push(label + ": municipality out of scope " + name);
      }
    });
  });
  return errors;
}

module.exports = {
  MUNICIPALITY_MASTER_FILE,
  EVACUATION_ALERT_REGION_FILE,
  loadMunicipalityMaster,
  getCommunityMunicipalitySet,
  getKumamotoMunicipalitySet: getCommunityMunicipalitySet,
  isKumamotoMunicipality,
  isCommunityScopeMunicipality,
  loadRegionGroups,
  matchesRegionGroupToken,
  validateMunicipalityMaster
};

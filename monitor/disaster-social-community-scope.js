"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const EVACUATION_ALERT_REGION_FILE = path.join(
  ROOT,
  "data",
  "public",
  "evacuation_alert_region.json"
);

const SNS_FETCH_PLATFORMS = ["X"];
const SNS_FETCH_SINCE_DATE = "2026-07-28";
const COMMUNITY_FETCH_CATEGORIES = [
  "WATER",
  "FOOD",
  "SUPPLIES",
  "TOILET",
  "CHARGING",
  "VOLUNTEER",
  "MEDICAL",
  "OTHER"
];
const COMMUNITY_SCOPE_MUNICIPALITY_COUNT = 23;
const KIRISHIMA_MUNICIPALITY = "霧島市";
const KIRISHIMA_PREFECTURE = "鹿児島県";
const KUMAMOTO_PREFECTURE = "熊本県";

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function loadEvacuationAlertScope(options) {
  options = options || {};
  const payload = readJson(options.scopePath || EVACUATION_ALERT_REGION_FILE, {
    municipalities: []
  });
  const municipalities = Array.isArray(payload.municipalities)
    ? payload.municipalities.slice()
    : [];
  return {
    municipalities: municipalities,
    municipality_count: municipalities.length,
    source_path: "data/public/evacuation_alert_region.json"
  };
}

function resolveMunicipalityPrefecture(municipality) {
  const name = String(municipality || "").trim();
  if (!name) {
    return "";
  }
  if (name === KIRISHIMA_MUNICIPALITY) {
    return KIRISHIMA_PREFECTURE;
  }
  return KUMAMOTO_PREFECTURE;
}

function getScopeMunicipalitySet(scopePayload) {
  const scope = scopePayload || loadEvacuationAlertScope();
  const set = new Set();
  (scope.municipalities || []).forEach(function (name) {
    if (name) {
      set.add(name);
    }
  });
  return set;
}

function isInCommunityScope(municipality, scopePayload) {
  const name = String(municipality || "").trim();
  if (!name) {
    return false;
  }
  return getScopeMunicipalitySet(scopePayload).has(name);
}

function normalizeDateToken(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : "";
}

function isSnsAutoFetchItem(item) {
  const importFormat = String((item && item.import_format) || "").toUpperCase();
  const sourceType = String((item && item.source_type) || "").trim();
  if (importFormat === "SNS") {
    return true;
  }
  return SNS_FETCH_PLATFORMS.indexOf(sourceType) !== -1;
}

function isSnsFetchPlatform(sourceType) {
  return SNS_FETCH_PLATFORMS.indexOf(String(sourceType || "").trim()) !== -1;
}

function isOnOrAfterSnsFetchSinceDate(dateValue) {
  const normalized = normalizeDateToken(dateValue);
  if (!normalized) {
    return false;
  }
  return normalized >= SNS_FETCH_SINCE_DATE;
}

function evaluateSnsFetchScope(item, scopePayload) {
  const reasons = [];
  const sourceType = String((item && item.source_type) || "").trim();
  const dateValue = (item && item.date) || (item && item.captured_at) || "";

  if (!isSnsFetchPlatform(sourceType)) {
    reasons.push("sns_platform_not_allowed:" + (sourceType || "UNKNOWN"));
  }
  if (!isOnOrAfterSnsFetchSinceDate(dateValue)) {
    reasons.push("date_before_sns_fetch_since:" + SNS_FETCH_SINCE_DATE);
  }

  return {
    pass: reasons.length === 0,
    reasons: reasons
  };
}

function validateCommunityScopeMaster(scopePayload) {
  const errors = [];
  const scope = scopePayload || loadEvacuationAlertScope();
  if (!Array.isArray(scope.municipalities)) {
    errors.push("evacuation_alert_region municipalities must be an array");
    return errors;
  }
  if (scope.municipalities.length !== COMMUNITY_SCOPE_MUNICIPALITY_COUNT) {
    errors.push(
      "evacuation_alert_region must contain exactly " +
        COMMUNITY_SCOPE_MUNICIPALITY_COUNT +
        " municipalities"
    );
  }
  const seen = new Set();
  scope.municipalities.forEach(function (name, index) {
    if (!name) {
      errors.push("municipalities[" + index + "]: empty municipality");
      return;
    }
    if (seen.has(name)) {
      errors.push("municipalities[" + index + "]: duplicate municipality " + name);
    } else {
      seen.add(name);
    }
    if (name !== KIRISHIMA_MUNICIPALITY && resolveMunicipalityPrefecture(name) !== KUMAMOTO_PREFECTURE) {
      errors.push("municipalities[" + index + "]: unexpected prefecture mapping for " + name);
    }
  });
  if (!seen.has(KIRISHIMA_MUNICIPALITY)) {
    errors.push("evacuation_alert_region must include 霧島市");
  }
  return errors;
}

module.exports = {
  EVACUATION_ALERT_REGION_FILE,
  SNS_FETCH_PLATFORMS,
  SNS_FETCH_SINCE_DATE,
  COMMUNITY_FETCH_CATEGORIES,
  COMMUNITY_SCOPE_MUNICIPALITY_COUNT,
  KIRISHIMA_MUNICIPALITY,
  KIRISHIMA_PREFECTURE,
  KUMAMOTO_PREFECTURE,
  loadEvacuationAlertScope,
  resolveMunicipalityPrefecture,
  getScopeMunicipalitySet,
  isInCommunityScope,
  isSnsAutoFetchItem,
  isSnsFetchPlatform,
  isOnOrAfterSnsFetchSinceDate,
  evaluateSnsFetchScope,
  validateCommunityScopeMaster
};

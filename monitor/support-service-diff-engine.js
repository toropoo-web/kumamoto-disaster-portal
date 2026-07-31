"use strict";

const crypto = require("crypto");

const COMPARISON_FIELDS = [
  "title",
  "subcategory",
  "facility_name",
  "address",
  "opening_type",
  "available_from",
  "available_until",
  "status"
];

const CHANGE_TYPES = ["NEW", "UPDATED", "ENDED", "UNCHANGED"];

function normalizeComparisonValue(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  return String(value).replace(/\s+/g, " ").trim();
}

function buildComparisonSnapshot(information) {
  if (!information) {
    return {};
  }

  const snapshot = {};
  COMPARISON_FIELDS.forEach(function (field) {
    snapshot[field] = normalizeComparisonValue(information[field]);
  });
  return snapshot;
}

function getChangedFields(before, after) {
  const beforeSnapshot = buildComparisonSnapshot(before);
  const afterSnapshot = buildComparisonSnapshot(after);

  return COMPARISON_FIELDS.filter(function (field) {
    return beforeSnapshot[field] !== afterSnapshot[field];
  });
}

function detectChangeType(before, after) {
  if (!after) {
    return null;
  }
  if (!before) {
    return "NEW";
  }

  const changedFields = getChangedFields(before, after);
  if (changedFields.length === 0) {
    return "UNCHANGED";
  }

  const beforeStatus = buildComparisonSnapshot(before).status;
  const afterStatus = buildComparisonSnapshot(after).status;
  if (beforeStatus !== "EXPIRED" && afterStatus === "EXPIRED") {
    return "ENDED";
  }

  return "UPDATED";
}

function resolveInformationMatchKey(information) {
  if (!information) {
    return null;
  }
  if (information.candidate_id) {
    return "candidate:" + information.candidate_id;
  }
  if (information.source_url) {
    return "source_url:" + information.source_url;
  }
  if (information.information_id) {
    return "information:" + information.information_id;
  }
  return (
    "composite:" +
    [
      information.source_id,
      information.subcategory,
      information.facility_name || information.title
    ]
      .filter(Boolean)
      .join("|")
  );
}

function indexInformations(informations) {
  const map = new Map();
  (informations || []).forEach(function (entry) {
    if (!entry) {
      return;
    }
    const key = resolveInformationMatchKey(entry);
    if (!key) {
      return;
    }
    map.set(key, entry);
  });
  return map;
}

function buildChangeId(before, after, changeType) {
  return (
    "SSCHG-" +
    crypto
      .createHash("sha256")
      .update(
        [
          changeType,
          before && before.information_id,
          after && after.information_id,
          after && after.candidate_id,
          after && after.source_id,
          after && after.title
        ]
          .filter(Boolean)
          .join("|")
      )
      .digest("hex")
      .slice(0, 10)
      .toUpperCase()
  );
}

function buildCheckedAtMeta(before, currentCheckedAt) {
  return {
    last_checked_at: before && before.checked_at ? before.checked_at : null,
    current_checked_at: currentCheckedAt
  };
}

function applyCheckedAtToInformation(information, checkedAtMeta) {
  if (!information || !checkedAtMeta) {
    return information;
  }

  const updated = Object.assign({}, information);
  if (checkedAtMeta.last_checked_at) {
    updated.last_checked_at = checkedAtMeta.last_checked_at;
  }
  updated.checked_at = checkedAtMeta.current_checked_at;
  return updated;
}

function compareSupportInformationChanges(currentInformations, discoveredInformations, options) {
  options = options || {};
  const detectedAt = options.detectedAt || new Date().toISOString();
  const currentMap = indexInformations(currentInformations);
  const discoveredMap = indexInformations(discoveredInformations);
  const keys = new Set();

  currentMap.forEach(function (_value, key) {
    keys.add(key);
  });
  discoveredMap.forEach(function (_value, key) {
    keys.add(key);
  });

  const changes = [];
  const updatedInformations = [];

  keys.forEach(function (key) {
    const before = currentMap.get(key) || null;
    const after = discoveredMap.get(key) || null;

    if (!after) {
      return;
    }

    const changeType = detectChangeType(before, after);
    const checkedAtMeta = buildCheckedAtMeta(before, detectedAt);
    const changedFields = before ? getChangedFields(before, after) : COMPARISON_FIELDS.slice();

    changes.push({
      change_id: buildChangeId(before, after, changeType),
      information_id: after.information_id || (before && before.information_id) || null,
      change_type: changeType,
      before: before ? buildComparisonSnapshot(before) : {},
      after: buildComparisonSnapshot(after),
      detected_at: detectedAt,
      status: "NEW_CHANGE",
      checked_at: checkedAtMeta,
      changed_fields: changedFields
    });

    updatedInformations.push(applyCheckedAtToInformation(after, checkedAtMeta));
  });

  const summary = CHANGE_TYPES.reduce(function (acc, changeType) {
    acc[changeType] = 0;
    return acc;
  }, {});
  changes.forEach(function (entry) {
    summary[entry.change_type] = (summary[entry.change_type] || 0) + 1;
  });

  return {
    changes: changes,
    updatedInformations: updatedInformations,
    summary: summary,
    detected_at: detectedAt
  };
}

module.exports = {
  COMPARISON_FIELDS,
  CHANGE_TYPES,
  normalizeComparisonValue,
  buildComparisonSnapshot,
  getChangedFields,
  detectChangeType,
  resolveInformationMatchKey,
  indexInformations,
  buildChangeId,
  buildCheckedAtMeta,
  applyCheckedAtToInformation,
  compareSupportInformationChanges
};

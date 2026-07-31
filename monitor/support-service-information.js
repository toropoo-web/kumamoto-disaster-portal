"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const INFORMATION_FILE = path.join(
  ROOT,
  "data",
  "support_service_discovery",
  "support_information_candidates.json"
);

const INFORMATION_STATUSES = ["ACTIVE", "EXPIRED", "UNKNOWN", "OUT_OF_AREA"];
const UNKNOWN_DATE = "UNKNOWN";

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeDateValue(value) {
  if (!value || value === UNKNOWN_DATE) {
    return UNKNOWN_DATE;
  }
  return String(value);
}

function buildInformationId(parts) {
  return (
    "SSINF-" +
    crypto
      .createHash("sha256")
      .update(parts.filter(Boolean).join("|"))
      .digest("hex")
      .slice(0, 10)
      .toUpperCase()
  );
}

function buildInformationTitle(candidate) {
  if (candidate.title) {
    return candidate.title;
  }
  if (candidate.opening_type === "FREE_OPEN" && candidate.detected_keyword) {
    const keyword = candidate.detected_keyword;
    return keyword.indexOf("無料") === 0 ? keyword : "無料" + keyword;
  }
  if (candidate.detected_keyword) {
    return candidate.detected_keyword;
  }
  if (candidate.facility_name) {
    return candidate.facility_name;
  }
  return "生活支援情報";
}

function buildDetectedKeywords(candidate) {
  if (Array.isArray(candidate.detected_keywords) && candidate.detected_keywords.length) {
    return candidate.detected_keywords.slice();
  }
  if (candidate.detected_keyword) {
    return [candidate.detected_keyword];
  }
  return [];
}

function resolveInformationSourceUrl(candidate, source) {
  if (!candidate) {
    return source && source.url ? source.url : null;
  }
  if (candidate.source_type === "X") {
    return (
      candidate.post_url ||
      candidate.source_url ||
      (source && source.url) ||
      null
    );
  }
  if (source && source.url) {
    return source.url;
  }
  return candidate.post_url || candidate.source_url || null;
}

function buildSourceTraceFromCandidate(candidate, source) {
  const sourceType = candidate.source_type || (source && source.platform) || null;
  if (sourceType !== "X") {
    return null;
  }

  const detectedKeywords = buildDetectedKeywords(candidate);
  return {
    platform: "X",
    account: candidate.account || (source && source.account) || "",
    post_url: candidate.post_url || "",
    detected_keywords: detectedKeywords
  };
}

function resolveInformationStatus(candidate) {
  if (!candidate) {
    return "UNKNOWN";
  }
  if (candidate.status === "OUT_OF_AREA") {
    return "OUT_OF_AREA";
  }
  if (candidate.availability_status === "EXPIRED") {
    return "EXPIRED";
  }

  const publishedAt = normalizeDateValue(candidate.published_at);
  const availableFrom = normalizeDateValue(candidate.available_from);
  const availableUntil = normalizeDateValue(candidate.available_until);

  const hasKnownDate =
    publishedAt !== UNKNOWN_DATE ||
    availableFrom !== UNKNOWN_DATE ||
    availableUntil !== UNKNOWN_DATE;

  if (!hasKnownDate) {
    return "UNKNOWN";
  }
  return "ACTIVE";
}

function candidateToInformation(candidate, options) {
  options = options || {};
  const source = options.source || null;
  const checkedAt = candidate.checked_at || options.checkedAt || new Date().toISOString();
  const title = buildInformationTitle(candidate);

  return {
    information_id: buildInformationId([
      candidate.source_id,
      candidate.candidate_id,
      title,
      candidate.facility_name
    ]),
    source_id: candidate.source_id,
    category: "SUPPORT_SERVICE",
    subcategory: candidate.subcategory || null,
    subcategory_detail: candidate.subcategory_detail || null,
    title: title,
    facility_name: candidate.facility_name || null,
    address: candidate.address || null,
    municipality: candidate.municipality || null,
    opening_type: candidate.opening_type || null,
    published_at: normalizeDateValue(candidate.published_at),
    available_from: normalizeDateValue(candidate.available_from),
    available_until: normalizeDateValue(candidate.available_until),
    checked_at: checkedAt,
    status: resolveInformationStatus(candidate),
    source_type: candidate.source_type || (source && source.platform) || null,
    source_name: source ? source.source_name : null,
    source_platform: source ? source.platform : candidate.source_type || null,
    source_url: resolveInformationSourceUrl(candidate, source),
    source_account: source ? source.account : candidate.account || null,
    detected_keywords: buildDetectedKeywords(candidate),
    source_trace: buildSourceTraceFromCandidate(candidate, source),
    candidate_id: candidate.candidate_id || null
  };
}

function buildSupportInformationCandidates(candidateBatch, options) {
  options = options || {};
  const sourceRegistry = options.sourceRegistry || { sources: [] };
  const sourceLookup = {};
  (sourceRegistry.sources || []).forEach(function (source) {
    sourceLookup[source.source_id] = source;
  });

  const informations = (candidateBatch.candidates || []).map(function (candidate) {
    return candidateToInformation(candidate, {
      source: sourceLookup[candidate.source_id] || null,
      checkedAt: options.checkedAt
    });
  });

  const statusSummary = INFORMATION_STATUSES.reduce(function (acc, status) {
    acc[status] = 0;
    return acc;
  }, {});
  informations.forEach(function (entry) {
    statusSummary[entry.status] = (statusSummary[entry.status] || 0) + 1;
  });

  return {
    version: "1.0",
    category: "SUPPORT_SERVICE",
    generated_at: new Date().toISOString(),
    AUTO_PUBLISH: false,
    auto_publish: false,
    information_count: informations.length,
    status_summary: statusSummary,
    source_candidates_file:
      options.candidatesFile || "data/candidates/support_service_candidates.json",
    informations: informations
  };
}

function validateSupportInformationEntry(entry, index) {
  const label = "informations[" + index + "]";
  const errors = [];

  if (!entry || typeof entry !== "object") {
    errors.push(label + ": entry missing");
    return errors;
  }

  [
    "information_id",
    "source_id",
    "category",
    "title",
    "published_at",
    "available_from",
    "available_until",
    "checked_at",
    "status"
  ].forEach(function (field) {
    if (!entry[field]) {
      errors.push(label + ": missing " + field);
    }
  });

  if (entry.category !== "SUPPORT_SERVICE") {
    errors.push(label + ": category must be SUPPORT_SERVICE");
  }
  if (INFORMATION_STATUSES.indexOf(entry.status) === -1) {
    errors.push(label + ": invalid status " + entry.status);
  }

  return errors;
}

function validateSupportInformationCandidates(payload) {
  const errors = [];

  if (!payload || payload.version !== "1.0") {
    errors.push("information candidates version must be 1.0");
  }
  if (payload.AUTO_PUBLISH !== false || payload.auto_publish !== false) {
    errors.push("information candidates AUTO_PUBLISH must be false");
  }
  if (!Array.isArray(payload.informations)) {
    errors.push("information candidates informations must be an array");
    return errors;
  }
  if (payload.information_count !== payload.informations.length) {
    errors.push("information candidates information_count mismatch");
  }

  const ids = new Set();
  payload.informations.forEach(function (entry, index) {
    errors.push.apply(errors, validateSupportInformationEntry(entry, index));
    if (entry.information_id) {
      if (ids.has(entry.information_id)) {
        errors.push("duplicate information_id: " + entry.information_id);
      }
      ids.add(entry.information_id);
    }
  });

  return errors;
}

function loadSupportInformationCandidates(options) {
  options = options || {};
  return readJson(options.inputPath || INFORMATION_FILE, {
    version: "1.0",
    category: "SUPPORT_SERVICE",
    AUTO_PUBLISH: false,
    auto_publish: false,
    information_count: 0,
    status_summary: {
      ACTIVE: 0,
      EXPIRED: 0,
      UNKNOWN: 0,
      OUT_OF_AREA: 0
    },
    informations: []
  });
}

function writeSupportInformationCandidates(payload, options) {
  options = options || {};
  const outputPath = options.outputPath || INFORMATION_FILE;
  writeJson(outputPath, payload);
  return outputPath;
}

module.exports = {
  INFORMATION_FILE,
  INFORMATION_STATUSES,
  UNKNOWN_DATE,
  buildInformationId,
  buildInformationTitle,
  buildDetectedKeywords,
  resolveInformationSourceUrl,
  buildSourceTraceFromCandidate,
  resolveInformationStatus,
  candidateToInformation,
  buildSupportInformationCandidates,
  validateSupportInformationEntry,
  validateSupportInformationCandidates,
  loadSupportInformationCandidates,
  writeSupportInformationCandidates
};

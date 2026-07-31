"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

const {
  LOCATION_LIST_REVIEW_SOURCE_IDS,
  SUGGESTED_REVIEW_LOCATION_LIST,
  SUGGESTED_REVIEW_INFRASTRUCTURE_STATUS
} = require("./constants");
const { buildCandidateId, normalizeCandidate } = require("./candidate-format");
const { loadCandidateFiles, flattenCandidates } = require("./review-engine");
const { validateApprovedCandidate, buildPreview } = require("./apply-engine");

const ROOT = path.join(__dirname, "..");
const PHASE1_UPDATES_FILE = path.join(ROOT, "data", "public", "phase1_updates.json");
const SNAPSHOT_FILE = path.join(ROOT, "monitor", "reports", "snapshots.json");
const AUTO_PREVIEW_DIR = path.join(ROOT, "data", "approved", "auto-preview");
const INCIDENT_SCOPE = "2026_KUMAMOTO_EARTHQUAKE";

const BLOCKED_PUBLIC_CATEGORIES = new Set(["SUPPORT"]);

const CASUALTY_PATTERNS = [
  /死者/,
  /死亡/,
  /負傷/,
  /怪我/,
  /けが/,
  /行方不明/,
  /人的被害/,
  /心肺停止/,
  /罹災者数/
];

const SKIP_REASON = {
  NOT_MUNICIPALITY_CATEGORY: "NOT_MUNICIPALITY_CATEGORY",
  INVALID_SOURCE_URL: "INVALID_SOURCE_URL",
  CHANGE_TYPE_URL_UNREACHABLE: "CHANGE_TYPE_URL_UNREACHABLE",
  CONTAMINATION_RISK: "CONTAMINATION_RISK",
  URL_NOT_REACHABLE: "URL_NOT_REACHABLE",
  DISASTER_LOCATIONS_TARGET: "DISASTER_LOCATIONS_TARGET",
  INFRASTRUCTURE_TARGET: "INFRASTRUCTURE_TARGET",
  COMMUNICATION_TARGET: "COMMUNICATION_TARGET",
  NO_PHASE1_UPDATE_MATCH: "NO_PHASE1_UPDATE_MATCH",
  BLOCKED_PUBLIC_CATEGORY: "BLOCKED_PUBLIC_CATEGORY",
  CASUALTY_CONTENT: "CASUALTY_CONTENT",
  EMERGENCY_CREATE_ONLY: "EMERGENCY_CREATE_ONLY"
};

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function isValidUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch (err) {
    return false;
  }
}

function readPhase1Updates() {
  if (!fs.existsSync(PHASE1_UPDATES_FILE)) {
    return [];
  }
  return JSON.parse(fs.readFileSync(PHASE1_UPDATES_FILE, "utf8"));
}

function readSnapshots() {
  if (!fs.existsSync(SNAPSHOT_FILE)) {
    return { sources: {} };
  }
  return JSON.parse(fs.readFileSync(SNAPSHOT_FILE, "utf8"));
}

function getSnapshotForCandidate(candidate, snapshots) {
  const bySource = snapshots.sources[candidate.source] || null;
  if (bySource) {
    return bySource;
  }

  return Object.values(snapshots.sources || {}).find(function (entry) {
    return entry.url === candidate.url;
  }) || null;
}

function hasCasualtySignal(candidate) {
  const text = [
    candidate.municipality,
    candidate.after && candidate.after.title,
    candidate.before && candidate.before.title,
    (candidate.keywords || []).join(" ")
  ]
    .filter(Boolean)
    .join(" ");

  return CASUALTY_PATTERNS.some(function (pattern) {
    return pattern.test(text);
  });
}

function isDisasterLocationsTarget(rawCandidate) {
  if (rawCandidate.relatedPublicTarget === "disaster_locations") {
    return true;
  }
  if (rawCandidate.suggestedReview === SUGGESTED_REVIEW_LOCATION_LIST) {
    return true;
  }
  if (LOCATION_LIST_REVIEW_SOURCE_IDS.has(rawCandidate.sourceId || rawCandidate.source)) {
    return true;
  }
  return false;
}

function isInfrastructureTarget(rawCandidate) {
  return (
    rawCandidate.relatedPublicTarget === "infrastructure_status" ||
    rawCandidate.suggestedReview === SUGGESTED_REVIEW_INFRASTRUCTURE_STATUS
  );
}

function hasContaminationRisk(rawCandidate, snapshot) {
  const safetyFlags = rawCandidate.safetyFlags || [];
  if (safetyFlags.indexOf("POSSIBLE_2016_CONTAMINATION") !== -1) {
    return true;
  }
  if (snapshot && snapshot.contaminationRisk === true) {
    return true;
  }
  return false;
}

function resolveDisplayedUpdatedAt(candidate, snapshot) {
  const pageUpdatedAt =
    (candidate.after && candidate.after.pageUpdatedAt) ||
    (snapshot && snapshot.pageUpdatedAt) ||
    "";

  if (pageUpdatedAt) {
    const parsed = Date.parse(pageUpdatedAt);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString();
    }
    return pageUpdatedAt;
  }

  return candidate.detectedAt || new Date().toISOString();
}

function buildPublicUpdateFields(candidate, publicRecord, snapshot) {
  const sourceUpdatedAt = resolveDisplayedUpdatedAt(candidate, snapshot);
  const checkedAt = candidate.detectedAt || new Date().toISOString();
  const fields = {
    collected_at: checkedAt,
    checked_at: checkedAt,
    displayed_updated_at: sourceUpdatedAt,
    source_updated_at: sourceUpdatedAt
  };

  const nextTitle = candidate.after && candidate.after.title;
  if (nextTitle && nextTitle !== publicRecord.headline) {
    fields.headline = nextTitle;
  }

  return fields;
}

function evaluateAutoApplyCandidate(rawCandidate, context) {
  const normalized = normalizeCandidate(rawCandidate, 0);
  const snapshot = getSnapshotForCandidate(normalized, context.snapshots);
  const reasons = [];

  if (normalized.category !== "municipality") {
    reasons.push(SKIP_REASON.NOT_MUNICIPALITY_CATEGORY);
  }

  if (!normalized.url || !isValidUrl(normalized.url)) {
    reasons.push(SKIP_REASON.INVALID_SOURCE_URL);
  }

  if (normalized.changeType === "URL_UNREACHABLE") {
    reasons.push(SKIP_REASON.CHANGE_TYPE_URL_UNREACHABLE);
  }

  if (isDisasterLocationsTarget(rawCandidate)) {
    reasons.push(SKIP_REASON.DISASTER_LOCATIONS_TARGET);
  }

  if (isInfrastructureTarget(rawCandidate)) {
    reasons.push(SKIP_REASON.INFRASTRUCTURE_TARGET);
  }

  if (rawCandidate.relatedPublicTarget === "communication_status" || normalized.category === "communication") {
    reasons.push(SKIP_REASON.COMMUNICATION_TARGET);
  }

  if (hasContaminationRisk(rawCandidate, snapshot)) {
    reasons.push(SKIP_REASON.CONTAMINATION_RISK);
  }

  if (!snapshot || snapshot.reachable !== true) {
    reasons.push(SKIP_REASON.URL_NOT_REACHABLE);
  }

  const publicRecord = context.updates.find(function (record) {
    return record.source_url === normalized.url;
  });

  if (!publicRecord) {
    reasons.push(SKIP_REASON.NO_PHASE1_UPDATE_MATCH);
  } else if (BLOCKED_PUBLIC_CATEGORIES.has(publicRecord.public_category_id)) {
    reasons.push(SKIP_REASON.BLOCKED_PUBLIC_CATEGORY);
  }

  if (hasCasualtySignal(normalized)) {
    reasons.push(SKIP_REASON.CASUALTY_CONTENT);
  }

  if (rawCandidate.relatedPublicTarget === "phase1_updates" && rawCandidate.update_type === "EMERGENCY_INFO") {
    reasons.push(SKIP_REASON.EMERGENCY_CREATE_ONLY);
  }

  return {
    normalized: normalized,
    snapshot: snapshot,
    publicRecord: publicRecord || null,
    eligible: reasons.length === 0,
    reasons: reasons
  };
}

function buildApprovedCandidate(rawCandidate, evaluation) {
  const candidate = evaluation.normalized;
  const publicRecord = evaluation.publicRecord;

  return {
    id: candidate.id || buildCandidateId(rawCandidate, 0),
    source: candidate.source,
    municipality: candidate.municipality,
    category: "municipality",
    areaId: candidate.areaId || publicRecord.area_id,
    publicCategoryId: publicRecord.public_category_id,
    url: candidate.url,
    detectedAt: candidate.detectedAt,
    changeType: candidate.changeType,
    priority: candidate.priority,
    keywords: candidate.keywords || [],
    before: candidate.before,
    after: candidate.after,
    reviewStatus: "APPROVED",
    incidentScope: INCIDENT_SCOPE,
    autoApply: true,
    publicUpdate: {
      target: "phase1_updates",
      action: "update",
      fields: buildPublicUpdateFields(candidate, publicRecord, evaluation.snapshot)
    }
  };
}

function loadRawCandidates() {
  const files = loadCandidateFiles();
  const flattened = flattenCandidates(files);
  const rawById = new Map();

  files.forEach(function (file) {
    (file.payload.candidates || []).forEach(function (raw) {
      const normalized = normalizeCandidate(raw, 0);
      rawById.set(normalized.source + "|" + normalized.url, raw);
    });
  });

  return flattened.map(function (candidate) {
    return rawById.get(candidate.source + "|" + candidate.url) || candidate;
  });
}

function validateApplyEngineCompatibility(approvedCandidates, updates) {
  const errors = [];
  const previews = [];

  approvedCandidates.forEach(function (candidate) {
    errors.push.apply(errors, validateApprovedCandidate(candidate));

    const record = updates.find(function (entry) {
      return entry.source_url === candidate.url;
    });
    if (!record) {
      errors.push(candidate.id + ": apply-engine would not find matching phase1_updates record");
    }

    if (candidate.publicUpdate.action !== "update") {
      errors.push(candidate.id + ": only update action is supported");
    }

    if (candidate.publicUpdate.target !== "phase1_updates") {
      errors.push(candidate.id + ": only phase1_updates target is supported");
    }
  });

  if (approvedCandidates.length) {
    previews.push.apply(
      previews,
      buildPreview([
        {
          candidates: approvedCandidates
        }
      ])
    );
  }

  return {
    compatible: errors.length === 0,
    errors: errors,
    previews: previews
  };
}

function buildAutoApplyPreview(options) {
  options = options || {};
  const updates = readPhase1Updates();
  const snapshots = readSnapshots();
  const rawCandidates = loadRawCandidates();
  const context = {
    updates: updates,
    snapshots: snapshots
  };

  const autoCandidates = [];
  const skippedCandidates = [];

  rawCandidates.forEach(function (rawCandidate) {
    const evaluation = evaluateAutoApplyCandidate(rawCandidate, context);

    if (!evaluation.eligible) {
      skippedCandidates.push({
        id: evaluation.normalized.id,
        source: evaluation.normalized.source,
        municipality: evaluation.normalized.municipality,
        url: evaluation.normalized.url,
        changeType: evaluation.normalized.changeType,
        reasons: evaluation.reasons
      });
      return;
    }

    autoCandidates.push({
      evaluation: {
        snapshotReachable: evaluation.snapshot.reachable === true,
        publicCategoryId: evaluation.publicRecord.public_category_id,
        areaId: evaluation.publicRecord.area_id
      },
      approved: buildApprovedCandidate(rawCandidate, evaluation)
    });
  });

  const approvedCandidates = autoCandidates.map(function (entry) {
    return entry.approved;
  });

  const compatibility = validateApplyEngineCompatibility(approvedCandidates, updates);
  const generatedAt = new Date().toISOString();
  const stamp = generatedAt.replace(/[:.]/g, "-");

  const approvedFile = {
    approvedAt: generatedAt,
    approvedBy: "auto-apply-engine",
    mode: "DRY_RUN_PREVIEW",
    note: "Phase A preview only. Do not copy into data/approved/ without manual review.",
    candidateCount: approvedCandidates.length,
    candidates: approvedCandidates
  };

  const summary = {
    generatedAt: generatedAt,
    mode: "DRY_RUN_PREVIEW",
    AUTO_PUBLICATION: false,
    inputCandidateCount: rawCandidates.length,
    autoCandidateCount: approvedCandidates.length,
    skippedCandidateCount: skippedCandidates.length,
    compatibility: compatibility,
    skipReasonCounts: skippedCandidates.reduce(function (acc, entry) {
      entry.reasons.forEach(function (reason) {
        acc[reason] = (acc[reason] || 0) + 1;
      });
      return acc;
    }, {}),
    previewPath: path.join("data", "approved", "auto-preview", "auto-apply-" + stamp + ".json"),
    summaryPath: path.join("data", "approved", "auto-preview", "latest-summary.json")
  };

  return {
    summary: summary,
    approvedFile: approvedFile,
    autoCandidates: autoCandidates,
    skippedCandidates: skippedCandidates,
    compatibility: compatibility,
    previewFileName: "auto-apply-" + stamp + ".json"
  };
}

function fetchStatus(url, redirectCount) {
  if (redirectCount === undefined) {
    redirectCount = 0;
  }

  return new Promise(function (resolve) {
    const client = url.startsWith("https") ? https : http;
    const req = client.request(
      url,
      {
        method: "GET",
        timeout: 15000,
        headers: { "User-Agent": "kumamoto-disaster-portal-auto-apply/1.0" }
      },
      function (res) {
        const status = res.statusCode || 0;
        const location = res.headers.location;

        if ([301, 302, 303, 307, 308].includes(status) && location && redirectCount < 5) {
          res.resume();
          fetchStatus(new URL(location, url).href, redirectCount + 1).then(resolve);
          return;
        }

        res.resume();
        resolve(status);
      }
    );
    req.on("timeout", function () {
      req.destroy();
      resolve(0);
    });
    req.on("error", function () {
      resolve(0);
    });
    req.end();
  });
}

async function runSafetyChecks(candidate) {
  const errors = [];
  const status = await fetchStatus(candidate.url);

  if (status < 200 || status >= 400) {
    errors.push(candidate.id + ": URL not HTTP 200 (" + status + ")");
  }

  return errors;
}

function applyApprovedCandidatesToPhase1Updates(approvedCandidates) {
  const updates = readPhase1Updates();
  const applied = [];

  approvedCandidates.forEach(function (candidate) {
    const record = updates.find(function (entry) {
      return entry.source_url === candidate.url;
    });

    if (!record) {
      throw new Error(candidate.id + ": no matching phase1_updates record for URL");
    }

    if (candidate.areaId && record.area_id !== candidate.areaId) {
      throw new Error(candidate.id + ": area_id mismatch");
    }

    if (candidate.publicUpdate.action !== "update") {
      throw new Error(candidate.id + ": only update action is supported");
    }

    if (candidate.publicUpdate.fields) {
      Object.keys(candidate.publicUpdate.fields).forEach(function (key) {
        record[key] = candidate.publicUpdate.fields[key];
      });
    }

    if (candidate.after && candidate.after.title) {
      record.headline = candidate.after.title;
    }

    record.collected_at = new Date().toISOString();
    record.checked_at = record.collected_at;
    if (candidate.publicUpdate.fields && candidate.publicUpdate.fields.source_updated_at) {
      record.source_updated_at = candidate.publicUpdate.fields.source_updated_at;
    }

    applied.push({
      id: candidate.id,
      municipality: candidate.municipality,
      url: candidate.url,
      fields: candidate.publicUpdate.fields
    });
  });

  fs.writeFileSync(PHASE1_UPDATES_FILE, JSON.stringify(updates, null, 2) + "\n", "utf8");

  return applied;
}

async function runAutoApply(options) {
  options = options || {};
  const apply = options.apply === true;
  const preview = buildAutoApplyPreview();
  const paths = writeAutoApplyPreview(preview);
  const approvedCandidates = preview.autoCandidates.map(function (entry) {
    return entry.approved;
  });

  const result = {
    MODE: apply ? "APPLY" : "DRY_RUN_PREVIEW",
    AUTO_PUBLICATION: apply,
    APPLIED: false,
    inputCandidateCount: preview.summary.inputCandidateCount,
    autoCandidateCount: preview.summary.autoCandidateCount,
    skippedCandidateCount: preview.summary.skippedCandidateCount,
    skipReasonCounts: preview.summary.skipReasonCounts,
    appliedCount: 0,
    compatibility: preview.compatibility,
    previewPath: paths.previewPath,
    summaryPath: paths.summaryPath,
    autoCandidates: preview.autoCandidates.map(function (entry) {
      return {
        id: entry.approved.id,
        municipality: entry.approved.municipality,
        url: entry.approved.url,
        publicCategoryId: entry.evaluation.publicCategoryId,
        fields: entry.approved.publicUpdate.fields
      };
    }),
    skippedCandidates: preview.skippedCandidates,
    applied: [],
    errors: []
  };

  if (!preview.compatibility.compatible) {
    result.errors.push.apply(result.errors, preview.compatibility.errors);
    return result;
  }

  if (!apply) {
    return result;
  }

  if (!approvedCandidates.length) {
    result.message = "No auto-apply candidates to publish";
    return result;
  }

  const validationErrors = [];
  approvedCandidates.forEach(function (candidate) {
    validationErrors.push.apply(validationErrors, validateApprovedCandidate(candidate));
  });

  for (const candidate of approvedCandidates) {
    validationErrors.push.apply(validationErrors, await runSafetyChecks(candidate));
  }

  if (validationErrors.length) {
    result.errors = validationErrors;
    return result;
  }

  try {
    result.applied = applyApprovedCandidatesToPhase1Updates(approvedCandidates);
    result.appliedCount = result.applied.length;
    result.APPLIED = true;
    result.changedFile = "data/public/phase1_updates.json";
  } catch (err) {
    result.errors.push(err.message);
  }

  return result;
}

function writeAutoApplyPreview(result) {
  ensureDir(AUTO_PREVIEW_DIR);

  const previewPath = path.join(AUTO_PREVIEW_DIR, result.previewFileName);
  const summaryPath = path.join(AUTO_PREVIEW_DIR, "latest-summary.json");

  fs.writeFileSync(previewPath, JSON.stringify(result.approvedFile, null, 2) + "\n", "utf8");
  fs.writeFileSync(
    summaryPath,
    JSON.stringify(
      {
        summary: result.summary,
        skippedCandidates: result.skippedCandidates,
        autoCandidates: result.autoCandidates.map(function (entry) {
          return {
            id: entry.approved.id,
            municipality: entry.approved.municipality,
            url: entry.approved.url,
            publicCategoryId: entry.evaluation.publicCategoryId,
            fields: entry.approved.publicUpdate.fields
          };
        })
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  return {
    previewPath: previewPath,
    summaryPath: summaryPath
  };
}

module.exports = {
  AUTO_PREVIEW_DIR,
  SKIP_REASON,
  BLOCKED_PUBLIC_CATEGORIES,
  CASUALTY_PATTERNS,
  evaluateAutoApplyCandidate,
  buildApprovedCandidate,
  buildAutoApplyPreview,
  writeAutoApplyPreview,
  validateApplyEngineCompatibility,
  loadRawCandidates,
  runAutoApply,
  applyApprovedCandidatesToPhase1Updates
};

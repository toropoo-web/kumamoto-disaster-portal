"use strict";

const fs = require("fs");
const path = require("path");

const {
  isLocationListReviewSource,
  SUGGESTED_REVIEW_LOCATION_LIST,
  SUGGESTED_REVIEW_EMERGENCY_INFO,
  SUGGESTED_REVIEW_INFRASTRUCTURE_STATUS
} = require("./constants");
const { findLocationSourcesByUrl } = require("./location-sources");
const { findEmergencySourcesByUrl } = require("./emergency-sources");
const { findInfrastructureSourcesByUrl } = require("./infrastructure-sources");

const { detectMultiLayerChange } = require("./patrol-v2/multi-layer-detector");

const ROOT = path.join(__dirname, "..");
const SNAPSHOT_FILE = path.join(__dirname, "reports", "snapshots.json");
const CHANGE_LOG_DIR = path.join(__dirname, "change-log");
const CANDIDATE_DIR = path.join(ROOT, "data", "update_candidates");

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function readSnapshots() {
  if (!fs.existsSync(SNAPSHOT_FILE)) {
    return { version: 1, sources: {} };
  }
  return JSON.parse(fs.readFileSync(SNAPSHOT_FILE, "utf8"));
}

function writeSnapshots(data) {
  ensureDir(path.dirname(SNAPSHOT_FILE));
  fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function buildChangeEntry(source, previous, current, changeType) {
  const entry = {
    source: source.id,
    sourceName: source.name,
    category: source.category,
    areaId: source.area_id || null,
    url: source.url,
    detectedAt: new Date().toISOString(),
    changeType,
    previousHash: previous ? previous.contentHash : null,
    currentHash: current ? current.contentHash : null,
    keywords: current ? current.keywords : [],
    status: "DETECTED"
  };

  if (!current || !current.reachable) {
    entry.status = "FAILED";
    entry.changeType = "URL_UNREACHABLE";
    return entry;
  }

  if (current.contaminationRisk) {
    entry.status = "REVIEW_REQUIRED";
    entry.changeType = changeType || "CONTENT_CHANGED";
    entry.safetyFlags = ["POSSIBLE_2016_CONTAMINATION"];
  }

  if (previous && previous.title !== current.title) {
    entry.titleChanged = {
      from: previous.title,
      to: current.title
    };
  }

  if (previous && previous.pageUpdatedAt !== current.pageUpdatedAt && current.pageUpdatedAt) {
    entry.pageUpdatedAtChanged = {
      from: previous.pageUpdatedAt || null,
      to: current.pageUpdatedAt
    };
  }

  return entry;
}

function compareSource(source, current, previous) {
  if (!current.reachable) {
    return buildChangeEntry(source, previous, current, "URL_UNREACHABLE");
  }

  if (!previous) {
    return null;
  }

  const changes = [];

  if (previous.contentHash !== current.contentHash) {
    changes.push(buildChangeEntry(source, previous, current, "CONTENT_CHANGED"));
  }

  if (previous.title !== current.title) {
    const titleEntry = buildChangeEntry(source, previous, current, "TITLE_CHANGED");
    if (!changes.length) {
      changes.push(titleEntry);
    } else {
      changes[0].titleChanged = titleEntry.titleChanged;
      if (changes[0].changeType === "CONTENT_CHANGED") {
        changes[0].changeType = "CONTENT_AND_TITLE_CHANGED";
      }
    }
  }

  if (previous.regionHash !== current.regionHash && current.regionHash) {
    const regionEntry = buildChangeEntry(source, previous, current, "REGION_CHANGED");
    if (!changes.length) {
      changes.push(regionEntry);
    } else {
      changes[0].regionHashChanged = {
        from: previous.regionHash,
        to: current.regionHash
      };
    }
  }

  if (
    previous.feedFingerprint &&
    current.feedFingerprint &&
    previous.feedFingerprint !== current.feedFingerprint
  ) {
    changes.push(buildChangeEntry(source, previous, current, "FEED_CHANGED"));
  }

  const multiLayer = detectMultiLayerChange(previous, current);
  if (changes.length && multiLayer.signals.length) {
    changes[0].detectionSignals = multiLayer.signals;
    changes[0].detectionScore = multiLayer.score;
  }

  return changes.length ? changes : null;
}

function buildUpdateCandidate(source, current, previous, changeEntries) {
  const changeTypes = changeEntries.map((entry) => entry.changeType);
  const primaryEntry = changeEntries[0];

  const candidate = {
    generatedAt: new Date().toISOString(),
    sourceId: source.id,
    sourceName: source.name,
    category: source.category,
    areaId: source.area_id || null,
    publicCategoryId: source.public_category_id || null,
    headline: current.title || source.name,
    summary: "自動巡回で変更を検知しました。人手確認後にのみ公開データへ反映してください。",
    sourceUrl: source.url,
    verificationStatus: "REQUIRES_MANUAL_REVIEW",
    reviewStatus: "REQUIRES_REVIEW",
    incidentScope: "2026_KUMAMOTO_EARTHQUAKE",
    priority: source.priority || null,
    serviceId: source.service_id || null,
    providerId: source.provider_id || null,
    detectedKeywords: current.keywords,
    changeTypes,
    changeType: primaryEntry.changeType,
    safetyFlags: changeEntries.flatMap((entry) => entry.safetyFlags || []),
    before: {
      title: previous ? previous.title || "" : null,
      contentHash: previous ? previous.contentHash || null : null,
      pageUpdatedAt: previous ? previous.pageUpdatedAt || null : null,
      sourceUpdatedAt: previous ? previous.sourceUpdatedAt || previous.pageUpdatedAt || null : null
    },
    after: {
      title: current.title || "",
      contentHash: current.contentHash || null,
      pageUpdatedAt: current.pageUpdatedAt || null,
      sourceUpdatedAt: current.sourceUpdatedAt || current.pageUpdatedAt || null
    },
    autoPublish: false
  };

  if (isLocationListReviewSource(source)) {
    candidate.suggestedReview = SUGGESTED_REVIEW_LOCATION_LIST;
    candidate.relatedPublicTarget = "disaster_locations";
  }

  const locationSources = findLocationSourcesByUrl(source.url);
  if (locationSources.length) {
    candidate.suggestedReview = SUGGESTED_REVIEW_LOCATION_LIST;
    candidate.relatedPublicTarget = "disaster_locations";
    candidate.source_id = locationSources[0].source_id;
    if (locationSources.length > 1) {
      candidate.locationSourceIds = locationSources.map((entry) => entry.source_id);
    }
  }

  const emergencySources = findEmergencySourcesByUrl(source.url);
  if (emergencySources.length) {
    candidate.suggestedReview = SUGGESTED_REVIEW_EMERGENCY_INFO;
    candidate.relatedPublicTarget = "phase1_updates";
    candidate.emergency_source_id = emergencySources[0].source_id;
    if (current.originalText) {
      candidate.original_text = current.originalText;
    }
  }

  const infrastructureSources = findInfrastructureSourcesByUrl(source.url);
  if (infrastructureSources.length) {
    candidate.suggestedReview = SUGGESTED_REVIEW_INFRASTRUCTURE_STATUS;
    candidate.relatedPublicTarget = "infrastructure_status";
    candidate.infrastructure_source_id = infrastructureSources[0].source_id;
    if (current.originalText) {
      candidate.original_text = current.originalText;
    }
  }

  return candidate;
}

function appendChangeLog(dateKey, entries) {
  ensureDir(CHANGE_LOG_DIR);
  const filePath = path.join(CHANGE_LOG_DIR, dateKey + ".json");
  let existing = [];

  if (fs.existsSync(filePath)) {
    existing = JSON.parse(fs.readFileSync(filePath, "utf8"));
  }

  const merged = existing.concat(entries);
  fs.writeFileSync(filePath, JSON.stringify(merged, null, 2) + "\n", "utf8");
  return filePath;
}

function writeUpdateCandidates(candidates) {
  if (!candidates.length) {
    return null;
  }

  ensureDir(CANDIDATE_DIR);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath = path.join(CANDIDATE_DIR, stamp + ".json");
  fs.writeFileSync(
    filePath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        candidateCount: candidates.length,
        autoPublish: false,
        candidates
      },
      null,
      2
    ) + "\n",
    "utf8"
  );
  return filePath;
}

function processResults(sources, parsedResults) {
  const snapshots = readSnapshots();
  const changeEntries = [];
  const candidates = [];
  let successCount = 0;
  let failedCount = 0;

  sources.forEach((source) => {
    const current = parsedResults[source.id];
    const previous = snapshots.sources[source.id] || null;

    if (!current.reachable) {
      failedCount += 1;
      changeEntries.push(buildChangeEntry(source, previous, current, "URL_UNREACHABLE"));
      snapshots.sources[source.id] = {
        ...current,
        sourceName: source.name,
        category: source.category
      };
      return;
    }

    successCount += 1;
    const detected = compareSource(source, current, previous);

    if (detected) {
      detected.forEach((entry) => changeEntries.push(entry));
      candidates.push(buildUpdateCandidate(source, current, previous, detected));
    }

    snapshots.sources[source.id] = {
      ...current,
      sourceName: source.name,
      category: source.category
    };
  });

  writeSnapshots(snapshots);

  const dateKey = new Date().toISOString().slice(0, 10);
  const changeLogPath = changeEntries.length
    ? appendChangeLog(dateKey, changeEntries)
    : null;
  const candidatePath = writeUpdateCandidates(candidates);

  return {
    successCount,
    failedCount,
    changeCount: changeEntries.length,
    candidateCount: candidates.length,
    changeLogPath,
    candidatePath,
    changeEntries
  };
}

module.exports = {
  readSnapshots,
  writeSnapshots,
  compareSource,
  processResults,
  buildChangeEntry,
  SNAPSHOT_FILE,
  CHANGE_LOG_DIR,
  CANDIDATE_DIR
};

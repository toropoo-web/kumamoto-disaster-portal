"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { compareSource } = require("./diff-engine");
const { SUGGESTED_REVIEW_EMERGENCY_INFO } = require("./constants");

const ROOT = path.join(__dirname, "..");
const SNAPSHOT_FILE = path.join(__dirname, "reports", "emergency-snapshots.json");
const CANDIDATE_FILE = path.join(ROOT, "data", "candidates", "emergency_candidates.json");

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

function buildCandidateId(sourceId, detectedAt) {
  const stamp = (detectedAt || new Date().toISOString()).slice(0, 10).replace(/-/g, "");
  const hash = crypto
    .createHash("sha256")
    .update(sourceId + stamp)
    .digest("hex")
    .slice(0, 6)
    .toUpperCase();
  return "EMGCAND-" + stamp + "-" + hash;
}

function buildEmergencyCandidate(patrolSource, current, previous, changeEntries) {
  const detectedAt = new Date().toISOString();
  const originalText = current.originalText || "";

  return {
    candidate_id: buildCandidateId(patrolSource.id, detectedAt),
    type: "EMERGENCY_INFO",
    source_id: patrolSource.id,
    municipality: patrolSource.name,
    original_text: originalText,
    published_at: current.publishedAt || current.pageUpdatedAt || "",
    detected_at: detectedAt,
    review_status: "PENDING",
    suggestedReview: SUGGESTED_REVIEW_EMERGENCY_INFO,
    relatedPublicTarget: "phase1_updates",
    source_url: current.url || patrolSource.url,
    changeType: changeEntries[0] ? changeEntries[0].changeType : "CONTENT_CHANGED",
    changeTypes: changeEntries.map((entry) => entry.changeType),
    before: {
      contentHash: previous ? previous.contentHash || null : null,
      original_text: previous ? previous.originalText || "" : null
    },
    after: {
      contentHash: current.contentHash || null,
      original_text: originalText
    },
    autoPublish: false
  };
}

function writeEmergencyCandidates(candidates) {
  ensureDir(path.dirname(CANDIDATE_FILE));
  const payload = {
    version: 1,
    generated_at: new Date().toISOString(),
    candidate_count: candidates.length,
    candidates
  };
  fs.writeFileSync(CANDIDATE_FILE, JSON.stringify(payload, null, 2) + "\n", "utf8");
  return CANDIDATE_FILE;
}

function processEmergencyResults(sources, parsedResults) {
  const snapshots = readSnapshots();
  const candidates = [];
  let successCount = 0;
  let failedCount = 0;
  let changeCount = 0;

  sources.forEach((source) => {
    const current = parsedResults[source.id];
    const previous = snapshots.sources[source.id] || null;

    if (!current.reachable) {
      failedCount += 1;
      snapshots.sources[source.id] = {
        ...current,
        sourceName: source.name,
        source_type: source.source_type
      };
      return;
    }

    successCount += 1;
    const detected = compareSource(source, current, previous);

    if (detected) {
      changeCount += detected.length;
      candidates.push(buildEmergencyCandidate(source, current, previous, detected));
    }

    snapshots.sources[source.id] = {
      ...current,
      sourceName: source.name,
      source_type: source.source_type
    };
  });

  writeSnapshots(snapshots);
  const candidatePath = writeEmergencyCandidates(candidates);

  return {
    successCount,
    failedCount,
    changeCount,
    candidateCount: candidates.length,
    candidatePath,
    candidates
  };
}

module.exports = {
  SNAPSHOT_FILE,
  CANDIDATE_FILE,
  readSnapshots,
  writeSnapshots,
  buildEmergencyCandidate,
  processEmergencyResults,
  writeEmergencyCandidates
};

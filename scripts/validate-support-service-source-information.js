#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

const {
  buildSourceRecord,
  resolveSupportServiceSource,
  validateSupportServiceSourceRegistry,
  loadSupportServiceSourceRegistry
} = require(path.join(ROOT, "monitor", "support-service-source-registry"));

const {
  candidateToInformation,
  resolveInformationStatus,
  buildSupportInformationCandidates,
  validateSupportInformationCandidates,
  INFORMATION_STATUSES
} = require(path.join(ROOT, "monitor", "support-service-information"));

const {
  buildCandidateFromPost,
  discoverSupportServiceCandidates
} = require(path.join(ROOT, "monitor", "support-service-discovery-engine"));

function main() {
  const errors = [];
  const checks = [];

  [
    "monitor/support-service-source-registry.js",
    "monitor/support-service-information.js",
    "data/support_service_discovery/source_registry.json",
    "data/support_service_discovery/source_tier_registry.json",
    "data/support_service_discovery/support_information_candidates.json"
  ].forEach(function (file) {
    const exists = fs.existsSync(path.join(ROOT, file));
    checks.push({ check: file, pass: exists });
    if (!exists) {
      errors.push("Missing file: " + file);
    }
  });

  const registry = loadSupportServiceSourceRegistry();
  const registryErrors = validateSupportServiceSourceRegistry(registry);
  checks.push({
    check: "source registry schema valid",
    pass: registryErrors.length === 0,
    errors: registryErrors
  });
  errors.push.apply(errors, registryErrors);

  const forbiddenFields = ["trust", "confidence", "rank", "score", "official", "official_flag", "provider_type", "tier"];
  (registry.sources || []).forEach(function (source, index) {
    forbiddenFields.forEach(function (field) {
      if (source[field] !== undefined) {
        errors.push("sources[" + index + "]: forbidden evaluation field " + field);
      }
    });
  });

  const sharedPost = {
    source_type: "X",
    account: "kumamoto_support_hub",
    source_url: "https://x.com/kumamoto_support_hub/status/phase9-shared",
    prefecture: "熊本県",
    municipality: "熊本市"
  };

  const candidateA = buildCandidateFromPost(
    Object.assign({}, sharedPost, {
      text: "熊本市 ○○体育館 シャワー無料開放",
      published_at: "2026-07-31"
    }),
    { referenceDate: "2026-07-31", persistSourceRegistry: false }
  );
  const candidateB = buildCandidateFromPost(
    Object.assign({}, sharedPost, {
      text: "熊本市 ○○体育館 休憩スペース開放",
      published_at: "2026-07-31"
    }),
    { referenceDate: "2026-07-31", persistSourceRegistry: false }
  );

  checks.push({
    check: "test1 same source two informations",
    pass:
      candidateA.source_id &&
      candidateB.source_id &&
      candidateA.source_id === candidateB.source_id &&
      candidateA.candidate_id !== candidateB.candidate_id
  });
  if (!candidateA.source_id || candidateA.source_id !== candidateB.source_id) {
    errors.push("test1 failed: expected one shared source_id for two candidates");
  }

  const informationBatch = buildSupportInformationCandidates(
    { candidates: [candidateA, candidateB] },
    { sourceRegistry: { sources: [buildSourceRecord(sharedPost)] } }
  );
  const sharedSourceCount = new Set(
    informationBatch.informations.map(function (entry) {
      return entry.source_id;
    })
  ).size;
  checks.push({
    check: "test1 source count and information count",
    pass: sharedSourceCount === 1 && informationBatch.informations.length === 2,
    sourceCount: sharedSourceCount,
    informationCount: informationBatch.informations.length
  });
  if (sharedSourceCount !== 1 || informationBatch.informations.length !== 2) {
    errors.push("test1 failed: expected Source 1 / Information 2");
  }

  const expiredCandidate = buildCandidateFromPost(
    {
      source_type: "X",
      account: "expired_support",
      source_url: "https://x.com/expired_support/status/1",
      text: "熊本市 温泉 無料開放",
      published_at: "2026-07-20",
      available_from: "2026-07-20",
      available_until: "2026-07-25"
    },
    { referenceDate: "2026-07-31", persistSourceRegistry: false }
  );
  const expiredInformation = candidateToInformation(expiredCandidate);
  checks.push({
    check: "test2 expired information",
    pass: expiredInformation.status === "EXPIRED",
    status: expiredInformation.status
  });
  if (expiredInformation.status !== "EXPIRED") {
    errors.push("test2 failed: expected status EXPIRED");
  }

  const unknownCandidate = buildCandidateFromPost(
    {
      source_type: "X",
      account: "unknown_dates",
      source_url: "https://x.com/unknown_dates/status/1",
      text: "熊本市 トイレ 開放",
      published_at: "UNKNOWN",
      available_from: "UNKNOWN",
      available_until: "UNKNOWN"
    },
    { persistSourceRegistry: false }
  );
  const unknownInformation = candidateToInformation(unknownCandidate);
  checks.push({
    check: "test3 unknown dates",
    pass: unknownInformation.status === "UNKNOWN",
    status: unknownInformation.status
  });
  if (unknownInformation.status !== "UNKNOWN") {
    errors.push("test3 failed: expected status UNKNOWN");
  }

  const outOfAreaCandidate = buildCandidateFromPost(
    {
      source_type: "X",
      account: "osaka_info",
      source_url: "https://x.com/osaka_info/status/1",
      text: "大阪 温泉無料開放",
      published_at: "2026-07-31"
    },
    { referenceDate: "2026-07-31", persistSourceRegistry: false }
  );
  const outOfAreaInformation = candidateToInformation(outOfAreaCandidate);
  checks.push({
    check: "test4 out of area",
    pass: outOfAreaInformation.status === "OUT_OF_AREA",
    status: outOfAreaInformation.status
  });
  if (outOfAreaInformation.status !== "OUT_OF_AREA") {
    errors.push("test4 failed: expected status OUT_OF_AREA");
  }

  INFORMATION_STATUSES.forEach(function (status) {
    if (resolveInformationStatus({ status: status === "OUT_OF_AREA" ? "OUT_OF_AREA" : "NEW", availability_status: status === "EXPIRED" ? "EXPIRED" : "ACTIVE" }) === undefined) {
      errors.push("information status resolver missing: " + status);
    }
  });

  const informationFile = path.join(
    ROOT,
    "data",
    "support_service_discovery",
    "support_information_candidates.json"
  );
  if (fs.existsSync(informationFile)) {
    const informationPayload = JSON.parse(fs.readFileSync(informationFile, "utf8"));
    const informationErrors = validateSupportInformationCandidates(informationPayload);
    checks.push({
      check: "seed information candidates valid",
      pass: informationErrors.length === 0,
      errors: informationErrors
    });
    errors.push.apply(errors, informationErrors);
    checks.push({
      check: "seed information count preserved",
      pass: informationPayload.information_count === 5,
      informationCount: informationPayload.information_count
    });
    if (informationPayload.information_count !== 5) {
      errors.push("seed information count changed from 5");
    }
  }

  const resolved = resolveSupportServiceSource({
    source_type: "X",
    account: "kumamoto_support_hub",
    source_url: "https://x.com/kumamoto_support_hub/status/phase9-shared",
    text: "熊本市"
  });
  checks.push({
    check: "source resolution creates record",
    pass: resolved.source && resolved.source.source_id
  });
  if (!resolved.source || !resolved.source.source_id) {
    errors.push("source resolution failed");
  }

  const output = {
    SUPPORT_SERVICE_SOURCE_INFORMATION_VALIDATION: errors.length === 0 ? "PASS" : "FAIL",
    sourceRegistryCount: (registry.sources || []).length,
    checks: checks,
    errors: errors
  };

  console.log("=== SUPPORT_SERVICE Source/Information Validation ===");
  console.log(JSON.stringify(output, null, 2));

  if (errors.length) {
    process.exit(1);
  }

  console.log("PHASE9_SUPPORT_SERVICE_SOURCE_INFORMATION_COMPLETE");
}

main();

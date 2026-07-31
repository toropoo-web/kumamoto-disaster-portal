#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");

const {
  loadSupportServiceSourceRegistry,
  resolveSupportServiceSource,
  validateSupportServiceSourceRegistry
} = require(path.join(ROOT, "monitor", "support-service-source-registry"));

const {
  loadSupportServiceFacilityRegistry,
  validateSupportServiceFacilityRegistry
} = require(path.join(ROOT, "monitor", "support-service-facility-registry"));

const {
  complementCandidateFromFacilityRegistry
} = require(path.join(ROOT, "monitor", "support-service-source-discovery"));

const {
  buildCandidateFromPost,
  discoverSupportServiceCandidates
} = require(path.join(ROOT, "monitor", "support-service-discovery-engine"));

const {
  buildDisasterSearchIndex
} = require(path.join(ROOT, "monitor", "disaster-search-index-engine"));

const PUBLIC_WATER_FILES = [
  "data/water_search_index.json",
  "data/public/water_search_index.json",
  "data/water_cross_view.json",
  "data/public/water_cross_view.json"
];

const FORBIDDEN_FIELDS = ["trust", "rank", "score", "confidence", "official_flag"];

function hashFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function main() {
  const errors = [];
  const checks = [];

  [
    "monitor/support-service-source-registry.js",
    "monitor/support-service-facility-registry.js",
    "data/support_service_discovery/source_registry.json",
    "data/support_service_discovery/facility_registry.json"
  ].forEach(function (file) {
    const exists = fs.existsSync(path.join(ROOT, file));
    checks.push({ check: file, pass: exists });
    if (!exists) {
      errors.push("Missing file: " + file);
    }
  });

  const sourceRegistry = loadSupportServiceSourceRegistry();
  const facilityRegistry = loadSupportServiceFacilityRegistry();
  const sourceRegistryErrors = validateSupportServiceSourceRegistry(sourceRegistry);
  const facilityRegistryErrors = validateSupportServiceFacilityRegistry(facilityRegistry);

  checks.push({
    check: "source registry schema valid",
    pass: sourceRegistryErrors.length === 0,
    errors: sourceRegistryErrors
  });
  checks.push({
    check: "facility registry schema valid",
    pass: facilityRegistryErrors.length === 0,
    errors: facilityRegistryErrors
  });
  errors.push.apply(errors, sourceRegistryErrors);
  errors.push.apply(errors, facilityRegistryErrors);

  (sourceRegistry.sources || []).forEach(function (source, index) {
    FORBIDDEN_FIELDS.forEach(function (field) {
      if (source[field] !== undefined) {
        errors.push("sources[" + index + "]: forbidden evaluation field " + field);
      }
    });
  });

  (facilityRegistry.facilities || []).forEach(function (facility, index) {
    FORBIDDEN_FIELDS.forEach(function (field) {
      if (facility[field] !== undefined) {
        errors.push("facilities[" + index + "]: forbidden evaluation field " + field);
      }
    });
  });

  const publicHashesBefore = {};
  PUBLIC_WATER_FILES.forEach(function (file) {
    const fullPath = path.join(ROOT, file);
    if (fs.existsSync(fullPath)) {
      publicHashesBefore[file] = hashFile(fullPath);
    }
  });

  const indexBefore = buildDisasterSearchIndex();
  const categoriesBefore = {};
  indexBefore.index.forEach(function (entry) {
    categoriesBefore[entry.category] = (categoriesBefore[entry.category] || 0) + 1;
  });

  const initialSourceCount = (sourceRegistry.sources || []).length;
  const newSourcePost = {
    source_type: "WEB",
    source_name: "Phase18 Registry Test Source",
    source_url: "https://example.invalid/support-service/phase18-registry-test",
    account: "",
    area: "熊本県熊本市",
    categories: ["SPACE"]
  };

  const resolved = resolveSupportServiceSource(newSourcePost, { registry: sourceRegistry });
  const registryOnlyCount = (resolved.registry.sources || []).length;
  checks.push({
    check: "case1 source addition registry only",
    pass:
      resolved.created === true &&
      resolved.source &&
      resolved.source.source_id &&
      registryOnlyCount === initialSourceCount + 1,
    created: resolved.created,
    sourceId: resolved.source && resolved.source.source_id,
    registryCount: registryOnlyCount
  });
  if (!resolved.created || !resolved.source || !resolved.source.source_id) {
    errors.push("case1 failed: source registration did not create registry entry");
  }
  if (registryOnlyCount !== initialSourceCount + 1) {
    errors.push("case1 failed: expected in-memory registry count increment only");
  }

  const discoveryPost = {
    source_type: "X",
    account: "phase18_discovery",
    source_url: "https://x.com/phase18_discovery/status/1",
    text: "熊本市 ○○温泉 被災者向け無料開放",
    published_at: "2026-07-31"
  };
  const candidate = buildCandidateFromPost(discoveryPost, {
    referenceDate: "2026-07-31",
    persistSourceRegistry: false
  });
  checks.push({
    check: "case2 candidate receives source_id",
    pass: Boolean(candidate.source_id),
    sourceId: candidate.source_id
  });
  if (!candidate.source_id) {
    errors.push("case2 failed: candidate missing source_id");
  }

  const matchedCandidate = complementCandidateFromFacilityRegistry({
    facility_name: "○○温泉",
    address: "UNKNOWN",
    municipality: "UNKNOWN",
    website: "UNKNOWN"
  });
  checks.push({
    check: "case3 facility registry match complements address",
    pass:
      matchedCandidate.web_complement_status === "RESOLVED" &&
      /熊本県熊本市/.test(matchedCandidate.address || ""),
    address: matchedCandidate.address,
    status: matchedCandidate.web_complement_status
  });
  if (matchedCandidate.web_complement_status !== "RESOLVED") {
    errors.push("case3 failed: expected web_complement_status RESOLVED");
  }
  if (!/熊本県熊本市/.test(matchedCandidate.address || "")) {
    errors.push("case3 failed: expected address complemented from facility registry");
  }

  const unmatchedCandidate = complementCandidateFromFacilityRegistry({
    facility_name: "未登録施設",
    address: "UNKNOWN",
    municipality: "UNKNOWN",
    website: "UNKNOWN"
  });
  checks.push({
    check: "case4 facility registry mismatch keeps UNKNOWN",
    pass:
      unmatchedCandidate.web_complement_status === "UNKNOWN" &&
      unmatchedCandidate.address === "UNKNOWN" &&
      unmatchedCandidate.municipality === "UNKNOWN" &&
      unmatchedCandidate.website === "UNKNOWN",
    address: unmatchedCandidate.address,
    municipality: unmatchedCandidate.municipality,
    website: unmatchedCandidate.website,
    status: unmatchedCandidate.web_complement_status
  });
  if (unmatchedCandidate.web_complement_status !== "UNKNOWN") {
    errors.push("case4 failed: expected web_complement_status UNKNOWN");
  }
  if (
    unmatchedCandidate.address !== "UNKNOWN" ||
    unmatchedCandidate.municipality !== "UNKNOWN" ||
    unmatchedCandidate.website !== "UNKNOWN"
  ) {
    errors.push("case4 failed: expected UNKNOWN preserved for unmatched facility");
  }

  const fixturePath = path.join(
    ROOT,
    "monitor",
    "fixtures",
    "support-service-discovery",
    "posts-fixture.json"
  );
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  const batch = discoverSupportServiceCandidates(fixture.posts, {
    referenceDate: fixture.referenceDate,
    persistSourceRegistry: false
  });
  const bathCandidate = batch.candidates.find(function (entry) {
    return /○○温泉/.test(entry.text);
  });
  checks.push({
    check: "discovery pipeline assigns source_id",
    pass: Boolean(bathCandidate && bathCandidate.source_id),
    sourceId: bathCandidate && bathCandidate.source_id
  });
  if (!bathCandidate || !bathCandidate.source_id) {
    errors.push("discovery pipeline failed: candidate missing source_id");
  }

  const indexAfter = buildDisasterSearchIndex();
  const categoriesAfter = {};
  indexAfter.index.forEach(function (entry) {
    categoriesAfter[entry.category] = (categoriesAfter[entry.category] || 0) + 1;
  });

  checks.push({
    check: "case5 WATER index count unchanged",
    pass: categoriesBefore.WATER === categoriesAfter.WATER,
    waterBefore: categoriesBefore.WATER,
    waterAfter: categoriesAfter.WATER
  });
  checks.push({
    check: "case5 VOLUNTEER index count unchanged",
    pass: categoriesBefore.VOLUNTEER === categoriesAfter.VOLUNTEER,
    volunteerBefore: categoriesBefore.VOLUNTEER,
    volunteerAfter: categoriesAfter.VOLUNTEER
  });
  if (categoriesBefore.WATER !== categoriesAfter.WATER) {
    errors.push("case5 failed: WATER index count changed during registry validation");
  }
  if (categoriesBefore.VOLUNTEER !== categoriesAfter.VOLUNTEER) {
    errors.push("case5 failed: VOLUNTEER index count changed during registry validation");
  }

  PUBLIC_WATER_FILES.forEach(function (file) {
    const fullPath = path.join(ROOT, file);
    if (!fs.existsSync(fullPath) || !publicHashesBefore[file]) {
      return;
    }
    const after = hashFile(fullPath);
    const pass = after === publicHashesBefore[file];
    checks.push({ check: "case5 water file unchanged: " + file, pass: pass });
    if (!pass) {
      errors.push("case5 failed: water file changed during validation: " + file);
    }
  });

  const output = {
    SUPPORT_SERVICE_REGISTRY_VALIDATION: errors.length === 0 ? "PASS" : "FAIL",
    sourceRegistryCount: (sourceRegistry.sources || []).length,
    facilityRegistryCount: (facilityRegistry.facilities || []).length,
    discoveryCandidateCount: batch.candidate_count,
    indexCategoriesBefore: categoriesBefore,
    indexCategoriesAfter: categoriesAfter,
    checks: checks,
    errors: errors
  };

  console.log("=== SUPPORT_SERVICE Registry Validation (Phase18) ===");
  console.log(JSON.stringify(output, null, 2));

  if (errors.length) {
    process.exit(1);
  }

  console.log("PHASE18_SUPPORT_SERVICE_SOURCE_REGISTRY_COMPLETE");
}

main();

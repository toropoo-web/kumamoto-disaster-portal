#!/usr/bin/env node
"use strict";

const path = require("path");

const {
  CAPABILITY_STATUS,
  CAPABILITY_STATUS_VALUES,
  VOLUNTEER_SCHEMA_CANDIDATES,
  buildVolunteerSchemaExample,
  getDisasterSources,
  loadWaterSources,
  validateDisasterRegistry,
  validateDisasterSourceEntry,
  validateVolunteerSchemaExample,
  validateVolunteerSchemaCandidates,
  validateWaterCompatibility
} = require(path.join(__dirname, "..", "monitor", "disaster-sources"));

const {
  buildVolunteerRegistryItems,
  searchDisasterIndex,
  toVolunteerRegistryIndexEntry,
  normalizeSearchText
} = require(path.join(__dirname, "..", "monitor", "disaster-search-index-engine"));

function main() {
  const errors = [];
  const checks = [];

  checks.push({
    check: "capability_status definitions",
    pass: CAPABILITY_STATUS_VALUES.length === 3,
    values: CAPABILITY_STATUS_VALUES
  });

  const volunteerExampleErrors = validateVolunteerSchemaExample();
  checks.push({
    check: "VOLUNTEER schema valid",
    pass: volunteerExampleErrors.length === 0,
    errors: volunteerExampleErrors
  });
  errors.push.apply(
    errors,
    volunteerExampleErrors.map(function (message) {
      return "VOLUNTEER schema: " + message;
    })
  );

  const candidateErrors = validateVolunteerSchemaCandidates();
  checks.push({
    check: "VOLUNTEER schema candidates valid",
    pass: candidateErrors.length === 0,
    candidateCount: Object.keys(VOLUNTEER_SCHEMA_CANDIDATES).reduce(function (sum, key) {
      return sum + VOLUNTEER_SCHEMA_CANDIDATES[key].length;
    }, 0),
    errors: candidateErrors
  });
  errors.push.apply(
    errors,
    candidateErrors.map(function (message) {
      return "VOLUNTEER candidate: " + message;
    })
  );

  const separationExample = buildVolunteerSchemaExample({
    historical_evidence: ["熊本地震"],
    current_capability: {
      confirmed: true,
      source: ""
    }
  });
  const separationErrors = validateDisasterSourceEntry(separationExample, 0, {
    allowInactiveWithoutUrl: true
  });
  checks.push({
    check: "historical/current separation enforced",
    pass: separationErrors.length > 0,
    errors: separationErrors
  });
  if (!separationErrors.length) {
    errors.push("historical_evidence must not justify current_capability.confirmed without source");
  }

  const waterOnlyEntry = {
    source_id: "DSRC-WAT-TEST000001",
    category: "WATER",
    prefecture: "熊本県",
    municipality: "熊本県",
    organization: "熊本県防災情報",
    source_type: "DISASTER",
    url: "https://example.invalid/water",
    keywords: ["給水"],
    extractor: {},
    official: true,
    active: true,
    capability_status: CAPABILITY_STATUS.CURRENT_CONFIRMED
  };
  const waterFieldErrors = validateDisasterSourceEntry(waterOnlyEntry, 0);
  checks.push({
    check: "WATER entries reject volunteer-only fields",
    pass: waterFieldErrors.some(function (message) {
      return /capability_status only allowed for VOLUNTEER/.test(message);
    }),
    errors: waterFieldErrors
  });
  if (!checks[checks.length - 1].pass) {
    errors.push("WATER entries must not accept volunteer-only fields");
  }

  const registryResult = validateDisasterRegistry();
  checks.push({
    check: "WATER registry unaffected",
    pass:
      registryResult.errors.length === 0 &&
      registryResult.categoryCounts.WATER > 0 &&
      registryResult.categoryCounts.VOLUNTEER === 0
  });
  errors.push.apply(errors, registryResult.errors);

  const waterCompatErrors = validateWaterCompatibility();
  checks.push({
    check: "WATER legacy compatibility",
    pass: waterCompatErrors.length === 0
  });
  errors.push.apply(errors, waterCompatErrors);

  const adapted = loadWaterSources();
  const activeWater = getDisasterSources("WATER", { activeOnly: true, officialOnly: true });
  checks.push({
    check: "loadWaterSources adapter unchanged",
    pass: adapted.category === "WATER" && adapted.sources.length === activeWater.length
  });
  if (adapted.sources.length !== activeWater.length) {
    errors.push("loadWaterSources adapter count mismatch");
  }

  const volunteerSource = buildVolunteerSchemaExample({ active: true });
  const volunteerIndexEntry = toVolunteerRegistryIndexEntry(volunteerSource);
  const volunteerItems = buildVolunteerRegistryItems({
    sources: [volunteerSource]
  });
  const volunteerPayload = { index: volunteerItems };
  const volunteerSearch = searchDisasterIndex(volunteerPayload, "熊本 ボランティア", {
    category: "VOLUNTEER"
  });
  const capabilitySearch = searchDisasterIndex(volunteerPayload, "CURRENT_CONFIRMED", {
    category: "VOLUNTEER"
  });
  const historicalSearch = searchDisasterIndex(
    volunteerPayload,
    normalizeSearchText((volunteerSource.historical_evidence || []).join(" ")),
    { category: "VOLUNTEER" }
  );

  checks.push({
    check: "VOLUNTEER index buildable",
    pass: volunteerItems.length === 1,
    itemCount: volunteerItems.length
  });
  if (!volunteerItems.length) {
    errors.push("VOLUNTEER index build failed");
  }

  checks.push({
    check: "VOLUNTEER search by organization/municipality/keywords",
    pass: volunteerSearch.length > 0,
    count: volunteerSearch.length
  });
  if (!volunteerSearch.length) {
    errors.push("VOLUNTEER search failed: 熊本 ボランティア");
  }

  checks.push({
    check: "VOLUNTEER search by capability_status",
    pass: capabilitySearch.length > 0,
    count: capabilitySearch.length
  });
  if (!capabilitySearch.length) {
    errors.push("VOLUNTEER search failed: CURRENT_CONFIRMED");
  }

  checks.push({
    check: "historical_evidence excluded from normal search",
    pass: historicalSearch.length === 0,
    count: historicalSearch.length
  });
  if (historicalSearch.length) {
    errors.push("historical_evidence must not be searchable in normal VOLUNTEER index");
  }

  const historicalOnlySource = buildVolunteerSchemaExample({
    source_id: "DSRC-VOL-HISTORICAL01",
    municipality: "氷川町",
    organization: "氷川町社会福祉協議会",
    active: true,
    capability_status: CAPABILITY_STATUS.HISTORICAL_ONLY,
    historical_evidence: ["熊本地震", "令和2年7月豪雨"],
    current_capability: {
      confirmed: false,
      source: ""
    }
  });
  const historicalOnlyItems = buildVolunteerRegistryItems({
    sources: [historicalOnlySource]
  });
  checks.push({
    check: "HISTORICAL_ONLY excluded from current index",
    pass: historicalOnlyItems.length === 0
  });
  if (historicalOnlyItems.length) {
    errors.push("HISTORICAL_ONLY sources must not appear in current search index");
  }

  checks.push({
    check: "VOLUNTEER index entry has capability_status",
    pass: volunteerIndexEntry.capability_status === CAPABILITY_STATUS.CURRENT_CONFIRMED
  });
  if (!volunteerIndexEntry.capability_status) {
    errors.push("VOLUNTEER index entry missing capability_status");
  }

  const output = {
    VOLUNTEER_SCHEMA_VALIDATION: errors.length === 0 ? "PASS" : "FAIL",
    capabilityStatus: CAPABILITY_STATUS,
    schemaCandidates: VOLUNTEER_SCHEMA_CANDIDATES,
    checks: checks,
    errors: errors
  };

  console.log("=== Volunteer Schema Validation ===");
  console.log(JSON.stringify(output, null, 2));

  if (errors.length) {
    process.exit(1);
  }

  console.log("PHASE27_VOLUNTEER_SCHEMA_EXTENSION_COMPLETE");
}

main();

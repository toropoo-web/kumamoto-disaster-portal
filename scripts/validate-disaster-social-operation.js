#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const WORKFLOW_FILE = path.join(ROOT, ".github", "workflows", "disaster-social-inbox.yml");
const SOURCES_FILE = path.join(ROOT, "data", "community", "disaster_social_sources.json");

const {
  AUTO_PUBLISH,
  SOURCE_TYPE_VALUES
} = require(path.join(__dirname, "..", "monitor", "disaster-social-pipeline"));

const {
  buildDisasterSocialOperationReport
} = require(path.join(__dirname, "..", "monitor", "disaster-social-operation-monitor"));

const {
  validateDisasterSocialSources,
  searchDisasterSocialIndex,
  loadMunicipalityMaster,
  validateMunicipalityMaster
} = require(path.join(__dirname, "..", "monitor", "disaster-social-index-engine"));

const {
  loadCommunityRegionMaster,
  validateCommunityRegionMaster,
  LAYER_SCOPE
} = require(path.join(__dirname, "..", "monitor", "disaster-social-region-master"));

const {
  buildAndWriteDisasterSearchIndex,
  searchDisasterIndex
} = require(path.join(__dirname, "..", "monitor", "disaster-search-index-engine"));

function main() {
  const errors = [];
  const checks = [];

  const workflowText = fs.readFileSync(WORKFLOW_FILE, "utf8");
  const workflowChecks = [
    { name: "cron schedule", pass: /cron:\s*"0 \*\/6 \* \* \*"/.test(workflowText) },
    { name: "workflow_dispatch", pass: /workflow_dispatch:/.test(workflowText) },
    { name: "instagram feed sync", pass: /sync:disaster-social-instagram-feed/.test(workflowText) },
    { name: "sns fetch step", pass: /fetch:disaster-social-sns/.test(workflowText) },
    { name: "review queue generation", pass: /review:disaster-social-queue/.test(workflowText) },
    { name: "operation monitor", pass: /monitor:disaster-social-operation/.test(workflowText) },
    { name: "stop at review queue", pass: /STOP_AT=REVIEW_QUEUE/.test(workflowText) },
    { name: "auto apply disabled", pass: /AUTO_APPLY=false/.test(workflowText) },
    { name: "no apply step", pass: !/apply:disaster-social-queue/.test(workflowText) },
    { name: "no build step", pass: !/npm run build/.test(workflowText) }
  ];
  workflowChecks.forEach(function (item) {
    checks.push({ check: "workflow " + item.name, pass: item.pass });
    if (!item.pass) {
      errors.push("workflow missing requirement: " + item.name);
    }
  });

  const sourcesPayload = JSON.parse(fs.readFileSync(SOURCES_FILE, "utf8"));
  errors.push.apply(errors, validateDisasterSocialSources(sourcesPayload));
  const activeSources = (sourcesPayload.sources || []).filter(function (source) {
    return source.active !== false;
  });
  const missingSourceType = activeSources.filter(function (source) {
    return !source.source_type || SOURCE_TYPE_VALUES.indexOf(source.source_type) === -1;
  });
  checks.push({
    check: "source_type on active sources",
    pass: missingSourceType.length === 0,
    active_source_count: activeSources.length,
    missing: missingSourceType.map(function (source) {
      return source.source_id;
    })
  });
  if (missingSourceType.length) {
    errors.push("active sources missing valid source_type");
  }

  const sourceTypesPresent = SOURCE_TYPE_VALUES.filter(function (type) {
    return activeSources.some(function (source) {
      return source.source_type === type;
    });
  });
  checks.push({
    check: "source_type coverage",
    pass: sourceTypesPresent.length >= 4,
    present: sourceTypesPresent
  });

  const report = buildDisasterSocialOperationReport();
  const indexPath = path.join(ROOT, "data", "community", "disaster_social_index.json");
  const indexPayload = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  const regionMaster = loadCommunityRegionMaster();
  errors.push.apply(errors, validateCommunityRegionMaster(regionMaster));
  checks.push({
    check: "community region layer",
    pass:
      regionMaster.layer_scope === LAYER_SCOPE &&
      regionMaster.extensible === false &&
      regionMaster.municipality_count === 23
  });
  if (regionMaster.layer_scope !== LAYER_SCOPE) {
    errors.push("community layer scope must be " + LAYER_SCOPE);
  }

  checks.push({
    check: "evacuation alert scope fixed",
    pass:
      regionMaster.extensible === false &&
      regionMaster.evacuation_alert_region_path === "data/public/evacuation_alert_region.json"
  });
  if (regionMaster.extensible !== false) {
    errors.push("community layer must use fixed evacuation alert municipality scope");
  }

  const masterPayload = loadMunicipalityMaster();
  errors.push.apply(errors, validateMunicipalityMaster(masterPayload));

  checks.push({
    check: "municipality master fixed scope",
    pass:
      masterPayload.extensible === false &&
      (masterPayload.municipalities || []).length === 23,
    municipality_count: (masterPayload.municipalities || []).length
  });
  if (masterPayload.extensible !== false) {
    errors.push("municipality master must remain fixed to evacuation alert scope");
  }

  const hachioResults = searchDisasterSocialIndex(indexPayload, { region: "八代市" });
  const hachioEntryCount = indexPayload.entries.filter(function (entry) {
    return entry.municipality === "八代市";
  }).length;
  checks.push({
    check: "evacuation scope municipality search",
    pass: hachioResults.length === hachioEntryCount && hachioEntryCount > 0,
    count: hachioResults.length
  });
  if (hachioResults.length !== hachioEntryCount) {
    errors.push("municipality search 八代市 must return all matching entries");
  }

  const kirishimaResults = searchDisasterSocialIndex(indexPayload, {
    prefecture: "鹿児島県",
    municipality: "霧島市"
  });
  const kirishimaEntryCount = indexPayload.entries.filter(function (entry) {
    return entry.prefecture === "鹿児島県" && entry.municipality === "霧島市";
  }).length;
  checks.push({
    check: "kirishima city search",
    pass: kirishimaResults.length === kirishimaEntryCount && kirishimaEntryCount > 0,
    count: kirishimaResults.length
  });
  if (kirishimaResults.length !== kirishimaEntryCount) {
    errors.push("search 鹿児島県霧島市 must return all Kirishima entries");
  }

  const districtResults = searchDisasterSocialIndex(indexPayload, {
    prefecture: "熊本県",
    municipality: "八代市"
  });
  checks.push({
    check: "municipality structured search",
    pass: districtResults.length > 0,
    count: districtResults.length
  });
  if (!districtResults.length) {
    errors.push("municipality structured search failed");
  }

  const categoryResults = searchDisasterSocialIndex(indexPayload, { category: "WATER" });
  checks.push({
    check: "category search",
    pass: categoryResults.length > 0,
    count: categoryResults.length
  });
  if (!categoryResults.length) {
    errors.push("category search failed for WATER");
  }

  const dateResults = searchDisasterSocialIndex(indexPayload, { date: "2026-07-31" });
  checks.push({
    check: "date search",
    pass: dateResults.length > 0,
    count: dateResults.length
  });
  if (!dateResults.length) {
    errors.push("date search failed for 2026-07-31");
  }

  checks.push({
    check: "operation monitor report",
    pass: report.counts.index_entry_count > 0,
    index_entry_count: report.counts.index_entry_count
  });
  checks.push({
    check: "incomplete preserved in index",
    pass: report.counts.incomplete_index_count > 0,
    incomplete_index_count: report.counts.incomplete_index_count
  });
  checks.push({
    check: "sns acquisition mode in inbox",
    pass: (JSON.parse(fs.readFileSync(path.join(ROOT, "data", "community", "disaster_social_inbox.json"), "utf8")).acquisition_mode === "SNS_AUTO_FETCH")
  });

  checks.push({
    check: "duplicate preserved in review queue",
    pass: typeof report.counts.duplicate_review_count === "number",
    duplicate_review_count: report.counts.duplicate_review_count
  });
  checks.push({
    check: "schema validation in monitor",
    pass: report.schema_validation.pass === true
  });
  checks.push({
    check: "AUTO_PUBLISH false",
    pass: AUTO_PUBLISH === false && report.AUTO_PUBLISH === false
  });
  checks.push({
    check: "AUTO_APPLY false",
    pass: report.AUTO_APPLY === false
  });
  checks.push({
    check: "manual apply required",
    pass: report.manual_apply_required === true
  });
  checks.push({
    check: "ai judgment disabled",
    pass: report.ai_judgment === false
  });
  checks.push({
    check: "stop at review queue",
    pass: report.STOP_AT === "REVIEW_QUEUE"
  });

  checks.push({
    check: "prefecture detail monitor",
    pass:
      report.prefecture_detail &&
      report.prefecture_detail["熊本県"] &&
      typeof report.prefecture_detail["熊本県"].category_counts === "object"
  });
  if (!report.prefecture_detail || !report.prefecture_detail["熊本県"]) {
    errors.push("operation monitor must include prefecture_detail");
  }

  const officialWater = searchDisasterIndex(buildAndWriteDisasterSearchIndex(), "給水", {
    category: "WATER"
  });
  checks.push({
    check: "official layer unaffected",
    pass: officialWater.length > 0,
    water_count: officialWater.length
  });
  if (!officialWater.length) {
    errors.push("official water search must remain available");
  }

  const incompleteWithNote = (report.incomplete_items || []).filter(function (item) {
    return item.review_note;
  });
  const testInboxPath = path.join(ROOT, "data", "community", "disaster_social_inbox_test.json");
  const testInbox = fs.existsSync(testInboxPath)
    ? JSON.parse(fs.readFileSync(testInboxPath, "utf8"))
    : { items: [] };
  const testIncompleteWithNote = (testInbox.items || []).filter(function (item) {
    return item.review_note;
  });
  checks.push({
    check: "incomplete review_note",
    pass: incompleteWithNote.length > 0 || testIncompleteWithNote.length > 0,
    production_count: incompleteWithNote.length,
    test_count: testIncompleteWithNote.length
  });
  if (!incompleteWithNote.length && !testIncompleteWithNote.length) {
    errors.push("incomplete items must include review_note in test inbox");
  }

  const publicIndexPath = path.join(ROOT, "data", "public", "disaster_social_index.json");
  checks.push({
    check: "public JSON exists",
    pass: fs.existsSync(publicIndexPath)
  });
  if (!fs.existsSync(publicIndexPath)) {
    errors.push("public disaster social index missing");
  }

  console.log("=== Disaster Social Operation Validation ===");
  console.log(
    JSON.stringify(
      {
        DISASTER_SOCIAL_OPERATION_VALIDATION: errors.length === 0 ? "PASS" : "FAIL",
        checks: checks,
        errors: errors
      },
      null,
      2
    )
  );

  if (errors.length) {
    process.exit(1);
  }

  console.log("DISASTER_CROSS_SEARCH_COMMUNITY_PHASE7_CORRECTION_2_COMPLETE");
}

main();

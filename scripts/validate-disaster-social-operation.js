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
    { name: "inbox schema validation", pass: /validate:disaster-social-inbox-schema/.test(workflowText) },
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
      regionMaster.extensible === true &&
      regionMaster.region_group === "KYUSHU"
  });
  if (regionMaster.layer_scope !== LAYER_SCOPE) {
    errors.push("community layer scope must be " + LAYER_SCOPE);
  }
  if (regionMaster.region_group !== "KYUSHU") {
    errors.push("community region_group must be KYUSHU");
  }

  const masterPayload = loadMunicipalityMaster();
  errors.push.apply(errors, validateMunicipalityMaster(masterPayload));

  checks.push({
    check: "municipality master extensible",
    pass: masterPayload.extensible === true && (masterPayload.municipalities || []).length >= 45,
    municipality_count: (masterPayload.municipalities || []).length
  });
  if (!masterPayload.extensible) {
    errors.push("municipality master must remain extensible");
  }

  const prefectureResults = searchDisasterSocialIndex(indexPayload, { region: "熊本県" });
  const kumamotoEntryCount = indexPayload.entries.filter(function (entry) {
    return entry.prefecture === "熊本県";
  }).length;
  checks.push({
    check: "prefecture wide search",
    pass: prefectureResults.length === kumamotoEntryCount && kumamotoEntryCount > 0,
    count: prefectureResults.length
  });
  if (prefectureResults.length !== kumamotoEntryCount) {
    errors.push("prefecture search 熊本県 must return all Kumamoto entries");
  }

  const kagoshimaResults = searchDisasterSocialIndex(indexPayload, { region: "鹿児島県" });
  const kagoshimaEntryCount = indexPayload.entries.filter(function (entry) {
    return entry.prefecture === "鹿児島県";
  }).length;
  checks.push({
    check: "kagoshima prefecture wide search",
    pass: kagoshimaResults.length === kagoshimaEntryCount && kagoshimaEntryCount > 0,
    count: kagoshimaResults.length
  });
  if (kagoshimaResults.length !== kagoshimaEntryCount) {
    errors.push("prefecture search 鹿児島県 must return all Kagoshima entries");
  }

  const municipalityResults = searchDisasterSocialIndex(indexPayload, { region: "鹿児島市" });
  checks.push({
    check: "municipality search",
    pass: municipalityResults.length > 0,
    count: municipalityResults.length
  });
  if (!municipalityResults.length) {
    errors.push("municipality search failed for 鹿児島市");
  }

  const districtResults = searchDisasterSocialIndex(indexPayload, {
    prefecture: "熊本県",
    municipality: "阿蘇市",
    district: "黒川"
  });
  checks.push({
    check: "district search",
    pass: districtResults.length > 0,
    count: districtResults.length
  });
  if (!districtResults.length) {
    errors.push("district search failed");
  }

  const miyazakiResults = searchDisasterSocialIndex(indexPayload, { region: "宮崎県" });
  const miyazakiEntryCount = indexPayload.entries.filter(function (entry) {
    return entry.prefecture === "宮崎県";
  }).length;
  checks.push({
    check: "miyazaki prefecture wide search",
    pass: miyazakiResults.length === miyazakiEntryCount && miyazakiEntryCount > 0,
    count: miyazakiResults.length
  });
  if (!miyazakiEntryCount || miyazakiResults.length !== miyazakiEntryCount) {
    errors.push("prefecture search 宮崎県 must return all Miyazaki entries");
  }

  const oitaResults = searchDisasterSocialIndex(indexPayload, { region: "大分県" });
  const oitaEntryCount = indexPayload.entries.filter(function (entry) {
    return entry.prefecture === "大分県";
  }).length;
  checks.push({
    check: "oita prefecture wide search",
    pass: oitaResults.length === oitaEntryCount && oitaEntryCount > 0,
    count: oitaResults.length
  });
  if (!oitaEntryCount || oitaResults.length !== oitaEntryCount) {
    errors.push("prefecture search 大分県 must return all Oita entries");
  }

  const kyushuSouthResults = searchDisasterSocialIndex(indexPayload, { region: "九州南部" });
  const kyushuSouthCount = indexPayload.entries.filter(function (entry) {
    return ["熊本県", "鹿児島県", "宮崎県"].indexOf(entry.prefecture) !== -1;
  }).length;
  checks.push({
    check: "kyushu south region search",
    pass: kyushuSouthResults.length === kyushuSouthCount && kyushuSouthCount > 0,
    count: kyushuSouthResults.length
  });
  if (kyushuSouthResults.length !== kyushuSouthCount) {
    errors.push("九州南部 search must return all south Kyushu entries");
  }

  const kyushuAllResults = searchDisasterSocialIndex(indexPayload, { region: "九州全域" });
  checks.push({
    check: "kyushu all region search",
    pass: kyushuAllResults.length === indexPayload.entries.length,
    count: kyushuAllResults.length
  });
  if (kyushuAllResults.length !== indexPayload.entries.length) {
    errors.push("九州全域 search must return all indexed entries");
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
    check: "duplicate preserved in review queue",
    pass: report.counts.duplicate_review_count > 0,
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
  checks.push({
    check: "incomplete review_note",
    pass: incompleteWithNote.length > 0,
    count: incompleteWithNote.length
  });
  if (!incompleteWithNote.length) {
    errors.push("incomplete items must include review_note");
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

  console.log("DISASTER_CROSS_SEARCH_COMMUNITY_PHASE7_KYUSHU_REGION_COMPLETE");
}

main();

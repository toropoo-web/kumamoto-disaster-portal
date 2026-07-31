#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..");

const {
  parseCsvImport,
  parseJsonImport,
  normalizeInboxItem,
  buildReviewQueueFromInbox,
  buildApplyQueueFromReviewQueue,
  applyDisasterSocialQueue,
  validateInboxItem,
  validateDisasterSocialInbox,
  AUTO_PUBLISH,
  SOURCE_TYPE_VALUES
} = require(path.join(__dirname, "..", "monitor", "disaster-social-pipeline"));

const {
  searchDisasterSocialIndex,
  buildAndWriteDisasterSocialIndex,
  validateDisasterSocialIndex,
  loadMunicipalityMaster,
  validateMunicipalityMaster,
  SOCIAL_CATEGORIES,
  SOCIAL_CATEGORY_KEYWORDS,
  matchesCategory,
  resolveCategoryFromKeyword,
  resolveSocialCategoryInput
} = require(path.join(__dirname, "..", "monitor", "disaster-social-index-engine"));

const {
  buildAndWriteDisasterSearchIndex,
  searchDisasterIndex
} = require(path.join(__dirname, "..", "monitor", "disaster-search-index-engine"));

function copyJson(fromPath, toPath) {
  fs.mkdirSync(path.dirname(toPath), { recursive: true });
  fs.copyFileSync(fromPath, toPath);
}

function main() {
  const errors = [];
  const checks = [];
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "disaster-social-pipeline-"));

  const inboxPath = path.join(tempDir, "disaster_social_inbox.json");
  const reviewPath = path.join(tempDir, "disaster_social_review_queue.json");
  const applyPath = path.join(tempDir, "disaster_social_apply_queue.json");
  const sourcesPath = path.join(tempDir, "disaster_social_sources.json");
  const indexPath = path.join(tempDir, "disaster_social_index.json");
  const publicIndexPath = path.join(tempDir, "public_disaster_social_index.json");
  const publicSourcesPath = path.join(tempDir, "public_disaster_social_sources.json");

  copyJson(
    path.join(ROOT, "data", "community", "disaster_social_index.json"),
    indexPath
  );
  copyJson(
    path.join(ROOT, "data", "community", "disaster_social_sources.json"),
    sourcesPath
  );

  const masterPayload = loadMunicipalityMaster();
  errors.push.apply(errors, validateMunicipalityMaster(masterPayload));
  checks.push({
    check: "municipality master",
    pass:
      validateMunicipalityMaster(masterPayload).length === 0 &&
      masterPayload.municipality_count >= 45,
    municipality_count: (masterPayload.municipalities || []).length
  });
  if (masterPayload.municipality_count < 45) {
    errors.push("municipality master must include all Kumamoto municipalities");
  }

  const inboxPayload = JSON.parse(
    fs.readFileSync(path.join(ROOT, "data", "community", "disaster_social_inbox.json"), "utf8")
  );
  errors.push.apply(errors, validateDisasterSocialInbox(inboxPayload));
  checks.push({ check: "inbox load", pass: validateDisasterSocialInbox(inboxPayload).length === 0 });

  const opsItems = (inboxPayload.items || []).filter(function (item) {
    return String(item.inbox_id || "").indexOf("OPS-") !== -1;
  });
  const opsSourceTypes = opsItems.map(function (item) {
    return item.source_type;
  });
  checks.push({
    check: "operation inbox source_type",
    pass:
      opsItems.length >= 12 &&
      opsSourceTypes.indexOf("X") !== -1 &&
      opsSourceTypes.indexOf("Instagram") !== -1 &&
      opsSourceTypes.indexOf("WEB") !== -1 &&
      opsSourceTypes.indexOf("MANUAL") !== -1,
    ops_count: opsItems.length
  });
  if (opsItems.length < 12) {
    errors.push("operation inbox items missing");
  }

  const csvItems = parseCsvImport(
    "source,category,prefecture,municipality,district,date,title,content,url\n" +
      "SOC-LOCAL-005,CHARGING,熊本県,氷川町,吉井,2026-07-30,CSV充電スポット,公民館前の充電提供,https://example.local/hikawa-csv-charging\n"
  );
  checks.push({ check: "csv import", pass: csvItems.length === 1 });
  if (!csvItems.length) {
    errors.push("csv import failed");
  }

  const jsonItems = parseJsonImport([
    {
      source: "SOC-LOCAL-003",
      category: "VOLUNTEER",
      prefecture: "熊本県",
      municipality: "熊本市",
      district: "東区",
      date: "2026-07-30",
      title: "JSONインポート検証",
      content: "東区での片付けボランティア募集。",
      url: "https://example.local/kumamoto-json-volunteer"
    }
  ]);
  checks.push({ check: "json import", pass: jsonItems.length === 1 });

  const incompleteItem = normalizeInboxItem(
    {
      source: "SOC-LOCAL-005",
      category: "SUPPLIES",
      prefecture: "熊本県",
      municipality: "氷川町",
      title: "不足項目テスト",
      review_note: "district, url 未確認"
    },
    0
  );
  checks.push({
    check: "incomplete status preserved",
    pass: incompleteItem.status === "incomplete" && incompleteItem.missing_fields.length > 0
  });
  if (incompleteItem.status !== "incomplete") {
    errors.push("incomplete items must be preserved with status incomplete");
  }

  const pipelineInbox = {
    version: "1.0",
    region: "KYUSHU_SOUTH",
    AUTO_PUBLISH: AUTO_PUBLISH,
    items: inboxPayload.items.concat(csvItems, jsonItems, [incompleteItem])
  };
  fs.writeFileSync(inboxPath, JSON.stringify(pipelineInbox, null, 2) + "\n", "utf8");

  const reviewQueue = buildReviewQueueFromInbox(pipelineInbox, {
    indexPath: indexPath,
    reviewQueuePath: reviewPath
  });
  reviewQueue.items.forEach(function (item) {
    if (item.review_status === "PENDING") {
      item.review_status = "APPROVED";
      item.reviewed_at = new Date().toISOString();
    }
  });
  fs.writeFileSync(reviewPath, JSON.stringify(reviewQueue, null, 2) + "\n", "utf8");
  checks.push({
    check: "queue generation",
    pass: reviewQueue.item_count > 0,
    review_item_count: reviewQueue.item_count
  });

  const duplicateCount = reviewQueue.items.filter(function (item) {
    return item.review_status === "DUPLICATE";
  }).length;
  checks.push({ check: "duplicate detection", pass: duplicateCount >= 1, duplicate_count: duplicateCount });

  const applyQueue = buildApplyQueueFromReviewQueue(reviewQueue, { applyQueuePath: applyPath });
  fs.writeFileSync(applyPath, JSON.stringify(applyQueue, null, 2) + "\n", "utf8");
  checks.push({
    check: "apply queue generation",
    pass: applyQueue.item_count > 0,
    apply_item_count: applyQueue.item_count
  });

  const applyResult = applyDisasterSocialQueue({
    applyQueuePath: applyPath,
    sourcesPath: sourcesPath,
    indexPath: indexPath,
    publicIndexPath: publicIndexPath,
    publicSourcesPath: publicSourcesPath
  });
  checks.push({
    check: "apply execution",
    pass: applyResult.applied_count > 0,
    applied_count: applyResult.applied_count,
    entry_count: applyResult.entry_count
  });

  const indexPayload = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  const baselineEntryCount = indexPayload.entries.length;
  errors.push.apply(errors, validateDisasterSocialIndex(indexPayload));
  const buildPayload = buildAndWriteDisasterSocialIndex({
    sourcesPath: sourcesPath,
    indexPath: indexPath,
    publicIndexPath: publicIndexPath,
    publicSourcesPath: publicSourcesPath
  });
  checks.push({
    check: "index generation",
    pass: buildPayload.meta.entry_count === indexPayload.entries.length
  });

  const regionResults = searchDisasterSocialIndex(indexPayload, { region: "熊本県" });
  const kumamotoEntryCount = indexPayload.entries.filter(function (entry) {
    return entry.prefecture === "熊本県";
  }).length;
  checks.push({
    check: "prefecture wide search",
    pass: regionResults.length === kumamotoEntryCount && kumamotoEntryCount > 0,
    count: regionResults.length,
    kumamoto_entry_count: kumamotoEntryCount
  });
  if (regionResults.length !== kumamotoEntryCount) {
    errors.push("prefecture search 熊本県 must return all Kumamoto entries");
  }

  const municipalityResults = searchDisasterSocialIndex(indexPayload, { region: "合志市" });
  checks.push({
    check: "municipality search",
    pass: municipalityResults.length > 0,
    count: municipalityResults.length
  });
  if (!municipalityResults.length) {
    errors.push("municipality search failed");
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

  const legacyFiveResults = searchDisasterSocialIndex(indexPayload, { municipality: "八代市" });
  checks.push({
    check: "municipality data preserved",
    pass: legacyFiveResults.length > 0,
    count: legacyFiveResults.length
  });
  if (!legacyFiveResults.length) {
    errors.push("municipality data must be preserved");
  }

  const extensibleItem = normalizeInboxItem(
    {
      source: "SOC-LOCAL-003",
      category: "OTHER",
      prefecture: "熊本県",
      municipality: "新規受付町",
      district: "テスト",
      date: "2026-08-01",
      title: "新規地域受付テスト",
      content: "マスタ未登録地域の受付確認",
      url: "https://example.local/full-region-test"
    },
    0
  );
  const extensibleErrors = validateInboxItem(extensibleItem, 0);
  checks.push({
    check: "extensible municipality intake",
    pass: extensibleErrors.length === 0 && extensibleItem.status === "ACTIVE",
    municipality: extensibleItem.municipality
  });
  if (extensibleErrors.length) {
    errors.push("unknown municipalities must remain accepted");
  }

  const regionResultsLegacy = searchDisasterSocialIndex(indexPayload, { region: "熊本市" });
  checks.push({ check: "region search", pass: regionResultsLegacy.length > 0, count: regionResultsLegacy.length });
  if (!regionResultsLegacy.length) {
    errors.push("region search failed");
  }

  const dateResults = searchDisasterSocialIndex(indexPayload, { date: "2026-07-31" });
  checks.push({ check: "date search", pass: dateResults.length > 0, count: dateResults.length });
  if (!dateResults.length) {
    errors.push("date search failed");
  }

  const categoryResults = searchDisasterSocialIndex(indexPayload, { category: "TOILET" });
  checks.push({ check: "category search", pass: categoryResults.length > 0, count: categoryResults.length });
  if (!categoryResults.length) {
    errors.push("category search failed");
  }

  const structuredResults = searchDisasterSocialIndex(indexPayload, {
    prefecture: "熊本県",
    municipality: "阿蘇市",
    date: "2026-08-01",
    category: "WATER"
  });
  checks.push({
    check: "prefecture municipality date category search",
    pass: structuredResults.length > 0,
    count: structuredResults.length,
    sample_id: structuredResults[0] && structuredResults[0].id
  });
  if (!structuredResults.length) {
    errors.push("structured search failed for 熊本県 阿蘇市 2026-08-01 WATER");
  }

  const expandedCategories = ["BATH", "SHOWER", "FREE_SPACE", "PET_SUPPORT", "WIFI"];
  const missingExpanded = expandedCategories.filter(function (category) {
    return SOCIAL_CATEGORIES.indexOf(category) === -1;
  });
  checks.push({
    check: "expanded categories defined",
    pass: missingExpanded.length === 0,
    missing: missingExpanded
  });
  if (missingExpanded.length) {
    errors.push("missing expanded categories");
  }

  checks.push({
    check: "keyword category resolution",
    pass: resolveCategoryFromKeyword("シャワー") === "SHOWER"
  });
  if (resolveCategoryFromKeyword("シャワー") !== "SHOWER") {
    errors.push("keyword シャワー must resolve to SHOWER");
  }

  checks.push({
    check: "keyword assist category match",
    pass: matchesCategory(
      { category: "OTHER", title: "Wi-Fi利用可", content: "", keywords: [] },
      "WIFI"
    )
  });

  checks.push({
    check: "existing entries preserved",
    pass: baselineEntryCount >= 31,
    entry_count: baselineEntryCount
  });

  checks.push({
    check: "category keywords defined",
    pass: (SOCIAL_CATEGORY_KEYWORDS.FOOD || []).indexOf("炊き出し") !== -1
  });

  const petKeywordChecks = ["迷子猫", "迷子犬", "ペット避難", "ペット用品"];
  const petKeywordPass = petKeywordChecks.every(function (keyword) {
    return (
      resolveCategoryFromKeyword(keyword) === "PET_SUPPORT" &&
      matchesCategory(
        { category: "OTHER", title: keyword + "の情報", content: "", keywords: [] },
        "PET_SUPPORT"
      )
    );
  });
  checks.push({
    check: "pet support keyword resolution",
    pass: petKeywordPass,
    keywords: petKeywordChecks
  });
  if (!petKeywordPass) {
    errors.push("pet support keywords must resolve to PET_SUPPORT");
  }

  const operationalSearches = [
    { keyword: "迷子犬", category: "PET_SUPPORT" },
    { keyword: "給水", category: "WATER" },
    { keyword: "風呂", category: "BATH" }
  ];
  const operationalPass = operationalSearches.every(function (item) {
    const resolution = resolveSocialCategoryInput(item.keyword);
    const results = searchDisasterSocialIndex(indexPayload, {
      region: "熊本県",
      date: "2026-08-01",
      categoryQuery: item.keyword
    });
    return resolution.category === item.category && results.length > 0;
  });
  checks.push({
    check: "operational keyword search",
    pass: operationalPass
  });
  if (!operationalPass) {
    errors.push("operational keyword search failed");
  }

  const officialPayload = buildAndWriteDisasterSearchIndex();
  const waterResults = searchDisasterIndex(officialPayload, "給水", { category: "WATER" });
  checks.push({
    check: "official search unaffected",
    pass: waterResults.length > 0,
    water_count: waterResults.length
  });
  if (!waterResults.length) {
    errors.push("official water search must remain available");
  }

  const incompleteEntries = indexPayload.entries.filter(function (entry) {
    return entry.status === "incomplete";
  });
  checks.push({
    check: "incomplete entries retained",
    pass: incompleteEntries.length > 0,
    incomplete_count: incompleteEntries.length
  });

  const reviewNotePass = incompleteItem.review_note && incompleteItem.status === "incomplete";
  checks.push({
    check: "incomplete review_note preserved",
    pass: reviewNotePass
  });
  if (!reviewNotePass) {
    errors.push("incomplete items must preserve review_note");
  }

  console.log("=== Disaster Social Pipeline Validation ===");
  console.log(
    JSON.stringify(
      {
        DISASTER_SOCIAL_PIPELINE_VALIDATION: errors.length === 0 ? "PASS" : "FAIL",
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

  console.log("DISASTER_CROSS_SEARCH_COMMUNITY_PIPELINE_PHASE2_COMPLETE");
}

main();

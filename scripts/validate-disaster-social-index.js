#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

const {
  PUBLIC_INDEX_FILE,
  PUBLIC_SOURCES_FILE,
  SOCIAL_CATEGORIES,
  SOCIAL_CATEGORY_KEYWORDS,
  buildAndWriteDisasterSocialIndex,
  searchDisasterSocialIndex,
  validateDisasterSocialIndex,
  validateDisasterSocialSources,
  loadMunicipalityMaster,
  validateMunicipalityMaster,
  matchesCategory,
  resolveCategoryFromKeyword,
  resolveSocialCategoryInput
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

  [
    "data/community/disaster_social_sources.json",
    "data/community/disaster_social_index.json",
    "data/community/municipality_master.json",
    "data/community/community_region_master.json",
    "monitor/disaster-social-region-master.js",
    "monitor/disaster-social-index-engine.js",
    "monitor/disaster-social-municipality-master.js",
    "scripts/build-disaster-social-index.js"
  ].forEach(function (file) {
    const exists = fs.existsSync(path.join(ROOT, file));
    checks.push({ check: file, pass: exists });
    if (!exists) {
      errors.push("Missing file: " + file);
    }
  });

  const masterPayload = loadMunicipalityMaster();
  errors.push.apply(errors, validateMunicipalityMaster(masterPayload));
  checks.push({
    check: "municipality master valid",
    pass: validateMunicipalityMaster(masterPayload).length === 0,
    municipality_count: (masterPayload.municipalities || []).length
  });

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

  const payload = buildAndWriteDisasterSocialIndex();
  const baselineEntryCount = payload.index.entries.length;
  errors.push.apply(errors, validateDisasterSocialSources(payload.sources));
  errors.push.apply(errors, validateDisasterSocialIndex(payload.index));

  checks.push({
    check: "JSON valid",
    pass:
      validateDisasterSocialSources(payload.sources).length === 0 &&
      validateDisasterSocialIndex(payload.index).length === 0
  });

  checks.push({
    check: "public JSON exists",
    pass: fs.existsSync(PUBLIC_INDEX_FILE) && fs.existsSync(PUBLIC_SOURCES_FILE)
  });

  const hachioResults = searchDisasterSocialIndex(payload.index, {
    region: "八代市"
  });
  const hachioEntryCount = payload.index.entries.filter(function (entry) {
    return entry.municipality === "八代市";
  }).length;
  checks.push({
    check: "evacuation scope municipality search",
    pass: hachioResults.length === hachioEntryCount && hachioEntryCount > 0,
    count: hachioResults.length,
    hachio_entry_count: hachioEntryCount
  });
  if (hachioResults.length !== hachioEntryCount) {
    errors.push("municipality search 八代市 must return all matching entries");
  }

  const kirishimaResults = searchDisasterSocialIndex(payload.index, {
    prefecture: "鹿児島県",
    municipality: "霧島市"
  });
  const kirishimaEntryCount = payload.index.entries.filter(function (entry) {
    return entry.prefecture === "鹿児島県" && entry.municipality === "霧島市";
  }).length;
  checks.push({
    check: "kirishima city search",
    pass: kirishimaResults.length === kirishimaEntryCount && kirishimaEntryCount > 0,
    count: kirishimaResults.length,
    kirishima_entry_count: kirishimaEntryCount
  });
  if (kirishimaResults.length !== kirishimaEntryCount) {
    errors.push("search 鹿児島県霧島市 must return all Kirishima entries");
  }

  const municipalityResults = searchDisasterSocialIndex(payload.index, {
    region: "合志市"
  });
  checks.push({
    check: "municipality search",
    pass: municipalityResults.length > 0,
    count: municipalityResults.length
  });
  if (!municipalityResults.length) {
    errors.push("municipality search must return results for 合志市");
  }

  const regionResults = searchDisasterSocialIndex(payload.index, {
    region: "八代"
  });
  checks.push({
    check: "region search",
    pass: regionResults.length > 0,
    count: regionResults.length
  });
  if (!regionResults.length) {
    errors.push("region search must return results for 八代");
  }

  const dateResults = searchDisasterSocialIndex(payload.index, {
    date: "2026-07-31"
  });
  checks.push({
    check: "date search",
    pass: dateResults.length > 0,
    count: dateResults.length
  });
  if (!dateResults.length) {
    errors.push("date search must return results for 2026-07-31");
  }

  const categoryResults = searchDisasterSocialIndex(payload.index, {
    category: "WATER"
  });
  checks.push({
    check: "category search",
    pass: categoryResults.length > 0,
    count: categoryResults.length
  });
  if (!categoryResults.length) {
    errors.push("category search must return results for WATER");
  }

  const combinedResults = searchDisasterSocialIndex(payload.index, {
    prefecture: "熊本県",
    municipality: "八代市",
    date: "2026-07-31",
    category: "WATER"
  });
  checks.push({
    check: "prefecture municipality date category search",
    pass: combinedResults.length > 0,
    count: combinedResults.length
  });
  if (!combinedResults.length) {
    errors.push("structured search must return results for 熊本県 八代市 2026-07-31 WATER");
  }

  const districtResults = searchDisasterSocialIndex(payload.index, {
    prefecture: "熊本県",
    municipality: "八代市"
  });
  checks.push({
    check: "district search optional",
    pass: districtResults.length > 0,
    count: districtResults.length
  });

  const legacyResults = searchDisasterSocialIndex(payload.index, {
    municipality: "熊本市"
  });
  checks.push({
    check: "municipality structured search",
    pass: legacyResults.length > 0,
    count: legacyResults.length
  });

  const requiredCategories = [
    "WATER",
    "FOOD",
    "SUPPLIES",
    "TOILET",
    "CHARGING",
    "VOLUNTEER",
    "BATH",
    "SHOWER",
    "FREE_SPACE",
    "SHELTER",
    "PET_SUPPORT",
    "WIFI",
    "OTHER"
  ];
  const missingCategories = requiredCategories.filter(function (category) {
    return SOCIAL_CATEGORIES.indexOf(category) === -1;
  });
  checks.push({
    check: "expanded categories defined",
    pass: missingCategories.length === 0,
    missing: missingCategories
  });
  if (missingCategories.length) {
    errors.push("missing expanded categories: " + missingCategories.join(", "));
  }

  const newCategoryResults = searchDisasterSocialIndex(payload.index, {
    category: "FOOD"
  });
  checks.push({
    check: "fetch category search",
    pass: newCategoryResults.length > 0,
    count: newCategoryResults.length
  });
  if (!newCategoryResults.length) {
    errors.push("category search must return results for FOOD");
  }

  const keywordCategory = resolveCategoryFromKeyword("給水");
  const keywordResults = searchDisasterSocialIndex(payload.index, {
    category: keywordCategory
  });
  checks.push({
    check: "keyword category resolution",
    pass: keywordCategory === "WATER" && keywordResults.length > 0,
    resolved_category: keywordCategory,
    count: keywordResults.length
  });
  if (keywordCategory !== "WATER") {
    errors.push("keyword 給水 must resolve to WATER");
  }

  const keywordAssistPass = matchesCategory(
    {
      category: "OTHER",
      title: "地域の銭湯が無料開放",
      content: "",
      keywords: []
    },
    "BATH"
  );
  checks.push({
    check: "keyword assist category match",
    pass: keywordAssistPass
  });
  if (!keywordAssistPass) {
    errors.push("keyword assist must match BATH for 銭湯 text");
  }

  checks.push({
    check: "sns rebuild entry volume",
    pass: baselineEntryCount >= 100,
    entry_count: baselineEntryCount
  });
  if (baselineEntryCount < 100) {
    errors.push("community index must contain sns rebuild volume");
  }

  checks.push({
    check: "category keywords defined",
    pass: (SOCIAL_CATEGORY_KEYWORDS.WATER || []).indexOf("給水") !== -1
  });

  const petKeywordChecks = ["迷子猫", "迷子犬", "ペット避難", "ペット用品"];
  const petKeywordResults = petKeywordChecks.map(function (keyword) {
    return {
      keyword: keyword,
      category: resolveCategoryFromKeyword(keyword),
      assist: matchesCategory(
        { category: "OTHER", title: keyword + "の情報", content: "", keywords: [] },
        "PET_SUPPORT"
      )
    };
  });
  const petKeywordPass = petKeywordResults.every(function (item) {
    return item.category === "PET_SUPPORT" && item.assist;
  });
  checks.push({
    check: "pet support keyword resolution",
    pass: petKeywordPass,
    results: petKeywordResults
  });
  if (!petKeywordPass) {
    errors.push("pet support keywords must resolve to PET_SUPPORT");
  }

  const operationalSearches = [
    { keyword: "給水", category: "WATER", region: "八代市" },
    { keyword: "炊き出し", category: "FOOD", region: "" },
    { keyword: "物資", category: "SUPPLIES", region: "人吉市" }
  ];
  const operationalResults = operationalSearches.map(function (item) {
    const resolution = resolveSocialCategoryInput(item.keyword);
    const query = { categoryQuery: item.keyword };
    if (item.region) {
      query.region = item.region;
    }
    const results = searchDisasterSocialIndex(payload.index, query);
    return {
      keyword: item.keyword,
      resolved_category: resolution.category,
      expected_category: item.category,
      count: results.length,
      pass: resolution.category === item.category && results.length > 0
    };
  });
  const operationalPass = operationalResults.every(function (item) {
    return item.pass;
  });
  checks.push({
    check: "operational keyword search",
    pass: operationalPass,
    results: operationalResults
  });
  if (!operationalPass) {
    errors.push("operational keyword search failed");
  }

  const regionHierarchyResults = searchDisasterSocialIndex(payload.index, {
    region: "八代市",
    date: "2026-07-31",
    categoryQuery: "給水"
  });
  checks.push({
    check: "region hierarchy search",
    pass: regionHierarchyResults.length > 0,
    count: regionHierarchyResults.length
  });
  if (!regionHierarchyResults.length) {
    errors.push("region hierarchy search must return results");
  }

  const regionGroupResults = searchDisasterSocialIndex(payload.index, {
    region: "阿蘇地域"
  });
  checks.push({
    check: "region group search",
    pass: regionGroupResults.length > 0,
    count: regionGroupResults.length
  });
  if (!regionGroupResults.length) {
    errors.push("region group search must return results for 阿蘇地域");
  }

  const emptyFilterResults = searchDisasterSocialIndex(payload.index, {});
  checks.push({
    check: "empty filter returns none",
    pass: emptyFilterResults.length === 0
  });
  if (emptyFilterResults.length) {
    errors.push("empty filters must not return results");
  }

  const officialPayload = buildAndWriteDisasterSearchIndex();
  const waterResults = searchDisasterIndex(officialPayload, "給水", { category: "WATER" });
  checks.push({
    check: "official water search preserved",
    pass: waterResults.length > 0,
    count: waterResults.length
  });
  if (!waterResults.length) {
    errors.push("official water search must remain available");
  }

  const appJs = fs.readFileSync(path.join(ROOT, "js", "app.js"), "utf8");
  checks.push({
    check: "community search UI",
    pass:
      appJs.indexOf("現地支援情報を探す") !== -1 &&
      appJs.indexOf("カテゴリ・キーワード") !== -1 &&
      appJs.indexOf("ペット・迷子情報") !== -1
  });
  if (
    appJs.indexOf("現地支援情報を探す") === -1 ||
    appJs.indexOf("カテゴリ・キーワード") === -1
  ) {
    errors.push("community search UI keyword input missing");
  }

  checks.push({
    check: "social categories defined",
    pass: SOCIAL_CATEGORIES.length >= 13
  });

  console.log("=== Disaster Social Index Validation ===");
  console.log(
    JSON.stringify(
      {
        DISASTER_SOCIAL_INDEX_VALIDATION: errors.length === 0 ? "PASS" : "FAIL",
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

  console.log("DISASTER_CROSS_SEARCH_COMMUNITY_LAYER_COMPLETE");
}

main();

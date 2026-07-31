#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");

const {
  evaluateXDiscoveryText,
  isDiscoverableSupportServicePost,
  COMPOUND_DISCOVERY_PHRASES,
  SUPPORT_STATE_KEYWORDS,
  TOPIC_KEYWORD_GROUPS
} = require(path.join(ROOT, "monitor", "support-service-x-discovery"));

const {
  buildCandidateFromPost,
  CATEGORY_KEYWORD_RULES
} = require(path.join(ROOT, "monitor", "support-service-discovery-engine"));

const {
  SUPPORT_SERVICE_SEARCH_DICTIONARY,
  getSupportServiceDictionaryKeywords
} = require(path.join(ROOT, "monitor", "support-service-search-dictionary"));

const {
  buildDisasterSearchIndex
} = require(path.join(ROOT, "monitor", "disaster-search-index-engine"));

const MATRIX_PATH = path.join(
  ROOT,
  "monitor",
  "fixtures",
  "support-service-phase28",
  "keyword-matrix.json"
);

const PUBLIC_WATER_FILES = [
  "data/water_search_index.json",
  "data/public/water_search_index.json",
  "data/water_cross_view.json",
  "data/public/water_cross_view.json"
];

function hashFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function includesKeyword(list, keyword) {
  return (list || []).indexOf(keyword) !== -1;
}

function getTopicKeywordsForGroup(group) {
  const topicKeywords = TOPIC_KEYWORD_GROUPS[group] || [];
  const dictionaryKeywords = SUPPORT_SERVICE_SEARCH_DICTIONARY[group] || [];
  const merged = topicKeywords.slice();

  dictionaryKeywords.forEach(function (keyword) {
    if (merged.indexOf(keyword) === -1) {
      merged.push(keyword);
    }
  });

  return merged;
}

function main() {
  const errors = [];
  const checks = [];
  const matrix = JSON.parse(fs.readFileSync(MATRIX_PATH, "utf8"));

  const publicHashesBefore = {};
  PUBLIC_WATER_FILES.forEach(function (file) {
    const fullPath = path.join(ROOT, file);
    if (fs.existsSync(fullPath)) {
      publicHashesBefore[file] = hashFile(fullPath);
    }
  });

  const waterSearchIndex = JSON.parse(
    fs.readFileSync(path.join(ROOT, "data", "public", "water_search_index.json"), "utf8")
  );
  const indexBefore = buildDisasterSearchIndex();
  const categoriesBefore = {};
  indexBefore.index.forEach(function (entry) {
    categoriesBefore[entry.category] = (categoriesBefore[entry.category] || 0) + 1;
  });

  Object.keys(matrix).forEach(function (group) {
    if (group === "version" || group === "description" || group === "support_state" || group === "compound_phrases") {
      return;
    }
    const topicKeywords = getTopicKeywordsForGroup(group);
    matrix[group].forEach(function (keyword) {
      const pass = includesKeyword(topicKeywords, keyword);
      checks.push({
        check: "x-discovery topic keyword: " + group + "/" + keyword,
        pass: pass
      });
      if (!pass) {
        errors.push("missing x-discovery topic keyword: " + group + "/" + keyword);
      }
    });
  });

  matrix.support_state.forEach(function (keyword) {
    const pass = includesKeyword(SUPPORT_STATE_KEYWORDS, keyword);
    checks.push({ check: "x-discovery support state: " + keyword, pass: pass });
    if (!pass) {
      errors.push("missing support state keyword: " + keyword);
    }
  });

  matrix.compound_phrases.forEach(function (phrase) {
    const pass = includesKeyword(COMPOUND_DISCOVERY_PHRASES, phrase);
    checks.push({ check: "x-discovery compound phrase: " + phrase, pass: pass });
    if (!pass) {
      errors.push("missing compound phrase: " + phrase);
    }
  });

  const discoveryCases = [
    { text: "熊本市 入浴施設で体を洗えます。無料開放しています。", subcategory: "BATH" },
    { text: "益城町 休憩スペースを仮眠利用できます。", subcategory: "SPACE" },
    { text: "八代市 仮設トイレを開放しています。", subcategory: "TOILET" },
    { text: "宇城市 駐車場開放。車中泊可能です。", subcategory: "VEHICLE" },
    { text: "人吉市 井戸水あります。水配布します。", subcategory: "WATER_SUPPORT" },
    { text: "合志市 炊き出しします。無料食事提供します。", subcategory: "FOOD" },
    { text: "菊陽町 毛布配布と衣類配布を開始しました。", subcategory: "SUPPLIES" },
    { text: "天草市 ペット受入対応します。犬猫預かります。", subcategory: "PET" },
    { text: "温泉無料開放しています。熊本市です。", subcategory: "BATH", compound: true },
    { text: "温泉", subcategory: null, discoverable: false }
  ];

  discoveryCases.forEach(function (testCase, index) {
    const evaluation = evaluateXDiscoveryText(testCase.text);
    const candidate = buildCandidateFromPost({
      source_type: "X",
      source_url: "https://x.com/example/status/phase28-" + index,
      account: "phase28_fixture",
      text: testCase.text,
      published_at: "2026-07-31",
      municipality: "熊本市"
    });
    const expectedDiscoverable = testCase.discoverable !== false;
    const pass =
      evaluation.discoverable === expectedDiscoverable &&
      (expectedDiscoverable ? candidate.subcategory === testCase.subcategory : true);
    checks.push({
      case: "discovery-" + (index + 1),
      check: testCase.text.slice(0, 24),
      pass: pass,
      subcategory: candidate.subcategory,
      discoverable: evaluation.discoverable
    });
    if (!pass) {
      errors.push("discovery case failed: " + testCase.text);
    }
  });

  if (isDiscoverableSupportServicePost({ text: "温泉" })) {
    errors.push("standalone 温泉 must remain excluded");
  } else {
    checks.push({ check: "standalone onsen excluded", pass: true });
  }

  Object.keys(matrix).forEach(function (group) {
    if (group === "version" || group === "description" || group === "support_state" || group === "compound_phrases") {
      return;
    }
    const dictGroup = SUPPORT_SERVICE_SEARCH_DICTIONARY[group] || [];
    matrix[group].forEach(function (keyword) {
      const pass = includesKeyword(dictGroup, keyword);
      checks.push({
        check: "search dictionary: " + group + "/" + keyword,
        pass: pass
      });
      if (!pass) {
        errors.push("missing search dictionary keyword: " + group + "/" + keyword);
      }
    });
  });

  const showerKeywords = getSupportServiceDictionaryKeywords("BATH", "SHOWER", "FREE_OPEN");
  checks.push({
    check: "search dictionary haystack includes シャワー室",
    pass: showerKeywords.indexOf("シャワー室") !== -1
  });
  if (showerKeywords.indexOf("シャワー室") === -1) {
    errors.push("search dictionary missing シャワー室 in BATH/SHOWER");
  }

  const ruleKeywordCount = CATEGORY_KEYWORD_RULES.reduce(function (count, rule) {
    return count + rule.keywords.length;
  }, 0);
  checks.push({
    check: "discovery-engine category rules expanded",
    pass: ruleKeywordCount >= 50,
    ruleKeywordCount: ruleKeywordCount
  });
  if (ruleKeywordCount < 50) {
    errors.push("discovery-engine category rules not expanded enough");
  }

  const case6Pass =
    categoriesBefore.WATER === waterSearchIndex.item_count &&
    categoriesBefore.VOLUNTEER === 20;
  checks.push({
    case: "Case6",
    check: "WATER/VOLUNTEER index unchanged",
    pass: case6Pass,
    categoriesBefore: categoriesBefore
  });
  if (!case6Pass) {
    errors.push("WATER/VOLUNTEER index changed during validation");
  }

  PUBLIC_WATER_FILES.forEach(function (file) {
    const fullPath = path.join(ROOT, file);
    if (!fs.existsSync(fullPath) || !publicHashesBefore[file]) {
      return;
    }
    const pass = hashFile(fullPath) === publicHashesBefore[file];
    checks.push({ case: "Case6", check: "file unchanged: " + file, pass: pass });
    if (!pass) {
      errors.push("water file changed: " + file);
    }
  });

  const output = {
    SUPPORT_SERVICE_PHASE28_KEYWORD_VALIDATION: errors.length === 0 ? "PASS" : "FAIL",
    matrixVersion: matrix.version,
    topicGroupCount: Object.keys(TOPIC_KEYWORD_GROUPS).length,
    supportStateCount: SUPPORT_STATE_KEYWORDS.length,
    compoundPhraseCount: COMPOUND_DISCOVERY_PHRASES.length,
    checks: checks,
    errors: errors
  };

  console.log("=== SUPPORT_SERVICE Phase28 Keyword Matrix Validation ===");
  console.log(JSON.stringify(output, null, 2));

  if (errors.length) {
    process.exit(1);
  }
}

main();

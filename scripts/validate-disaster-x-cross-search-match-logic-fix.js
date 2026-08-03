#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PUBLIC_SOCIAL_INDEX = path.join(ROOT, "data", "public", "disaster_social_index.json");

const { searchDisasterSocialIndex } = require(path.join(ROOT, "monitor", "disaster-social-index-engine"));
const {
  buildEntryContentHaystack,
  matchesPreciseSearchQuery
} = require(path.join(ROOT, "monitor", "disaster-social-search-match"));

const MAINTAIN_EXPECTED = {
  給水: 540,
  支援物資: 134,
  炊き出し: 31,
  風呂: 184
};

function loadIndex() {
  return JSON.parse(fs.readFileSync(PUBLIC_SOCIAL_INDEX, "utf8"));
}

function search(index, categoryQuery) {
  return searchDisasterSocialIndex(index, { categoryQuery: categoryQuery });
}

function isPetBottleFalsePositive(entry) {
  const hay = buildEntryContentHaystack(entry);
  return /ペットボトル/.test(hay) && !matchesPreciseSearchQuery(hay, "猫") && !matchesPreciseSearchQuery(hay, "犬");
}

function isRescueDogFalsePositive(entry) {
  const hay = buildEntryContentHaystack(entry);
  return (
    /救助犬|警備犬/.test(hay) &&
    !/迷子犬|迷い犬|保護犬|犬を探|犬が迷/.test(hay) &&
    !matchesPreciseSearchQuery(hay, "犬")
  );
}

function isPetOnlyFalsePositiveForCat(entry) {
  const hay = buildEntryContentHaystack(entry);
  return /ペット/.test(hay) && !/猫/.test(hay);
}

function main() {
  const errors = [];
  const checks = [];
  const index = loadIndex();

  const catResults = search(index, "猫");
  const catFalsePositives = catResults.filter(function (item) {
    return isPetBottleFalsePositive(item.entry) || isPetOnlyFalsePositiveForCat(item.entry);
  });
  const catSample = catResults[0] || null;
  checks.push({
    check: "猫検索: ペット全体展開なし",
    pass: catResults.length > 0 && catFalsePositives.length === 0,
    count: catResults.length,
    false_positive_count: catFalsePositives.length,
    sample_match: catSample ? catSample.matchReason : null
  });
  if (!catResults.length || catFalsePositives.length) {
    errors.push("猫検索 must not expand to generic pet matches");
  }
  if (catSample && catSample.matchReason && catSample.matchReason.matchedKeyword === "ペット") {
    errors.push("猫検索 must not display matched keyword ペット");
  }

  const dogResults = search(index, "犬");
  const dogFalsePositives = dogResults.filter(function (item) {
    return isRescueDogFalsePositive(item.entry);
  });
  checks.push({
    check: "犬検索: 救助犬・警備犬誤一致なし",
    pass: dogResults.length > 0 && dogFalsePositives.length === 0,
    count: dogResults.length,
    false_positive_count: dogFalsePositives.length
  });
  if (!dogResults.length || dogFalsePositives.length) {
    errors.push("犬検索 must not match rescue/security dog posts without lost dog context");
  }

  const petResults = search(index, "ペット");
  const petFalsePositives = petResults.filter(function (item) {
    return isPetBottleFalsePositive(item.entry);
  });
  checks.push({
    check: "ペット検索: ペット関連として動作",
    pass: petResults.length > 0 && petFalsePositives.length === 0,
    count: petResults.length,
    false_positive_count: petFalsePositives.length
  });
  if (!petResults.length || petFalsePositives.length) {
    errors.push("ペット検索 must remain usable without pet-bottle false positives");
  }

  Object.keys(MAINTAIN_EXPECTED).forEach(function (query) {
    const count = search(index, query).length;
    const pass = count === MAINTAIN_EXPECTED[query];
    checks.push({
      check: "既存検索維持 " + query,
      pass: pass,
      expected: MAINTAIN_EXPECTED[query],
      actual: count
    });
    if (!pass) {
      errors.push(query + " count must remain " + MAINTAIN_EXPECTED[query] + ", got " + count);
    }
  });

  const result = {
    DISASTER_X_CROSS_SEARCH_MATCH_LOGIC_FIX_VALIDATION: errors.length === 0 ? "PASS" : "FAIL",
    checks: checks,
    errors: errors
  };

  console.log(JSON.stringify(result, null, 2));
  if (errors.length) {
    process.exit(1);
  }
  console.log("DISASTER_X_CROSS_SEARCH_MATCH_LOGIC_FIX_COMPLETE");
}

main();

#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

const {
  DISASTER_CATEGORIES,
  CATEGORY_KEYWORDS,
  classifyChangeLogEntries,
  classifyChangeEntry,
  validateClassificationBatch,
  resolveChangeLogPath,
  listChangeLogFiles
} = require("../monitor/diff-classification");

function main() {
  const errors = [];
  const checks = [];

  const modulePath = path.join(ROOT, "monitor", "diff-classification.js");
  const scriptPath = path.join(ROOT, "scripts", "classify-patrol-diffs.js");
  checks.push({ check: "monitor/diff-classification.js exists", pass: fs.existsSync(modulePath) });
  checks.push({ check: "scripts/classify-patrol-diffs.js exists", pass: fs.existsSync(scriptPath) });

  if (!fs.existsSync(modulePath) || !fs.existsSync(scriptPath)) {
    errors.push("classification module or script missing");
  }

  DISASTER_CATEGORIES.forEach(function (category) {
    const keywords = CATEGORY_KEYWORDS[category];
    const pass = Array.isArray(keywords) && keywords.length > 0;
    checks.push({ check: "category keywords: " + category, pass: pass });
    if (!pass) {
      errors.push("missing keywords for category: " + category);
    }
  });

  const sampleShelter = classifyChangeEntry(
    {
      source: "TEST-shelter",
      sourceName: "テスト市",
      url: "https://example.test/shelter",
      changeType: "CONTENT_CHANGED",
      detectedAt: "2026-07-30T00:00:00.000Z",
      keywords: ["避難所", "開設"]
    },
    { title: "避難所の開設について" },
    0
  );
  const shelterPass =
    sampleShelter.length === 1 &&
    sampleShelter[0].category === "SHELTER" &&
    sampleShelter[0].confidence === "HIGH";
  checks.push({ check: "keyword-only SHELTER classification", pass: shelterPass });
  if (!shelterPass) {
    errors.push("SHELTER sample classification failed");
  }

  const sampleNoGuess = classifyChangeEntry(
    {
      source: "TEST-no-guess",
      sourceName: "テスト町",
      url: "https://example.test/page",
      changeType: "CONTENT_CHANGED",
      detectedAt: "2026-07-30T00:00:00.000Z",
      keywords: ["避難"]
    },
    { title: "防災情報" },
    0
  );
  const noGuessPass = sampleNoGuess.length === 0;
  checks.push({ check: "no speculative classification for 避難 only", pass: noGuessPass });
  if (!noGuessPass) {
    errors.push("speculative classification detected for 避難-only sample");
  }

  const pageUpdatedOnly = classifyChangeLogEntries(
    [
      {
        source: "TEST-page-updated-only",
        sourceName: "テスト村",
        url: "https://example.test/page",
        changeType: "PAGE_UPDATED_AT_CHANGED",
        detectedAt: "2026-07-30T00:00:00.000Z",
        previousHash: "same-hash",
        currentHash: "same-hash",
        keywords: ["避難所", "給水", "復旧"],
        pageUpdatedAtChanged: {
          from: "Thu, 30 Jul 2026 15:00:10 GMT",
          to: "Thu, 30 Jul 2026 15:00:13 GMT"
        }
      }
    ],
    { sources: {} }
  );
  const pageUpdatedOnlyPass = pageUpdatedOnly.length === 0;
  checks.push({ check: "PAGE_UPDATED_AT_CHANGED excluded from classification", pass: pageUpdatedOnlyPass });
  if (!pageUpdatedOnlyPass) {
    errors.push("PAGE_UPDATED_AT_CHANGED must not produce classifications");
  }

  const contentChanged = classifyChangeLogEntries(
    [
      {
        source: "TEST-content-changed",
        sourceName: "テスト市",
        url: "https://example.test/water",
        changeType: "CONTENT_CHANGED",
        detectedAt: "2026-07-30T00:00:00.000Z",
        previousHash: "before-hash",
        currentHash: "after-hash",
        keywords: ["断水"]
      }
    ],
    { sources: {} }
  );
  const contentChangedPass =
    contentChanged.length >= 1 &&
    contentChanged.some(function (item) {
      return item.category === "WATER";
    });
  checks.push({ check: "CONTENT_CHANGED produces classification", pass: contentChangedPass });
  if (!contentChangedPass) {
    errors.push("CONTENT_CHANGED must produce keyword-based classification");
  }

  const changeLogPath = resolveChangeLogPath();
  if (!changeLogPath) {
    // change-log JSON files are gitignored; CI clean checkouts rely on synthetic samples above.
    checks.push({
      check: "existing change-log parse",
      pass: true,
      skipped: true,
      reason: "monitor/change-log/*.json absent (gitignored)"
    });
    checks.push({
      check: "classification generated from change-log",
      pass: true,
      skipped: true,
      reason: "no local change-log"
    });
    ["WATER", "SHELTER", "COMMUNICATION", "SUPPORT"].forEach(function (category) {
      checks.push({
        check: "category present: " + category,
        pass: true,
        skipped: true,
        reason: "no local change-log"
      });
    });
  } else {
    const entries = JSON.parse(fs.readFileSync(changeLogPath, "utf8"));
    const snapshotsPath = path.join(ROOT, "monitor", "reports", "snapshots.json");
    const snapshots = fs.existsSync(snapshotsPath)
      ? JSON.parse(fs.readFileSync(snapshotsPath, "utf8"))
      : { sources: {} };
    const classifications = classifyChangeLogEntries(entries, snapshots);
    checks.push({
      check: "existing change-log parse",
      pass: Array.isArray(entries) && entries.length > 0
    });
    checks.push({
      check: "classification generated from change-log",
      pass: classifications.length > 0
    });

    const batch = {
      generatedAt: new Date().toISOString(),
      classificationCount: classifications.length,
      autoPublish: false,
      classifications: classifications
    };
    const schemaErrors = validateClassificationBatch(batch);
    checks.push({
      check: "JSON schema validation",
      pass: schemaErrors.length === 0,
      schemaErrors: schemaErrors
    });
    if (schemaErrors.length) {
      errors.push.apply(errors, schemaErrors);
    }

    const categorySummary = {};
    DISASTER_CATEGORIES.forEach(function (category) {
      categorySummary[category] = classifications.filter(function (item) {
        return item.category === category;
      }).length;
    });
    checks.push({ check: "category summary", pass: true, categorySummary: categorySummary });

    ["WATER", "SHELTER", "COMMUNICATION", "SUPPORT"].forEach(function (category) {
      if (!categorySummary[category]) {
        errors.push("expected at least one " + category + " classification from existing change-log");
        checks.push({ check: "category present: " + category, pass: false });
      } else {
        checks.push({ check: "category present: " + category, pass: true });
      }
    });
  }

  const result = {
    DIFF_CLASSIFICATION_VALIDATION: errors.length === 0 ? "PASS" : "FAIL",
    changeLogFiles: listChangeLogFiles().map(function (filePath) {
      return path.relative(ROOT, filePath);
    }),
    checks: checks,
    errors: errors
  };

  console.log("=== Diff Classification Validation ===");
  console.log(JSON.stringify(result, null, 2));

  if (errors.length) {
    process.exit(1);
  }
}

main();

#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");

const PUBLIC_FILES = [
  "data/public/phase1_areas.json",
  "data/public/phase1_navigation.json",
  "data/public/phase1_updates.json",
  "data/public/communication_status.json",
  "data/public/status.json"
];

const {
  URL_STATUS,
  classifyFromHttp,
  renderLinkAuditReport,
  saveAuditArtifacts,
  summarizeAuditResults
} = require(path.join(ROOT, "monitor", "url-audit"));

function hashFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function main() {
  const errors = [];
  const publicHashesBefore = {};

  PUBLIC_FILES.forEach((file) => {
    publicHashesBefore[file] = hashFile(path.join(ROOT, file));
  });

  const requiredFiles = [
    "monitor/url-audit.js",
    "scripts/run-url-audit.js",
    "operations/url-audit/.gitkeep"
  ];

  requiredFiles.forEach((file) => {
    if (!fs.existsSync(path.join(ROOT, file))) {
      errors.push("Missing file: " + file);
    }
  });

  const validStatuses = Object.values(URL_STATUS);
  const classificationCases = [
  {
      name: "http-200",
      fetchResult: { status: 200 },
      followUp: {},
      expected: URL_STATUS.PASS
    },
    {
      name: "timeout",
      fetchResult: { status: 0, error: "timeout" },
      followUp: {},
      expected: URL_STATUS.TEMPORARY_FAILURE
    },
    {
      name: "server-error",
      fetchResult: { status: 503 },
      followUp: {},
      expected: URL_STATUS.TEMPORARY_FAILURE
    },
    {
      name: "404-with-hub",
      fetchResult: { status: 404 },
      followUp: { officialDomain: true, titleSearchHit: true, hubPageHit: true },
      expected: URL_STATUS.URL_CHANGE_REQUIRED
    },
    {
      name: "404-with-successor",
      fetchResult: { status: 404 },
      followUp: { candidateSuccessorUrl: "https://example.org/new" },
      expected: URL_STATUS.REVIEW_REQUIRED
    }
  ];

  classificationCases.forEach((testCase) => {
    const actual = classifyFromHttp(testCase.fetchResult, testCase.followUp);
    if (actual !== testCase.expected) {
      errors.push(
        "Classification failed for " + testCase.name + ": expected " + testCase.expected + ", got " + actual
      );
    }
  });

  const mockResults = summarizeAuditResults([
    {
      id: "MOCK-001",
      category: "municipality",
      areaId: "KM000",
      name: "Mock Municipality",
      headline: "Test",
      url: "https://example.org/pass",
      httpStatus: 200,
      error: null,
      status: URL_STATUS.PASS,
      followUp: { notes: [] },
      auditedAt: new Date().toISOString()
    },
    {
      id: "MOCK-002",
      category: "municipality",
      areaId: "KM007",
      name: "Mock Temporary",
      headline: "Test",
      url: "https://example.org/fail",
      httpStatus: 0,
      error: "timeout",
      status: URL_STATUS.TEMPORARY_FAILURE,
      followUp: { notes: [] },
      auditedAt: new Date().toISOString()
    }
  ]);

  const report = renderLinkAuditReport(mockResults);
  if (!report.includes("# Link Audit")) {
    errors.push("link audit report missing header");
  }
  if (!report.includes("## PASS") || !report.includes("## TEMPORARY_FAILURE")) {
    errors.push("link audit report missing status sections");
  }

  let artifacts;
  try {
    artifacts = saveAuditArtifacts(mockResults);
  } catch (err) {
    errors.push("Report generation failed: " + err.message);
  }

  if (artifacts) {
    ["report.md", "result.json"].forEach((name) => {
      if (!fs.existsSync(path.join(artifacts.operationDir, name))) {
        errors.push("Missing operation artifact: " + name);
      }
    });
    if (!fs.existsSync(artifacts.reportPath)) {
      errors.push("Missing monitor/reports/link-audit-report.md");
    }
  }

  mockResults.results.forEach((result) => {
    if (!validStatuses.includes(result.status)) {
      errors.push("Invalid status on mock result: " + result.status);
    }
  });

  PUBLIC_FILES.forEach((file) => {
    const after = hashFile(path.join(ROOT, file));
    if (after !== publicHashesBefore[file]) {
      errors.push("Public data modified during url audit validation: " + file);
    }
  });

  const result = {
    URL_CLASSIFICATION: errors.length === 0 ? "PASS" : "FAIL",
    TEMPORARY_FAILURE_DETECTION:
      classifyFromHttp({ status: 0, error: "timeout" }, {}) === URL_STATUS.TEMPORARY_FAILURE
        ? "PASS"
        : "FAIL",
    REPORT_GENERATION: artifacts ? "PASS" : "FAIL",
    PUBLIC_DATA_CHANGE: errors.some((e) => e.includes("Public data modified")) ? "FAIL" : "NONE",
    PUBLIC_DATA_AUTO_DELETE: false,
    PUBLIC_DATA_PROTECTION: errors.some((e) => e.includes("Public data modified")) ? "FAIL" : "PASS",
    errors
  };

  console.log("=== URL Audit Validation ===");
  console.log(JSON.stringify(result, null, 2));

  if (errors.length > 0) {
    process.exit(1);
  }
}

main();

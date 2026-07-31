#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SOURCES_FILE = path.join(ROOT, "monitor", "sources.json");
const DRY_RUN_SNAPSHOT_FILE = path.join(ROOT, "monitor", "reports", "dry-run-snapshots.json");

const TARGET_AREA_IDS = [
  "KM014", "KM015", "KM016", "KM017", "KM018",
  "KM019", "KM020", "KM021", "KM022"
];

const { fetchSource } = require("../monitor/crawler");
const { parsePage } = require("../monitor/parser");
const { readSnapshots, writeSnapshots } = require("../monitor/diff-engine");

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function loadExpansionSources() {
  const data = readJson(SOURCES_FILE, { municipalities: [] });
  return (data.municipalities || []).filter(function (item) {
    return TARGET_AREA_IDS.indexOf(item.area_id) >= 0 && item.status === "ACTIVE";
  });
}

function buildSnapshotRecord(source, parsed, fetched) {
  return {
    url: source.url,
    httpStatus: fetched.status || null,
    reachable: parsed.reachable === true,
    title: parsed.title || "",
    pageUpdatedAt: parsed.pageUpdatedAt || "",
    keywords: parsed.keywords || [],
    contaminationRisk: parsed.contaminationRisk === true,
    contentHash: parsed.contentHash || null,
    checkedAt: new Date().toISOString(),
    sourceName: source.name,
    category: source.category
  };
}

function validateSnapshotRecord(sourceId, source, snapshot) {
  const errors = [];
  if (!snapshot) {
    errors.push("snapshot missing");
    return errors;
  }
  if (snapshot.url !== source.url) {
    errors.push("url mismatch");
  }
  if (!snapshot.contentHash) {
    errors.push("contentHash missing");
  }
  if (!snapshot.checkedAt) {
    errors.push("checkedAt missing");
  }
  if (snapshot.reachable !== true) {
    errors.push("reachable must be true");
  }
  return errors;
}

async function registerMissingBaselines(sources, snapshots, dryRun) {
  const results = [];

  for (let i = 0; i < sources.length; i += 1) {
    const source = sources[i];
    const existing = snapshots.sources[source.id] || null;
    const validationErrors = existing ? validateSnapshotRecord(source.id, source, existing) : ["snapshot missing"];

    if (existing && validationErrors.length === 0) {
      results.push({
        source_id: source.id,
        area_id: source.area_id,
        action: "verified",
        status: "PASS"
      });
      continue;
    }

    const fetched = await fetchSource(source.url);
    const parsed = parsePage(fetched);
    const record = buildSnapshotRecord(source, parsed, fetched);
    const recordErrors = validateSnapshotRecord(source.id, source, record);

    if (recordErrors.length) {
      results.push({
        source_id: source.id,
        area_id: source.area_id,
        action: "register_failed",
        status: "FAIL",
        errors: recordErrors
      });
      continue;
    }

    if (!dryRun) {
      snapshots.sources[source.id] = record;
    }

    results.push({
      source_id: source.id,
      area_id: source.area_id,
      municipality: source.name,
      action: existing ? "refreshed" : "registered",
      status: "PASS",
      contentHash: record.contentHash,
      checkedAt: record.checkedAt
    });
  }

  return results;
}

function listMissingExpansionSnapshots(snapshots, sources) {
  return sources
    .filter(function (source) {
      return !snapshots.sources[source.id];
    })
    .map(function (source) {
      return source.id;
    });
}

function main() {
  const dryRun = process.argv.indexOf("--dry-run") >= 0;
  const sources = loadExpansionSources();
  const snapshots = readSnapshots();

  registerMissingBaselines(sources, snapshots, dryRun)
    .then(function (results) {
      const failed = results.filter(function (item) {
        return item.status === "FAIL";
      });

      if (!dryRun && failed.length === 0) {
        writeSnapshots(snapshots);
      }

      const missingAfter = listMissingExpansionSnapshots(snapshots, sources);
      const dryRunSnapshotExists = fs.existsSync(DRY_RUN_SNAPSHOT_FILE);

      const output = {
        SNAPSHOT_BASELINE_FINALIZE: failed.length === 0 ? "PASS" : "FAIL",
        dryRun: dryRun,
        target_area_ids: TARGET_AREA_IDS,
        source_count: sources.length,
        results: results,
        missing_snapshots_after_finalize: missingAfter,
        dry_run_snapshot_file: dryRunSnapshotExists
          ? path.relative(ROOT, DRY_RUN_SNAPSHOT_FILE)
          : null,
        note:
          "KM022 and other missing sources receive first-time baseline registration only; compareSource logic unchanged."
      };

      console.log("=== Snapshot Baseline Finalize ===");
      console.log(JSON.stringify(output, null, 2));

      if (failed.length) {
        process.exit(1);
      }
    })
    .catch(function (err) {
      console.error(err);
      process.exit(1);
    });
}

main();

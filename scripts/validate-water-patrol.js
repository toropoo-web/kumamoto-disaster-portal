#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");

const SNAPSHOT_FILE = path.join(ROOT, "monitor", "reports", "water-snapshots.json");
const REVIEW_QUEUE_FILE = path.join(ROOT, "data", "review", "water", "water_review_queue.json");

const { validateWaterRegistry, getActiveWaterSources } = require("../monitor/water-sources");
const { validateWaterSnapshots, WATER_KEYWORDS } = require("../monitor/water-diff-engine");

const PUBLIC_WATER_FILES = [
  "data/water_sources.json",
  "data/water_cross_view.json",
  "data/public/water_cross_view.json",
  "data/water_search_index.json",
  "data/public/water_search_index.json"
];

function hashFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function hashContent(text) {
  return crypto.createHash("sha256").update(text || "").digest("hex");
}

function main() {
  const errors = [];
  const publicHashesBefore = {};

  PUBLIC_WATER_FILES.forEach(function (file) {
    const fullPath = path.join(ROOT, file);
    if (fs.existsSync(fullPath)) {
      publicHashesBefore[file] = hashFile(fullPath);
    }
  });

  [
    "data/water_sources.json",
    "monitor/water-sources.js",
    "monitor/water-fetcher.js",
    "monitor/water-diff-engine.js",
    "scripts/run-water-patrol.js",
    "monitor/baselines/water-snapshots.seed.json"
  ].forEach(function (file) {
    if (!fs.existsSync(path.join(ROOT, file))) {
      errors.push("Missing file: " + file);
    }
  });

  const registryCheck = validateWaterRegistry();
  errors.push.apply(errors, registryCheck.errors);

  const sources = getActiveWaterSources();
  const targetSource = sources[0];
  if (!targetSource) {
    errors.push("no active water sources");
  }

  const appJs = fs.readFileSync(path.join(ROOT, "js", "app.js"), "utf8");
  if (!/renderWaterCrossView/.test(appJs) || !/renderWaterSearch/.test(appJs)) {
    errors.push("existing WATER UI checks failed");
  }

  const snapshotBackup = fs.existsSync(SNAPSHOT_FILE)
    ? fs.readFileSync(SNAPSHOT_FILE, "utf8")
    : null;

  if (targetSource) {
    const oldText = "旧スナップショット（WATER差分検知テスト用）";
    const seededSnapshots = {
      version: 1,
      category: "WATER",
      sources: {}
    };

    seededSnapshots.sources[targetSource.source_id] = {
      source_id: targetSource.source_id,
      region: targetSource.region,
      organization: targetSource.organization,
      url: targetSource.url,
      fetched_at: "2026-07-30T05:00:00+09:00",
      content_hash: hashContent(oldText),
      category: "WATER",
      contentHash: hashContent(oldText),
      reachable: true,
      title: "旧情報",
      originalText: oldText,
      keywords: ["給水"],
      source_class: targetSource.source_class,
      municipality: targetSource.municipality
    };

    fs.mkdirSync(path.dirname(SNAPSHOT_FILE), { recursive: true });
    fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(seededSnapshots, null, 2) + "\n", "utf8");
  }

  const patrolResult = spawnSync("node", ["scripts/run-water-patrol.js", "--fixture"], {
    cwd: ROOT,
    encoding: "utf8"
  });

  if (patrolResult.status !== 0) {
    errors.push("patrol:water --fixture failed: " + (patrolResult.stderr || patrolResult.stdout));
  }

  errors.push.apply(errors, validateWaterSnapshots());

  if (!fs.existsSync(REVIEW_QUEUE_FILE)) {
    errors.push("water review queue not generated");
  } else {
    const queue = JSON.parse(fs.readFileSync(REVIEW_QUEUE_FILE, "utf8"));
    if (queue.category !== "WATER") {
      errors.push("review queue category must be WATER");
    }
    if (!Array.isArray(queue.items) || !queue.items.length) {
      errors.push("review queue items missing");
    } else {
      const item = queue.items[0];
      ["category", "region", "municipality", "source", "change_type", "detected_at", "status"].forEach(function (field) {
        if (!item[field]) {
          errors.push("review item missing " + field);
        }
      });
      if (item.status !== "PENDING") {
        errors.push("review item status must be PENDING");
      }
      if (item.auto_publish !== false && item.auto_publish !== undefined) {
        errors.push("review item must not auto publish");
      }
    }
  }

  PUBLIC_WATER_FILES.forEach(function (file) {
    const fullPath = path.join(ROOT, file);
    if (!fs.existsSync(fullPath) || !publicHashesBefore[file]) {
      return;
    }
    if (hashFile(fullPath) !== publicHashesBefore[file]) {
      errors.push("public WATER file changed during validation: " + file);
    }
  });

  if (snapshotBackup !== null) {
    fs.writeFileSync(SNAPSHOT_FILE, snapshotBackup, "utf8");
  } else if (fs.existsSync(SNAPSHOT_FILE)) {
    fs.unlinkSync(SNAPSHOT_FILE);
  }

  const output = {
    WATER_PATROL_VALIDATION: errors.length === 0 ? "PASS" : "FAIL",
    SOURCE_COUNT: registryCheck.sourceCount,
    CLASS_COUNTS: registryCheck.classCounts,
    WATER_KEYWORDS: WATER_KEYWORDS,
    AUTO_PUBLICATION: false,
    errors: errors
  };

  console.log("=== Water Patrol Validation ===");
  console.log(JSON.stringify(output, null, 2));

  if (errors.length) {
    process.exit(1);
  }

  console.log("PHASE27_WATER_PATROL_IMPLEMENTATION_COMPLETE");
}

main();

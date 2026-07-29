#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const SNAPSHOT_FILE = path.join(ROOT, "monitor", "reports", "infrastructure-snapshots.json");
const CANDIDATE_FILE = path.join(ROOT, "data", "candidates", "infrastructure_candidates.json");
const INFRASTRUCTURE_SOURCES_FILE = path.join(ROOT, "data", "public", "infrastructure_sources.json");

const PUBLIC_FILES = [
  "data/public/phase1_areas.json",
  "data/public/phase1_navigation.json",
  "data/public/phase1_updates.json",
  "data/public/communication_status.json",
  "data/public/status.json",
  "data/public/infrastructure_status.json"
];

const EXPECTED_FIXTURE_TEXT =
  "【巡回テスト】今回の地震に伴う断水について。宇土市内の網田地区を除く全域で断水が発生しています。復旧作業を継続中です。";
const KM002_WATER_SOURCE_ID = "INF-SRC-KM002-WATER-001";
const KM002_WATER_STATUS_ID = "INF-STATUS-WATER-KM002-001";

function hashFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function hashContent(text) {
  return crypto.createHash("sha256").update(text || "").digest("hex");
}

async function main() {
  const errors = [];
  const publicHashesBefore = {};

  PUBLIC_FILES.forEach((file) => {
    publicHashesBefore[file] = hashFile(path.join(ROOT, file));
  });

  const requiredFiles = [
    "data/public/infrastructure_sources.json",
    "monitor/infrastructure-sources.js",
    "monitor/infrastructure-fetcher.js",
    "monitor/infrastructure-diff-engine.js",
    "scripts/run-infrastructure-patrol.js",
    "data/candidates/infrastructure_candidates.json"
  ];

  requiredFiles.forEach((file) => {
    if (!fs.existsSync(path.join(ROOT, file))) {
      errors.push("Missing file: " + file);
    }
  });

  let sourceCount = 0;
  let categoryCounts = {};
  if (fs.existsSync(INFRASTRUCTURE_SOURCES_FILE)) {
    const registry = JSON.parse(fs.readFileSync(INFRASTRUCTURE_SOURCES_FILE, "utf8"));
    const {
      getPatrolInfrastructureSources,
      PATROL_CATEGORIES
    } = require(path.join(ROOT, "monitor", "infrastructure-sources"));
    const patrolSources = getPatrolInfrastructureSources();
    sourceCount = patrolSources.length;

    patrolSources.forEach((source) => {
      categoryCounts[source.category] = (categoryCounts[source.category] || 0) + 1;
    });

    if (sourceCount < 10) {
      errors.push("infrastructure patrol source count too low: " + sourceCount);
    }

    const hasPowerPatrol = patrolSources.some((source) => source.category === "POWER");
    if (hasPowerPatrol) {
      errors.push("POWER must be excluded from infrastructure patrol");
    }

    const hasToyotaPatrol = patrolSources.some((source) => source.source_type === "EXTERNAL_INFRA_MAP");
    if (hasToyotaPatrol) {
      errors.push("EXTERNAL_INFRA_MAP must be excluded from infrastructure patrol");
    }

    PATROL_CATEGORIES.forEach((category) => {
      if (!categoryCounts[category]) {
        errors.push("Missing patrol category: " + category);
      }
    });
  }

  const snapshotBackup = fs.existsSync(SNAPSHOT_FILE)
    ? fs.readFileSync(SNAPSHOT_FILE, "utf8")
    : null;

  const seededSnapshots = {
    version: 1,
    sources: {}
  };
  seededSnapshots.sources[KM002_WATER_SOURCE_ID] = {
    url: "https://www.city.uto.lg.jp/article/view/1014/16317.html",
    reachable: true,
    title: "旧スナップショット",
    originalText: "旧スナップショット（差分検知テスト用）",
    pageUpdatedAt: "2026-07-29T05:00:00+09:00",
    publishedAt: "2026-07-29T05:00:00+09:00",
    keywords: [],
    contaminationRisk: false,
    contentHash: hashContent("旧スナップショット（差分検知テスト用）"),
    checkedAt: "2026-07-29T05:00:00+09:00",
    sourceName: "宇土市",
    category: "WATER_SERVICE",
    source_type: "MUNICIPAL_WATER_PAGE"
  };

  fs.mkdirSync(path.dirname(SNAPSHOT_FILE), { recursive: true });
  fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(seededSnapshots, null, 2) + "\n", "utf8");

  const patrolResult = spawnSync("node", ["scripts/run-infrastructure-patrol.js", "--fixture"], {
    cwd: ROOT,
    encoding: "utf8"
  });

  if (patrolResult.status !== 0) {
    errors.push("patrol:infrastructure --fixture failed: " + (patrolResult.stderr || patrolResult.stdout));
  }

  if (!fs.existsSync(CANDIDATE_FILE)) {
    errors.push("infrastructure_candidates.json not generated");
  } else {
    const candidates = JSON.parse(fs.readFileSync(CANDIDATE_FILE, "utf8"));
    const waterCandidate = (candidates.candidates || []).find((candidate) => {
      return candidate.source_id === KM002_WATER_SOURCE_ID && candidate.original_text === EXPECTED_FIXTURE_TEXT;
    });

    if (!waterCandidate) {
      errors.push("KM002 water infrastructure candidate not generated");
    } else {
      if (waterCandidate.type !== "INFRASTRUCTURE_STATUS") {
        errors.push("candidate type must be INFRASTRUCTURE_STATUS");
      }
      if (waterCandidate.suggestedReview !== "INFRASTRUCTURE_STATUS") {
        errors.push("candidate suggestedReview must be INFRASTRUCTURE_STATUS");
      }
      if (waterCandidate.relatedPublicTarget !== "infrastructure_status") {
        errors.push("candidate relatedPublicTarget must be infrastructure_status");
      }
      if (waterCandidate.review_status !== "PENDING") {
        errors.push("candidate review_status must be PENDING");
      }
      if (waterCandidate.category !== "WATER_SERVICE") {
        errors.push("candidate category must be WATER_SERVICE");
      }
      if (waterCandidate.area_id !== "KM002") {
        errors.push("candidate area_id must be KM002");
      }
    }
  }

  const approvedPath = path.join(ROOT, "data", "approved", "20260729-km002-infrastructure-water.json");
  if (!fs.existsSync(approvedPath)) {
    errors.push("Missing approved update fixture for KM002 infrastructure");
  } else {
    const approved = JSON.parse(fs.readFileSync(approvedPath, "utf8"));
    const updateCandidate = (approved.candidates || []).find((candidate) => {
      return candidate.publicUpdate && candidate.publicUpdate.target === "infrastructure_status";
    });
    if (!updateCandidate) {
      errors.push("Approved fixture missing infrastructure_status target");
    } else if (updateCandidate.publicUpdate.action !== "update") {
      errors.push("Approved fixture action must be update");
    } else if (updateCandidate.publicUpdate.status_id !== KM002_WATER_STATUS_ID) {
      errors.push("Approved fixture status_id mismatch");
    }
  }

  const {
    findInfrastructureItem,
    applyInfrastructureFields
  } = require(path.join(ROOT, "monitor", "apply-engine"));
  const infrastructureData = JSON.parse(
    fs.readFileSync(path.join(ROOT, "data", "public", "infrastructure_status.json"), "utf8")
  );
  const statusItem = findInfrastructureItem(infrastructureData, KM002_WATER_STATUS_ID);
  if (!statusItem) {
    errors.push("infrastructure_status missing KM002 water seed item");
  } else {
  try {
      const clone = JSON.parse(JSON.stringify(statusItem));
      applyInfrastructureFields(clone, {
        description: "テスト更新",
        last_checked_at: "2026-07-29T20:00:00+09:00"
      });
      if (clone.last_checked_at !== "2026-07-29T20:00:00+09:00") {
        errors.push("applyInfrastructureFields last_checked_at not applied");
      }
    } catch (err) {
      errors.push("applyInfrastructureFields failed: " + err.message);
    }
  }

  if (snapshotBackup !== null) {
    fs.writeFileSync(SNAPSHOT_FILE, snapshotBackup, "utf8");
  } else if (fs.existsSync(SNAPSHOT_FILE)) {
    fs.unlinkSync(SNAPSHOT_FILE);
  }

  PUBLIC_FILES.forEach((file) => {
    const after = hashFile(path.join(ROOT, file));
    if (after !== publicHashesBefore[file]) {
      errors.push("Public data modified during infrastructure patrol validation: " + file);
    }
  });

  const result = {
    INFRASTRUCTURE_PATROL: errors.length === 0 ? "PASS" : "FAIL",
    PATROL_COMMAND: "npm run patrol:infrastructure",
    SOURCE_COUNT: sourceCount,
    CATEGORY_COUNTS: categoryCounts,
    CANDIDATE: fs.existsSync(CANDIDATE_FILE) ? "PASS" : "FAIL",
    APPLY_UPDATE: fs.existsSync(approvedPath) ? "PASS" : "FAIL",
    PUBLIC_DATA_PROTECTION: errors.some((e) => e.includes("Public data modified")) ? "FAIL" : "PASS",
    errors
  };

  console.log("=== Infrastructure Patrol Validation ===");
  console.log(JSON.stringify(result, null, 2));

  if (errors.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

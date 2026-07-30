"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const REPORTS_DIR = path.join(__dirname, "reports");
const BASELINES_DIR = path.join(__dirname, "baselines");

const SNAPSHOT_FILES = {
  patrol: path.join(REPORTS_DIR, "snapshots.json"),
  emergency: path.join(REPORTS_DIR, "emergency-snapshots.json"),
  infrastructure: path.join(REPORTS_DIR, "infrastructure-snapshots.json")
};

const SNAPSHOT_SEEDS = {
  patrol: path.join(BASELINES_DIR, "patrol-snapshots.seed.json"),
  emergency: path.join(BASELINES_DIR, "emergency-snapshots.seed.json"),
  infrastructure: path.join(BASELINES_DIR, "infrastructure-snapshots.seed.json")
};

const CACHE_PATHS = [
  SNAPSHOT_FILES.patrol,
  SNAPSHOT_FILES.emergency,
  SNAPSHOT_FILES.infrastructure
];

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function seedSnapshotIfMissing(kind) {
  const target = SNAPSHOT_FILES[kind];
  const seed = SNAPSHOT_SEEDS[kind];

  if (fs.existsSync(target)) {
    return { kind: kind, seeded: false, path: target, reason: "exists" };
  }

  if (!fs.existsSync(seed)) {
    return { kind: kind, seeded: false, path: target, reason: "seed_missing" };
  }

  ensureDir(path.dirname(target));
  fs.copyFileSync(seed, target);
  return { kind: kind, seeded: true, path: target, reason: "seeded_from_baseline" };
}

function seedAllSnapshotsIfMissing() {
  return ["patrol", "emergency", "infrastructure"].map(seedSnapshotIfMissing);
}

function countSnapshotSources(filePath) {
  if (!fs.existsSync(filePath)) {
    return 0;
  }

  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return Object.keys(data.sources || {}).length;
  } catch (err) {
    return 0;
  }
}

function inspectSnapshotStore() {
  return {
    patrolSourceCount: countSnapshotSources(SNAPSHOT_FILES.patrol),
    emergencySourceCount: countSnapshotSources(SNAPSHOT_FILES.emergency),
    infrastructureSourceCount: countSnapshotSources(SNAPSHOT_FILES.infrastructure),
    files: Object.keys(SNAPSHOT_FILES).map(function (kind) {
      const filePath = SNAPSHOT_FILES[kind];
      return {
        kind: kind,
        path: path.relative(ROOT, filePath),
        exists: fs.existsSync(filePath),
        sourceCount: countSnapshotSources(filePath),
        seedExists: fs.existsSync(SNAPSHOT_SEEDS[kind])
      };
    })
  };
}

module.exports = {
  ROOT,
  SNAPSHOT_FILES,
  SNAPSHOT_SEEDS,
  CACHE_PATHS,
  seedSnapshotIfMissing,
  seedAllSnapshotsIfMissing,
  inspectSnapshotStore,
  countSnapshotSources
};

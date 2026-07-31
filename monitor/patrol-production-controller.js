"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const PRODUCTION_DIR = path.join(ROOT, "data", "patrol_production");
const RUNS_DIR = path.join(PRODUCTION_DIR, "runs");
const ROLLBACK_DIR = path.join(PRODUCTION_DIR, "rollback");
const EXECUTION_HISTORY_FILE = path.join(PRODUCTION_DIR, "execution_history.json");
const REGISTRY_APPLY_HISTORY_FILE = path.join(PRODUCTION_DIR, "registry_apply_history.json");
const SOURCES_FILE = path.join(ROOT, "monitor", "sources.json");
const PUBLIC_DIR = path.join(ROOT, "data", "public");
const DEFAULT_SNAPSHOT_FILE = path.join(ROOT, "monitor", "reports", "snapshots.json");

const URL_PATTERN = /^https?:\/\/.+/i;
const DOMAIN_PATTERN = /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i;

const { classifyChangeLogEntries, validateClassificationShape } = require("./diff-classification");
const {
  convertClassifiedBatch,
  buildQueueBatch,
  validateQueueItem,
  validateQueueBatch
} = require("./review-queue");

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function toRepoRelative(filePath) {
  if (!filePath) {
    return null;
  }
  return path.relative(ROOT, filePath).split(path.sep).join("/");
}

function hashContent(value) {
  return crypto
    .createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
}

function hashFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return hashContent(fs.readFileSync(filePath, "utf8"));
}

function hashPublicDirectory() {
  if (!fs.existsSync(PUBLIC_DIR)) {
    return "";
  }
  return fs
    .readdirSync(PUBLIC_DIR)
    .filter(function (name) {
      return name.endsWith(".json");
    })
    .sort()
    .map(function (name) {
      return name + ":" + hashFile(path.join(PUBLIC_DIR, name));
    })
    .join("|");
}

function buildProductionRunId(generatedAt) {
  return "PPR-" + (generatedAt || new Date().toISOString()).replace(/[:.]/g, "-");
}

function loadSourcesRegistry() {
  const data = readJson(SOURCES_FILE, { municipalities: [], communication: [] });
  const sources = (data.municipalities || []).concat(data.communication || []);
  const map = new Map();
  sources.forEach(function (source) {
    map.set(source.id, source);
  });
  return { data: data, sources: sources, map: map };
}

function loadRegistryApplyHistory(filePath) {
  const resolved = filePath || REGISTRY_APPLY_HISTORY_FILE;
  const data = readJson(resolved, { entries: [] });
  return {
    filePath: resolved,
    entries: data.entries || []
  };
}

function loadExecutionHistory() {
  return readJson(EXECUTION_HISTORY_FILE, { version: 1, runs: [] });
}

function appendExecutionHistory(entry) {
  const history = loadExecutionHistory();
  history.runs = history.runs || [];
  history.runs.push(entry);
  history.generatedAt = new Date().toISOString();
  writeJson(EXECUTION_HISTORY_FILE, history);
  return history;
}

function extractDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch (err) {
    return null;
  }
}

function verifyRegistryApply(entries, options) {
  options = options || {};
  const errors = [];
  const sourceIds = options.sourceIds || [];
  const approved = [];

  sourceIds.forEach(function (sourceId) {
    const record = entries.find(function (entry) {
      return entry.source_id === sourceId;
    });
    if (!record) {
      errors.push("registry apply missing for source_id: " + sourceId);
      return;
    }
    if (!record.decision || record.decision.status !== "APPROVED") {
      errors.push(sourceId + ": decision.status must be APPROVED");
    }
    if (record.apply_status !== "COMPLETE") {
      errors.push(sourceId + ": apply_status must be COMPLETE");
    }
    if (!record.source_trace || typeof record.source_trace !== "object") {
      errors.push(sourceId + ": source_trace missing");
    }
    approved.push(record);
  });

  return {
    valid: errors.length === 0,
    errors: errors,
    approved: approved
  };
}

function verifySourcesIntegrity(registryRecords) {
  const errors = [];
  const registry = loadSourcesRegistry();

  registryRecords.forEach(function (record) {
    const source = registry.map.get(record.source_id);
    if (!source) {
      errors.push(record.source_id + ": source_id not found in sources.json");
      return;
    }
    if (!URL_PATTERN.test(source.url)) {
      errors.push(record.source_id + ": invalid URL format in sources.json");
    }
    if (record.url && source.url !== record.url) {
      errors.push(record.source_id + ": sources.json URL does not match registry apply URL");
    }
    const sourceDomain = extractDomain(source.url);
    const expectedDomain = record.official_domain || extractDomain(record.url);
    if (expectedDomain && sourceDomain && sourceDomain !== expectedDomain && sourceDomain !== "www." + expectedDomain) {
      errors.push(record.source_id + ": domain mismatch (" + sourceDomain + " vs " + expectedDomain + ")");
    }
    if (record.official_domain && !DOMAIN_PATTERN.test(record.official_domain)) {
      errors.push(record.source_id + ": invalid official_domain in registry apply record");
    }
  });

  return {
    valid: errors.length === 0,
    errors: errors,
    source_count: registry.sources.length,
    sources_hash: hashFile(SOURCES_FILE)
  };
}

function runFixturePatrolStep(options) {
  const fixture = readJson(options.fixturePath, null);
  if (!fixture || !fixture.change_log_entry) {
    return {
      success: false,
      errors: ["patrol fixture missing change_log_entry"]
    };
  }

  const changeEntry = fixture.change_log_entry;
  const snapshotFile = options.snapshotFile || path.join(options.runDir, "snapshots.json");
  const changeLogPath = options.changeLogPath || path.join(options.runDir, "change-log.json");
  const snapshotsBefore = readJson(snapshotFile, { version: 1, sources: {} });
  const sourceId = changeEntry.source || changeEntry.source_id;

  writeJson(changeLogPath, [changeEntry]);

  const snapshotsAfter = JSON.parse(JSON.stringify(snapshotsBefore));
  snapshotsAfter.sources = snapshotsAfter.sources || {};
  const previousSnapshot = snapshotsAfter.sources[sourceId] || {
    title: changeEntry.titleChanged ? changeEntry.titleChanged.from : fixture.title,
    contentHash: changeEntry.previousHash,
    reachable: true
  };
  const currentSnapshot = {
    title: changeEntry.titleChanged ? changeEntry.titleChanged.to : fixture.title,
    contentHash: changeEntry.currentHash,
    reachable: true,
    sourceName: changeEntry.sourceName || fixture.municipality,
    category: changeEntry.category || "municipality",
    url: changeEntry.url || fixture.source_url
  };

  const created = snapshotsBefore.sources[sourceId] ? 0 : 1;
  const updated = snapshotsBefore.sources[sourceId] ? 1 : 0;
  snapshotsAfter.sources[sourceId] = currentSnapshot;
  writeJson(snapshotFile, snapshotsAfter);

  return {
    success: true,
    source_id: sourceId,
    source_count: 1,
    failed_count: 0,
    changeLogPath: changeLogPath,
    snapshotFile: snapshotFile,
    snapshotsBefore: snapshotsBefore,
    snapshotsAfter: snapshotsAfter,
    previousSnapshot: previousSnapshot,
    currentSnapshot: currentSnapshot,
    snapshot_result: {
      created: created,
      updated: updated || 1,
      source_id: sourceId,
      url: currentSnapshot.url
    },
    changeEntries: [changeEntry]
  };
}

function verifySnapshotResult(snapshotResult, registryRecords) {
  const errors = [];
  registryRecords.forEach(function (record) {
    if (!snapshotResult || snapshotResult.source_id !== record.source_id) {
      errors.push(record.source_id + ": snapshot not generated for source");
      return;
    }
    if (!snapshotResult.url || snapshotResult.url !== record.url) {
      errors.push(record.source_id + ": snapshot URL mismatch");
    }
  });

  return {
    valid: errors.length === 0,
    errors: errors
  };
}

function runClassificationStep(options) {
  const changeLogPath = options.changeLogPath;
  const snapshotFile = options.snapshotFile || DEFAULT_SNAPSHOT_FILE;
  const outputPath = options.outputPath || path.join(options.runDir, "classified.json");
  const entries = readJson(changeLogPath, []);
  const snapshots = readJson(snapshotFile, { sources: {} });
  const classifications = classifyChangeLogEntries(entries, snapshots);

  classifications.forEach(function (item, index) {
    const shapeErrors = validateClassificationShape(item);
    if (shapeErrors.length) {
      return;
    }
  });

  const batch = {
    generatedAt: options.generatedAt || new Date().toISOString(),
    incidentScope: "2026_KUMAMOTO_EARTHQUAKE",
    classificationCount: classifications.length,
    categorySummary: summarizeByCategory(classifications),
    autoPublish: false,
    sourceChangeLog: toRepoRelative(changeLogPath),
    classifications: classifications
  };

  if (!options.dryRun) {
    writeJson(outputPath, batch);
  }

  return {
    saved: !options.dryRun,
    dryRun: options.dryRun === true,
    outputPath: outputPath,
    classificationCount: classifications.length,
    classifications: classifications,
    batch: batch
  };
}

function summarizeByCategory(classifications) {
  const summary = {
    WATER: 0,
    SHELTER: 0,
    COMMUNICATION: 0,
    VOLUNTEER: 0,
    ROAD: 0,
    SUPPORT: 0
  };
  classifications.forEach(function (item) {
    summary[item.category] = (summary[item.category] || 0) + 1;
  });
  return summary;
}

function runReviewQueueStep(options) {
  const classifiedBatch = options.classifiedBatch;
  const outputPath = options.outputPath || path.join(options.runDir, "patrol_review_queue.json");
  const incomingItems = convertClassifiedBatch(classifiedBatch, {
    classifiedPath: options.classifiedPath,
    createdAt: options.generatedAt
  });
  const batch = buildQueueBatch(incomingItems, {
    incidentScope: classifiedBatch.incidentScope,
    sourceClassificationFile: toRepoRelative(options.classifiedPath)
  });
  const errors = validateQueueBatch(batch);

  if (!options.dryRun) {
    writeJson(outputPath, batch);
  }

  return {
    saved: !options.dryRun,
    dryRun: options.dryRun === true,
    outputPath: outputPath,
    item_count: batch.itemCount || incomingItems.length,
    items: batch.items || incomingItems,
    errors: errors
  };
}

function createRollbackBundle(runId, options) {
  options = options || {};
  ensureDir(ROLLBACK_DIR);
  const bundlePath = path.join(ROLLBACK_DIR, runId + ".json");
  const bundle = {
    run_id: runId,
    created_at: new Date().toISOString(),
    sources_file: toRepoRelative(SOURCES_FILE),
    sources_hash: hashFile(SOURCES_FILE),
    sources_backup: readJson(SOURCES_FILE, null),
    registry_apply_history_file: toRepoRelative(options.registryApplyHistoryFile || REGISTRY_APPLY_HISTORY_FILE),
    registry_apply_history: readJson(options.registryApplyHistoryFile || REGISTRY_APPLY_HISTORY_FILE, { entries: [] }),
    snapshot_file: options.snapshotFile ? toRepoRelative(options.snapshotFile) : null,
    snapshot_backup: options.snapshotFile ? readJson(options.snapshotFile, null) : null,
    public_hash: hashPublicDirectory()
  };
  writeJson(bundlePath, bundle);
  return {
    saved: true,
    bundlePath: bundlePath,
    bundle: bundle
  };
}

function rollbackProductionRun(runId, options) {
  options = options || {};
  const bundlePath = path.join(ROLLBACK_DIR, runId + ".json");
  const bundle = readJson(bundlePath, null);
  if (!bundle) {
    return {
      rolledBack: false,
      errors: ["rollback bundle not found: " + runId]
    };
  }

  const errors = [];
  if (bundle.sources_backup && !options.dryRun) {
    const currentHash = hashFile(SOURCES_FILE);
    if (currentHash !== bundle.sources_hash) {
      writeJson(SOURCES_FILE, bundle.sources_backup);
    }
  }

  if (bundle.snapshot_backup && bundle.snapshot_file && !options.dryRun) {
    const snapshotPath = path.isAbsolute(bundle.snapshot_file)
      ? bundle.snapshot_file
      : path.join(ROOT, bundle.snapshot_file);
    writeJson(snapshotPath, bundle.snapshot_backup);
  }

  if (bundle.registry_apply_history && bundle.registry_apply_history_file && !options.dryRun) {
    const historyPath = path.isAbsolute(bundle.registry_apply_history_file)
      ? bundle.registry_apply_history_file
      : path.join(ROOT, bundle.registry_apply_history_file);
    const restored = JSON.parse(JSON.stringify(bundle.registry_apply_history));
    restored.entries = (restored.entries || []).map(function (entry) {
      return Object.assign({}, entry, { apply_status: "ROLLED_BACK" });
    });
    writeJson(historyPath, restored);
  }

  const publicHashAfter = hashPublicDirectory();
  if (bundle.public_hash !== publicHashAfter) {
    errors.push("public data changed during rollback verification");
  }

  if (!options.dryRun) {
    appendExecutionHistory({
      run_id: runId,
      action: "ROLLBACK",
      rolled_back_at: new Date().toISOString(),
      dryRun: false
    });
  }

  return {
    rolledBack: errors.length === 0,
    dryRun: options.dryRun === true,
    bundlePath: bundlePath,
    errors: errors
  };
}

async function runPatrolProductionFlow(options) {
  options = options || {};
  const generatedAt = options.generatedAt || new Date().toISOString();
  const runId = options.runId || buildProductionRunId(generatedAt);
  const runDir = options.runDir || path.join(RUNS_DIR, runId);
  const dryRun = options.dryRun !== false;
  const errors = [];
  const trace = {};

  ensureDir(runDir);

  const publicHashBefore = hashPublicDirectory();
  const sourcesHashBefore = hashFile(SOURCES_FILE);
  const registryApplyHistory = loadRegistryApplyHistory(options.registryApplyHistoryFile);
  const sourceIds = options.sourceIds || [options.sourceId].filter(Boolean);

  const registryVerify = verifyRegistryApply(registryApplyHistory.entries, { sourceIds: sourceIds });
  if (!registryVerify.valid) {
    errors.push.apply(errors, registryVerify.errors);
  }
  trace.registry_updates = registryVerify.approved;

  const integrity = verifySourcesIntegrity(registryVerify.approved);
  if (!integrity.valid) {
    errors.push.apply(errors, integrity.errors);
  }
  trace.sources_hash = integrity.sources_hash;

  let patrolResult = {
    source_count: 0,
    failed_count: 0
  };
  let snapshotResult = { created: 0, updated: 0 };
  let classificationResult = { count: 0 };
  let reviewQueueResult = { item_count: 0, items: [] };

  const snapshotFile = path.join(runDir, "snapshots.json");
  const changeLogPath = path.join(runDir, "change-log.json");
  const classifiedPath = path.join(runDir, "classified.json");
  const reviewQueuePath = path.join(runDir, "patrol_review_queue.json");

  if (options.fixturePath) {
    const patrolStep = runFixturePatrolStep({
      fixturePath: options.fixturePath,
      runDir: runDir,
      snapshotFile: snapshotFile,
      changeLogPath: changeLogPath
    });
    if (!patrolStep.success) {
      errors.push.apply(errors, patrolStep.errors || ["patrol fixture step failed"]);
    } else {
      patrolResult = {
        source_count: patrolStep.source_count,
        failed_count: patrolStep.failed_count,
        changeLogPath: toRepoRelative(patrolStep.changeLogPath)
      };
      snapshotResult = patrolStep.snapshot_result;
      trace.patrol_source_id = patrolStep.source_id;
    }

    const snapshotVerify = verifySnapshotResult(snapshotResult, registryVerify.approved);
    if (!snapshotVerify.valid) {
      errors.push.apply(errors, snapshotVerify.errors);
    }

    const classificationStep = runClassificationStep({
      changeLogPath: changeLogPath,
      snapshotFile: snapshotFile,
      runDir: runDir,
      outputPath: classifiedPath,
      generatedAt: generatedAt,
      dryRun: dryRun
    });
    if (!dryRun) {
      writeJson(classifiedPath, classificationStep.batch);
    }
    classificationResult = {
      count: classificationStep.classificationCount,
      outputPath: toRepoRelative(classifiedPath),
      categorySummary: classificationStep.batch.categorySummary
    };
    trace.classification_ids = (classificationStep.classifications || []).map(function (item) {
      return item.id;
    });

    const reviewStep = runReviewQueueStep({
      classifiedBatch: classificationStep.batch,
      classifiedPath: classifiedPath,
      runDir: runDir,
      outputPath: reviewQueuePath,
      generatedAt: generatedAt,
      dryRun: dryRun
    });
    if (reviewStep.errors && reviewStep.errors.length) {
      errors.push.apply(errors, reviewStep.errors);
    }
    reviewQueueResult = {
      item_count: reviewStep.item_count,
      outputPath: toRepoRelative(reviewQueuePath),
      items: reviewStep.items
    };
    trace.queue_ids = (reviewStep.items || []).map(function (item) {
      return item.queue_id;
    });
  } else if (options.live) {
    errors.push("live patrol production flow is not enabled in this release; use fixture mode");
  } else {
    errors.push("fixturePath or live mode required");
  }

  const sourcesHashAfter = hashFile(SOURCES_FILE);
  if (sourcesHashBefore !== sourcesHashAfter) {
    errors.push("sources.json was modified during production flow");
  }

  const publicHashAfter = hashPublicDirectory();
  if (publicHashBefore !== publicHashAfter) {
    errors.push("public data was modified during production flow");
  }

  const rollbackBundle = createRollbackBundle(runId, {
    registryApplyHistoryFile: registryApplyHistory.filePath,
    snapshotFile: snapshotFile
  });

  const run = {
    version: 1,
    run_id: runId,
    started_at: generatedAt,
    completed_at: new Date().toISOString(),
    dryRun: dryRun,
    registry_updates: registryVerify.approved,
    patrol_result: patrolResult,
    snapshot_result: snapshotResult,
    classification_result: classificationResult,
    review_queue_result: reviewQueueResult,
    rollback_bundle: toRepoRelative(rollbackBundle.bundlePath),
    status: errors.length === 0 ? "SUCCESS" : "FAILED",
    trace: Object.assign({}, trace, {
      sources_hash_before: sourcesHashBefore,
      sources_hash_after: sourcesHashAfter,
      public_hash_before: publicHashBefore,
      public_hash_after: publicHashAfter
    }),
    errors: errors
  };

  const runPath = path.join(runDir, runId + ".json");
  if (!dryRun || options.persistArtifacts) {
    writeJson(runPath, run);
  }
  if (!dryRun && !options.skipHistory) {
    appendExecutionHistory({
      run_id: runId,
      started_at: generatedAt,
      status: run.status,
      dryRun: false,
      run_path: toRepoRelative(runPath)
    });
  }

  return {
    saved: !dryRun || options.persistArtifacts === true,
    dryRun: dryRun,
    run_id: runId,
    run_path: toRepoRelative(runPath),
    run: run,
    rollback_bundle: rollbackBundle.bundlePath,
    errors: errors
  };
}

module.exports = {
  PRODUCTION_DIR,
  RUNS_DIR,
  ROLLBACK_DIR,
  EXECUTION_HISTORY_FILE,
  REGISTRY_APPLY_HISTORY_FILE,
  SOURCES_FILE,
  PUBLIC_DIR,
  URL_PATTERN,
  DOMAIN_PATTERN,
  buildProductionRunId,
  loadSourcesRegistry,
  loadRegistryApplyHistory,
  loadExecutionHistory,
  appendExecutionHistory,
  verifyRegistryApply,
  verifySourcesIntegrity,
  runFixturePatrolStep,
  verifySnapshotResult,
  runClassificationStep,
  runReviewQueueStep,
  createRollbackBundle,
  rollbackProductionRun,
  runPatrolProductionFlow,
  hashFile,
  hashPublicDirectory
};

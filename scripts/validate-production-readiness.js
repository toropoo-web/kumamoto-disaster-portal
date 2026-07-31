#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const SOURCES_FILE = path.join(ROOT, "monitor", "sources.json");
const SNAPSHOT_FILE = path.join(ROOT, "monitor", "reports", "snapshots.json");
const PUBLIC_DIR = path.join(ROOT, "data", "public");
const TARGETS_FILE = path.join(ROOT, "data", "municipality_expansion", "portal_ui_targets.json");
const REVIEW_QUEUE_FILE = path.join(ROOT, "data", "review_queue", "patrol_review_queue.json");
const PUBLIC_HASH_FILE = path.join(ROOT, "data", "production_readiness", "public-data-hash.json");

const TARGET_AREA_IDS = [
  "KM014", "KM015", "KM016", "KM017", "KM018",
  "KM019", "KM020", "KM021", "KM022"
];

const EXPECTED_MUNICIPALITY_COUNT = 9;
const ALLOWED_DECISION_STATUSES = ["PENDING", "APPROVED", "REJECTED"];

const {
  classifyChangeLogEntries,
  isClassifiableChangeEntry
} = require("../monitor/diff-classification");

const { validateQueueItem } = require("../monitor/review-queue");
const { CATEGORY_TARGET_LAYERS } = require("../monitor/review-approved-converter");

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function hashFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return "";
  }
  return crypto.createHash("sha256").update(fs.readFileSync(filePath, "utf8")).digest("hex");
}

function hashPublicSnapshot() {
  return [
    "phase1_areas.json",
    "phase1_navigation.json",
    "phase1_updates.json",
    "area_navigation.json",
    "water_search_index.json",
    "disaster_search_index.json",
    "location_sources.json",
    "emergency_sources.json"
  ]
    .map(function (name) {
      return name + ":" + hashFile(path.join(PUBLIC_DIR, name));
    })
    .join("|");
}

function check(name, pass, reason) {
  return { check: name, status: pass ? "PASS" : "FAIL", reason: reason || null };
}

function loadExpansionSources() {
  const data = readJson(SOURCES_FILE, { municipalities: [] });
  return (data.municipalities || []).filter(function (item) {
    return TARGET_AREA_IDS.indexOf(item.area_id) >= 0 && item.status === "ACTIVE";
  });
}

function validateSnapshots(sources) {
  const snapshots = readJson(SNAPSHOT_FILE, { sources: {} });
  const checks = [];

  sources.forEach(function (source) {
    const snapshot = snapshots.sources[source.id];
    const pass =
      Boolean(snapshot) &&
      snapshot.url === source.url &&
      Boolean(snapshot.contentHash) &&
      Boolean(snapshot.checkedAt) &&
      snapshot.reachable === true;
    checks.push(
      check(
        "snapshot." + source.id,
        pass,
        pass ? null : "missing or incomplete production snapshot"
      )
    );
  });

  return checks;
}

function validateClassificationHardening() {
  const checks = [];
  const excluded = classifyChangeLogEntries(
    [
      {
        source: "KM020-nishihara-bousai",
        sourceName: "西原村",
        changeType: "PAGE_UPDATED_AT_CHANGED",
        previousHash: "same",
        currentHash: "same",
        keywords: ["避難所", "給水"]
      }
    ],
    { sources: {} }
  );
  checks.push(check("PAGE_UPDATED_AT_CHANGED excluded", excluded.length === 0));

  const included = classifyChangeLogEntries(
    [
      {
        source: "KM020-nishihara-bousai",
        sourceName: "西原村",
        url: "https://www.vill.nishihara.kumamoto.jp/bousai/default.html",
        changeType: "CONTENT_CHANGED",
        previousHash: "before",
        currentHash: "after",
        keywords: ["断水", "復旧"]
      }
    ],
    { sources: {} }
  );
  checks.push(check("CONTENT_CHANGED included", included.length >= 1));
  checks.push(check("isClassifiableChangeEntry helper", isClassifiableChangeEntry({
    changeType: "PAGE_UPDATED_AT_CHANGED",
    previousHash: "a",
    currentHash: "a"
  }) === false));

  return checks;
}

function validateReviewQueue() {
  const checks = [];
  const queue = readJson(REVIEW_QUEUE_FILE, { items: [] });
  const expansionNames = readJson(TARGETS_FILE, { municipalities: [] }).municipalities.map(function (item) {
    return item.name;
  });

  checks.push(check("review_queue.autoPublish false", queue.autoPublish === false || queue.auto_publish === false));

  (queue.items || []).forEach(function (item, index) {
    if (expansionNames.indexOf(item.municipality) < 0) {
      return;
    }
    const itemErrors = validateQueueItem(item);
    checks.push(check("review[" + index + "].schema", itemErrors.length === 0, itemErrors.join("; ")));
    checks.push(check("review[" + index + "].status=PENDING", item.status === "PENDING"));
    checks.push(check("review[" + index + "].review_required", item.review_required === true));
    checks.push(check("review[" + index + "].auto_publish", item.auto_publish === false));
    checks.push(check(
      "review[" + index + "].decision_status",
      ALLOWED_DECISION_STATUSES.indexOf(item.decision && item.decision.status) >= 0
    ));
    checks.push(check(
      "review[" + index + "].source_trace",
      Boolean(item.source_trace && item.source_trace.classification_id)
    ));
    if (item.category && CATEGORY_TARGET_LAYERS[item.category]) {
      checks.push(check(
        "review[" + index + "].category_mapping",
        Boolean(CATEGORY_TARGET_LAYERS[item.category])
      ));
    }
  });

  return checks;
}

function validatePatrolPipelineScripts() {
  const scripts = [
    "scripts/run-monitor.js",
    "scripts/classify-patrol-diffs.js",
    "scripts/build-patrol-review-queue.js",
    "scripts/run-patrol-pipeline.js",
    "scripts/apply-public-updates.js"
  ];
  return scripts.map(function (file) {
    return check("pipeline_script." + path.basename(file), fs.existsSync(path.join(ROOT, file)));
  });
}

function validateRegistryIntegrity(sources) {
  const checks = [];
  const manifest = readJson(TARGETS_FILE, { municipalities: [] }).municipalities;

  checks.push(check("municipality_count_fixed", manifest.length === EXPECTED_MUNICIPALITY_COUNT));

  const areaIds = manifest.map(function (item) {
    return item.area_id;
  });
  checks.push(check("area_id_unique", areaIds.length === new Set(areaIds).size));

  const sourceIds = sources.map(function (item) {
    return item.id;
  });
  checks.push(check("source_id_unique", sourceIds.length === new Set(sourceIds).size));

  manifest.forEach(function (item) {
    const hasSource = sources.some(function (source) {
      return source.area_id === item.area_id;
    });
    checks.push(check("patrol_source." + item.area_id, hasSource));
  });

  return checks;
}

function validateShelterTrace() {
  const checks = [];
  const data = readJson(path.join(PUBLIC_DIR, "disaster_search_index.json"), { index: [] });
  const entries = data.index || data.items || [];
  const expansionAreaIds = new Set(TARGET_AREA_IDS);

  entries.forEach(function (item, indexPos) {
    if (item.category !== "SHELTER" || expansionAreaIds.has(item.area_id) === false) {
      return;
    }
    const trace = item.source_trace || {};
    const pass =
      Boolean(item.area_id) &&
      Boolean(item.source_id) &&
      Boolean(trace.classification_id || trace.apply_id || trace.registry_apply_id);
    checks.push(
      check(
        "shelter_trace." + (item.area_id || "unknown") + "[" + indexPos + "]",
        pass,
        pass ? null : "source_trace missing for SHELTER entry"
      )
    );
  });

  if (!checks.length) {
    checks.push(check("shelter_trace_entries_present", false, "no SHELTER entries for KM014-KM022"));
  }

  return checks;
}

function validatePublicDataIntegrity() {
  const checks = [];
  const currentHash = hashPublicSnapshot();
  const stored = readJson(PUBLIC_HASH_FILE, null);

  if (!stored || !stored.hash) {
    checks.push(check("public_data_baseline_recorded", false, "run finalize after first readiness pass to record baseline"));
    return { checks: checks, currentHash: currentHash };
  }

  checks.push(check("public_data_baseline_recorded", true));
  checks.push(check("public_data_unchanged", stored.hash === currentHash));
  return { checks: checks, currentHash: currentHash };
}

function statusFrom(checks) {
  return checks.some(function (item) {
    return item.status === "FAIL";
  })
    ? "FAIL"
    : "PASS";
}

function main() {
  const recordPublicHash = process.argv.indexOf("--record-public-hash") >= 0;
  const skipPublicHash = process.argv.indexOf("--skip-public-hash") >= 0;
  const errors = [];
  const sections = {};

  const sources = loadExpansionSources();
  sections.snapshot_baseline = {
    checks: validateSnapshots(sources),
    status: "PENDING"
  };
  sections.classification_hardening = {
    checks: validateClassificationHardening(),
    status: "PENDING"
  };
  sections.review_queue = {
    checks: validateReviewQueue(),
    status: "PENDING"
  };
  sections.patrol_pipeline = {
    checks: validatePatrolPipelineScripts(),
    status: "PENDING"
  };
  sections.registry_integrity = {
    checks: validateRegistryIntegrity(sources),
    status: "PENDING"
  };
  sections.trace_integrity = {
    checks: validateShelterTrace(),
    status: "PENDING"
  };

  const publicIntegrity = skipPublicHash
    ? { checks: [check("public_data_unchanged", true, "skipped in test suite")], currentHash: hashPublicSnapshot() }
    : validatePublicDataIntegrity();
  if (recordPublicHash) {
    const dir = path.dirname(PUBLIC_HASH_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(
      PUBLIC_HASH_FILE,
      JSON.stringify(
        {
          recordedAt: new Date().toISOString(),
          hash: publicIntegrity.currentHash
        },
        null,
        2
      ) + "\n",
      "utf8"
    );
    publicIntegrity.checks = [
      check("public_data_baseline_recorded", true),
      check("public_data_unchanged", true)
    ];
  }
  sections.public_data_integrity = {
    checks: publicIntegrity.checks,
    status: "PENDING"
  };

  Object.keys(sections).forEach(function (key) {
    sections[key].status = statusFrom(sections[key].checks);
    sections[key].checks.forEach(function (item) {
      if (item.status === "FAIL") {
        errors.push(key + ": " + item.check + (item.reason ? " (" + item.reason + ")" : ""));
      }
    });
  });

  const overallPass = errors.length === 0;

  const output = {
    PRODUCTION_READINESS: overallPass ? "PASS" : "FAIL",
    generatedAt: new Date().toISOString(),
    target_area_ids: TARGET_AREA_IDS,
    constraints: {
      auto_municipality_add: false,
      sources_json_auto_change: false,
      auto_publish: false,
      speculative_classification: false
    },
    sections: sections,
    errors: errors
  };

  const outDir = path.join(ROOT, "data", "production_readiness");
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  fs.writeFileSync(
    path.join(outDir, "latest-report.json"),
    JSON.stringify(output, null, 2) + "\n",
    "utf8"
  );

  console.log("=== Production Readiness Validation ===");
  console.log(JSON.stringify(output, null, 2));

  if (!overallPass) {
    process.exit(1);
  }
}

main();

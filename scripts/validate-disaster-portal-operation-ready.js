#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "data", "public");
const SOURCES_FILE = path.join(ROOT, "monitor", "sources.json");
const TARGETS_FILE = path.join(ROOT, "data", "municipality_expansion", "portal_ui_targets.json");
const APP_JS = path.join(ROOT, "js", "app.js");
const REVIEW_QUEUE_FILE = path.join(ROOT, "data", "review_queue", "patrol_review_queue.json");
const PUBLIC_HASH_FILE = path.join(ROOT, "data", "production_readiness", "public-data-hash.json");
const SOURCES_HASH_FILE = path.join(ROOT, "data", "production_readiness", "sources-json-hash.json");

const EXPECTED_AREA_COUNT = 23;
const EXPANSION_AREA_IDS = [
  "KM014", "KM015", "KM016", "KM017", "KM018",
  "KM019", "KM020", "KM021", "KM022"
];

const {
  classifyChangeLogEntries,
  isClassifiableChangeEntry
} = require("../monitor/diff-classification");

const { rollbackPublicUpdateApply } = require("../monitor/public-update-apply-engine");

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

function check(name, pass, reason) {
  return { check: name, status: pass ? "PASS" : "FAIL", reason: reason || null };
}

function statusFrom(checks) {
  return checks.some(function (item) {
    return item.status === "FAIL";
  })
    ? "FAIL"
    : "PASS";
}

function uniqueCount(values) {
  return new Set(values).size;
}

function validateDataIntegrity() {
  const checks = [];
  const phase1Areas = readJson(path.join(PUBLIC_DIR, "phase1_areas.json"), []);
  const phase1Nav = readJson(path.join(PUBLIC_DIR, "phase1_navigation.json"), []);
  const phase1Updates = readJson(path.join(PUBLIC_DIR, "phase1_updates.json"), []);
  const areaNav = readJson(path.join(PUBLIC_DIR, "area_navigation.json"), { areas: [] });
  const waterIndex = readJson(path.join(PUBLIC_DIR, "water_search_index.json"), { index: [] });
  const disasterIndex = readJson(path.join(PUBLIC_DIR, "disaster_search_index.json"), { index: [] });
  const sources = readJson(SOURCES_FILE, { municipalities: [] });
  const targets = readJson(TARGETS_FILE, { municipalities: [] }).municipalities;

  const areaIds = phase1Areas.map(function (item) {
    return item.area_id;
  });
  checks.push(check("phase1_areas.count", phase1Areas.length === EXPECTED_AREA_COUNT));
  checks.push(check("phase1_areas.area_id_unique", areaIds.length === uniqueCount(areaIds)));

  const navIds = phase1Nav.map(function (item) {
    return item.area_id;
  });
  checks.push(check("phase1_navigation.area_id_unique", navIds.length === uniqueCount(navIds)));
  checks.push(check("phase1_navigation.matches_areas", navIds.every(function (id) {
    return areaIds.indexOf(id) >= 0;
  })));

  targets.forEach(function (target) {
    const inAreas = phase1Areas.some(function (item) {
      return item.area_id === target.area_id && item.name === target.name;
    });
    const inNav = phase1Nav.some(function (item) {
      return item.area_id === target.area_id;
    });
    const inUpdates = phase1Updates.some(function (item) {
      return item.area_id === target.area_id;
    });
    const activeSources = (sources.municipalities || []).filter(function (item) {
      return item.area_id === target.area_id && item.status === "ACTIVE";
    });
    checks.push(check("registry." + target.area_id + ".phase1_areas", inAreas));
    checks.push(check("registry." + target.area_id + ".phase1_navigation", inNav));
    checks.push(check("registry." + target.area_id + ".phase1_updates", inUpdates));
    checks.push(check("registry." + target.area_id + ".sources_active", activeSources.length > 0));
  });

  const waterEntries = waterIndex.index || waterIndex.items || [];
  const disasterEntries = disasterIndex.index || disasterIndex.items || [];
  const disasterIds = disasterEntries.map(function (item) {
    return item.index_id;
  });
  checks.push(check("water_search_index.present", waterEntries.length > 0));
  checks.push(check("disaster_search_index.present", disasterEntries.length > 0));
  checks.push(check("disaster_search_index.index_id_unique", disasterIds.length === uniqueCount(disasterIds)));

  EXPANSION_AREA_IDS.forEach(function (areaId) {
    const target = targets.find(function (item) {
      return item.area_id === areaId;
    });
    if (!target) {
      checks.push(check("water_search." + areaId, false, "target missing"));
      checks.push(check("shelter_search." + areaId, false, "target missing"));
      return;
    }
    const waterHit = waterEntries.some(function (item) {
      return item.municipality === target.name;
    });
    const shelterHit = disasterEntries.some(function (item) {
      return item.category === "SHELTER" && item.area_id === areaId;
    });
    checks.push(check("water_search." + areaId, waterHit));
    checks.push(check("shelter_search." + areaId, shelterHit));

    if (shelterHit) {
      const shelter = disasterEntries.find(function (item) {
        return item.category === "SHELTER" && item.area_id === areaId;
      });
      const trace = shelter && shelter.source_trace;
      const tracePass =
        Boolean(shelter && shelter.source_id) &&
        Boolean(trace && (trace.classification_id || trace.registry_apply_id || trace.apply_id));
      checks.push(check("source_trace." + areaId, tracePass));
    }
  });

  const areaNavIds = (areaNav.areas || []).map(function (item) {
    return item.area_id;
  });
  checks.push(check("area_navigation.area_id_unique", areaNavIds.length === uniqueCount(areaNavIds)));
  EXPANSION_AREA_IDS.forEach(function (areaId) {
    checks.push(check("area_navigation." + areaId, areaNavIds.indexOf(areaId) >= 0));
  });

  return checks;
}

function validateUiFinal() {
  const checks = [];
  const appJs = fs.readFileSync(APP_JS, "utf8");
  const phase1Areas = readJson(path.join(PUBLIC_DIR, "phase1_areas.json"), []);
  const anchors = phase1Areas.map(function (item) {
    return item.anchor;
  });

  checks.push(check("ui.municipality_tiles", phase1Areas.length === EXPECTED_AREA_COUNT));
  checks.push(check("ui.anchor_unique", anchors.length === uniqueCount(anchors)));
  checks.push(check("ui.emergency_section", /renderLatestUpdates|phase1_updates\.json/.test(appJs)));
  checks.push(check("ui.water_search", /renderWaterSearch|water-search/.test(appJs)));
  checks.push(check("ui.disaster_search", /renderDisasterSearch|disaster-search/.test(appJs)));
  checks.push(check("ui.area_disaster_nav", /renderAreaDisasterNav/.test(appJs)));
  checks.push(check("ui.empty_state", /公開可能な公式情報を確認中です|該当する情報は見つかりませんでした/.test(appJs)));
  checks.push(check("ui.no_duplicate_quick_access", appJs.indexOf("portal-quick-access__card-note") < 0));

  EXPANSION_AREA_IDS.forEach(function (areaId) {
    checks.push(check("ui.AREA_DISPLAY_RULES." + areaId, new RegExp(areaId + ":").test(appJs)));
    const area = phase1Areas.find(function (item) {
      return item.area_id === areaId;
    });
    if (area) {
      checks.push(check("ui.tile." + areaId, Boolean(area.name && area.anchor)));
    }
  });

  const duplicateNames = phase1Areas
    .map(function (item) {
      return item.name;
    })
    .filter(function (name, index, array) {
      return array.indexOf(name) !== index;
    });
  checks.push(check("ui.no_duplicate_municipality_names", duplicateNames.length === 0));

  return checks;
}

function validatePatrolOperation() {
  const checks = [];
  const scripts = [
    "scripts/run-monitor.js",
    "scripts/classify-patrol-diffs.js",
    "scripts/build-patrol-review-queue.js",
    "scripts/run-patrol-pipeline.js"
  ];
  scripts.forEach(function (file) {
    checks.push(check("patrol.script." + path.basename(file), fs.existsSync(path.join(ROOT, file))));
  });

  const pageUpdatedExcluded = classifyChangeLogEntries(
    [{
      source: "KM020-nishihara-bousai",
      sourceName: "西原村",
      changeType: "PAGE_UPDATED_AT_CHANGED",
      previousHash: "same",
      currentHash: "same",
      keywords: ["避難所"]
    }],
    { sources: {} }
  );
  checks.push(check("patrol.PAGE_UPDATED_AT_CHANGED_excluded", pageUpdatedExcluded.length === 0));

  const contentIncluded = classifyChangeLogEntries(
    [{
      source: "KM020-nishihara-bousai",
      sourceName: "西原村",
      url: "https://example.test",
      changeType: "CONTENT_CHANGED",
      previousHash: "before",
      currentHash: "after",
      keywords: ["断水"]
    }],
    { sources: {} }
  );
  checks.push(check("patrol.CONTENT_CHANGED_classified", contentIncluded.length >= 1));
  checks.push(check("patrol.isClassifiableChangeEntry", isClassifiableChangeEntry({
    changeType: "PAGE_UPDATED_AT_CHANGED",
    previousHash: "a",
    currentHash: "a"
  }) === false));

  const noDiffStops = classifyChangeLogEntries([], { sources: {} });
  checks.push(check("patrol.no_diff_no_classification", noDiffStops.length === 0));

  const changeLogDir = path.join(ROOT, "monitor", "change-log");
  checks.push(check("patrol.change_log_dir", fs.existsSync(changeLogDir)));

  return checks;
}

function validateSecurityGovernance() {
  const checks = [];
  const queue = readJson(REVIEW_QUEUE_FILE, { items: [], autoPublish: false });
  const pipelineJs = fs.readFileSync(path.join(ROOT, "scripts", "run-patrol-pipeline.js"), "utf8");
  const applyEngineJs = fs.readFileSync(path.join(ROOT, "monitor", "public-update-apply-engine.js"), "utf8");

  checks.push(check("governance.review_queue.auto_publish_false", queue.autoPublish === false || queue.auto_publish === false));
  checks.push(check("governance.pipeline.manual_apply_only", /apply_confirm[\s\S]*SKIPPED/.test(pipelineJs)));
  checks.push(check("governance.pipeline.auto_publish_false", /auto_publish:\s*false/.test(pipelineJs)));
  checks.push(check("governance.rollback_function", typeof rollbackPublicUpdateApply === "function"));
  checks.push(check("governance.rollback_metadata_required", applyEngineJs.indexOf("rollback metadata required") >= 0));
  checks.push(check("governance.public_hash_baseline", fs.existsSync(PUBLIC_HASH_FILE)));

  const storedSourcesHash = readJson(SOURCES_HASH_FILE, null);
  const currentSourcesHash = hashFile(SOURCES_FILE);
  if (!storedSourcesHash || !storedSourcesHash.hash) {
    const dir = path.dirname(SOURCES_HASH_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(
      SOURCES_HASH_FILE,
      JSON.stringify({
        recordedAt: new Date().toISOString(),
        hash: currentSourcesHash
      }, null, 2) + "\n",
      "utf8"
    );
    checks.push(check("governance.sources_json_unchanged", true, "baseline recorded"));
  } else {
    checks.push(check("governance.sources_json_unchanged", storedSourcesHash.hash === currentSourcesHash));
  }

  (queue.items || []).forEach(function (item, index) {
    if (item.auto_publish === true) {
      checks.push(check("governance.review_item[" + index + "].no_auto_publish", false));
    }
    if (item.status && item.status !== "PENDING" && !item.decision) {
      checks.push(check("governance.review_item[" + index + "].decision_required", false));
    }
  });

  return checks;
}

function runBuildVerification() {
  const checks = [];
  const commands = [
    { name: "npm test", command: "npm test" },
    { name: "npm run build", command: "npm run build" },
    {
      name: "validate-production-readiness",
      command: "node scripts/validate-production-readiness.js --record-public-hash"
    }
  ];

  commands.forEach(function (item) {
    try {
      execSync(item.command, {
        cwd: ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      });
      checks.push(check("build." + item.name, true));
    } catch (err) {
      checks.push(check("build." + item.name, false, (err.stderr || err.stdout || err.message).slice(0, 200)));
    }
  });

  return checks;
}

function main() {
  const runBuild = process.argv.indexOf("--run-build") >= 0;
  const errors = [];
  const sections = {};

  sections.data_integrity = { checks: validateDataIntegrity(), status: "PENDING" };
  sections.ui_final = { checks: validateUiFinal(), status: "PENDING" };
  sections.patrol_operation = { checks: validatePatrolOperation(), status: "PENDING" };
  sections.security_governance = { checks: validateSecurityGovernance(), status: "PENDING" };

  if (runBuild) {
    sections.build_verification = { checks: runBuildVerification(), status: "PENDING" };
  } else {
    sections.build_verification = {
      checks: [check("build.skipped", true, "pass --run-build to execute npm test/build/readiness")],
      status: "PASS"
    };
  }

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
    DISASTER_PORTAL_OPERATION_READY: overallPass ? "PASS" : "FAIL",
    generatedAt: new Date().toISOString(),
    scope: {
      existing_municipalities: "KM000-KM013",
      expansion_municipalities: EXPANSION_AREA_IDS,
      total_area_count: EXPECTED_AREA_COUNT
    },
    sections: sections,
    errors: errors
  };

  const outDir = path.join(ROOT, "data", "operation_audit");
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  fs.writeFileSync(
    path.join(outDir, "latest-report.json"),
    JSON.stringify(output, null, 2) + "\n",
    "utf8"
  );

  console.log("=== Disaster Portal Operation Completion Audit ===");
  console.log(JSON.stringify(output, null, 2));

  if (!overallPass) {
    process.exit(1);
  }
}

main();

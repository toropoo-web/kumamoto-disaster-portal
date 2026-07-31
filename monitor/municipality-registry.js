"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const REGISTRY_DIR = path.join(ROOT, "data", "municipality_registry");
const PREFECTURES_FILE = path.join(REGISTRY_DIR, "prefectures.json");
const MUNICIPALITIES_FILE = path.join(REGISTRY_DIR, "municipalities.json");
const DISCOVERY_TARGETS_FILE = path.join(REGISTRY_DIR, "discovery_targets.json");
const SCHEMA_FILE = path.join(REGISTRY_DIR, "registry_schema.json");
const NATIONAL_RUNS_DIR = path.join(REGISTRY_DIR, "national_runs");

const DOMAIN_PATTERN = /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i;
const URL_PATTERN = /^https?:\/\/.+/i;
const MUNICIPALITY_ID_PATTERN = /^JP[0-9]{6}$/;
const TARGET_ID_PATTERN = /^DST-[0-9]{6}$/;

const DESIGNATED_CITIES = new Set(["熊本市"]);
const PREFECTURE_CAPITALS = new Set(["熊本市"]);
const DISASTER_RISK_MUNICIPALITIES = new Set([
  "熊本市",
  "宇土市",
  "宇城市",
  "美里町",
  "八代市",
  "人吉市",
  "氷川町",
  "益城町",
  "合志市",
  "御船町",
  "菊陽町",
  "嘉島町",
  "菊池市",
  "水俣市",
  "甲佐町",
  "芦北町",
  "津奈木町",
  "上天草市",
  "天草市",
  "西原村",
  "苓北町",
  "多良木町"
]);

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
  return path.relative(ROOT, filePath).split(path.sep).join("/");
}

function loadPrefectures() {
  const data = readJson(PREFECTURES_FILE, { prefectures: [] });
  return data.prefectures || [];
}

function loadMunicipalities() {
  const data = readJson(MUNICIPALITIES_FILE, { municipalities: [] });
  return data.municipalities || [];
}

function loadDiscoveryTargets() {
  const data = readJson(DISCOVERY_TARGETS_FILE, { targets: [] });
  return data.targets || [];
}

function loadRegistry() {
  return {
    prefectures: loadPrefectures(),
    municipalities: loadMunicipalities(),
    discovery_targets: loadDiscoveryTargets(),
    schema: readJson(SCHEMA_FILE, {})
  };
}

function inferPriority(municipality) {
  if (DESIGNATED_CITIES.has(municipality.municipality)) {
    return "HIGH";
  }
  if (DISASTER_RISK_MUNICIPALITIES.has(municipality.municipality)) {
    return "HIGH";
  }
  if (municipality.prefecture === "熊本県") {
    return "HIGH";
  }
  if (PREFECTURE_CAPITALS.has(municipality.municipality)) {
    return "MEDIUM";
  }
  if (municipality.type === "city") {
    return "MEDIUM";
  }
  return "LOW";
}

function validateMunicipalityRecord(record, index) {
  const errors = [];
  const prefix = "municipalities[" + index + "]";

  if (!record.municipality_id) {
    errors.push(prefix + ": municipality_id is required");
  } else if (!MUNICIPALITY_ID_PATTERN.test(record.municipality_id)) {
    errors.push(prefix + ": invalid municipality_id format");
  }

  if (!record.municipality) {
    errors.push(prefix + ": municipality is required");
  }
  if (!record.prefecture) {
    errors.push(prefix + ": prefecture is required");
  }
  if (["city", "town", "village", "prefecture"].indexOf(record.type) < 0) {
    errors.push(prefix + ": invalid type");
  }
  if (["ACTIVE", "INACTIVE"].indexOf(record.status) < 0) {
    errors.push(prefix + ": invalid status");
  }
  if (["READY", "PENDING", "DISABLED", "COMPLETED"].indexOf(record.discovery_status) < 0) {
    errors.push(prefix + ": invalid discovery_status");
  }

  if (record.official_domain && !DOMAIN_PATTERN.test(record.official_domain)) {
    errors.push(prefix + ": invalid official_domain");
  }
  if (record.official_url && !URL_PATTERN.test(record.official_url)) {
    errors.push(prefix + ": invalid official_url");
  }

  if (!record.source || !record.source.created_at || !record.source.source) {
    errors.push(prefix + ": source metadata incomplete");
  }

  return errors;
}

function validateDiscoveryTargetRecord(record, index, municipalityMap) {
  const errors = [];
  const prefix = "discovery_targets[" + index + "]";

  if (!record.target_id) {
    errors.push(prefix + ": target_id is required");
  } else if (!TARGET_ID_PATTERN.test(record.target_id)) {
    errors.push(prefix + ": invalid target_id format");
  }

  if (!record.municipality_id) {
    errors.push(prefix + ": municipality_id is required");
  } else if (!municipalityMap.has(record.municipality_id)) {
    errors.push(prefix + ": municipality_id not found in municipalities registry");
  }

  if (["HIGH", "MEDIUM", "LOW"].indexOf(record.priority) < 0) {
    errors.push(prefix + ": invalid priority");
  }

  if (typeof record.discovery_enabled !== "boolean") {
    errors.push(prefix + ": discovery_enabled must be boolean");
  }

  if (record.official_domain && !DOMAIN_PATTERN.test(record.official_domain)) {
    errors.push(prefix + ": invalid official_domain");
  }

  if (!record.discovery_result || typeof record.discovery_result !== "object") {
    errors.push(prefix + ": discovery_result missing");
  }

  const municipality = municipalityMap.get(record.municipality_id);
  if (municipality && municipality.status === "INACTIVE" && record.discovery_enabled) {
    errors.push(prefix + ": inactive municipality cannot have discovery_enabled=true");
  }

  return errors;
}

function validateRegistry() {
  const errors = [];
  const municipalities = loadMunicipalities();
  const targets = loadDiscoveryTargets();
  const idSet = new Set();
  const municipalityMap = new Map();

  municipalities.forEach(function (record, index) {
    validateMunicipalityRecord(record, index).forEach(function (message) {
      errors.push(message);
    });
    if (record.municipality_id) {
      if (idSet.has(record.municipality_id)) {
        errors.push("duplicate municipality_id: " + record.municipality_id);
      }
      idSet.add(record.municipality_id);
      municipalityMap.set(record.municipality_id, record);
    }
  });

  const targetIdSet = new Set();
  targets.forEach(function (record, index) {
    validateDiscoveryTargetRecord(record, index, municipalityMap).forEach(function (message) {
      errors.push(message);
    });
    if (record.target_id) {
      if (targetIdSet.has(record.target_id)) {
        errors.push("duplicate target_id: " + record.target_id);
      }
      targetIdSet.add(record.target_id);
    }
  });

  return {
    valid: errors.length === 0,
    errors: errors,
    municipality_count: municipalities.length,
    target_count: targets.length,
    active_target_count: targets.filter(function (target) {
      return target.discovery_enabled;
    }).length
  };
}

function listMunicipalityTargets(options) {
  options = options || {};
  const municipalities = loadMunicipalities();
  const targets = loadDiscoveryTargets();
  const targetMap = new Map();
  targets.forEach(function (target) {
    targetMap.set(target.municipality_id, target);
  });

  let rows = municipalities.map(function (municipality) {
    const target = targetMap.get(municipality.municipality_id) || null;
    return {
      municipality_id: municipality.municipality_id,
      prefecture: municipality.prefecture,
      municipality: municipality.municipality,
      type: municipality.type,
      official_domain: municipality.official_domain,
      status: municipality.status,
      discovery_status: municipality.discovery_status,
      priority: target ? target.priority : inferPriority(municipality),
      discovery_enabled: target ? target.discovery_enabled : false,
      last_discovery: target ? target.last_discovery : "",
      discovery_result: target ? target.discovery_result : null
    };
  });

  if (options.prefecture) {
    rows = rows.filter(function (row) {
      return row.prefecture === options.prefecture;
    });
  }
  if (options.priority) {
    rows = rows.filter(function (row) {
      return row.priority === options.priority;
    });
  }
  if (options.activeOnly) {
    rows = rows.filter(function (row) {
      return row.status === "ACTIVE";
    });
  }

  return rows;
}

function getEnabledDiscoveryTargets(options) {
  options = options || {};
  const municipalities = loadMunicipalities();
  const municipalityMap = new Map();
  municipalities.forEach(function (item) {
    municipalityMap.set(item.municipality_id, item);
  });

  let targets = loadDiscoveryTargets().filter(function (target) {
    const municipality = municipalityMap.get(target.municipality_id);
    if (!target.discovery_enabled) {
      return false;
    }
    if (!municipality || municipality.status !== "ACTIVE") {
      return false;
    }
    if (municipality.discovery_status === "DISABLED") {
      return false;
    }
    if (!target.official_domain) {
      return false;
    }
    return true;
  });

  if (options.prefecture) {
    targets = targets.filter(function (target) {
      return target.prefecture === options.prefecture;
    });
  }
  if (options.priority) {
    targets = targets.filter(function (target) {
      return target.priority === options.priority;
    });
  }
  if (options.municipalityIds && options.municipalityIds.length) {
    const allowed = new Set(options.municipalityIds);
    targets = targets.filter(function (target) {
      return allowed.has(target.municipality_id);
    });
  }
  if (options.limit) {
    targets = targets.slice(0, options.limit);
  }

  return targets;
}

function buildPipelineTargetsFromDiscoveryTargets(targets) {
  return {
    version: 1,
    prefecture: targets[0] ? targets[0].prefecture : "熊本県",
    source: "data/municipality_registry/discovery_targets.json",
    targets: targets.map(function (target) {
      return {
        prefecture: target.prefecture,
        municipality: target.municipality,
        official_domain: target.official_domain,
        municipality_id: target.municipality_id,
        target_id: target.target_id
      };
    })
  };
}

function buildDiscoveryRunId(generatedAt) {
  return "NDR-" + (generatedAt || new Date().toISOString()).replace(/[:.]/g, "-");
}

function hashFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function annotateReviewQueueWithRegistry(reviewQueue, discoveryRunId, targetMap) {
  const items = (reviewQueue.items || []).map(function (item) {
    const municipalityRow = Array.from(targetMap.values()).find(function (target) {
      return target.municipality === item.municipality;
    });
    return Object.assign({}, item, {
      municipality_id: municipalityRow ? municipalityRow.municipality_id : null,
      target_id: municipalityRow ? municipalityRow.target_id : null,
      source_trace: Object.assign({}, item.source_trace || {}, {
        discovery_run_id: discoveryRunId,
        municipality_id: municipalityRow ? municipalityRow.municipality_id : null,
        target_id: municipalityRow ? municipalityRow.target_id : null
      })
    });
  });

  return Object.assign({}, reviewQueue, {
    discovery_run_id: discoveryRunId,
    items: items
  });
}

function updateDiscoveryTargetResults(targetResults, generatedAt) {
  const data = readJson(DISCOVERY_TARGETS_FILE, { targets: [] });
  const resultMap = new Map();
  targetResults.forEach(function (result) {
    resultMap.set(result.municipality_id, result);
  });

  data.targets = (data.targets || []).map(function (target) {
    const result = resultMap.get(target.municipality_id);
    if (!result) {
      return target;
    }
    return Object.assign({}, target, {
      last_discovery: generatedAt,
      discovery_result: {
        status: result.status,
        candidate_count: result.candidate_count,
        discovery_run_id: result.discovery_run_id,
        pipeline_run_id: result.pipeline_run_id || null,
        error: result.error || null
      }
    });
  });

  data.generatedAt = generatedAt;
  writeJson(DISCOVERY_TARGETS_FILE, data);
  return data;
}

async function runNationalDiscovery(options) {
  options = options || {};
  const validation = validateRegistry();
  if (!validation.valid) {
    return {
      saved: false,
      reason: "registry validation failed",
      errors: validation.errors
    };
  }

  const { runPatrolDiscoveryPipeline, SOURCES_FILE } = require("./patrol-discovery-controller");
  const sourcesHashBefore = hashFile(SOURCES_FILE);
  const generatedAt = options.generatedAt || new Date().toISOString();
  const discoveryRunId = options.discoveryRunId || buildDiscoveryRunId(generatedAt);
  const enabledTargets = getEnabledDiscoveryTargets({
    prefecture: options.prefecture,
    priority: options.priority,
    municipalityIds: options.municipalityIds,
    limit: options.limit
  });

  if (!enabledTargets.length) {
    return {
      saved: false,
      reason: "no enabled discovery targets",
      errors: ["no enabled discovery targets"],
      discovery_run_id: discoveryRunId
    };
  }

  const targetMap = new Map();
  enabledTargets.forEach(function (target) {
    targetMap.set(target.municipality_id, target);
  });

  const pipelineTargets = buildPipelineTargetsFromDiscoveryTargets(enabledTargets);
  const tempTargetsPath = path.join(
    REGISTRY_DIR,
    "pipeline_targets-" + generatedAt.replace(/[:.]/g, "-") + ".json"
  );
  writeJson(tempTargetsPath, pipelineTargets);

  const pipelineResult = await runPatrolDiscoveryPipeline({
    live: options.live === true,
    dryRunOutput: options.dryRunOutput !== false,
    targetsPath: tempTargetsPath,
    maxCandidates: options.maxCandidates || 12,
    generatedAt: generatedAt,
    fixtureMap: options.fixtureMap
  });

  if (fs.existsSync(tempTargetsPath)) {
    fs.unlinkSync(tempTargetsPath);
  }

  const targetResults = enabledTargets.map(function (target) {
    const municipalityResult = (pipelineResult.run.municipalities || []).find(function (item) {
      return item.municipality === target.municipality;
    });
    if (!municipalityResult) {
      return {
        municipality_id: target.municipality_id,
        target_id: target.target_id,
        status: "ERROR",
        candidate_count: 0,
        discovery_run_id: discoveryRunId,
        pipeline_run_id: pipelineResult.pipeline_run_id,
        error: "municipality result missing"
      };
    }
    if (municipalityResult.error) {
      return {
        municipality_id: target.municipality_id,
        target_id: target.target_id,
        status: "ERROR",
        candidate_count: 0,
        discovery_run_id: discoveryRunId,
        pipeline_run_id: pipelineResult.pipeline_run_id,
        error: municipalityResult.error
      };
    }
    return {
      municipality_id: target.municipality_id,
      target_id: target.target_id,
      status: "COMPLETED",
      candidate_count: municipalityResult.candidate_count || 0,
      discovery_run_id: discoveryRunId,
      pipeline_run_id: pipelineResult.pipeline_run_id
    };
  });

  const annotatedReviewQueue = annotateReviewQueueWithRegistry(
    pipelineResult.review_queue,
    discoveryRunId,
    targetMap
  );

  const nationalRun = {
    version: 1,
    generatedAt: generatedAt,
    discovery_run_id: discoveryRunId,
    pipeline_run_id: pipelineResult.pipeline_run_id,
    prefecture: options.prefecture || pipelineTargets.prefecture,
    target_count: enabledTargets.length,
    municipality_ids: enabledTargets.map(function (target) {
      return target.municipality_id;
    }),
    pipeline_summary: pipelineResult.summary,
    target_results: targetResults,
    review_queue: annotatedReviewQueue,
    errors: pipelineResult.errors || []
  };

  let nationalRunPath = null;
  if (!options.dryRunOutput) {
    ensureDir(NATIONAL_RUNS_DIR);
    nationalRunPath = path.join(NATIONAL_RUNS_DIR, discoveryRunId + ".json");
    writeJson(nationalRunPath, nationalRun);
    updateDiscoveryTargetResults(targetResults, generatedAt);
    writeJson(path.join(REGISTRY_DIR, "review_queue_snapshot.json"), annotatedReviewQueue);
  }

  const sourcesHashAfter = hashFile(SOURCES_FILE);
  if (sourcesHashBefore !== sourcesHashAfter) {
    return {
      saved: false,
      reason: "sources.json was modified during national discovery",
      errors: ["sources.json auto-modification detected"],
      discovery_run_id: discoveryRunId
    };
  }

  return {
    saved: !options.dryRunOutput,
    dryRunOutput: options.dryRunOutput !== false,
    discovery_run_id: discoveryRunId,
    pipeline_run_id: pipelineResult.pipeline_run_id,
    target_count: enabledTargets.length,
    national_run: nationalRun,
    national_run_path: nationalRunPath ? toRepoRelative(nationalRunPath) : null,
    pipeline_result: pipelineResult,
    review_queue: annotatedReviewQueue,
    errors: nationalRun.errors
  };
}

module.exports = {
  REGISTRY_DIR,
  PREFECTURES_FILE,
  MUNICIPALITIES_FILE,
  DISCOVERY_TARGETS_FILE,
  SCHEMA_FILE,
  NATIONAL_RUNS_DIR,
  DOMAIN_PATTERN,
  URL_PATTERN,
  MUNICIPALITY_ID_PATTERN,
  TARGET_ID_PATTERN,
  loadPrefectures,
  loadMunicipalities,
  loadDiscoveryTargets,
  loadRegistry,
  inferPriority,
  validateMunicipalityRecord,
  validateDiscoveryTargetRecord,
  validateRegistry,
  listMunicipalityTargets,
  getEnabledDiscoveryTargets,
  buildPipelineTargetsFromDiscoveryTargets,
  buildDiscoveryRunId,
  annotateReviewQueueWithRegistry,
  updateDiscoveryTargetResults,
  runNationalDiscovery
};

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const EXPANSION_DIR = path.join(ROOT, "data", "municipality_expansion");
const RUNS_DIR = path.join(EXPANSION_DIR, "runs");
const REVIEW_DIR = path.join(EXPANSION_DIR, "review");

const ALLOWED_PORTALS = ["kumamoto-disaster-portal"];
const DISCOVERY_TARGET_LABELS = [
  "official_top",
  "disaster_page",
  "emergency",
  "disaster_special",
  "water",
  "shelter",
  "support"
];

const { loadMunicipalities } = require("./municipality-registry");
const {
  discoverPatrolUrls,
  normalizeUrl,
  loadSourcesRegistry
} = require("./patrol-url-discovery-engine");
const {
  classifyRegistryComparison,
  buildReviewQueueItem,
  validateReviewQueueItem,
  getRegisteredSources,
  SOURCES_FILE
} = require("./patrol-discovery-controller");
const { fetchSource } = require("./crawler");
const { parsePage, normalizeContent } = require("./parser");

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

function hashFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return crypto.createHash("sha256").update(fs.readFileSync(filePath, "utf8")).digest("hex");
}

function buildExpansionRunId(generatedAt) {
  return "MEX-" + (generatedAt || new Date().toISOString()).replace(/[:.]/g, "-");
}

function validateExpansionInput(input) {
  const errors = [];
  if (!input || typeof input !== "object") {
    return { valid: false, errors: ["input object required"] };
  }
  if (!input.portal || ALLOWED_PORTALS.indexOf(input.portal) < 0) {
    errors.push("portal must be kumamoto-disaster-portal");
  }
  if (!Array.isArray(input.municipalities) || !input.municipalities.length) {
    errors.push("municipalities array required with at least one entry");
  } else {
    const unique = new Set();
    input.municipalities.forEach(function (name, index) {
      if (!name || typeof name !== "string") {
        errors.push("municipalities[" + index + "] must be a non-empty string");
      } else if (unique.has(name)) {
        errors.push("duplicate municipality: " + name);
      } else {
        unique.add(name);
      }
    });
  }
  return { valid: errors.length === 0, errors: errors };
}

function resolveSpecifiedMunicipalities(names) {
  const registry = loadMunicipalities();
  const registryMap = new Map();
  registry.forEach(function (item) {
    registryMap.set(item.municipality, item);
  });

  const resolved = [];
  const errors = [];
  const notFound = [];

  names.forEach(function (name) {
    const record = registryMap.get(name);
    if (!record) {
      notFound.push(name);
      errors.push("municipality not in registry (Portal指定のみ): " + name);
      return;
    }
    if (record.status !== "ACTIVE") {
      errors.push(name + ": municipality is not ACTIVE");
      return;
    }
    resolved.push(record);
  });

  return {
    valid: errors.length === 0,
    errors: errors,
    municipalities: resolved,
    not_found: notFound
  };
}

function loadFixtureMap(fixtureMapOption) {
  if (!fixtureMapOption) {
    return null;
  }
  const map = {};
  Object.keys(fixtureMapOption).forEach(function (municipality) {
    const entry = fixtureMapOption[municipality];
    const candidates = {};
    Object.keys(entry.candidates || {}).forEach(function (url) {
      const filePath = path.isAbsolute(entry.candidates[url])
        ? entry.candidates[url]
        : path.join(ROOT, entry.candidates[url]);
      candidates[normalizeUrl(url)] = fs.readFileSync(filePath, "utf8");
    });
    const entryPath = path.isAbsolute(entry.entry) ? entry.entry : path.join(ROOT, entry.entry);
    map[municipality] = {
      entry: fs.readFileSync(entryPath, "utf8"),
      candidates: candidates
    };
  });
  return map;
}

function summarizeCandidate(candidate, dryRun) {
  return {
    candidate_url: candidate.candidate_url,
    link_label: candidate.link_label,
    page_type: candidate.page_type,
    public_category_id: candidate.public_category_id,
    recommended_role: candidate.recommended_role,
    score: candidate.score,
    score_tier: candidate.score_tier,
    confidence: candidate.confidence,
    detected_keywords: candidate.detected_keywords || [],
    discovery_status: candidate.discovery_status,
    page_analysis: candidate.page_analysis || null,
    dry_run: dryRun
      ? {
          verdict: dryRun.verdict,
          reason: dryRun.reason,
          http: dryRun.http,
          html_parse: dryRun.html_parse,
          text_length: dryRun.text_length
        }
      : null
  };
}

async function analyzeCandidateDryRun(candidate, options) {
  options = options || {};
  let fetched;
  if (options.fixtureHtml) {
    fetched = {
      ok: true,
      status: 200,
      body: options.fixtureHtml,
      finalUrl: candidate.candidate_url,
      url: candidate.candidate_url,
      headers: {}
    };
  } else {
    fetched = await fetchSource(candidate.candidate_url);
  }

  const parsed = parsePage(fetched);
  const normalized = normalizeContent(fetched.body || "");
  const textLength = normalized.text.length;
  const httpPass = Boolean(fetched.ok && fetched.status >= 200 && fetched.status < 400);
  const htmlPass = Boolean(parsed.title) && textLength >= 50;
  const keywords = parsed.keywords || candidate.detected_keywords || [];

  let verdict = "FAIL";
  let reason = "取得または解析に失敗";
  if (!httpPass) {
    reason = "HTTP取得失敗";
  } else if (!htmlPass) {
    reason = "HTML解析不能（title/本文不足）";
  } else if (keywords.length >= 2) {
    verdict = "PASS";
    reason = "運用キーワード検出。Patrol接続可能";
  } else if (keywords.length >= 1) {
    verdict = "WARNING";
    reason = "キーワードが少ない。Review推奨";
  } else {
    verdict = "WARNING";
    reason = "取得成功だが災害キーワードが弱い";
  }

  return {
    candidate_url: candidate.candidate_url,
    verdict: verdict,
    reason: reason,
    http: httpPass ? "PASS" : "FAIL",
    html_parse: htmlPass ? "PASS" : "FAIL",
    text_length: textLength,
    title: parsed.title || "",
    keywords: keywords
  };
}

function pickRecommendedPrimary(candidates, dryRunMap) {
  const operational = candidates.filter(function (candidate) {
    return (
      candidate.recommended_role === "primary" &&
      candidate.discovery_status !== "SKIPPED" &&
      ["emergency_list", "emergency_dashboard", "bousai_portal", "disaster_special"].indexOf(
        candidate.page_type
      ) >= 0
    );
  });

  const pool = operational.length ? operational : candidates;
  const ranked = pool.slice().sort(function (a, b) {
    return b.score - a.score;
  });

  if (!ranked.length) {
    return {
      recommended_primary: "",
      confidence: "LOW",
      dry_run_status: "FAIL"
    };
  }

  const top = ranked[0];
  const dryRun = dryRunMap.get(normalizeUrl(top.candidate_url));
  const dryRunStatus = dryRun ? dryRun.verdict : "UNKNOWN";
  let confidence = top.score_tier || top.confidence || "MEDIUM";
  if (dryRunStatus === "FAIL") {
    confidence = "LOW";
  } else if (dryRunStatus === "PASS" && top.score >= 80) {
    confidence = "HIGH";
  }

  return {
    recommended_primary: top.candidate_url,
    confidence: confidence,
    dry_run_status: dryRunStatus
  };
}

function buildReviewItems(candidates, pipelineRunId, municipality) {
  const registry = loadSourcesRegistry();
  const registeredSources = getRegisteredSources(municipality, registry);
  const items = [];
  let index = 0;

  candidates.forEach(function (candidate) {
    if (candidate.discovery_status === "SKIPPED") {
      return;
    }
    const comparison = classifyRegistryComparison(candidate, registeredSources, candidates);
    if (comparison.classification === "MATCH" || comparison.classification === "FALSE_POSITIVE") {
      return;
    }
    const item = buildReviewQueueItem(candidate, comparison, pipelineRunId, index);
    items.push(item);
    index += 1;
  });

  return items;
}

async function runMunicipalityExpansion(municipalityRecord, options) {
  const fixtureEntry =
    options.fixtureMap && options.fixtureMap[municipalityRecord.municipality]
      ? options.fixtureMap[municipalityRecord.municipality]
      : null;

  const discoveryResult = await discoverPatrolUrls(
    {
      prefecture: municipalityRecord.prefecture,
      municipality: municipalityRecord.municipality,
      official_domain: municipalityRecord.official_domain
    },
    {
      maxCandidates: options.maxCandidates || 12,
      generatedAt: options.generatedAt,
      entryFixtureHtml: fixtureEntry ? fixtureEntry.entry : undefined,
      candidateFixtureMap: fixtureEntry ? fixtureEntry.candidates : undefined,
      analyzeCandidates: true
    }
  );

  if (!discoveryResult.candidates || !discoveryResult.candidates.length) {
    return {
      municipality: municipalityRecord.municipality,
      municipality_id: municipalityRecord.municipality_id,
      prefecture: municipalityRecord.prefecture,
      official_domain: municipalityRecord.official_domain,
      discovery_status: "NO_CANDIDATES",
      patrol_candidates: [],
      recommended_primary: "",
      confidence: "LOW",
      dry_run_status: "FAIL",
      review_items: [],
      sources_registration: "MANUAL_REQUIRED",
      errors: [discoveryResult.reason || "no candidates discovered"]
    };
  }

  const dryRunMap = new Map();
  const topCandidates = discoveryResult.candidates.slice(0, options.dryRunLimit || 5);
  for (let i = 0; i < topCandidates.length; i += 1) {
    const candidate = topCandidates[i];
    const fixtureHtml =
      fixtureEntry && fixtureEntry.candidates
        ? fixtureEntry.candidates[normalizeUrl(candidate.candidate_url)]
        : undefined;
    const dryRun = await analyzeCandidateDryRun(candidate, { fixtureHtml: fixtureHtml });
    dryRunMap.set(normalizeUrl(candidate.candidate_url), dryRun);
  }

  const recommendation = pickRecommendedPrimary(discoveryResult.candidates, dryRunMap);
  const reviewItems = buildReviewItems(
    discoveryResult.candidates,
    options.runId,
    municipalityRecord.municipality
  );

  const patrolCandidates = discoveryResult.candidates.map(function (candidate) {
    return summarizeCandidate(candidate, dryRunMap.get(normalizeUrl(candidate.candidate_url)));
  });

  return {
    municipality: municipalityRecord.municipality,
    municipality_id: municipalityRecord.municipality_id,
    prefecture: municipalityRecord.prefecture,
    official_domain: municipalityRecord.official_domain,
    discovery_status: "COMPLETE",
    discovery_targets: DISCOVERY_TARGET_LABELS.slice(),
    candidate_count: discoveryResult.candidates.length,
    patrol_candidates: patrolCandidates,
    recommended_primary: recommendation.recommended_primary,
    confidence: recommendation.confidence,
    dry_run_status: recommendation.dry_run_status,
    review_items: reviewItems,
    sources_registration: "MANUAL_REQUIRED",
    pipeline_connection: {
      discovery_complete: true,
      dry_run_complete: recommendation.dry_run_status !== "FAIL",
      review_ready: reviewItems.length > 0,
      sources_json_updated: false
    },
    errors: []
  };
}

async function runMunicipalityExpansionFlow(input, options) {
  options = options || {};
  const generatedAt = options.generatedAt || new Date().toISOString();
  const runId = options.runId || buildExpansionRunId(generatedAt);
  const runDir = options.runDir || path.join(RUNS_DIR, runId);
  const errors = [];

  const inputValidation = validateExpansionInput(input);
  if (!inputValidation.valid) {
    return {
      saved: false,
      status: "FAILED",
      errors: inputValidation.errors
    };
  }

  const resolved = resolveSpecifiedMunicipalities(input.municipalities);
  if (!resolved.valid) {
    return {
      saved: false,
      status: "FAILED",
      errors: resolved.errors
    };
  }

  if (resolved.municipalities.length !== input.municipalities.length) {
    errors.push("municipality scope mismatch: auto-discovery or scope change is forbidden");
  }

  const sourcesHashBefore = hashFile(SOURCES_FILE);
  const fixtureMap = loadFixtureMap(options.fixtureMap);

  const municipalityResults = [];
  for (let i = 0; i < resolved.municipalities.length; i += 1) {
    const result = await runMunicipalityExpansion(resolved.municipalities[i], {
      runId: runId,
      generatedAt: generatedAt,
      maxCandidates: options.maxCandidates || 12,
      dryRunLimit: options.dryRunLimit || 5,
      fixtureMap: fixtureMap
    });
    municipalityResults.push(result);
    if (result.errors && result.errors.length) {
      errors.push.apply(errors, result.errors);
    }
  }

  const sourcesHashAfter = hashFile(SOURCES_FILE);
  if (sourcesHashBefore !== sourcesHashAfter) {
    errors.push("sources.json was modified during expansion flow");
  }

  const reviewItems = municipalityResults.reduce(function (all, item) {
    return all.concat(item.review_items || []);
  }, []);

  const flowResult = {
    version: 1,
    run_id: runId,
    portal: input.portal,
    generated_at: generatedAt,
    municipality_count: municipalityResults.length,
    specified_municipalities: input.municipalities.slice(),
    discovery_scope: "PORTAL_SPECIFIED_ONLY",
    municipalities: municipalityResults.map(function (item) {
      return {
        municipality: item.municipality,
        municipality_id: item.municipality_id,
        patrol_candidates: item.patrol_candidates,
        recommended_primary: item.recommended_primary,
        confidence: item.confidence,
        dry_run_status: item.dry_run_status,
        sources_registration: item.sources_registration,
        pipeline_connection: item.pipeline_connection
      };
    }),
    review_queue: {
      item_count: reviewItems.length,
      auto_register: false,
      items: reviewItems
    },
    safety: {
      auto_municipality_discovery: false,
      auto_sources_register: false,
      national_exploration: false,
      sources_json_hash_before: sourcesHashBefore,
      sources_json_hash_after: sourcesHashAfter,
      sources_json_unchanged: sourcesHashBefore === sourcesHashAfter
    },
    status: errors.length === 0 ? "SUCCESS" : "FAILED",
    errors: errors
  };

  ensureDir(runDir);
  const runPath = path.join(runDir, runId + ".json");
  const reviewPath = path.join(runDir, "review_queue.json");

  if (!options.dryRun) {
    writeJson(runPath, flowResult);
    writeJson(reviewPath, {
      version: 1,
      run_id: runId,
      generated_at: generatedAt,
      auto_register: false,
      item_count: reviewItems.length,
      items: reviewItems
    });
  }

  return {
    saved: !options.dryRun,
    dryRun: options.dryRun === true,
    run_id: runId,
    run_path: toRepoRelative(runPath),
    review_path: toRepoRelative(reviewPath),
    result: flowResult,
    errors: errors
  };
}

function validateMunicipalityOutput(item) {
  const errors = [];
  if (!item.municipality) {
    errors.push("municipality required");
  }
  if (!Array.isArray(item.patrol_candidates)) {
    errors.push("patrol_candidates must be array");
  }
  if (typeof item.recommended_primary !== "string") {
    errors.push("recommended_primary must be string");
  }
  if (!item.confidence) {
    errors.push("confidence required");
  }
  if (!item.dry_run_status) {
    errors.push("dry_run_status required");
  }
  return errors;
}

module.exports = {
  EXPANSION_DIR,
  RUNS_DIR,
  REVIEW_DIR,
  ALLOWED_PORTALS,
  DISCOVERY_TARGET_LABELS,
  SOURCES_FILE,
  buildExpansionRunId,
  validateExpansionInput,
  resolveSpecifiedMunicipalities,
  analyzeCandidateDryRun,
  pickRecommendedPrimary,
  runMunicipalityExpansion,
  runMunicipalityExpansionFlow,
  validateMunicipalityOutput,
  validateReviewQueueItem,
  hashFile
};

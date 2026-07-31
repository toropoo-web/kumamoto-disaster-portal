"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const OUTPUT_DIR = path.join(ROOT, "data", "patrol_discovery");
const PIPELINE_TARGETS_FILE = path.join(OUTPUT_DIR, "pipeline_targets.json");
const PIPELINE_RUNS_DIR = path.join(OUTPUT_DIR, "pipeline_runs");
const REPORTS_DIR = path.join(OUTPUT_DIR, "reports");
const REVIEW_DIR = path.join(OUTPUT_DIR, "review");
const REVIEW_QUEUE_FILE = path.join(REVIEW_DIR, "patrol_discovery_review_queue.json");
const SOURCES_FILE = path.join(__dirname, "sources.json");

const CLASSIFICATION_TYPES = ["MATCH", "BETTER_CANDIDATE", "NEW_CANDIDATE", "FALSE_POSITIVE"];

const PAGE_TYPE_PRIORITY = {
  emergency_dashboard: 6,
  emergency_list: 5,
  disaster_special: 4,
  bousai_portal: 3,
  article_list: 2,
  normal_info: 1,
  hazard_map: 0,
  archive: 0,
  pdf: 0
};

const FALSE_POSITIVE_PAGE_TYPES = ["pdf", "hazard_map", "archive", "normal_info"];

const {
  discoverPatrolUrls,
  loadSourcesRegistry,
  normalizeUrl,
  urlMatchesDomain,
  validateDiscoveryCandidate,
  ENGINE_VERSION
} = require("./patrol-url-discovery-engine");

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

function loadPipelineTargets(targetsPath) {
  const filePath = targetsPath || PIPELINE_TARGETS_FILE;
  const data = readJson(filePath, { targets: [] });
  return {
    prefecture: data.prefecture || "熊本県",
    targets: (data.targets || []).map(function (target) {
      return {
        prefecture: target.prefecture || data.prefecture || "熊本県",
        municipality: target.municipality,
        official_domain: target.official_domain,
        area_id: target.area_id || null
      };
    })
  };
}

function validatePipelineTargets(data) {
  const errors = [];
  if (!data || !Array.isArray(data.targets)) {
    return ["targets array missing"];
  }
  if (!data.targets.length) {
    errors.push("targets must not be empty");
  }
  const seen = new Set();
  data.targets.forEach(function (target, index) {
    if (!target.municipality) {
      errors.push("targets[" + index + "]: municipality is required");
    }
    if (!target.official_domain) {
      errors.push("targets[" + index + "]: official_domain is required");
    }
    const key = target.municipality + "|" + target.official_domain;
    if (seen.has(key)) {
      errors.push("targets[" + index + "]: duplicate municipality/domain pair");
    }
    seen.add(key);
  });
  return errors;
}

function getRegisteredSources(municipality, registry) {
  return (registry.municipalities || []).filter(function (source) {
    return source.name === municipality;
  });
}

function isOperationalPageType(pageType) {
  return (
    pageType === "emergency_dashboard" ||
    pageType === "emergency_list" ||
    pageType === "disaster_special" ||
    pageType === "bousai_portal" ||
    pageType === "article_list"
  );
}

function pageTypeRank(pageType) {
  return Object.prototype.hasOwnProperty.call(PAGE_TYPE_PRIORITY, pageType)
    ? PAGE_TYPE_PRIORITY[pageType]
    : 0;
}

function isDisasterPlan(candidate) {
  const haystack = [
    candidate.link_label,
    candidate.candidate_url,
    candidate.page_type,
    candidate.exclusion && candidate.exclusion.exclusion_type
  ]
    .filter(Boolean)
    .join(" ");
  return /防災計画|地域防災計画|災害対策基本計画|disaster_plan|bousaikeikaku/i.test(haystack);
}

function isFalsePositiveCandidate(candidate) {
  if (candidate.exclusion && candidate.exclusion.excluded) {
    return true;
  }
  if (FALSE_POSITIVE_PAGE_TYPES.indexOf(candidate.page_type) >= 0) {
    return true;
  }
  if (isDisasterPlan(candidate)) {
    return true;
  }
  if (candidate.recommended_role === "skip" || candidate.score_tier === "LOW") {
    return true;
  }
  return false;
}

function findRegisteredMatch(candidate, registeredSources) {
  const normalized = normalizeUrl(candidate.candidate_url);
  return registeredSources.find(function (source) {
    return normalizeUrl(source.url) === normalized;
  });
}

function getRegisteredBaseline(registeredSources, candidates) {
  const priorityOrder = ["primary", "secondary"];
  let selectedSource = null;

  priorityOrder.forEach(function (role) {
    if (selectedSource) {
      return;
    }
    selectedSource =
      registeredSources.find(function (source) {
        return source.patrol_role === role;
      }) || null;
  });

  if (!selectedSource) {
    selectedSource = registeredSources[0] || null;
  }
  if (!selectedSource) {
    return null;
  }

  const matchedCandidate = (candidates || []).find(function (item) {
    return normalizeUrl(item.candidate_url) === normalizeUrl(selectedSource.url);
  });

  return {
    source_id: selectedSource.id,
    url: selectedSource.url,
    patrol_role: selectedSource.patrol_role,
    score: matchedCandidate ? matchedCandidate.score : 0,
    page_type: matchedCandidate ? matchedCandidate.page_type : "normal_info"
  };
}

function classifyRegistryComparison(candidate, registeredSources, allCandidates) {
  const registered = findRegisteredMatch(candidate, registeredSources);
  if (registered) {
    return {
      classification: "MATCH",
      matched_source_id: registered.id,
      current_url: registered.url,
      note: "matches existing sources.json entry"
    };
  }

  if (isFalsePositiveCandidate(candidate)) {
    return {
      classification: "FALSE_POSITIVE",
      matched_source_id: null,
      current_url: null,
      note: "excluded page type or low-value candidate"
    };
  }

  const baseline = getRegisteredBaseline(registeredSources, allCandidates);
  const betterByScore = baseline ? candidate.score > baseline.score : candidate.score >= 80;
  const betterByPageType =
    baseline && pageTypeRank(candidate.page_type) > pageTypeRank(baseline.page_type);

  if (isOperationalPageType(candidate.page_type) && (betterByScore || betterByPageType)) {
    return {
      classification: "BETTER_CANDIDATE",
      matched_source_id: baseline ? baseline.source_id : null,
      current_url: baseline ? baseline.url : null,
      note: betterByPageType
        ? "higher page_type priority than registered baseline"
        : "higher score than registered baseline"
    };
  }

  if (
    isOperationalPageType(candidate.page_type) &&
    candidate.score >= 80 &&
    candidate.recommended_role !== "skip"
  ) {
    return {
      classification: "NEW_CANDIDATE",
      matched_source_id: null,
      current_url: baseline ? baseline.url : null,
      note: "unregistered operational page with score >= 80"
    };
  }

  return {
    classification: "FALSE_POSITIVE",
    matched_source_id: null,
    current_url: baseline ? baseline.url : null,
    note: "does not meet NEW_CANDIDATE or BETTER_CANDIDATE thresholds"
  };
}

function buildPipelineRunId(generatedAt) {
  const stamp = (generatedAt || new Date().toISOString()).replace(/[:.]/g, "-");
  return "PDP-" + stamp;
}

function buildReviewId(municipality, candidateUrl, index) {
  const digest = crypto
    .createHash("sha256")
    .update([municipality, candidateUrl, String(index)].join("|"))
    .digest("hex")
    .slice(0, 6)
    .toUpperCase();
  return "PRD-" + String(index + 1).padStart(3, "0") + "-" + digest;
}

function buildReviewQueueItem(candidate, comparison, pipelineRunId, index) {
  const trace = candidate.source_trace || {};
  const discoveryMethods = trace.discovery_methods || [];
  return {
    review_id: buildReviewId(candidate.municipality, candidate.candidate_url, index),
    municipality: candidate.municipality,
    candidate_url: candidate.candidate_url,
    current_url: comparison.current_url || null,
    classification: comparison.classification,
    page_type: candidate.page_type,
    score: candidate.score,
    score_tier: candidate.score_tier,
    recommended_role: candidate.recommended_role,
    detected_keywords: Array.isArray(candidate.detected_keywords)
      ? candidate.detected_keywords.slice()
      : [],
    decision: {
      status: "PENDING",
      reviewer: "",
      reviewed_at: "",
      review_note: ""
    },
    auto_register: false,
    review_required: true,
    source_trace: {
      pipeline_run_id: pipelineRunId,
      discovery_method: discoveryMethods[0] || "entry_link",
      discovery_methods: discoveryMethods,
      cms_pattern: trace.cms_pattern || null,
      crawl_depth: typeof trace.crawl_depth === "number" ? trace.crawl_depth : null,
      candidate_score: candidate.score,
      discovered_from: trace.discovered_from || candidate.entry_url || null,
      discovery_id: candidate.discovery_id || null,
      official_domain: candidate.official_domain || null
    }
  };
}

function validateReviewQueueItem(item) {
  const errors = [];
  const required = [
    "review_id",
    "municipality",
    "candidate_url",
    "classification",
    "decision",
    "auto_register",
    "review_required",
    "source_trace"
  ];
  required.forEach(function (key) {
    if (!Object.prototype.hasOwnProperty.call(item, key)) {
      errors.push("missing field: " + key);
    }
  });
  if (item.auto_register !== false) {
    errors.push("auto_register must be false");
  }
  if (item.review_required !== true) {
    errors.push("review_required must be true");
  }
  if (!item.decision || item.decision.status !== "PENDING") {
    errors.push("decision.status must be PENDING");
  }
  if (!item.source_trace || !item.source_trace.pipeline_run_id) {
    errors.push("source_trace.pipeline_run_id is required");
  }
  if (CLASSIFICATION_TYPES.indexOf(item.classification) < 0) {
    errors.push("invalid classification: " + item.classification);
  }
  return errors;
}

function validatePipelineRun(run) {
  const errors = [];
  if (!run || !run.pipeline_run_id) {
    errors.push("pipeline_run_id missing");
  }
  if (!Array.isArray(run.municipalities)) {
    errors.push("municipalities array missing");
    return errors;
  }

  const seenUrls = new Set();
  run.municipalities.forEach(function (municipalityResult, municipalityIndex) {
    (municipalityResult.candidates || []).forEach(function (candidate, candidateIndex) {
      const candidateErrors = validateDiscoveryCandidate(candidate);
      candidateErrors.forEach(function (message) {
        errors.push(
          "municipalities[" + municipalityIndex + "].candidates[" + candidateIndex + "]: " + message
        );
      });

      if (!urlMatchesDomain(candidate.candidate_url, municipalityResult.official_domain)) {
        errors.push(
          "municipalities[" +
            municipalityIndex +
            "].candidates[" +
            candidateIndex +
            "]: candidate_url outside official_domain"
        );
      }

      const normalized = normalizeUrl(candidate.candidate_url);
      if (seenUrls.has(normalized)) {
        errors.push("duplicate candidate_url: " + normalized);
      }
      seenUrls.add(normalized);

      if (!candidate.source_trace || !candidate.source_trace.discovered_from) {
        errors.push(
          "municipalities[" +
            municipalityIndex +
            "].candidates[" +
            candidateIndex +
            "]: source_trace incomplete"
        );
      }
    });
  });

  return errors;
}

function analyzePrimaryCoverage(registeredSources, classifiedCandidates) {
  const primarySources = registeredSources.filter(function (source) {
    return source.patrol_role === "primary";
  });
  const primaryMatches = primarySources.map(function (source) {
    const match = classifiedCandidates.find(function (item) {
      return item.classification === "MATCH" && item.matched_source_id === source.id;
    });
    return {
      source_id: source.id,
      url: source.url,
      discovered: Boolean(match)
    };
  });
  return {
    primary_total: primarySources.length,
    primary_discovered: primaryMatches.filter(function (item) {
      return item.discovered;
    }).length,
    primary_matches: primaryMatches
  };
}

function buildMunicipalityResult(target, discoveryResult, registeredSources, pipelineRunId) {
  const candidates = discoveryResult.candidates || [];
  const classified = candidates.map(function (candidate) {
    const comparison = classifyRegistryComparison(candidate, registeredSources, candidates);
    return Object.assign({}, candidate, {
      classification: comparison.classification,
      matched_source_id: comparison.matched_source_id,
      current_url: comparison.current_url,
      classification_note: comparison.note
    });
  });

  const comparisonSummary = {
    MATCH: 0,
    BETTER_CANDIDATE: 0,
    NEW_CANDIDATE: 0,
    FALSE_POSITIVE: 0
  };
  classified.forEach(function (item) {
    comparisonSummary[item.classification] = (comparisonSummary[item.classification] || 0) + 1;
  });

  return {
    municipality: target.municipality,
    area_id: discoveryResult.area_id || target.area_id,
    official_domain: target.official_domain,
    prefecture: target.prefecture,
    entry_url: discoveryResult.entry_url,
    candidate_count: classified.length,
    link_count: discoveryResult.linkCount,
    registered_source_count: registeredSources.length,
    comparison_summary: comparisonSummary,
    primary_coverage: analyzePrimaryCoverage(registeredSources, classified),
    candidates: classified
  };
}

function buildReviewQueue(municipalityResults, pipelineRunId) {
  const items = [];
  let reviewIndex = 0;

  municipalityResults.forEach(function (municipalityResult) {
    (municipalityResult.candidates || []).forEach(function (candidate) {
      if (
        candidate.classification !== "BETTER_CANDIDATE" &&
        candidate.classification !== "NEW_CANDIDATE"
      ) {
        return;
      }
      items.push(
        buildReviewQueueItem(
          candidate,
          {
            classification: candidate.classification,
            current_url: candidate.current_url
          },
          pipelineRunId,
          reviewIndex
        )
      );
      reviewIndex += 1;
    });
  });

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    pipeline_run_id: pipelineRunId,
    item_count: items.length,
    auto_register: false,
    items: items
  };
}

function collectByClassification(municipalityResults, classification) {
  const rows = [];
  municipalityResults.forEach(function (municipalityResult) {
    (municipalityResult.candidates || []).forEach(function (candidate) {
      if (candidate.classification !== classification) {
        return;
      }
      rows.push({
        municipality: municipalityResult.municipality,
        candidate_url: candidate.candidate_url,
        current_url: candidate.current_url || null,
        classification: candidate.classification,
        page_type: candidate.page_type,
        score: candidate.score,
        score_tier: candidate.score_tier,
        recommended_role: candidate.recommended_role,
        matched_source_id: candidate.matched_source_id || null,
        classification_note: candidate.classification_note || null,
        source_trace: candidate.source_trace || null
      });
    });
  });
  return rows;
}

function buildPipelineSummary(run) {
  const totals = {
    municipalities: run.municipalities.length,
    candidates: 0,
    MATCH: 0,
    BETTER_CANDIDATE: 0,
    NEW_CANDIDATE: 0,
    FALSE_POSITIVE: 0,
    primary_discovered: 0,
    primary_total: 0,
    review_queue_items: run.review_queue_item_count || 0
  };

  run.municipalities.forEach(function (result) {
    totals.candidates += result.candidate_count || 0;
    if (result.comparison_summary) {
      totals.MATCH += result.comparison_summary.MATCH || 0;
      totals.BETTER_CANDIDATE += result.comparison_summary.BETTER_CANDIDATE || 0;
      totals.NEW_CANDIDATE += result.comparison_summary.NEW_CANDIDATE || 0;
      totals.FALSE_POSITIVE += result.comparison_summary.FALSE_POSITIVE || 0;
    }
    if (result.primary_coverage) {
      totals.primary_discovered += result.primary_coverage.primary_discovered || 0;
      totals.primary_total += result.primary_coverage.primary_total || 0;
    }
  });

  return {
    version: 1,
    generatedAt: run.generatedAt,
    pipeline_run_id: run.pipeline_run_id,
    engine_version: run.engine_version,
    PATROL_DISCOVERY_PIPELINE: run.errors && run.errors.length ? "FAIL" : "PASS",
    primary_discovery_rate:
      totals.primary_total > 0
        ? Number((totals.primary_discovered / totals.primary_total).toFixed(3))
        : 0,
    false_positive_rate:
      totals.candidates > 0
        ? Number((totals.FALSE_POSITIVE / totals.candidates).toFixed(3))
        : 0,
    totals: totals,
    errors: run.errors || []
  };
}

async function runPatrolDiscoveryPipeline(options) {
  options = options || {};
  const generatedAt = options.generatedAt || new Date().toISOString();
  const pipelineRunId = options.pipelineRunId || buildPipelineRunId(generatedAt);
  const targetData = loadPipelineTargets(options.targetsPath);
  const targetErrors = validatePipelineTargets(targetData);
  if (targetErrors.length) {
    return {
      saved: false,
      pipeline_run_id: pipelineRunId,
      reason: "pipeline target validation failed",
      errors: targetErrors,
      municipalities: []
    };
  }

  const registry = loadSourcesRegistry();
  const municipalityResults = [];
  const errors = targetErrors.slice();
  const targets = targetData.targets.filter(function (target) {
    if (options.fixtureMap) {
      return Boolean(options.fixtureMap[target.municipality]);
    }
    return true;
  });

  for (let i = 0; i < targets.length; i += 1) {
    const target = targets[i];
    const registeredSources = getRegisteredSources(target.municipality, registry);
    const input = {
      prefecture: target.prefecture,
      municipality: target.municipality,
      official_domain: target.official_domain
    };

    try {
      const discoveryResult = await discoverPatrolUrls(input, {
        dryRun: true,
        maxCandidates: options.maxCandidates || 15,
        entryFixtureHtml:
          options.fixtureMap && options.fixtureMap[target.municipality]
            ? options.fixtureMap[target.municipality].entry
            : undefined,
        candidateFixtureMap:
          options.fixtureMap && options.fixtureMap[target.municipality]
            ? options.fixtureMap[target.municipality].candidates
            : undefined
      });

      if (discoveryResult.reason && !(discoveryResult.candidates || []).length) {
        errors.push(target.municipality + ": " + discoveryResult.reason);
        municipalityResults.push({
          municipality: target.municipality,
          official_domain: target.official_domain,
          error: discoveryResult.reason,
          candidate_count: 0,
          candidates: []
        });
        continue;
      }

      municipalityResults.push(
        buildMunicipalityResult(target, discoveryResult, registeredSources, pipelineRunId)
      );
    } catch (err) {
      errors.push(target.municipality + ": " + err.message);
      municipalityResults.push({
        municipality: target.municipality,
        official_domain: target.official_domain,
        error: err.message,
        candidate_count: 0,
        candidates: []
      });
    }
  }

  const reviewQueue = buildReviewQueue(municipalityResults, pipelineRunId);
  const run = {
    version: 1,
    generatedAt: generatedAt,
    pipeline_run_id: pipelineRunId,
    engine_version: ENGINE_VERSION,
    mode: options.live ? "LIVE" : "DRY_RUN",
    targets_file: toRepoRelative(options.targetsPath || PIPELINE_TARGETS_FILE),
    sources_registry_file: toRepoRelative(SOURCES_FILE),
    auto_register: false,
    review_queue_item_count: reviewQueue.items.length,
    municipalities: municipalityResults,
    errors: errors
  };

  const summary = buildPipelineSummary(run);
  const reports = {
    summary: summary,
    better_candidates: {
      version: 1,
      generatedAt: generatedAt,
      pipeline_run_id: pipelineRunId,
      count: collectByClassification(municipalityResults, "BETTER_CANDIDATE").length,
      items: collectByClassification(municipalityResults, "BETTER_CANDIDATE")
    },
    new_candidates: {
      version: 1,
      generatedAt: generatedAt,
      pipeline_run_id: pipelineRunId,
      count: collectByClassification(municipalityResults, "NEW_CANDIDATE").length,
      items: collectByClassification(municipalityResults, "NEW_CANDIDATE")
    },
    false_positive: {
      version: 1,
      generatedAt: generatedAt,
      pipeline_run_id: pipelineRunId,
      count: collectByClassification(municipalityResults, "FALSE_POSITIVE").length,
      items: collectByClassification(municipalityResults, "FALSE_POSITIVE")
    }
  };

  const validationErrors = validatePipelineRun(run);
  if (validationErrors.length) {
    errors.push.apply(errors, validationErrors);
    run.errors = errors;
    summary.PATROL_DISCOVERY_PIPELINE = "FAIL";
    summary.errors = errors;
  }

  reviewQueue.items.forEach(function (item, index) {
    const itemErrors = validateReviewQueueItem(item);
    itemErrors.forEach(function (message) {
      errors.push("review_queue.items[" + index + "]: " + message);
    });
  });

  if (!options.dryRunOutput) {
    ensureDir(PIPELINE_RUNS_DIR);
    ensureDir(REPORTS_DIR);
    ensureDir(REVIEW_DIR);
    const runFile = path.join(PIPELINE_RUNS_DIR, "run-" + generatedAt.replace(/[:.]/g, "-") + ".json");
    writeJson(runFile, run);
    writeJson(path.join(REPORTS_DIR, "summary.json"), reports.summary);
    writeJson(path.join(REPORTS_DIR, "better_candidates.json"), reports.better_candidates);
    writeJson(path.join(REPORTS_DIR, "new_candidates.json"), reports.new_candidates);
    writeJson(path.join(REPORTS_DIR, "false_positive.json"), reports.false_positive);
    writeJson(REVIEW_QUEUE_FILE, reviewQueue);
    run.output_files = {
      run: toRepoRelative(runFile),
      summary: toRepoRelative(path.join(REPORTS_DIR, "summary.json")),
      better_candidates: toRepoRelative(path.join(REPORTS_DIR, "better_candidates.json")),
      new_candidates: toRepoRelative(path.join(REPORTS_DIR, "new_candidates.json")),
      false_positive: toRepoRelative(path.join(REPORTS_DIR, "false_positive.json")),
      review_queue: toRepoRelative(REVIEW_QUEUE_FILE)
    };
  }

  return {
    saved: !options.dryRunOutput,
    dryRunOutput: options.dryRunOutput === true,
    pipeline_run_id: pipelineRunId,
    run: run,
    summary: summary,
    reports: reports,
    review_queue: reviewQueue,
    errors: errors
  };
}

module.exports = {
  CLASSIFICATION_TYPES,
  PAGE_TYPE_PRIORITY,
  FALSE_POSITIVE_PAGE_TYPES,
  OUTPUT_DIR,
  PIPELINE_TARGETS_FILE,
  PIPELINE_RUNS_DIR,
  REPORTS_DIR,
  REVIEW_DIR,
  REVIEW_QUEUE_FILE,
  SOURCES_FILE,
  loadPipelineTargets,
  validatePipelineTargets,
  getRegisteredSources,
  isOperationalPageType,
  pageTypeRank,
  isFalsePositiveCandidate,
  classifyRegistryComparison,
  buildReviewQueueItem,
  validateReviewQueueItem,
  validatePipelineRun,
  buildPipelineSummary,
  runPatrolDiscoveryPipeline
};

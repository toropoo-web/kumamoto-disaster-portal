"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const OUTPUT_DIR = path.join(ROOT, "data", "patrol_discovery");
const TARGETS_FILE = path.join(OUTPUT_DIR, "accuracy-targets.json");
const ACCURACY_REPORT_FILE = path.join(OUTPUT_DIR, "accuracy-report.json");
const ACCURACY_SUMMARY_FILE = path.join(OUTPUT_DIR, "accuracy-summary.json");

const COMPARISON_TYPES = ["MATCH", "BETTER_CANDIDATE", "FALSE_POSITIVE", "NEW_CANDIDATE"];

const {
  discoverPatrolUrls,
  loadSourcesRegistry,
  normalizeUrl,
  scoreTier
} = require("./patrol-url-discovery-engine");

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function loadAccuracyTargets(targetsPath) {
  const filePath = targetsPath || TARGETS_FILE;
  const data = readJson(filePath, { targets: [] });
  return (data.targets || []).map(function (target) {
    return {
      prefecture: data.prefecture || "熊本県",
      municipality: target.municipality,
      official_domain: target.official_domain,
      area_id: target.area_id || null
    };
  });
}

function getRegisteredSources(municipality, registry) {
  return (registry.municipalities || []).filter(function (source) {
    return source.name === municipality;
  });
}

function buildDiscoveryInput(target) {
  return {
    prefecture: target.prefecture,
    municipality: target.municipality,
    official_domain: target.official_domain
  };
}

function isOperationalPageType(pageType) {
  return (
    pageType === "disaster_special" ||
    pageType === "emergency_list" ||
    pageType === "bousai_portal" ||
    pageType === "emergency_dashboard" ||
    pageType === "article_list"
  );
}

function classifyCandidateComparison(candidate, registeredSources) {
  const normalized = normalizeUrl(candidate.candidate_url);
  const registered = registeredSources.find(function (source) {
    return normalizeUrl(source.url) === normalized;
  });

  if (registered) {
    return {
      comparison: "MATCH",
      matched_source_id: registered.id,
      matched_patrol_role: registered.patrol_role,
      note: "matches existing sources.json entry"
    };
  }

  if (candidate.exclusion && candidate.exclusion.excluded) {
    return {
      comparison: "FALSE_POSITIVE",
      matched_source_id: null,
      note: candidate.exclusion.exclusion_reason
    };
  }

  if (candidate.recommended_role === "skip" || candidate.score_tier === "LOW") {
    return {
      comparison: "FALSE_POSITIVE",
      matched_source_id: null,
      note: "low-value page or excluded by recommended_role"
    };
  }

  if (
    candidate.score >= 80 &&
    isOperationalPageType(candidate.page_type) &&
    candidate.recommended_role !== "skip"
  ) {
    return {
      comparison: "BETTER_CANDIDATE",
      matched_source_id: null,
      note: "high-score operational page not yet registered"
    };
  }

  return {
    comparison: "NEW_CANDIDATE",
    matched_source_id: null,
    note: "valid candidate for manual review"
  };
}

function analyzeRegisteredCoverage(registeredSources, candidates, comparisons) {
  const primarySources = registeredSources.filter(function (source) {
    return source.patrol_role === "primary";
  });
  const primaryMatches = primarySources.map(function (source) {
    const match = comparisons.find(function (item) {
      return item.comparison === "MATCH" && item.matched_source_id === source.id;
    });
    return {
      source_id: source.id,
      url: source.url,
      discovered: Boolean(match),
      comparison: match ? match.comparison : null
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

function analyzeScoreTiers(candidates) {
  const summary = { HIGH: 0, MEDIUM: 0, LOW: 0 };
  const highSamples = [];
  const mediumSamples = [];
  const lowSamples = [];

  candidates.forEach(function (candidate) {
    summary[candidate.score_tier] = (summary[candidate.score_tier] || 0) + 1;
    const sample = {
      candidate_url: candidate.candidate_url,
      score: candidate.score,
      page_type: candidate.page_type,
      recommended_role: candidate.recommended_role
    };
    if (candidate.score_tier === "HIGH") {
      highSamples.push(sample);
    } else if (candidate.score_tier === "MEDIUM") {
      mediumSamples.push(sample);
    } else {
      lowSamples.push(sample);
    }
  });

  const highOperationalPass = highSamples.every(function (item) {
    return isOperationalPageType(item.page_type);
  });

  const mediumSupportPass = mediumSamples.every(function (item) {
    return (
      item.page_type === "article_list" ||
      item.page_type === "disaster_special" ||
      item.page_type === "bousai_portal" ||
      item.recommended_role === "secondary"
    );
  });

  const lowSkipPass = lowSamples.every(function (item) {
    return item.recommended_role === "skip" || !isOperationalPageType(item.page_type);
  });

  return {
    summary: summary,
    high_operational_pass: highOperationalPass,
    medium_support_pass: mediumSamples.length === 0 ? true : mediumSupportPass,
    low_skip_pass: lowSamples.length === 0 ? true : lowSkipPass,
    high_samples: highSamples.slice(0, 5),
    medium_samples: mediumSamples.slice(0, 5),
    low_samples: lowSamples.slice(0, 5)
  };
}

function analyzeFalsePositiveExclusion(candidates) {
  const excluded = candidates.filter(function (candidate) {
    return candidate.exclusion && candidate.exclusion.excluded;
  });
  const exclusionTypes = {};
  excluded.forEach(function (candidate) {
    const type = candidate.exclusion.exclusion_type || "UNKNOWN";
    exclusionTypes[type] = (exclusionTypes[type] || 0) + 1;
  });

  const skippedStatuses = candidates.filter(function (candidate) {
    return candidate.discovery_status === "SKIPPED";
  });

  return {
    excluded_count: excluded.length,
    skipped_status_count: skippedStatuses.length,
    exclusion_types: exclusionTypes,
    all_marked_skip: excluded.every(function (candidate) {
      return candidate.recommended_role === "skip";
    })
  };
}

function analyzeMunicipalityResult(target, discoveryResult, registeredSources) {
  const candidates = discoveryResult.candidates || [];
  const comparisons = candidates.map(function (candidate) {
    const comparison = classifyCandidateComparison(candidate, registeredSources);
    return Object.assign(
      {
        discovery_id: candidate.discovery_id,
        candidate_url: candidate.candidate_url,
        score: candidate.score,
        score_tier: candidate.score_tier,
        page_type: candidate.page_type,
        detected_keywords: candidate.detected_keywords,
        recommended_role: candidate.recommended_role,
        discovery_status: candidate.discovery_status
      },
      comparison
    );
  });

  const comparisonSummary = {
    MATCH: 0,
    BETTER_CANDIDATE: 0,
    FALSE_POSITIVE: 0,
    NEW_CANDIDATE: 0
  };
  comparisons.forEach(function (item) {
    comparisonSummary[item.comparison] = (comparisonSummary[item.comparison] || 0) + 1;
  });

  const coverage = analyzeRegisteredCoverage(registeredSources, candidates, comparisons);
  const scoreAnalysis = analyzeScoreTiers(candidates);
  const exclusionAnalysis = analyzeFalsePositiveExclusion(candidates);

  return {
    municipality: target.municipality,
    area_id: target.area_id,
    official_domain: target.official_domain,
    entry_url: discoveryResult.entry_url,
    candidate_count: candidates.length,
    link_count: discoveryResult.linkCount,
    registered_source_count: registeredSources.length,
    comparison_summary: comparisonSummary,
    primary_coverage: coverage,
    score_analysis: scoreAnalysis,
    exclusion_analysis: exclusionAnalysis,
    candidates: comparisons
  };
}

async function runAccuracyValidation(options) {
  options = options || {};
  const targets = loadAccuracyTargets(options.targetsPath).filter(function (target) {
    if (options.fixtureMap) {
      return Boolean(options.fixtureMap[target.municipality]);
    }
    return true;
  });
  const registry = loadSourcesRegistry();
  const municipalityResults = [];
  const errors = [];

  for (let i = 0; i < targets.length; i += 1) {
    const target = targets[i];
    const input = buildDiscoveryInput(target);
    const registeredSources = getRegisteredSources(target.municipality, registry);

    try {
      const discoveryResult = await discoverPatrolUrls(input, {
        dryRun: true,
        maxCandidates: options.maxCandidates || 15,
        entryFixtureHtml: options.fixtureMap && options.fixtureMap[target.municipality] ? options.fixtureMap[target.municipality].entry : undefined,
        candidateFixtureMap: options.fixtureMap && options.fixtureMap[target.municipality] ? options.fixtureMap[target.municipality].candidates : undefined
      });

      if (discoveryResult.reason && !discoveryResult.candidates.length) {
        errors.push(target.municipality + ": " + discoveryResult.reason);
        municipalityResults.push({
          municipality: target.municipality,
          error: discoveryResult.reason,
          candidate_count: 0
        });
        continue;
      }

      municipalityResults.push(analyzeMunicipalityResult(target, discoveryResult, registeredSources));
    } catch (err) {
      errors.push(target.municipality + ": " + err.message);
      municipalityResults.push({
        municipality: target.municipality,
        error: err.message,
        candidate_count: 0
      });
    }
  }

  const totals = {
    municipalities: municipalityResults.length,
    candidates: 0,
    MATCH: 0,
    BETTER_CANDIDATE: 0,
    FALSE_POSITIVE: 0,
    NEW_CANDIDATE: 0,
    primary_discovered: 0,
    primary_total: 0,
    excluded: 0
  };

  municipalityResults.forEach(function (result) {
    totals.candidates += result.candidate_count || 0;
    if (result.comparison_summary) {
      totals.MATCH += result.comparison_summary.MATCH || 0;
      totals.BETTER_CANDIDATE += result.comparison_summary.BETTER_CANDIDATE || 0;
      totals.FALSE_POSITIVE += result.comparison_summary.FALSE_POSITIVE || 0;
      totals.NEW_CANDIDATE += result.comparison_summary.NEW_CANDIDATE || 0;
    }
    if (result.primary_coverage) {
      totals.primary_discovered += result.primary_coverage.primary_discovered || 0;
      totals.primary_total += result.primary_coverage.primary_total || 0;
    }
    if (result.exclusion_analysis) {
      totals.excluded += result.exclusion_analysis.excluded_count || 0;
    }
  });

  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    incidentScope: "2026_KUMAMOTO_EARTHQUAKE",
    mode: options.live ? "LIVE" : "DRY_RUN",
    targetsFile: path.relative(ROOT, options.targetsPath || TARGETS_FILE).split(path.sep).join("/"),
    totals: totals,
    municipalities: municipalityResults,
    errors: errors
  };

  const summary = {
    version: 1,
    generatedAt: report.generatedAt,
    PATROL_DISCOVERY_ACCURACY: errors.length ? "FAIL" : "PASS",
    primary_discovery_rate:
      totals.primary_total > 0
        ? Number((totals.primary_discovered / totals.primary_total).toFixed(3))
        : 0,
    totals: totals,
    municipality_count: municipalityResults.length,
    errors: errors
  };

  if (!options.dryRunOutput) {
    ensureDir(OUTPUT_DIR);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    writeJson(path.join(OUTPUT_DIR, "accuracy-report-" + stamp + ".json"), report);
    writeJson(ACCURACY_REPORT_FILE, report);
    writeJson(ACCURACY_SUMMARY_FILE, summary);
  }

  return {
    report: report,
    summary: summary
  };
}

module.exports = {
  COMPARISON_TYPES,
  TARGETS_FILE,
  ACCURACY_REPORT_FILE,
  ACCURACY_SUMMARY_FILE,
  loadAccuracyTargets,
  getRegisteredSources,
  classifyCandidateComparison,
  analyzeMunicipalityResult,
  runAccuracyValidation
};

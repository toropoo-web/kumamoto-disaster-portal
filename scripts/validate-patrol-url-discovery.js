#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const FIXTURE_HUB = path.join(
  ROOT,
  "monitor",
  "fixtures",
  "patrol-url-discovery",
  "uto-emergency-hub.html"
);
const FIXTURE_WATER = path.join(
  ROOT,
  "monitor",
  "fixtures",
  "patrol-url-discovery",
  "uto-water-page.html"
);

const SAMPLE_INPUT = {
  prefecture: "熊本県",
  municipality: "宇土市",
  official_domain: "city.uto.lg.jp"
};

const {
  extractDiscoveryLinks,
  extractInternalLinks,
  detectCmsPattern,
  collectDiscoveryLinks,
  inferPublicCategory,
  inferPatrolRole,
  buildPatrolCandidate,
  validateDiscoveryCandidate,
  validateDiscoveryBatch,
  buildDiscoveryBatch,
  resolveDiscoveryTarget,
  discoverPatrolUrls,
  validateDiscoveryInput,
  calculateCandidateScore,
  normalizeUrl,
  inferPageType,
  ENGINE_VERSION,
  PAGE_TYPES,
  SOURCES_FILE
} = require("../monitor/patrol-url-discovery-engine");

function main() {
  const errors = [];
  const checks = [];

  const modulePath = path.join(ROOT, "monitor", "patrol-url-discovery-engine.js");
  const scriptPath = path.join(ROOT, "scripts", "discover-patrol-url.js");
  checks.push({ check: "monitor/patrol-url-discovery-engine.js exists", pass: fs.existsSync(modulePath) });
  checks.push({ check: "scripts/discover-patrol-url.js exists", pass: fs.existsSync(scriptPath) });

  const inputErrors = validateDiscoveryInput(SAMPLE_INPUT);
  checks.push({ check: "input schema validation", pass: inputErrors.length === 0 });
  if (inputErrors.length) {
    errors.push.apply(errors, inputErrors);
  }

  const hubHtml = fs.readFileSync(FIXTURE_HUB, "utf8");
  const links = extractDiscoveryLinks(
    hubHtml,
    "https://www.city.uto.lg.jp/article/list/1014.html",
    "city.uto.lg.jp"
  );
  const linksPass =
    links.length >= 3 &&
    links.some(function (item) {
      return item.url.indexOf("16317.html") >= 0;
    });
  checks.push({ check: "fixture link extraction", pass: linksPass });
  if (!linksPass) {
    errors.push("fixture link extraction failed");
  }

  const internalLinks = extractInternalLinks(
    hubHtml,
    "https://www.city.uto.lg.jp/article/list/1014.html",
    "city.uto.lg.jp"
  );
  const internalPass = internalLinks.length >= 4;
  checks.push({ check: "internal link extraction includes non-disaster links", pass: internalPass });
  if (!internalPass) {
    errors.push("internal link extraction failed");
  }

  const cmsPass =
    detectCmsPattern("https://www.city.uto.lg.jp/article/list/1014.html") === "CMS_A" &&
    detectCmsPattern("https://www.town.tsunagi.lg.jp/kinkyu/pub/default.aspx") === "CMS_B";
  checks.push({ check: "CMS pattern detection", pass: cmsPass });
  if (!cmsPass) {
    errors.push("CMS pattern detection failed");
  }

  const disasterSpecialType = inferPageType(
    {
      label: "令和8年熊本地震 被害状況",
      url: "https://www.city.uto.lg.jp/saigai/2026/index.html",
      matched_hints: ["地震"]
    },
    { title: "被害状況", keywords: ["地震"] }
  );
  checks.push({ check: "disaster_special page_type inference", pass: disasterSpecialType === "disaster_special" });
  if (disasterSpecialType !== "disaster_special") {
    errors.push("disaster_special page_type inference failed");
  }

  const pageTypesPass = PAGE_TYPES.indexOf("emergency_list") >= 0 && PAGE_TYPES.indexOf("pdf") >= 0;
  checks.push({ check: "v2 page_type enum", pass: pageTypesPass });
  if (!pageTypesPass) {
    errors.push("v2 page_type enum missing values");
  }

  const waterLink = links.find(function (item) {
    return item.url.indexOf("16317.html") >= 0;
  });
  const categoryInfo = inferPublicCategory(waterLink, "水道の復旧状況について");
  const categoryPass = categoryInfo.public_category_id === "WATER";
  checks.push({ check: "WATER category inference", pass: categoryPass });
  if (!categoryPass) {
    errors.push("WATER category inference failed");
  }

  const target = resolveDiscoveryTarget(SAMPLE_INPUT);
  const targetPass =
    target.found === true &&
    target.area_id === "KM002" &&
    target.official_domain === "city.uto.lg.jp";
  checks.push({ check: "discovery target resolution", pass: targetPass });
  if (!targetPass) {
    errors.push("discovery target resolution failed");
  }

  const analysis = {
    verdict: "PASS",
    reason: "fixture",
    keywords: ["断水", "復旧"],
    content_hash: "fixture-hash",
    contamination_risk: false
  };
  const score = calculateCandidateScore(waterLink, analysis, categoryInfo, target);
  const scorePass = score >= 40 && score <= 100;
  checks.push({ check: "candidate score calculation", pass: scorePass, score: score });
  if (!scorePass) {
    errors.push("candidate score calculation failed");
  }

  const candidate = buildPatrolCandidate(target, waterLink, analysis, {
    discoveredAt: "2026-07-31T00:00:00.000Z"
  });
  const candidateErrors = validateDiscoveryCandidate(candidate);
  checks.push({
    check: "discovery candidate schema",
    pass: candidateErrors.length === 0,
    candidateErrors: candidateErrors
  });
  if (candidateErrors.length) {
    errors.push.apply(errors, candidateErrors);
  }

  const fieldsPass =
    candidate.page_type &&
    candidate.recommended_role &&
    Array.isArray(candidate.detected_keywords) &&
    candidate.score_tier;
  checks.push({ check: "page_type/recommended_role/detected_keywords present", pass: fieldsPass });
  if (!fieldsPass) {
    errors.push("extended candidate fields missing");
  }

  const autoRegisterPass = candidate.auto_register === false;
  checks.push({ check: "auto_register disabled", pass: autoRegisterPass });
  if (!autoRegisterPass) {
    errors.push("auto_register must be false");
  }

  const registeredPass = candidate.discovery_status === "ALREADY_REGISTERED";
  checks.push({ check: "existing URL detected as ALREADY_REGISTERED", pass: registeredPass });
  if (!registeredPass) {
    errors.push("existing URL should be ALREADY_REGISTERED");
  }

  const batch = buildDiscoveryBatch([candidate], {
    input: SAMPLE_INPUT,
    municipality: target.municipality,
    area_id: target.area_id,
    entry_url: target.entry_url
  });
  const batchErrors = validateDiscoveryBatch(batch);
  checks.push({ check: "discovery batch validation", pass: batchErrors.length === 0 });
  if (batchErrors.length) {
    errors.push.apply(errors, batchErrors);
  }

  const versionPass = batch.version === ENGINE_VERSION;
  checks.push({ check: "discovery batch engine version", pass: versionPass, version: batch.version });
  if (!versionPass) {
    errors.push("discovery batch version mismatch");
  }

  const sourcesBefore = fs.readFileSync(SOURCES_FILE, "utf8");
  return discoverPatrolUrls(SAMPLE_INPUT, {
    dryRun: true,
    entryFixtureHtml: hubHtml,
    candidateFixtureMap: {
      [normalizeUrl("https://www.city.uto.lg.jp/article/view/1014/16317.html")]: fs.readFileSync(
        FIXTURE_WATER,
        "utf8"
      )
    },
    maxCandidates: 4
  }).then(function (discoveryResult) {
    const discoveryPass =
      discoveryResult.dryRun === true &&
      discoveryResult.candidateCount >= 3 &&
      discoveryResult.alreadyRegisteredCount >= 1;
    checks.push({ check: "fixture discovery dry-run", pass: discoveryPass });
    if (!discoveryPass) {
      errors.push("fixture discovery dry-run failed");
    }

    const tracePass = (discoveryResult.candidates || []).every(function (item) {
      return item.source_trace && item.source_trace.discovered_from;
    });
    checks.push({ check: "source_trace preserved", pass: tracePass });
    if (!tracePass) {
      errors.push("source_trace not preserved");
    }

    const sortedPass =
      discoveryResult.candidates.length < 2 ||
      discoveryResult.candidates[0].score >= discoveryResult.candidates[1].score;
    checks.push({ check: "candidates sorted by score", pass: sortedPass });
    if (!sortedPass) {
      errors.push("candidates not sorted by score");
    }

    const sourcesAfter = fs.readFileSync(SOURCES_FILE, "utf8");
    const noSourcesModifyPass = sourcesBefore === sourcesAfter;
    checks.push({ check: "sources.json not modified", pass: noSourcesModifyPass });
    if (!noSourcesModifyPass) {
      errors.push("sources.json was modified");
    }

    const result = {
      PATROL_URL_DISCOVERY_VALIDATION: errors.length === 0 ? "PASS" : "FAIL",
      checks: checks,
      errors: errors,
      sampleCandidate: {
        discovery_id: candidate.discovery_id,
        candidate_url: candidate.candidate_url,
        public_category_id: candidate.public_category_id,
        score: candidate.score,
        discovery_status: candidate.discovery_status,
        registration_status: candidate.registration_status
      }
    };

    console.log("=== Patrol URL Discovery Validation ===");
    console.log(JSON.stringify(result, null, 2));

    if (errors.length) {
      process.exit(1);
    }
  });
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});

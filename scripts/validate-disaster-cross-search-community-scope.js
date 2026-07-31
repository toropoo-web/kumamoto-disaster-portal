#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

const {
  loadEvacuationAlertScope,
  validateCommunityScopeMaster,
  evaluateSnsFetchScope,
  isInCommunityScope,
  SNS_FETCH_PLATFORMS,
  SNS_FETCH_SINCE_DATE,
  COMMUNITY_SCOPE_MUNICIPALITY_COUNT
} = require(path.join(__dirname, "..", "monitor", "disaster-social-community-scope"));

const {
  loadMunicipalityMaster,
  validateMunicipalityMaster
} = require(path.join(__dirname, "..", "monitor", "disaster-social-municipality-master"));

const {
  loadCommunityRegionMaster,
  validateCommunityRegionMaster
} = require(path.join(__dirname, "..", "monitor", "disaster-social-region-master"));

const {
  buildReviewQueueFromInbox,
  normalizeInboxItem
} = require(path.join(__dirname, "..", "monitor", "disaster-social-pipeline"));

function main() {
  const errors = [];
  const checks = [];

  const scope = loadEvacuationAlertScope();
  errors.push.apply(errors, validateCommunityScopeMaster(scope));
  checks.push({
    check: "evacuation alert scope count",
    pass:
      validateCommunityScopeMaster(scope).length === 0 &&
      scope.municipality_count === COMMUNITY_SCOPE_MUNICIPALITY_COUNT,
    municipality_count: scope.municipality_count
  });
  if (scope.municipality_count !== COMMUNITY_SCOPE_MUNICIPALITY_COUNT) {
    errors.push("scope must contain exactly 23 municipalities");
  }

  const masterPayload = loadMunicipalityMaster();
  errors.push.apply(errors, validateMunicipalityMaster(masterPayload));
  checks.push({
    check: "municipality master matches scope",
    pass:
      validateMunicipalityMaster(masterPayload).length === 0 &&
      (masterPayload.municipalities || []).length === COMMUNITY_SCOPE_MUNICIPALITY_COUNT,
    municipality_count: (masterPayload.municipalities || []).length
  });

  const regionMaster = loadCommunityRegionMaster();
  errors.push.apply(errors, validateCommunityRegionMaster(regionMaster));
  checks.push({
    check: "community region fixed scope",
    pass:
      regionMaster.extensible === false &&
      regionMaster.municipality_count === COMMUNITY_SCOPE_MUNICIPALITY_COUNT &&
      regionMaster.evacuation_alert_region_path === "data/public/evacuation_alert_region.json"
  });
  if (regionMaster.extensible !== false) {
    errors.push("community layer must not be extensible beyond evacuation alert scope");
  }

  const sourcesPath = path.join(ROOT, "data", "community", "disaster_social_sources.json");
  const sourcesPayload = JSON.parse(fs.readFileSync(sourcesPath, "utf8"));
  const scopeSet = new Set(scope.municipalities);
  const prefectureWideSources = (sourcesPayload.sources || []).filter(function (source) {
    return Array.isArray(source.coverage_prefectures) && source.coverage_prefectures.length > 0;
  });
  checks.push({
    check: "no prefecture-wide source coverage",
    pass: prefectureWideSources.length === 0,
    blocked_source_ids: prefectureWideSources.map(function (source) {
      return source.source_id;
    })
  });
  if (prefectureWideSources.length) {
    errors.push("sources must not use coverage_prefectures");
  }

  const outOfScopeCoverage = [];
  (sourcesPayload.sources || []).forEach(function (source) {
    (source.coverage_municipalities || []).forEach(function (name) {
      if (!scopeSet.has(name)) {
        outOfScopeCoverage.push(source.source_id + ":" + name);
      }
    });
  });
  checks.push({
    check: "source coverage municipalities in scope",
    pass: outOfScopeCoverage.length === 0,
    out_of_scope: outOfScopeCoverage
  });
  if (outOfScopeCoverage.length) {
    errors.push("source coverage includes municipalities outside evacuation alert scope");
  }

  checks.push({
    check: "sns fetch config",
    pass:
      sourcesPayload.sns_fetch &&
      sourcesPayload.sns_fetch.since_date === SNS_FETCH_SINCE_DATE &&
      JSON.stringify(sourcesPayload.sns_fetch.platforms) === JSON.stringify(SNS_FETCH_PLATFORMS)
  });
  if (!sourcesPayload.sns_fetch || sourcesPayload.sns_fetch.since_date !== SNS_FETCH_SINCE_DATE) {
    errors.push("sources sns_fetch since_date must be " + SNS_FETCH_SINCE_DATE);
  }

  const inScopePass = isInCommunityScope("阿蘇市") && isInCommunityScope("霧島市");
  const outScopePass = !isInCommunityScope("玉名市") && !isInCommunityScope("大津町");
  checks.push({
    check: "scope municipality membership",
    pass: inScopePass && outScopePass
  });
  if (!inScopePass || !outScopePass) {
    errors.push("scope municipality membership incorrect");
  }

  const acceptedSns = evaluateSnsFetchScope(
    normalizeInboxItem(
      {
        import_format: "SNS",
        source_type: "X",
        municipality: "八代市",
        date: "2026-07-28",
        title: "scope pass",
        content: "test"
      },
      0
    )
  );
  const rejectedMunicipality = evaluateSnsFetchScope(
    normalizeInboxItem(
      {
        import_format: "SNS",
        source_type: "X",
        municipality: "玉名市",
        date: "2026-07-30",
        title: "scope fail municipality",
        content: "test"
      },
      0
    )
  );
  const rejectedDate = evaluateSnsFetchScope(
    normalizeInboxItem(
      {
        import_format: "SNS",
        source_type: "Instagram",
        municipality: "霧島市",
        date: "2026-07-27",
        title: "scope fail date",
        content: "test"
      },
      0
    )
  );
  checks.push({
    check: "sns scope evaluation",
    pass:
      acceptedSns.pass === true &&
      rejectedMunicipality.pass === false &&
      rejectedDate.pass === false
  });
  if (!acceptedSns.pass || rejectedMunicipality.pass || rejectedDate.pass) {
    errors.push("sns scope evaluation failed");
  }

  const reviewQueue = buildReviewQueueFromInbox(
    {
      version: "1.0",
      AUTO_PUBLISH: false,
      items: [
        normalizeInboxItem(
          {
            inbox_id: "SCOPE-REJECT-001",
            import_format: "SNS",
            source_type: "X",
            municipality: "玉名市",
            date: "2026-07-30",
            source: "SOC-LOCAL-001",
            category: "WATER",
            title: "out of scope",
            content: "test"
          },
          0
        )
      ]
    },
    {
      indexPath: path.join(ROOT, "data", "community", "disaster_social_index.json")
    }
  );
  const rejectedItem = (reviewQueue.items || []).find(function (item) {
    return item.inbox_id === "SCOPE-REJECT-001";
  });
  checks.push({
    check: "sns out-of-scope rejected in review queue",
    pass: rejectedItem && rejectedItem.review_status === "REJECTED" && rejectedItem.scope_rejection,
    review_status: rejectedItem && rejectedItem.review_status
  });
  if (!rejectedItem || rejectedItem.review_status !== "REJECTED") {
    errors.push("sns out-of-scope item must be rejected in review queue");
  }

  const appJs = fs.readFileSync(path.join(ROOT, "js", "app.js"), "utf8");
  checks.push({
    check: "community search placeholder",
    pass: appJs.indexOf("例：八代市 / 霧島市 / 阿蘇市") !== -1
  });
  if (appJs.indexOf("例：熊本県 / 霧島市") !== -1) {
    errors.push("community search placeholder must not suggest prefecture-wide scope");
  }

  console.log("=== Disaster Cross Search Community Scope Validation ===");
  console.log(
    JSON.stringify(
      {
        DISASTER_CROSS_SEARCH_COMMUNITY_SCOPE_VALIDATION: errors.length === 0 ? "PASS" : "FAIL",
        checks: checks,
        errors: errors
      },
      null,
      2
    )
  );

  if (errors.length) {
    process.exit(1);
  }

  console.log("DISASTER_CROSS_SEARCH_COMMUNITY_SCOPE_CORRECTION_COMPLETE");
}

main();

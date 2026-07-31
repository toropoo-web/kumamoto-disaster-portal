"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PREVIEW_FILE = path.join(ROOT, "data", "public", "x_feed_preview.json");
const OUTPUT_FILE = path.join(ROOT, "data", "operation_monitor", "x-feed-operation-check.json");

const {
  SOURCE_REGISTRY,
  MUNICIPALITY_CONTENT_FILTER,
  matchesDisasterRelatedContent,
  buildStrictMunicipalityRegistry,
  countSelectedMunicipalityPosts,
  retainStalePreview,
  OUTPUT_PATH
} = require(path.join(ROOT, "scripts", "sync-x-feed"));

const CLASSIFICATION = {
  A: "DISASTER_RECOVERY",
  B: "ADMINISTRATIVE_LIFE",
  C: "NORMAL"
};

const CATEGORY_A_KEYWORDS = [
  "給水",
  "応急給水",
  "生活用水",
  "飲料水",
  "断水",
  "試験通水",
  "通水",
  "道路",
  "通行止め",
  "復旧",
  "施設",
  "避難所",
  "ごみ",
  "ゴミ",
  "収集",
  "支援",
  "物資",
  "配布",
  "罹災証明",
  "り災証明",
  "被災",
  "防災無線"
];

const CATEGORY_B_KEYWORDS = [
  "窓口",
  "イベント",
  "催し",
  "講座",
  "募集",
  "開催",
  "市民",
  "申請",
  "手続",
  "一般行政",
  "市役所案内"
];

const NOISE_NORMAL_POST_RATIO_THRESHOLD = 0.5;

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    return fallback;
  }
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function matchesKeywordList(text, keywords) {
  const normalized = normalizeText(text);
  return keywords.some(function (keyword) {
    return normalized.indexOf(keyword) !== -1;
  });
}

function classifyMunicipalityPost(post) {
  const text = normalizeText(post.text);
  const haystack = [text, post.municipality, post.account_name].filter(Boolean).join(" ");

  if (matchesDisasterRelatedContent({ summary: text, title: text, category: post.category }) ||
    matchesKeywordList(haystack, CATEGORY_A_KEYWORDS)) {
    return "A";
  }

  if (matchesKeywordList(haystack, CATEGORY_B_KEYWORDS)) {
    return "B";
  }

  return "C";
}

function resolveAccountStatus(preview, accountSummary) {
  if (!preview) {
    return "MISSING";
  }
  if (preview.sync_status === "STALE") {
    return accountSummary.count > 0 ? "STALE_RETAINED" : "STALE_EMPTY";
  }
  if (accountSummary.count > 0) {
    return "ACTIVE";
  }
  return "EMPTY";
}

function buildMunicipalitySummary(preview) {
  const posts = (preview && preview.posts) || [];
  const municipalityPosts = posts.filter(function (post) {
    return post.source_type === "LOCAL_GOVERNMENT";
  });

  const byAccount = new Map();

  Object.keys(SOURCE_REGISTRY).forEach(function (sourceId) {
    const meta = SOURCE_REGISTRY[sourceId];
    byAccount.set(meta.account_handle, {
      account: meta.account_handle,
      source_id: sourceId,
      municipality: meta.municipality,
      count: 0,
      latest_post: null,
      status: "EMPTY"
    });
  });

  municipalityPosts.forEach(function (post) {
    const handle = normalizeText(post.account_handle).replace(/^@/, "");
    const key = handle || post.source_id;
    const existing = byAccount.get(key) || byAccount.get(post.source_id) || {
      account: handle || post.source_id,
      source_id: post.source_id,
      municipality: post.municipality || "UNKNOWN",
      count: 0,
      latest_post: null,
      status: "EMPTY"
    };

    existing.count += 1;
    if (!existing.latest_post || new Date(post.post_time) > new Date(existing.latest_post)) {
      existing.latest_post = post.post_time;
    }

    if (post.source_id && !existing.source_id) {
      existing.source_id = post.source_id;
    }
    if (post.municipality && existing.municipality === "UNKNOWN") {
      existing.municipality = post.municipality;
    }

    byAccount.set(key, existing);
  });

  const summary = Array.from(byAccount.values())
    .map(function (entry) {
      return Object.assign({}, entry, {
        status: resolveAccountStatus(preview, entry)
      });
    })
    .sort(function (left, right) {
      return left.account.localeCompare(right.account);
    });

  return {
    rows: summary,
    municipality_post_count: municipalityPosts.length,
    preview_post_count: posts.length
  };
}

function buildContentClassification(preview) {
  const municipalityPosts = ((preview && preview.posts) || []).filter(function (post) {
    return post.source_type === "LOCAL_GOVERNMENT";
  });

  const counts = {
    A: 0,
    B: 0,
    C: 0
  };
  const samples = {
    A: [],
    B: [],
    C: []
  };

  municipalityPosts.forEach(function (post) {
    const category = classifyMunicipalityPost(post);
    counts[category] += 1;
    if (samples[category].length < 3) {
      samples[category].push({
        source_id: post.source_id,
        account: post.account_handle,
        post_time: post.post_time,
        text_preview: normalizeText(post.text).slice(0, 80)
      });
    }
  });

  const total = municipalityPosts.length || 1;
  return {
    counts: counts,
    ratios: {
      A: Number((counts.A / total).toFixed(4)),
      B: Number((counts.B / total).toFixed(4)),
      C: Number((counts.C / total).toFixed(4))
    },
    samples: samples,
    ab_information_captured: counts.A + counts.B > 0
  };
}

function buildNoiseCheck(classification, municipalitySummary) {
  const total = classification.counts.A + classification.counts.B + classification.counts.C;
  const normalRatio = total > 0 ? classification.counts.C / total : 0;
  const normalPostExcess =
    total > 0 &&
    normalRatio > NOISE_NORMAL_POST_RATIO_THRESHOLD &&
    classification.counts.C > classification.counts.A;

  let disasterPostsBuried = false;
  const buriedAccounts = [];

  municipalitySummary.rows.forEach(function (row) {
    if (row.count === 0) {
      return;
    }

    const accountPosts = ((municipalitySummary.previewPosts || []) || []).filter(function (post) {
      return normalizeText(post.account_handle).replace(/^@/, "") === row.account;
    });

    if (!accountPosts.length) {
      return;
    }

    const sorted = accountPosts.slice().sort(function (left, right) {
      return new Date(right.post_time) - new Date(left.post_time);
    });
    const latestCategory = classifyMunicipalityPost(sorted[0]);
    const hasDisasterRecovery = sorted.some(function (post) {
      return classifyMunicipalityPost(post) === "A";
    });

    if (latestCategory === "C" && hasDisasterRecovery) {
      disasterPostsBuried = true;
      buriedAccounts.push(row.account);
    }
  });

  let assessment = "ACCEPTABLE";
  if (normalPostExcess && disasterPostsBuried) {
    assessment = "REVIEW";
  } else if (normalPostExcess) {
    assessment = "WATCH_NORMAL_POSTS";
  } else if (disasterPostsBuried) {
    assessment = "WATCH_BURIED_DISASTER";
  }

  return {
    normal_post_excess: normalPostExcess,
    normal_post_ratio: Number(normalRatio.toFixed(4)),
    disaster_posts_buried: disasterPostsBuried,
    buried_accounts: buriedAccounts,
    assessment: assessment
  };
}

function buildFetchSuccessRate(preview) {
  if (!preview) {
    return {
      rate: 0,
      sync_status: "MISSING",
      last_successful_sync_at: null
    };
  }

  const syncStatus = preview.sync_status || "UNKNOWN";
  let rate = 0;
  if (syncStatus === "FRESH") {
    rate = 1;
  } else if (syncStatus === "STALE" && Array.isArray(preview.posts) && preview.posts.length > 0) {
    rate = 1;
  }

  return {
    rate: rate,
    sync_status: syncStatus,
    synced_at: preview.synced_at || null,
    last_successful_sync_at: preview.last_successful_sync_at || preview.synced_at || null
  };
}

function buildFailOpenCheck() {
  const syncSource = fs.readFileSync(path.join(ROOT, "scripts", "sync-x-feed.js"), "utf8");
  const appSource = fs.readFileSync(path.join(ROOT, "js", "app.js"), "utf8");

  const failOpenEnabled = /resolveFailOpen/.test(syncSource) && /X_FEED_FAIL_OPEN/.test(syncSource);
  const staleRetention = /retainStalePreview/.test(syncSource) && /sync_status:\s*"STALE"/.test(syncSource);
  const portalFailOpen = /x_feed_preview\.json/.test(appSource) && /X_FEED_STATUS_/.test(appSource);

  return {
    fail_open_enabled: failOpenEnabled,
    stale_retention_supported: staleRetention,
    portal_stop_on_fetch_failure: false,
    portal_fail_open_render: portalFailOpen,
    status: failOpenEnabled && staleRetention && portalFailOpen ? "PASS" : "FAIL"
  };
}

function buildPhase39dComparison(options) {
  options = options || {};
  const rawPosts = options.rawPosts || [];
  if (!rawPosts.length) {
    return {
      relaxed_municipality_count: null,
      strict_municipality_count: null,
      count_delta: null
    };
  }

  const relaxedCount = countSelectedMunicipalityPosts(rawPosts, { sourceRegistry: SOURCE_REGISTRY });
  const strictCount = countSelectedMunicipalityPosts(rawPosts, {
    sourceRegistry: buildStrictMunicipalityRegistry()
  });

  return {
    relaxed_municipality_count: relaxedCount,
    strict_municipality_count: strictCount,
    count_delta: relaxedCount - strictCount,
    content_filter: MUNICIPALITY_CONTENT_FILTER
  };
}

function buildXFeedOperationCheck(options) {
  options = options || {};
  const previewPath = options.previewPath || PREVIEW_FILE;
  const preview = readJson(previewPath, null);
  const generatedAt = options.generatedAt || new Date().toISOString();

  const municipalitySummary = buildMunicipalitySummary(preview);
  municipalitySummary.previewPosts = ((preview && preview.posts) || []).filter(function (post) {
    return post.source_type === "LOCAL_GOVERNMENT";
  });

  const classification = buildContentClassification(preview);
  const noiseCheck = buildNoiseCheck(classification, municipalitySummary);
  const fetchSuccess = buildFetchSuccessRate(preview);
  const failOpenCheck = buildFailOpenCheck();
  const phase39dComparison = buildPhase39dComparison(options);

  const disasterRelatedRatio =
    municipalitySummary.municipality_post_count > 0
      ? Number((classification.counts.A / municipalitySummary.municipality_post_count).toFixed(4))
      : 0;

  return {
    version: "1.0",
    view_type: "X_FEED_OPERATION_CHECK",
    phase: "PHASE39E",
    generated_at: generatedAt,
    constraints: {
      public_ui_display: false,
      fetch_method_unchanged: true,
      exclusion_rules_unchanged: true
    },
    preview_sync_status: preview ? preview.sync_status || "UNKNOWN" : "MISSING",
    preview_synced_at: preview ? preview.synced_at || null : null,
    municipality_x_feed_summary: municipalitySummary.rows,
    municipality_post_count: municipalitySummary.municipality_post_count,
    preview_post_count: municipalitySummary.preview_post_count,
    content_classification: classification,
    disaster_related_ratio: disasterRelatedRatio,
    fetch_success_rate: fetchSuccess.rate,
    fetch_success: fetchSuccess,
    noise_check: noiseCheck,
    fail_open_check: failOpenCheck,
    phase39d_comparison: phase39dComparison,
    source_files: {
      preview_json: "data/public/x_feed_preview.json",
      sync_script: "scripts/sync-x-feed.js"
    }
  };
}

function validateXFeedOperationCheck(report) {
  const errors = [];

  if (!report || report.version !== "1.0") {
    errors.push("report version must be 1.0");
    return errors;
  }
  if (report.view_type !== "X_FEED_OPERATION_CHECK") {
    errors.push("view_type must be X_FEED_OPERATION_CHECK");
  }
  if (!Array.isArray(report.municipality_x_feed_summary)) {
    errors.push("municipality_x_feed_summary must be an array");
  } else if (report.municipality_x_feed_summary.length !== Object.keys(SOURCE_REGISTRY).length) {
    errors.push("municipality_x_feed_summary must include all official municipality accounts");
  }

  ["fetch_success_rate", "disaster_related_ratio", "municipality_post_count"].forEach(function (field) {
    if (typeof report[field] !== "number") {
      errors.push(field + " must be a number");
    }
  });

  if (!report.content_classification || !report.content_classification.counts) {
    errors.push("content_classification.counts missing");
  }
  if (!report.noise_check || typeof report.noise_check.normal_post_excess !== "boolean") {
    errors.push("noise_check missing");
  }
  if (!report.fail_open_check || report.fail_open_check.status !== "PASS") {
    errors.push("fail_open_check must be PASS");
  }
  if (!report.content_classification || !report.content_classification.ab_information_captured) {
    errors.push("PHASE39D A/B information not captured in preview");
  }

  return errors;
}

function writeXFeedOperationCheck(report, options) {
  options = options || {};
  const outputPath = options.outputPath || OUTPUT_FILE;
  writeJson(outputPath, report);
  return outputPath;
}

function loadXFeedOperationCheck(options) {
  options = options || {};
  return readJson(options.reportPath || OUTPUT_FILE, null);
}

module.exports = {
  PREVIEW_FILE,
  OUTPUT_FILE,
  CLASSIFICATION,
  classifyMunicipalityPost,
  buildMunicipalitySummary,
  buildContentClassification,
  buildNoiseCheck,
  buildFetchSuccessRate,
  buildFailOpenCheck,
  buildXFeedOperationCheck,
  validateXFeedOperationCheck,
  writeXFeedOperationCheck,
  loadXFeedOperationCheck,
  retainStalePreview,
  OUTPUT_PATH
};

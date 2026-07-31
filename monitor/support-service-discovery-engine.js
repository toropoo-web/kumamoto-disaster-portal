"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const {
  OPENING_TYPE,
  OPENING_TYPE_VALUES,
  PROVIDER_TYPE,
  PROVIDER_TYPE_VALUES,
  SUPPORT_SERVICE_SUBCATEGORIES,
  SUPPORT_SERVICE_VERIFICATION_STATUS
} = require("./disaster-sources");

const {
  inferSourceTier,
  isDiscoverableSupportServicePost,
  complementCandidateFromFacilityRegistry,
  mergeCandidateBatches,
  evaluateXDiscoveryText
} = require("./support-service-source-discovery");

const {
  resolveSupportServiceSource,
  loadSupportServiceSourceRegistry,
  writeSupportServiceSourceRegistry,
  findSourceById
} = require("./support-service-source-registry");

const {
  buildSupportInformationCandidates,
  writeSupportInformationCandidates,
  INFORMATION_STATUSES
} = require("./support-service-information");

const ROOT = path.join(__dirname, "..");
const CANDIDATES_DIR = path.join(ROOT, "data", "candidates");
const CANDIDATES_FILE = path.join(CANDIDATES_DIR, "support_service_candidates.json");

const AUTO_PUBLISH = false;

const CANDIDATE_STATUSES = ["NEW", "OUT_OF_AREA"];
const REVIEW_QUEUE_STATUSES = ["NEW", "REVIEWING", "APPROVED", "REJECTED"];
const AVAILABILITY_STATUSES = ["ACTIVE", "EXPIRED", "UNKNOWN"];
const INFORMATION_STATUS_VALUES = INFORMATION_STATUSES;
const SOURCE_CONFIDENCE_VALUES = ["HIGH", "MEDIUM", "LOW"];
const SOURCE_TYPES = ["X", "WEB"];

const TARGET_PREFECTURES = ["熊本県", "鹿児島県"];

const KUMAMOTO_MUNICIPALITIES = [
  "熊本市",
  "八代市",
  "人吉市",
  "宇城市",
  "宇土市",
  "上天草市",
  "水俣市",
  "合志市",
  "菊池市",
  "阿蘇市",
  "天草市",
  "山鹿市",
  "益城町",
  "御船町",
  "嘉島町",
  "氷川町",
  "美里町",
  "菊陽町",
  "大津町",
  "甲佐町",
  "熊本県"
];

const KAGOSHIMA_MUNICIPALITIES = [
  "鹿児島市",
  "霧島市",
  "姶良市",
  "薩摩川内市",
  "鹿児島県"
];

const REGION_MUNICIPALITIES = KUMAMOTO_MUNICIPALITIES.concat(KAGOSHIMA_MUNICIPALITIES);

const OPENING_KEYWORDS = [
  { keyword: "温泉無料開放", opening_type: OPENING_TYPE.FREE_OPEN },
  { keyword: "無料開放", opening_type: OPENING_TYPE.FREE_OPEN },
  { keyword: "無料入浴", opening_type: OPENING_TYPE.FREE_OPEN },
  { keyword: "無料風呂", opening_type: OPENING_TYPE.FREE_OPEN },
  { keyword: "無料シャワー", opening_type: OPENING_TYPE.FREE_OPEN },
  { keyword: "無料食事", opening_type: OPENING_TYPE.FREE_OPEN },
  { keyword: "トイレ開放", opening_type: OPENING_TYPE.OPEN },
  { keyword: "駐車場開放", opening_type: OPENING_TYPE.OPEN },
  { keyword: "開放", opening_type: OPENING_TYPE.OPEN },
  { keyword: "提供", opening_type: OPENING_TYPE.SUPPORT },
  { keyword: "利用できます", opening_type: OPENING_TYPE.OPEN },
  { keyword: "利用可能", opening_type: OPENING_TYPE.OPEN },
  { keyword: "使えます", opening_type: OPENING_TYPE.OPEN },
  { keyword: "あります", opening_type: OPENING_TYPE.OPEN },
  { keyword: "できます", opening_type: OPENING_TYPE.OPEN },
  { keyword: "ご利用ください", opening_type: OPENING_TYPE.OPEN },
  { keyword: "支援します", opening_type: OPENING_TYPE.SUPPORT },
  { keyword: "対応します", opening_type: OPENING_TYPE.SUPPORT },
  { keyword: "受け入れます", opening_type: OPENING_TYPE.SUPPORT },
  { keyword: "受け入れ", opening_type: OPENING_TYPE.SUPPORT },
  { keyword: "配布", opening_type: OPENING_TYPE.SUPPORT },
  { keyword: "開始しました", opening_type: OPENING_TYPE.OPEN }
];

const CATEGORY_KEYWORD_RULES = [
  {
    subcategory: "BATH",
    subcategory_detail: "SHOWER",
    keywords: ["シャワー室", "無料シャワー", "シャワー", "体を洗える"]
  },
  {
    subcategory: "BATH",
    subcategory_detail: "BATH",
    keywords: [
      "入浴施設",
      "浴場",
      "温泉開放",
      "風呂無料",
      "風呂",
      "お風呂",
      "温泉",
      "銭湯",
      "入浴",
      "無料風呂",
      "無料入浴",
      "入浴支援"
    ]
  },
  {
    subcategory: "SPACE",
    subcategory_detail: "REST_SPACE",
    keywords: [
      "休憩スペース",
      "宿泊スペース",
      "休憩場所",
      "待機場所",
      "スペース",
      "休憩",
      "場所提供",
      "仮眠"
    ]
  },
  {
    subcategory: "SPACE",
    subcategory_detail: "ROOM",
    keywords: ["個室提供", "部屋提供", "個室", "部屋"]
  },
  {
    subcategory: "TOILET",
    subcategory_detail: null,
    keywords: ["仮設トイレ", "トイレ開放", "水洗トイレ", "お手洗い", "トイレ"]
  },
  {
    subcategory: "VEHICLE",
    subcategory_detail: "CAR_CAMP",
    keywords: ["車中泊できます", "車中泊可能", "車中泊", "車泊", "車で泊まる", "キャンピングカー"]
  },
  {
    subcategory: "VEHICLE",
    subcategory_detail: "PARKING",
    keywords: ["駐車場開放", "駐車場提供", "無料駐車場", "車両受入", "駐車場"]
  },
  {
    subcategory: "FOOD",
    subcategory_detail: "COOKING",
    keywords: [
      "炊き出しします",
      "食事提供",
      "食料提供",
      "弁当配布",
      "無料食事",
      "炊き出し",
      "弁当",
      "食料配布"
    ]
  },
  {
    subcategory: "WATER_SUPPORT",
    subcategory_detail: null,
    keywords: [
      "井戸水あります",
      "飲料水提供",
      "生活用水",
      "水配布",
      "水提供",
      "井戸水",
      "飲料水",
      "給水",
      "地下水"
    ]
  },
  {
    subcategory: "SUPPLIES",
    subcategory_detail: null,
    keywords: [
      "日用品配布",
      "衣類配布",
      "毛布配布",
      "支援物資",
      "物資配布",
      "生活用品"
    ]
  },
  {
    subcategory: "PET",
    subcategory_detail: null,
    keywords: ["ペット預かり", "ペット受入", "ペット対応", "ペット", "犬", "猫", "預かり"]
  }
];

const OUT_OF_AREA_MARKERS = [
  "大阪",
  "東京",
  "福岡",
  "名古屋",
  "京都",
  "神戸",
  "広島",
  "北海道",
  "沖縄"
];

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

function buildCandidateId(parts) {
  return (
    "SSCAND-" +
    crypto
      .createHash("sha256")
      .update(parts.filter(Boolean).join("|"))
      .digest("hex")
      .slice(0, 10)
      .toUpperCase()
  );
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function detectOpeningType(text) {
  const normalized = normalizeText(text);
  for (let i = 0; i < OPENING_KEYWORDS.length; i += 1) {
    if (normalized.indexOf(OPENING_KEYWORDS[i].keyword) !== -1) {
      return {
        opening_type: OPENING_KEYWORDS[i].opening_type,
        detected_keyword: OPENING_KEYWORDS[i].keyword
      };
    }
  }
  return { opening_type: null, detected_keyword: null };
}

function detectCategory(text) {
  const normalized = normalizeText(text);
  const matches = [];
  for (let i = 0; i < CATEGORY_KEYWORD_RULES.length; i += 1) {
    const rule = CATEGORY_KEYWORD_RULES[i];
    for (let j = 0; j < rule.keywords.length; j += 1) {
      if (normalized.indexOf(rule.keywords[j]) !== -1) {
        matches.push({
          subcategory: rule.subcategory,
          subcategory_detail: rule.subcategory_detail,
          detected_keyword: rule.keywords[j],
          keyword_length: rule.keywords[j].length
        });
      }
    }
  }
  if (!matches.length) {
    return { subcategory: null, subcategory_detail: null, detected_keyword: null };
  }
  matches.sort(function (left, right) {
    return right.keyword_length - left.keyword_length;
  });
  return matches[0];
}

function detectPrefecture(text) {
  const normalized = normalizeText(text);
  if (/熊本/.test(normalized)) {
    return "熊本県";
  }
  if (/鹿児島/.test(normalized)) {
    return "鹿児島県";
  }
  return null;
}

function detectMunicipality(text) {
  const normalized = normalizeText(text);
  for (let i = 0; i < REGION_MUNICIPALITIES.length; i += 1) {
    if (normalized.indexOf(REGION_MUNICIPALITIES[i]) !== -1) {
      return REGION_MUNICIPALITIES[i];
    }
  }
  return null;
}

function isOutOfArea(text, account, facilityName, address) {
  const hay = normalizeText([text, account, facilityName, address].join(" "));
  for (let i = 0; i < OUT_OF_AREA_MARKERS.length; i += 1) {
    if (hay.indexOf(OUT_OF_AREA_MARKERS[i]) !== -1) {
      return true;
    }
  }
  const prefecture = detectPrefecture(hay);
  if (prefecture && TARGET_PREFECTURES.indexOf(prefecture) === -1) {
    return true;
  }
  if (/大阪|東京|福岡県|愛知|北海道|沖縄/.test(hay) && !/熊本|鹿児島/.test(hay)) {
    return true;
  }
  return false;
}

function isInTargetArea(text, account, facilityName, address) {
  const hay = normalizeText([text, account, facilityName, address].join(" "));
  const prefecture = detectPrefecture(hay);
  if (prefecture && TARGET_PREFECTURES.indexOf(prefecture) !== -1) {
    return true;
  }
  const municipality = detectMunicipality(hay);
  if (municipality) {
    return true;
  }
  if (/熊本|鹿児島/.test(hay)) {
    return true;
  }
  return false;
}

function parseDateString(value) {
  if (!value || typeof value !== "string") {
    return null;
  }
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) {
    return null;
  }
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function resolveAvailabilityStatus(publishedAt, availableFrom, availableUntil, referenceDate) {
  const ref = referenceDate ? new Date(referenceDate) : new Date();
  const until = parseDateString(availableUntil);
  if (until && until < ref) {
    return "EXPIRED";
  }
  const from = parseDateString(availableFrom) || parseDateString(publishedAt);
  if (!from && !until) {
    return "UNKNOWN";
  }
  return "ACTIVE";
}

function inferSourceConfidence(post) {
  const tier = inferSourceTier(post);
  if (tier && tier.source_confidence) {
    return tier.source_confidence;
  }

  const hay = normalizeText(
    [post.account, post.text, post.source_url, post.facility_name].join(" ")
  );
  if (
    /公式|自治体|市役所|町役場|村役場|県庁|公式サイト|\.lg\.jp|\.pref\./.test(hay)
  ) {
    return "HIGH";
  }
  if (/団体|企業|協会|NPO|社協|株式会社|有限会社/.test(hay)) {
    return "MEDIUM";
  }
  if (/個人|転載|拡散|情報提供|匿名/.test(hay)) {
    return "LOW";
  }
  if (post.source_type === "WEB" && /\.lg\.jp|\.pref\./.test(post.source_url || "")) {
    return "HIGH";
  }
  return "LOW";
}

function inferProviderType(post, sourceConfidence) {
  const hay = normalizeText([post.account, post.text, post.facility_name].join(" "));
  if (/市役所|町役場|村役場|自治体|県/.test(hay)) {
    return PROVIDER_TYPE.MUNICIPALITY;
  }
  if (/温泉|ホテル|体育館|施設|会館|センター/.test(hay)) {
    return PROVIDER_TYPE.FACILITY;
  }
  if (/株式会社|有限会社|企業/.test(hay)) {
    return PROVIDER_TYPE.COMPANY;
  }
  if (/団体|協会|NPO|社協|ネットワーク/.test(hay)) {
    return PROVIDER_TYPE.ORGANIZATION;
  }
  if (sourceConfidence === "HIGH" && /\.lg\.jp/.test(post.source_url || "")) {
    return PROVIDER_TYPE.MUNICIPALITY;
  }
  if (sourceConfidence === "LOW") {
    return PROVIDER_TYPE.INDIVIDUAL;
  }
  return PROVIDER_TYPE.PUBLIC_ORGANIZATION;
}

function extractFacilityName(text) {
  const normalized = normalizeText(text);
  const patterns = [
    /([^\s、。]+温泉)/,
    /([^\s、。]+体育館)/,
    /([^\s、。]+センター)/,
    /([^\s、。]+会館)/,
    /(○+[^\s、。]+)/
  ];
  for (let i = 0; i < patterns.length; i += 1) {
    const match = normalized.match(patterns[i]);
    if (match && match[1]) {
      return match[1];
    }
  }
  return null;
}

function buildCandidateFromPost(post, options) {
  options = options || {};
  const text = normalizeText(post.text);
  const account = normalizeText(post.account);
  const facilityName = normalizeText(post.facility_name) || extractFacilityName(text);
  const address = normalizeText(post.address);
  const opening = detectOpeningType(text);
  const category = detectCategory(text);
  const discoveryEvaluation = evaluateXDiscoveryText(text);
  const detectedKeywords = discoveryEvaluation.detected_keywords || [];
  const detectedKeyword =
    category.detected_keyword || opening.detected_keyword || detectedKeywords[0] || null;
  const prefecture =
    post.prefecture || detectPrefecture([text, account, facilityName, address].join(" ")) || "UNKNOWN";
  const municipality =
    post.municipality ||
    detectMunicipality([text, account, facilityName, address].join(" ")) ||
    "UNKNOWN";
  const publishedAt = post.published_at || options.referenceDate || "UNKNOWN";
  const availableFrom = post.available_from || (publishedAt !== "UNKNOWN" ? publishedAt : "UNKNOWN");
  const availableUntil = post.available_until || "UNKNOWN";
  const checkedAt = options.checkedAt || new Date().toISOString();
  const sourceConfidence = post.source_confidence || inferSourceConfidence(post);
  const sourceTier = inferSourceTier(post);
  const outOfArea = isOutOfArea(text, account, facilityName, address);
  const inArea = isInTargetArea(text, account, facilityName, address);
  const status = outOfArea || !inArea ? "OUT_OF_AREA" : "NEW";
  const sourceType = post.source_type === "WEB" ? "WEB" : "X";
  let sourceResolution = null;
  const registrySource =
    post.registry_source_id && options.sourceRegistry
      ? findSourceById(options.sourceRegistry, post.registry_source_id)
      : null;

  if (registrySource) {
    sourceResolution = {
      registry: options.sourceRegistry,
      source: registrySource,
      created: false
    };
  } else {
    sourceResolution = resolveSupportServiceSource(
      Object.assign({}, post, {
        source_type: sourceType,
        source_url: post.source_url || "",
        account: account,
        prefecture: prefecture,
        municipality: municipality,
        facility_name: facilityName,
        categories: category.subcategory ? [category.subcategory] : []
      }),
      { registry: options.sourceRegistry }
    );
  }

  if (options.sourceRegistry) {
    options.sourceRegistry = sourceResolution.registry;
  }

  if (!category.subcategory && registrySource && Array.isArray(registrySource.categories)) {
    const registryCategory = registrySource.categories.find(function (entry) {
      return entry && entry !== "FREE_OPEN";
    });
    if (registryCategory === "SHOWER") {
      category.subcategory = "BATH";
      category.subcategory_detail = "SHOWER";
    } else if (registryCategory) {
      category.subcategory = registryCategory;
    }
    if (registrySource.categories.indexOf("FREE_OPEN") !== -1 && !opening.opening_type) {
      opening.opening_type = OPENING_TYPE.FREE_OPEN;
    }
  }

  return {
    candidate_id: buildCandidateId([
      sourceType,
      post.source_url || account,
      text,
      publishedAt
    ]),
    source_id: sourceResolution.source.source_id,
    category: "SUPPORT_SERVICE",
    source_type: sourceType,
    source_url: post.source_url || "",
    post_url: sourceType === "X" ? post.source_url || "" : "",
    account: account,
    text: text,
    detected_keyword: detectedKeyword,
    detected_keywords: detectedKeywords,
    subcategory: category.subcategory,
    subcategory_detail: category.subcategory_detail,
    opening_type: opening.opening_type,
    provider_type: post.provider_type || inferProviderType(post, sourceConfidence),
    prefecture: prefecture,
    municipality: municipality,
    facility_name: facilityName,
    address: address,
    published_at: publishedAt,
    available_from: availableFrom,
    available_until: availableUntil,
    checked_at: checkedAt,
    availability_status: resolveAvailabilityStatus(
      publishedAt === "UNKNOWN" ? null : publishedAt,
      availableFrom === "UNKNOWN" ? null : availableFrom,
      availableUntil === "UNKNOWN" ? null : availableUntil,
      options.referenceDate
    ),
    verification_status: SUPPORT_SERVICE_VERIFICATION_STATUS.REQUIRES_MANUAL_REVIEW,
    source_confidence: sourceConfidence,
    source_tier: sourceTier.source_tier,
    source_tier_label: sourceTier.source_tier_label,
    hours: post.hours || null,
    conditions: post.conditions || null,
    web_complement_status: post.web_complement_status || null,
    status: status,
    auto_publish: AUTO_PUBLISH
  };
}

function discoverSupportServiceCandidates(posts, options) {
  options = options || {};
  let sourceRegistry = options.sourceRegistry || loadSupportServiceSourceRegistry(options);
  let excludedCount = 0;
  const candidates = [];

  (posts || []).forEach(function (post) {
    if (!post) {
      return;
    }
    if (options.requireDiscoverable !== false && !isDiscoverableSupportServicePost(post)) {
      excludedCount += 1;
      return;
    }
    const postOptions = Object.assign({}, options, { sourceRegistry: sourceRegistry });
    let candidate = buildCandidateFromPost(post, postOptions);
    sourceRegistry = postOptions.sourceRegistry;
    candidate = complementCandidateFromFacilityRegistry(candidate, options);
    candidates.push(candidate);
  });

  const batch = {
    version: "1.0",
    category: "SUPPORT_SERVICE",
    generated_at: new Date().toISOString(),
    AUTO_PUBLISH: AUTO_PUBLISH,
    auto_publish: AUTO_PUBLISH,
    candidate_count: candidates.length,
    in_area_count: candidates.filter(function (entry) {
      return entry.status === "NEW";
    }).length,
    out_of_area_count: candidates.filter(function (entry) {
      return entry.status === "OUT_OF_AREA";
    }).length,
    excluded_count: excludedCount,
    candidates: candidates
  };

  if (options.persistSourceRegistry === true) {
    writeSupportServiceSourceRegistry(sourceRegistry, options);
  }

  return batch;
}

function discoverAndMergeSupportServiceCandidates(posts, options) {
  options = options || {};
  const existing = loadSupportServiceCandidates(options);
  const incoming = discoverSupportServiceCandidates(posts, options);
  return mergeCandidateBatches(existing, incoming);
}

function validateSupportServiceCandidate(candidate, index) {
  const label = "candidates[" + index + "]";
  const errors = [];

  if (!candidate || typeof candidate !== "object") {
    errors.push(label + ": entry missing");
    return errors;
  }

  if (!candidate.candidate_id) {
    errors.push(label + ": candidate_id missing");
  }
  if (!candidate.source_id) {
    errors.push(label + ": source_id missing");
  }
  if (!candidate.checked_at) {
    errors.push(label + ": checked_at missing");
  }
  if (candidate.category !== "SUPPORT_SERVICE") {
    errors.push(label + ": category must be SUPPORT_SERVICE");
  }
  if (SOURCE_TYPES.indexOf(candidate.source_type) === -1) {
    errors.push(label + ": invalid source_type " + candidate.source_type);
  }
  if (CANDIDATE_STATUSES.indexOf(candidate.status) === -1) {
    errors.push(label + ": invalid status " + candidate.status);
  }
  if (candidate.auto_publish !== false) {
    errors.push(label + ": auto_publish must be false");
  }
  if (
    candidate.verification_status !== SUPPORT_SERVICE_VERIFICATION_STATUS.REQUIRES_MANUAL_REVIEW
  ) {
    errors.push(label + ": verification_status must be REQUIRES_MANUAL_REVIEW");
  }
  if (SOURCE_CONFIDENCE_VALUES.indexOf(candidate.source_confidence) === -1) {
    errors.push(label + ": invalid source_confidence " + candidate.source_confidence);
  }
  if (AVAILABILITY_STATUSES.indexOf(candidate.availability_status) === -1) {
    errors.push(label + ": invalid availability_status " + candidate.availability_status);
  }

  if (candidate.status === "NEW") {
    if (!candidate.subcategory) {
      errors.push(label + ": subcategory missing for in-area candidate");
    }
    if (!candidate.opening_type) {
      errors.push(label + ": opening_type missing for in-area candidate");
    }
    if (OPENING_TYPE_VALUES.indexOf(candidate.opening_type) === -1) {
      errors.push(label + ": invalid opening_type " + candidate.opening_type);
    }
    if (!candidate.provider_type) {
      errors.push(label + ": provider_type missing for in-area candidate");
    }
    if (PROVIDER_TYPE_VALUES.indexOf(candidate.provider_type) === -1) {
      errors.push(label + ": invalid provider_type " + candidate.provider_type);
    }
    if (candidate.subcategory && SUPPORT_SERVICE_SUBCATEGORIES[candidate.subcategory]) {
      const allowedDetails = SUPPORT_SERVICE_SUBCATEGORIES[candidate.subcategory].details;
      if (allowedDetails.length && !candidate.subcategory_detail) {
        errors.push(label + ": subcategory_detail required for " + candidate.subcategory);
      }
    }
  }

  return errors;
}

function validateSupportServiceCandidateBatch(batch) {
  const errors = [];

  if (!batch || batch.version !== "1.0") {
    errors.push("candidate batch version must be 1.0");
  }
  if (batch.category !== "SUPPORT_SERVICE") {
    errors.push("candidate batch category must be SUPPORT_SERVICE");
  }
  if (batch.AUTO_PUBLISH !== false || batch.auto_publish !== false) {
    errors.push("candidate batch AUTO_PUBLISH must be false");
  }
  if (!Array.isArray(batch.candidates)) {
    errors.push("candidate batch candidates must be an array");
    return errors;
  }

  const ids = new Set();
  batch.candidates.forEach(function (candidate, index) {
    errors.push.apply(errors, validateSupportServiceCandidate(candidate, index));
    if (candidate.candidate_id) {
      if (ids.has(candidate.candidate_id)) {
        errors.push("duplicate candidate_id: " + candidate.candidate_id);
      }
      ids.add(candidate.candidate_id);
    }
  });

  return errors;
}

function writeSupportServiceCandidates(batch, options) {
  options = options || {};
  const outputPath = options.outputPath || CANDIDATES_FILE;
  writeJson(outputPath, batch);
  return outputPath;
}

function loadSupportServiceCandidates(options) {
  options = options || {};
  return readJson(options.inputPath || CANDIDATES_FILE, {
    version: "1.0",
    category: "SUPPORT_SERVICE",
    AUTO_PUBLISH: AUTO_PUBLISH,
    auto_publish: AUTO_PUBLISH,
    candidate_count: 0,
    in_area_count: 0,
    out_of_area_count: 0,
    candidates: []
  });
}

module.exports = {
  AUTO_PUBLISH,
  CANDIDATES_FILE,
  CANDIDATES_DIR,
  CANDIDATE_STATUSES,
  REVIEW_QUEUE_STATUSES,
  AVAILABILITY_STATUSES,
  INFORMATION_STATUS_VALUES,
  SOURCE_CONFIDENCE_VALUES,
  TARGET_PREFECTURES,
  OPENING_TYPE,
  OPENING_KEYWORDS,
  CATEGORY_KEYWORD_RULES,
  buildCandidateFromPost,
  buildCandidateId,
  discoverSupportServiceCandidates,
  discoverAndMergeSupportServiceCandidates,
  mergeCandidateBatches,
  detectOpeningType,
  detectCategory,
  isOutOfArea,
  isInTargetArea,
  resolveAvailabilityStatus,
  inferSourceConfidence,
  validateSupportServiceCandidate,
  validateSupportServiceCandidateBatch,
  writeSupportServiceCandidates,
  loadSupportServiceCandidates,
  loadSupportServiceSourceRegistry,
  writeSupportServiceSourceRegistry,
  buildSupportInformationCandidates,
  writeSupportInformationCandidates
};

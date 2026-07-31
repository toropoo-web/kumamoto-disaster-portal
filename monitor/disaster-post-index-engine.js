"use strict";

const fs = require("fs");
const https = require("https");
const path = require("path");
const crypto = require("crypto");

const { REGION_KYUSHU_SOUTH, PREFECTURES, resolveMunicipality } = require("./disaster-sources");
const { SOURCE_REGISTRY, X_FEED_POSTS_URL } = require(path.join(
  __dirname,
  "..",
  "scripts",
  "sync-x-feed"
));

const ROOT = path.join(__dirname, "..");
const X_FEED_PREVIEW_FILE = path.join(ROOT, "data", "public", "x_feed_preview.json");
const OUTPUT_FILE = path.join(ROOT, "data", "disaster_post_index.json");
const PUBLIC_OUTPUT_FILE = path.join(ROOT, "data", "public", "disaster_post_index.json");

const EXCLUDED_SOURCE_IDS = new Set(["SRC-PER-001"]);
const EXCLUDED_ACCOUNT_HANDLES = new Set(["shinjirokoiz"]);
const EXCLUDED_PATTERNS = [/DEMO/i, /SEED/i, /デモ/];

const OFFICIAL_SOURCE_TYPES = new Set([
  "LOCAL_GOVERNMENT",
  "GOVERNMENT",
  "PREFECTURE",
  "POLICE",
  "FIRE",
  "SDF",
  "LIFELINE",
  "TRANSPORT",
  "MEDICAL",
  "VOLUNTEER_CENTER",
  "PUBLIC_SAFETY"
]);

const POST_CATEGORY_RULES = [
  {
    category: "WATER",
    subcategories: [
      { id: "WATER_SUPPLY", keywords: ["給水", "応急給水", "飲料水", "生活用水"] },
      { id: "WATER_OUTAGE", keywords: ["断水", "断水情報", "試験通水"] },
      { id: "WATER_RESTORE", keywords: ["水道復旧", "通水", "復水"] }
    ]
  },
  {
    category: "SHELTER",
    subcategories: [
      { id: "SHELTER_OPEN", keywords: ["避難所", "開設", "避難勧告", "避難指示", "避難情報"] },
      { id: "SHELTER_CLOSE", keywords: ["閉鎖", "避難解除"] }
    ]
  },
  {
    category: "COOLING",
    subcategories: [
      { id: "HEAT_ALERT", keywords: ["暑さ", "熱中症", "猛暑"] },
      { id: "COOLING_SPACE", keywords: ["冷房", "休憩", "クール"] }
    ]
  },
  {
    category: "FOOD",
    subcategories: [
      { id: "FOOD_SUPPLY", keywords: ["食料", "配布", "物資"] },
      { id: "FOOD_SERVICE", keywords: ["炊き出し"] }
    ]
  },
  {
    category: "MEDICAL",
    subcategories: [
      { id: "MEDICAL_CARE", keywords: ["医療", "救護", "診療"] },
      { id: "MEDICINE", keywords: ["薬", "調剤"] }
    ]
  },
  {
    category: "SECURITY",
    subcategories: [
      { id: "POLICE", keywords: ["警察", "防犯", "パトロール"] }
    ]
  },
  {
    category: "VOLUNTEER",
    subcategories: [
      { id: "VOLUNTEER_RECRUIT", keywords: ["災害ボランティア", "ボランティア", "募集", "受付", "災害VC"] }
    ]
  },
  {
    category: "RECOVERY",
    subcategories: [
      { id: "RECOVERY_WORK", keywords: ["復旧", "道路", "住宅", "生活支援", "り災"] }
    ]
  },
  {
    category: "TRANSPORT",
    subcategories: [
      { id: "TRANSPORT_STATUS", keywords: ["交通", "通行止め", "公共交通", "運休", "バス"] }
    ]
  }
];

const POST_CATEGORY_LABELS = {
  WATER: "給水・断水",
  SHELTER: "避難所",
  COOLING: "暑さ・熱中症",
  FOOD: "食料・物資",
  MEDICAL: "医療",
  SECURITY: "防犯・警察",
  VOLUNTEER: "災害ボランティア",
  RECOVERY: "復旧・生活支援",
  TRANSPORT: "交通",
  GENERAL: "公式発信"
};

const REGION_KEYWORDS = [
  { prefecture: "熊本県", keywords: ["熊本県", "熊本", "九州南部", "熊本地震"] },
  { prefecture: "鹿児島県", keywords: ["鹿児島県", "鹿児島"] }
];

const MUNICIPALITY_PREFECTURE_HINTS = {
  熊本市: "熊本県",
  八代市: "熊本県",
  人吉市: "熊本県",
  合志市: "熊本県",
  宇城市: "熊本県",
  上天草市: "熊本県",
  天草市: "熊本県",
  宇土市: "熊本県",
  荒尾市: "熊本県",
  水俣市: "熊本県",
  玉名市: "熊本県",
  山鹿市: "熊本県",
  菊池市: "熊本県",
  阿蘇市: "熊本県",
  南阿蘇村: "熊本県",
  益城町: "熊本県",
  御船町: "熊本県",
  嘉島町: "熊本県",
  霧島市: "鹿児島県"
};

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

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function buildPostContentHash(text) {
  return crypto.createHash("sha256").update(normalizeText(text)).digest("hex");
}

function buildIndexId(parts) {
  return crypto
    .createHash("sha1")
    .update(parts.filter(Boolean).join("|"))
    .digest("hex")
    .slice(0, 16);
}

function extractTweetId(url) {
  const normalized = normalizeText(url);
  const numericMatch = normalized.match(/status\/(\d+)/i);
  if (numericMatch) {
    return numericMatch[1];
  }
  const genericMatch = normalized.match(/status\/([^/?#]+)/i);
  return genericMatch ? genericMatch[1] : null;
}

function fetchJson(url) {
  return new Promise(function (resolve, reject) {
    https
      .get(url, function (response) {
        if (response.statusCode !== 200) {
          reject(new Error("HTTP " + response.statusCode + " for " + url));
          response.resume();
          return;
        }

        let data = "";
        response.on("data", function (chunk) {
          data += chunk;
        });
        response.on("end", function () {
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(new Error("Invalid JSON from " + url + ": " + err.message));
          }
        });
      })
      .on("error", reject);
  });
}

function getSourceMeta(post, sourceRegistry) {
  const registry = sourceRegistry || SOURCE_REGISTRY;
  const sourceId = post.sourceId || post.source_id;
  return registry[sourceId] || null;
}

function resolveSourceType(post, registryMeta) {
  if (registryMeta && registryMeta.source_type) {
    return registryMeta.source_type;
  }

  const sourceId = post.sourceId || post.source_id;
  if (typeof sourceId === "string") {
    if (sourceId.startsWith("SRC-NAT-")) {
      return "GOVERNMENT";
    }
    if (sourceId.startsWith("SRC-KUM-")) {
      return "PREFECTURE";
    }
    if (sourceId.startsWith("SRC-MUN-")) {
      return "LOCAL_GOVERNMENT";
    }
  }

  if (post.source_type) {
    return post.source_type;
  }

  return null;
}

function isExcludedPost(post) {
  if (!post) {
    return true;
  }

  const sourceId = post.sourceId || post.source_id;
  if (EXCLUDED_SOURCE_IDS.has(sourceId)) {
    return true;
  }

  const accountHandle = post.accountHandle || post.account_handle;
  if (accountHandle && EXCLUDED_ACCOUNT_HANDLES.has(accountHandle)) {
    return true;
  }

  const fields = [
    sourceId,
    post.postId,
    post.post_id,
    post.sourceName,
    post.account_name,
    accountHandle,
    post.category
  ];
  const haystack = fields.filter(Boolean).join(" ");
  return EXCLUDED_PATTERNS.some(function (pattern) {
    return pattern.test(haystack);
  });
}

function isOfficialPost(post, registryMeta) {
  const sourceType = resolveSourceType(post, registryMeta);
  if (sourceType && OFFICIAL_SOURCE_TYPES.has(sourceType)) {
    return true;
  }
  if (registryMeta) {
    return true;
  }
  const sourceId = post.sourceId || post.source_id;
  if (typeof sourceId === "string" && /^(SRC-NAT-|SRC-KUM-|SRC-MUN-)/.test(sourceId)) {
    return true;
  }
  return false;
}

function isActivePost(post) {
  if (!post) {
    return false;
  }
  if (!post.status) {
    return true;
  }
  return post.status === "ACTIVE";
}

function getPostText(post) {
  if (typeof post.text === "string" && post.text.trim() !== "") {
    return post.text.trim();
  }
  if (typeof post.summary === "string" && post.summary.trim() !== "") {
    return post.summary.trim();
  }
  if (typeof post.title === "string" && post.title.trim() !== "") {
    return post.title.trim();
  }
  return "";
}

function getPostUrl(post) {
  return normalizeText(post.postUrl || post.url || post.post_url || "");
}

function getPostId(post) {
  const url = getPostUrl(post);
  const tweetId = extractTweetId(url);
  if (tweetId) {
    return tweetId;
  }
  return normalizeText(post.postId || post.post_id || post.sourceId || post.source_id || url);
}

function getPublishedAt(post) {
  return normalizeText(post.postedAt || post.post_time || post.published_at || "");
}

function getAccountHandle(post, registryMeta) {
  return (
    normalizeText(post.accountHandle || post.account_handle) ||
    (registryMeta && registryMeta.account_handle) ||
    ""
  );
}

function getOrganization(post, registryMeta) {
  return normalizeText(post.sourceName || post.account_name || registryMeta && registryMeta.organization) || "公式発信";
}

function extractTitle(text) {
  const raw = String(text || "").trim();
  if (!raw) {
    return "公式投稿";
  }
  const firstLine = raw.split(/\r?\n/)[0].replace(/\s+/g, " ").trim();
  if (!firstLine) {
    return "公式投稿";
  }
  if (firstLine.length <= 80) {
    return firstLine;
  }
  return firstLine.slice(0, 77) + "...";
}

function summarizeText(text, maxLength) {
  const normalized = normalizeText(text).replace(/\n+/g, " ");
  if (!normalized) {
    return "";
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return normalized.slice(0, maxLength - 1) + "…";
}

function classifyPost(text) {
  const haystack = normalizeText(text);
  let bestMatch = null;

  POST_CATEGORY_RULES.forEach(function (rule) {
    rule.subcategories.forEach(function (subcategory) {
      subcategory.keywords.forEach(function (keyword) {
        if (haystack.indexOf(keyword) === -1) {
          return;
        }
        const score = keyword.length;
        if (!bestMatch || score > bestMatch.score) {
          bestMatch = {
            category: rule.category,
            subcategory: subcategory.id,
            keyword: keyword,
            score: score
          };
        }
      });
    });
  });

  if (bestMatch) {
    return {
      category: bestMatch.category,
      subcategory: bestMatch.subcategory,
      matched_keyword: bestMatch.keyword
    };
  }

  return {
    category: "GENERAL",
    subcategory: "OFFICIAL",
    matched_keyword: null
  };
}

function extractPrefecture(post, registryMeta, text) {
  if (registryMeta && registryMeta.prefecture) {
    return registryMeta.prefecture;
  }

  const municipality =
    registryMeta && registryMeta.municipality
      ? registryMeta.municipality
      : post.municipality || "";

  if (municipality && MUNICIPALITY_PREFECTURE_HINTS[municipality]) {
    return MUNICIPALITY_PREFECTURE_HINTS[municipality];
  }

  const haystack = [text, municipality, post.sourceName, post.account_name].filter(Boolean).join(" ");
  let matched = null;
  REGION_KEYWORDS.forEach(function (entry) {
    entry.keywords.forEach(function (keyword) {
      if (haystack.indexOf(keyword) !== -1) {
        matched = entry.prefecture;
      }
    });
  });
  if (matched) {
    return matched;
  }

  const sourceId = post.sourceId || post.source_id;
  if (typeof sourceId === "string" && sourceId.startsWith("SRC-KUM-")) {
    return "熊本県";
  }

  return "熊本県";
}

function extractMunicipality(post, registryMeta, prefecture, organization) {
  if (registryMeta && registryMeta.municipality) {
    return registryMeta.municipality;
  }
  if (post.municipality) {
    return post.municipality;
  }

  const text = getPostText(post);
  const municipalities = Object.keys(MUNICIPALITY_PREFECTURE_HINTS);
  for (let index = 0; index < municipalities.length; index += 1) {
    const name = municipalities[index];
    if (text.indexOf(name) !== -1 && MUNICIPALITY_PREFECTURE_HINTS[name] === prefecture) {
      return name;
    }
  }

  return resolveMunicipality(prefecture, organization);
}

function isInCoverageRegion(prefecture) {
  return PREFECTURES[REGION_KYUSHU_SOUTH].indexOf(prefecture) !== -1;
}

function normalizeRawPost(post, options) {
  options = options || {};
  const sourceRegistry = options.sourceRegistry || SOURCE_REGISTRY;
  const registryMeta = getSourceMeta(post, sourceRegistry);

  if (!isActivePost(post) || isExcludedPost(post) || !isOfficialPost(post, registryMeta)) {
    return null;
  }

  const text = getPostText(post);
  const url = getPostUrl(post);
  if (!text || !url) {
    return null;
  }

  const organization = getOrganization(post, registryMeta);
  const prefecture = extractPrefecture(post, registryMeta, text);
  if (!isInCoverageRegion(prefecture)) {
    return null;
  }

  const municipality = extractMunicipality(post, registryMeta, prefecture, organization);
  const classification = classifyPost(text);
  const publishedAt = getPublishedAt(post);
  const now = new Date().toISOString();
  const account = getAccountHandle(post, registryMeta);
  const sourceType = resolveSourceType(post, registryMeta);

  return {
    post_id: getPostId(post),
    source_type: "official_x",
    organization: organization,
    account: account,
    prefecture: prefecture,
    municipality: municipality,
    category: classification.category,
    subcategory: classification.subcategory,
    title: extractTitle(text),
    text: text,
    url: url,
    published_at: publishedAt || now,
    updated_at: publishedAt || now,
    hash: buildPostContentHash(text),
    verification: "official",
    matched_keyword: classification.matched_keyword,
    registry_source_type: sourceType || null,
    source_id: post.sourceId || post.source_id || null
  };
}

function previewPostsToRaw(previewPosts) {
  return (previewPosts || []).map(function (preview) {
    return {
      sourceId: preview.source_id,
      sourceName: preview.account_name,
      accountHandle: preview.account_handle,
      postedAt: preview.post_time,
      summary: preview.text,
      postUrl: preview.url,
      source_type: preview.source_type,
      municipality: preview.municipality,
      status: "ACTIVE"
    };
  });
}

function loadLocalPosts(options) {
  options = options || {};
  const localFile = options.postsFile || process.env.X_FEED_POSTS_FILE;
  if (localFile && fs.existsSync(localFile)) {
    const payload = readJson(localFile, []);
    const posts = Array.isArray(payload) ? payload : payload.posts || [];
    return { posts: posts, source: localFile };
  }

  const previewPath = options.previewPath || X_FEED_PREVIEW_FILE;
  if (fs.existsSync(previewPath)) {
    const preview = readJson(previewPath, { posts: [] });
    return {
      posts: previewPostsToRaw(preview.posts || []),
      source: previewPath
    };
  }

  return null;
}

async function loadPostsForIndex(options) {
  options = options || {};
  const local = loadLocalPosts(options);
  if (local) {
    return local;
  }

  const url = options.postsUrl || X_FEED_POSTS_URL;
  const payload = await fetchJson(url);
  const posts = Array.isArray(payload) ? payload : payload.posts || [];
  return { posts: posts, source: url };
}

function dedupePostEntries(entries) {
  const byUrl = new Map();
  const byHash = new Map();
  const deduped = [];

  entries.forEach(function (entry) {
    if (!entry || !entry.url) {
      return;
    }

    if (byUrl.has(entry.url)) {
      return;
    }

    if (byHash.has(entry.hash)) {
      return;
    }

    byUrl.set(entry.url, true);
    byHash.set(entry.hash, true);
    deduped.push(entry);
  });

  return deduped;
}

function buildDisasterPostIndexPayload(posts, options) {
  options = options || {};
  const normalized = [];
  const sourceRegistry = options.sourceRegistry || SOURCE_REGISTRY;

  (posts || []).forEach(function (post) {
    const entry = normalizeRawPost(post, { sourceRegistry: sourceRegistry });
    if (entry) {
      normalized.push(entry);
    }
  });

  const deduped = dedupePostEntries(normalized).sort(function (left, right) {
    return new Date(right.published_at) - new Date(left.published_at);
  });

  return {
    version: "1.0",
    region: REGION_KYUSHU_SOUTH,
    posts: deduped,
    meta: {
      item_count: deduped.length,
      source: options.source || null,
      last_updated: new Date().toISOString()
    }
  };
}

async function buildDisasterPostIndex(options) {
  options = options || {};
  const loaded = await loadPostsForIndex(options);
  return buildDisasterPostIndexPayload(loaded.posts, {
    sourceRegistry: options.sourceRegistry,
    source: loaded.source
  });
}

async function buildAndWriteDisasterPostIndex(options) {
  options = options || {};
  const payload = await buildDisasterPostIndex(options);
  writeJson(options.outputPath || OUTPUT_FILE, payload);
  writeJson(options.publicOutputPath || PUBLIC_OUTPUT_FILE, payload);
  return payload;
}

function buildOfficialPostKeywords(entry) {
  const keywords = [
    entry.organization,
    entry.account,
    entry.prefecture,
    entry.municipality,
    entry.title,
    POST_CATEGORY_LABELS[entry.category] || entry.category,
    entry.subcategory,
    entry.matched_keyword
  ].filter(Boolean);

  const rule = POST_CATEGORY_RULES.find(function (item) {
    return item.category === entry.category;
  });
  if (rule) {
    rule.subcategories.forEach(function (subcategory) {
      keywords.push.apply(keywords, subcategory.keywords);
    });
  }

  return Array.from(new Set(keywords.map(normalizeText).filter(Boolean)));
}

function toDisasterSearchIndexEntry(entry) {
  const categoryLabel = POST_CATEGORY_LABELS[entry.category] || POST_CATEGORY_LABELS.GENERAL;
  const summary = summarizeText(entry.text, 220);
  const keywords = buildOfficialPostKeywords(entry);

  return {
    index_id: buildIndexId(["OFFICIAL_POST", entry.post_id, entry.url]),
    category: "OFFICIAL_POST",
    prefecture: entry.prefecture,
    municipality: entry.municipality,
    organization: entry.organization,
    title: entry.title,
    content: summary,
    keywords: keywords,
    subcategory: entry.category,
    subcategory_detail: entry.subcategory,
    post_category: entry.category,
    post_category_label: categoryLabel,
    post_summary: summary,
    account: entry.account,
    source_type: entry.source_type,
    source_url: entry.url,
    official: true,
    verification: entry.verification,
    published_at: entry.published_at,
    updated_at: entry.updated_at,
    hash: entry.hash,
    post_id: entry.post_id
  };
}

function buildOfficialPostSearchItems(options) {
  options = options || {};
  const payload = readJson(options.postIndexPath || PUBLIC_OUTPUT_FILE, { posts: [] });
  return (payload.posts || []).map(toDisasterSearchIndexEntry);
}

function validateDisasterPostIndexEntry(entry, index) {
  const label = "posts[" + index + "]";
  const errors = [];

  if (!entry || typeof entry !== "object") {
    errors.push(label + ": entry missing");
    return errors;
  }

  [
    "post_id",
    "source_type",
    "organization",
    "account",
    "prefecture",
    "municipality",
    "category",
    "subcategory",
    "title",
    "text",
    "url",
    "published_at",
    "updated_at",
    "hash",
    "verification"
  ].forEach(function (field) {
    if (!entry[field]) {
      errors.push(label + ": missing " + field);
    }
  });

  if (entry.verification !== "official") {
    errors.push(label + ": verification must be official");
  }

  if (entry.source_type !== "official_x") {
    errors.push(label + ": source_type must be official_x");
  }

  if (!isInCoverageRegion(entry.prefecture)) {
    errors.push(label + ": prefecture out of coverage");
  }

  return errors;
}

function validateDisasterPostIndex(payload) {
  const errors = [];
  if (!payload || !Array.isArray(payload.posts)) {
    errors.push("posts must be an array");
    return errors;
  }

  const urls = new Set();
  const hashes = new Set();

  payload.posts.forEach(function (entry, index) {
    errors.push.apply(errors, validateDisasterPostIndexEntry(entry, index));
    if (entry.url) {
      if (urls.has(entry.url)) {
        errors.push("duplicate url: " + entry.url);
      }
      urls.add(entry.url);
    }
    if (entry.hash) {
      if (hashes.has(entry.hash)) {
        errors.push("duplicate hash: " + entry.hash);
      }
      hashes.add(entry.hash);
    }
  });

  return errors;
}

module.exports = {
  OUTPUT_FILE,
  PUBLIC_OUTPUT_FILE,
  X_FEED_PREVIEW_FILE,
  POST_CATEGORY_RULES,
  POST_CATEGORY_LABELS,
  OFFICIAL_SOURCE_TYPES,
  normalizeRawPost,
  previewPostsToRaw,
  loadLocalPosts,
  loadPostsForIndex,
  buildDisasterPostIndex,
  buildDisasterPostIndexPayload,
  buildAndWriteDisasterPostIndex,
  buildOfficialPostSearchItems,
  toDisasterSearchIndexEntry,
  validateDisasterPostIndex,
  validateDisasterPostIndexEntry,
  classifyPost,
  buildPostContentHash,
  dedupePostEntries
};

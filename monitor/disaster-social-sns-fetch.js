"use strict";

const fs = require("fs");
const https = require("https");
const path = require("path");

const {
  loadEvacuationAlertScope,
  isInCommunityScope,
  isOnOrAfterSnsFetchSinceDate,
  resolveMunicipalityPrefecture,
  SNS_FETCH_SINCE_DATE,
  COMMUNITY_FETCH_CATEGORIES
} = require("./disaster-social-community-scope");
const { resolveCategoryFromKeyword } = require("./disaster-social-index-engine");
const { resolveSnsPostUrlFromFeedPost, isXPostUrl } = require("./disaster-social-url");
const { normalizeInboxItem } = require("./disaster-social-pipeline");
const { isDisasterRelevantPostText } = require("./disaster-social-disaster-relevance");

const DEFAULT_OFFICIAL_X_FEED_URL =
  "https://raw.githubusercontent.com/toropoo-web/kumamoto-disaster-x-feed/main/data/posts.json";
const DEFAULT_X_CROSS_SEARCH_FEED_URL =
  process.env.X_CROSS_SEARCH_FEED_URL ||
  "https://raw.githubusercontent.com/toropoo-web/kumamoto-disaster-x-feed/main/data/posts-cross-search.json";
const DEFAULT_X_SOURCE_ID = "SOC-X-CROSS-SEARCH";
const LOCAL_CROSS_SEARCH_FEED_FALLBACK = path.join(
  __dirname,
  "..",
  "..",
  "kumamoto-disaster-x-feed",
  "data",
  "posts-cross-search.json"
);

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
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

function normalizePostsPayload(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (payload && Array.isArray(payload.posts)) {
    return payload.posts;
  }
  if (payload && Array.isArray(payload.items)) {
    return payload.items;
  }
  return [];
}

function resolveCrossSearchFeedSource(options) {
  options = options || {};
  if (options.xFeedFile && fs.existsSync(options.xFeedFile)) {
    return {
      source: options.xFeedFile,
      kind: "file"
    };
  }
  const envFile = process.env.X_CROSS_SEARCH_FEED_FILE;
  if (envFile && fs.existsSync(envFile)) {
    return {
      source: envFile,
      kind: "file"
    };
  }
  if (options.xFeedUrl) {
    return {
      source: options.xFeedUrl,
      kind: "url"
    };
  }
  return {
    source: DEFAULT_X_CROSS_SEARCH_FEED_URL,
    kind: "url"
  };
}

async function loadCrossSearchFeedPayload(options) {
  const resolved = resolveCrossSearchFeedSource(options);
  if (resolved.kind === "file") {
    return {
      payload: readJsonFile(resolved.source),
      feedSource: resolved.source
    };
  }
  try {
    return {
      payload: await fetchJson(resolved.source),
      feedSource: resolved.source
    };
  } catch (err) {
    if (
      fs.existsSync(LOCAL_CROSS_SEARCH_FEED_FALLBACK) &&
      /HTTP 404/.test(String(err && err.message))
    ) {
      return {
        payload: readJsonFile(LOCAL_CROSS_SEARCH_FEED_FALLBACK),
        feedSource: LOCAL_CROSS_SEARCH_FEED_FALLBACK
      };
    }
    throw err;
  }
}

function getScopeMunicipalities(scopePayload) {
  return (scopePayload || loadEvacuationAlertScope()).municipalities.slice();
}

function getPostText(post) {
  return [post.title, post.summary, post.content, post.text, post.caption]
    .filter(function (value) {
      return typeof value === "string" && value.trim();
    })
    .join(" ")
    .trim();
}

function resolveMunicipalityFromPost(post, scopeMunicipalities) {
  if (post.municipality && isInCommunityScope(post.municipality)) {
    return post.municipality;
  }
  const regions = Array.isArray(post.regions) ? post.regions : [];
  for (let i = 0; i < regions.length; i += 1) {
    const region = String(regions[i] || "").trim();
    if (region && isInCommunityScope(region)) {
      return region;
    }
  }
  const text = getPostText(post);
  const regionText = Array.isArray(post.regions) ? post.regions.join(" ") : "";
  const haystack = text + " " + regionText;
  const sorted = scopeMunicipalities.slice().sort(function (a, b) {
    return b.length - a.length;
  });
  for (let i = 0; i < sorted.length; i += 1) {
    if (haystack.indexOf(sorted[i]) !== -1) {
      return sorted[i];
    }
  }
  return "";
}

function resolveRelatedRegionKeywords(post) {
  const keywords = [];
  const regions = Array.isArray(post.regions) ? post.regions : [];
  regions.forEach(function (region) {
    const value = String(region || "").trim();
    if (value && keywords.indexOf(value) === -1) {
      keywords.push(value);
    }
  });
  const text = getPostText(post);
  ["熊本県", "鹿児島県", "熊本", "鹿児島"].forEach(function (token) {
    if (text.indexOf(token) !== -1 && keywords.indexOf(token) === -1) {
      keywords.push(token);
    }
  });
  return keywords;
}

function resolvePrefectureFromPost(post, municipality) {
  if (municipality) {
    return resolveMunicipalityPrefecture(municipality);
  }
  const text = getPostText(post);
  const regions = Array.isArray(post.regions) ? post.regions.join(" ") : "";
  const haystack = text + " " + regions;
  if (haystack.indexOf("鹿児島") !== -1) {
    return "鹿児島県";
  }
  return "熊本県";
}

function resolvePostRegionMetadata(post, scopeMunicipalities) {
  const municipality = resolveMunicipalityFromPost(post, scopeMunicipalities);
  return {
    municipality: municipality,
    prefecture: resolvePrefectureFromPost(post, municipality),
    keywords: resolveRelatedRegionKeywords(post)
  };
}

function resolveCommunityCategory(post) {
  const text = getPostText(post);
  const resolved = resolveCategoryFromKeyword(text);
  if (COMMUNITY_FETCH_CATEGORIES.indexOf(resolved) !== -1) {
    return resolved;
  }
  return "OTHER";
}

function resolveXSourceId() {
  return DEFAULT_X_SOURCE_ID;
}

function buildTitle(text) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "SNS投稿";
  }
  const firstLine = normalized.split(/[\n。]/)[0].trim();
  if (firstLine.length <= 80) {
    return firstLine;
  }
  return firstLine.slice(0, 77) + "...";
}

function sanitizeInboxId(prefix, rawId) {
  const safe = String(rawId || "")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 48);
  return prefix + "-" + (safe || String(Date.now()));
}

function isActivePost(post) {
  return post && (!post.status || post.status === "ACTIVE");
}

function matchesMunicipalityScope(post, scopeMunicipalities) {
  const municipality = resolveMunicipalityFromPost(post, scopeMunicipalities);
  if (municipality && isInCommunityScope(municipality)) {
    return true;
  }
  const regions = Array.isArray(post.regions) ? post.regions : [];
  return regions.some(function (region) {
    return isInCommunityScope(region);
  });
}

function xPostToInboxItem(post, index, scopeMunicipalities) {
  const postDate = String(post.postedAt || post.post_time || post.published_at || "").slice(0, 10);
  if (!isOnOrAfterSnsFetchSinceDate(postDate)) {
    return null;
  }
  if (!matchesMunicipalityScope(post, scopeMunicipalities)) {
    return null;
  }
  const text = getPostText(post);
  if (!text || !isDisasterRelevantPostText(text)) {
    return null;
  }
  const regionMeta = resolvePostRegionMetadata(post, scopeMunicipalities);
  const url = resolveSnsPostUrlFromFeedPost(post, "X");
  if (!url || !isXPostUrl(url)) {
    return null;
  }
  const publishedAt = post.postedAt || post.post_time || post.published_at || "";
  const sourceAccount = post.accountHandle || post.account || post.username || "";
  const item = normalizeInboxItem(
    {
      inbox_id: sanitizeInboxId("SNS-X", post.postId || post.id || index + 1),
      import_format: "SNS",
      source_type: "X",
      captured_at: post.fetchedAt || publishedAt || new Date().toISOString(),
      published_at: publishedAt,
      source_account: sourceAccount,
      source: resolveXSourceId(),
      category: resolveCommunityCategory(post),
      prefecture: regionMeta.prefecture,
      municipality: regionMeta.municipality,
      district: "",
      date: postDate,
      title: buildTitle(text),
      content: text,
      url: url,
      post_url: url,
      keywords: regionMeta.keywords,
      sns_fetch: {
        platform: "X",
        source_post_id: post.postId || post.id || "",
        acquisition_mode: post.acquisition_mode || "SEARCH_CROSS",
        source_account: sourceAccount,
        post_url: url,
        fetched_at: new Date().toISOString()
      }
    },
    index
  );
  return item;
}

function dedupeInboxItems(items) {
  const seen = new Set();
  const deduped = [];
  items.forEach(function (item) {
    if (!item || !item.dedupe_key || seen.has(item.dedupe_key)) {
      return;
    }
    seen.add(item.dedupe_key);
    deduped.push(item);
  });
  return deduped;
}

async function fetchXInboxItems(options) {
  options = options || {};
  const scopeMunicipalities = getScopeMunicipalities(options.scopePayload);
  const feedResult = await loadCrossSearchFeedPayload(options);
  const feedUrl = feedResult.feedSource;
  const payload = feedResult.payload;
  const posts = normalizePostsPayload(payload).filter(isActivePost);
  const items = [];
  posts.forEach(function (post, index) {
    const item = xPostToInboxItem(post, index, scopeMunicipalities);
    if (item) {
      items.push(item);
    }
  });
  return {
    platform: "X",
    feed_url: feedUrl,
    source_post_count: posts.length,
    inbox_item_count: items.length,
    items: items
  };
}

async function fetchDisasterSocialSnsInbox(options) {
  options = options || {};
  const xResult = await fetchXInboxItems(options);
  const items = dedupeInboxItems(xResult.items.slice());
  const municipalitySummary = {};
  items.forEach(function (item) {
    const key = item.municipality || "UNKNOWN";
    municipalitySummary[key] = (municipalitySummary[key] || 0) + 1;
  });
  const categorySummary = {};
  items.forEach(function (item) {
    const key = item.category || "OTHER";
    categorySummary[key] = (categorySummary[key] || 0) + 1;
  });
  return {
    phase: "DISASTER_X_CROSS_SEARCH_SOURCE_SEPARATION",
    acquisition_mode: "SNS_SEARCH_CROSS_FETCH",
    region_filter_at_search: true,
    since_date: SNS_FETCH_SINCE_DATE,
    fetch_categories: COMMUNITY_FETCH_CATEGORIES.slice(),
    ai_judgment: false,
    fetched_at: new Date().toISOString(),
    platforms: {
      X: {
        feed_url: xResult.feed_url,
        source_post_count: xResult.source_post_count,
        inbox_item_count: xResult.inbox_item_count
      }
    },
    inbox_item_count: items.length,
    municipality_summary: municipalitySummary,
    category_summary: categorySummary,
    items: items
  };
}

module.exports = {
  DEFAULT_OFFICIAL_X_FEED_URL,
  DEFAULT_X_CROSS_SEARCH_FEED_URL,
  LOCAL_CROSS_SEARCH_FEED_FALLBACK,
  resolveCrossSearchFeedSource,
  loadCrossSearchFeedPayload,
  fetchXInboxItems,
  fetchDisasterSocialSnsInbox,
  xPostToInboxItem,
  dedupeInboxItems,
  resolveMunicipalityFromPost,
  resolvePostRegionMetadata,
  matchesMunicipalityScope,
  resolveCommunityCategory
};

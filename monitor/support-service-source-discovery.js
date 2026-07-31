"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SOURCE_TIER_REGISTRY_FILE = path.join(
  ROOT,
  "data",
  "support_service_discovery",
  "source_tier_registry.json"
);
const {
  loadSupportServiceFacilityRegistry,
  findFacilityRecord
} = require("./support-service-facility-registry");
const X_FEED_PREVIEW_FILE = path.join(ROOT, "data", "public", "x_feed_preview.json");

const {
  SUPPORT_STATE_KEYWORDS,
  COMPOUND_DISCOVERY_PHRASES,
  TOPIC_KEYWORD_GROUPS,
  DISCOVERY_EXCLUSION_PATTERNS,
  evaluateXDiscoveryText,
  isNormalBusinessExclusion,
  isExcludedDiscoveryText,
  isDiscoverableSupportServicePost,
  matchesDiscoveryKeyword
} = require("./support-service-x-discovery");

const PRIMARY_DISCOVERY_KEYWORDS = ["無料開放", "開放"];
const SECONDARY_DISCOVERY_KEYWORDS = SUPPORT_STATE_KEYWORDS.filter(function (keyword) {
  return PRIMARY_DISCOVERY_KEYWORDS.indexOf(keyword) === -1;
});

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function loadSourceTierRegistry(options) {
  options = options || {};
  return readJson(options.tierRegistryPath || SOURCE_TIER_REGISTRY_FILE, { version: "1.0", tiers: {} });
}

function loadFacilityRegistry(options) {
  return loadSupportServiceFacilityRegistry(options);
}

function inferSourceTier(post) {
  const registry = loadSourceTierRegistry();
  const hay = normalizeText(
    [
      post.account,
      post.account_name,
      post.text,
      post.source_type,
      post.source_url,
      post.facility_name
    ].join(" ")
  );

  const tierOrder = ["TIER1", "TIER2", "TIER3", "TIER4"];
  for (let i = 0; i < tierOrder.length; i += 1) {
    const tierKey = tierOrder[i];
    const tier = registry.tiers[tierKey];
    if (!tier || !Array.isArray(tier.patterns)) {
      continue;
    }
    for (let j = 0; j < tier.patterns.length; j += 1) {
      if (hay.indexOf(tier.patterns[j]) !== -1) {
        return {
          source_tier: tierKey,
          source_confidence: tier.source_confidence,
          source_tier_label: tier.label
        };
      }
    }
  }

  const tier4 = registry.tiers.TIER4 || { source_confidence: "LOW", label: "個人投稿" };
  return {
    source_tier: "TIER4",
    source_confidence: tier4.source_confidence,
    source_tier_label: tier4.label
  };
}

function resolveFacilityRecord(facilityName, options) {
  options = options || {};
  const registry = loadFacilityRegistry(options);
  return findFacilityRecord(registry, facilityName);
}

function complementCandidateFromFacilityRegistry(candidate, options) {
  const unknownDefaults = {
    address: "UNKNOWN",
    municipality: "UNKNOWN",
    website: "UNKNOWN",
    web_complement_status: "UNKNOWN"
  };

  if (!candidate || !candidate.facility_name) {
    return Object.assign({}, candidate, unknownDefaults, {
      address: candidate && candidate.address ? candidate.address : "UNKNOWN",
      municipality: candidate && candidate.municipality ? candidate.municipality : "UNKNOWN",
      website: candidate && candidate.website ? candidate.website : "UNKNOWN"
    });
  }

  const facility = resolveFacilityRecord(candidate.facility_name, options);
  if (!facility) {
    return Object.assign({}, candidate, unknownDefaults, {
      address: candidate.address || "UNKNOWN",
      municipality: candidate.municipality || "UNKNOWN",
      website: candidate.website || "UNKNOWN"
    });
  }

  return Object.assign({}, candidate, {
    facility_id: facility.facility_id,
    facility_name: facility.facility_name,
    address: facility.address || "UNKNOWN",
    municipality: facility.municipality || "UNKNOWN",
    website: facility.website || "UNKNOWN",
    web_complement_status: "RESOLVED"
  });
}

function normalizeXFeedPost(post) {
  if (!post) {
    return null;
  }

  const publishedAt = post.post_time ? String(post.post_time).slice(0, 10) : null;

  return {
    source_type: "X",
    source_url: post.url || "",
    account: post.account_handle || post.account_name || "",
    account_name: post.account_name || "",
    text: post.text || "",
    municipality: post.municipality || null,
    prefecture: null,
    published_at: publishedAt,
    source_id: post.source_id || null,
    x_source_type: post.source_type || null
  };
}

function loadXFeedPosts(options) {
  options = options || {};
  const feedPath = options.feedPath || X_FEED_PREVIEW_FILE;
  const feed = readJson(feedPath, { posts: [] });
  return (feed.posts || [])
    .map(normalizeXFeedPost)
    .filter(function (post) {
      return Boolean(post);
    });
}

function loadXFeedDiscoveryPosts(options) {
  return loadXFeedPosts(options).filter(function (post) {
    return isDiscoverableSupportServicePost(post);
  });
}

function discoverXFeedSupportServiceCandidates(options) {
  options = options || {};
  const { discoverSupportServiceCandidates } = require("./support-service-discovery-engine");
  const posts = loadXFeedDiscoveryPosts(options);
  return discoverSupportServiceCandidates(posts, {
    referenceDate: options.referenceDate,
    sourceRegistry: options.sourceRegistry,
    persistSourceRegistry: options.persistSourceRegistry === true
  });
}

function mergeCandidateBatches(existingBatch, incomingBatch) {
  const mergedMap = new Map();

  ((existingBatch && existingBatch.candidates) || []).forEach(function (candidate) {
    if (candidate && candidate.candidate_id) {
      mergedMap.set(candidate.candidate_id, candidate);
    }
  });

  ((incomingBatch && incomingBatch.candidates) || []).forEach(function (candidate) {
    if (candidate && candidate.candidate_id) {
      mergedMap.set(candidate.candidate_id, candidate);
    }
  });

  const candidates = Array.from(mergedMap.values());
  return {
    version: "1.0",
    category: "SUPPORT_SERVICE",
    generated_at: new Date().toISOString(),
    AUTO_PUBLISH: false,
    auto_publish: false,
    candidate_count: candidates.length,
    in_area_count: candidates.filter(function (entry) {
      return entry.status === "NEW";
    }).length,
    out_of_area_count: candidates.filter(function (entry) {
      return entry.status === "OUT_OF_AREA";
    }).length,
    excluded_count: incomingBatch.excluded_count || 0,
    candidates: candidates
  };
}

module.exports = {
  SOURCE_TIER_REGISTRY_FILE,
  X_FEED_PREVIEW_FILE,
  PRIMARY_DISCOVERY_KEYWORDS,
  SECONDARY_DISCOVERY_KEYWORDS,
  SUPPORT_STATE_KEYWORDS,
  COMPOUND_DISCOVERY_PHRASES,
  TOPIC_KEYWORD_GROUPS,
  DISCOVERY_EXCLUSION_PATTERNS,
  loadSourceTierRegistry,
  loadFacilityRegistry,
  inferSourceTier,
  evaluateXDiscoveryText,
  isNormalBusinessExclusion,
  matchesDiscoveryKeyword,
  isExcludedDiscoveryText,
  isDiscoverableSupportServicePost,
  resolveFacilityRecord,
  complementCandidateFromFacilityRegistry,
  normalizeXFeedPost,
  loadXFeedPosts,
  loadXFeedDiscoveryPosts,
  discoverXFeedSupportServiceCandidates,
  mergeCandidateBatches
};

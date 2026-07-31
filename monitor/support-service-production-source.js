"use strict";

const fs = require("fs");
const path = require("path");

const {
  SOURCE_PLATFORMS,
  loadSupportServiceSourceRegistry,
  validateSupportServiceSourceRecord,
  validateSupportServiceSourceRegistry,
  sourceRecordKey
} = require("./support-service-source-registry");

const {
  collectPatrolPostsFromRegistry
} = require("./support-service-patrol-fetcher");

const {
  discoverSupportServiceCandidates,
  AUTO_PUBLISH
} = require("./support-service-discovery-engine");

const ROOT = path.join(__dirname, "..");
const PRODUCTION_SOURCE_FIXTURE_DIR = path.join(
  ROOT,
  "monitor",
  "fixtures",
  "support-service-production-source"
);
const PRODUCTION_REGISTRY_FIXTURE = path.join(
  PRODUCTION_SOURCE_FIXTURE_DIR,
  "production-registry-fixture.json"
);
const PRODUCTION_X_FEED_FIXTURE = path.join(
  PRODUCTION_SOURCE_FIXTURE_DIR,
  "x-feed-fixture.json"
);
const PRODUCTION_WEB_POSTS_FIXTURE = path.join(
  PRODUCTION_SOURCE_FIXTURE_DIR,
  "web-posts-fixture.json"
);

const PRODUCTION_SOURCE_CATEGORIES = [
  "FREE_OPEN",
  "BATH",
  "SHOWER",
  "SPACE",
  "TOILET",
  "VEHICLE",
  "FOOD",
  "SUPPLIES",
  "PET"
];

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeUrl(value) {
  return normalizeText(value).replace(/\/+$/, "").toLowerCase();
}

function findSourceById(registry, sourceId) {
  return (registry.sources || []).find(function (entry) {
    return entry.source_id === sourceId;
  });
}

function findSourceByAccount(registry, account) {
  const normalized = normalizeText(account).toLowerCase();
  return (registry.sources || []).find(function (entry) {
    return normalizeText(entry.account).toLowerCase() === normalized;
  });
}

function findSourceByUrl(registry, url) {
  const normalized = normalizeUrl(url);
  return (registry.sources || []).find(function (entry) {
    return normalizeUrl(entry.url) === normalized;
  });
}

function findSourceByName(registry, sourceName) {
  const normalized = normalizeText(sourceName);
  return (registry.sources || []).find(function (entry) {
    return normalizeText(entry.source_name) === normalized;
  });
}

function mapRegistryCategory(category) {
  if (category === "SHOWER") {
    return { subcategory: "BATH", subcategory_detail: "SHOWER" };
  }
  if (category === "FREE_OPEN") {
    return { opening_type: "FREE_OPEN", subcategory: null, subcategory_detail: null };
  }
  return { subcategory: category, subcategory_detail: null, opening_type: null };
}

function applyRegistryCategories(candidate, registrySource) {
  if (!candidate || !registrySource || !Array.isArray(registrySource.categories)) {
    return candidate;
  }

  const mapped = registrySource.categories
    .map(mapRegistryCategory)
    .find(function (entry) {
      return entry.subcategory || entry.opening_type;
    });

  if (!mapped) {
    return candidate;
  }

  return Object.assign({}, candidate, {
    subcategory: candidate.subcategory || mapped.subcategory,
    subcategory_detail: candidate.subcategory_detail || mapped.subcategory_detail,
    opening_type: candidate.opening_type || mapped.opening_type
  });
}

function validateProductionSourceCategories(record, index) {
  const errors = [];
  const label = "sources[" + index + "]";

  if (!Array.isArray(record.categories)) {
    return errors;
  }

  record.categories.forEach(function (category, categoryIndex) {
    if (PRODUCTION_SOURCE_CATEGORIES.indexOf(category) === -1) {
      errors.push(
        label + ": invalid category categories[" + categoryIndex + "]=" + category
      );
    }
  });

  return errors;
}

function validateProductionSourceDuplicates(registry) {
  const errors = [];
  const accounts = new Map();
  const urls = new Map();
  const names = new Map();

  (registry.sources || []).forEach(function (record, index) {
    const label = "sources[" + index + "]";

    const account = normalizeText(record.account);
    if (account) {
      if (accounts.has(account)) {
        errors.push(label + ": duplicate account " + account);
      } else {
        accounts.set(account, record.source_id);
      }
    }

    const url = normalizeUrl(record.url);
    if (url) {
      if (urls.has(url)) {
        errors.push(label + ": duplicate url " + record.url);
      } else {
        urls.set(url, record.source_id);
      }
    }

    const sourceName = normalizeText(record.source_name);
    if (sourceName) {
      if (names.has(sourceName)) {
        errors.push(label + ": duplicate source_name " + record.source_name);
      } else {
        names.set(sourceName, record.source_id);
      }
    }
  });

  return errors;
}

function validateProductionSourceRecord(record, index) {
  const errors = validateSupportServiceSourceRecord(record, index);
  errors.push.apply(errors, validateProductionSourceCategories(record, index));

  ["source_id", "source_name", "platform", "area"].forEach(function (field) {
    if (!record || !normalizeText(record[field])) {
      errors.push("sources[" + index + "]: missing required field " + field);
    }
  });

  if (record && SOURCE_PLATFORMS.indexOf(record.platform) === -1) {
    errors.push("sources[" + index + "]: platform must be X or WEB");
  }

  return errors;
}

function validateProductionSourceRegistry(registry) {
  const errors = validateSupportServiceSourceRegistry(registry);
  errors.push.apply(errors, validateProductionSourceDuplicates(registry));

  (registry.sources || []).forEach(function (record, index) {
    const recordErrors = validateProductionSourceRecord(record, index);
    recordErrors.forEach(function (message) {
      if (errors.indexOf(message) === -1) {
        errors.push(message);
      }
    });
  });

  return errors;
}

function assertProductionSourceRegistration(registry, record) {
  const errors = validateProductionSourceRecord(record, (registry.sources || []).length);
  if (errors.length) {
    return { ok: false, errors: errors };
  }

  const nextRegistry = Object.assign({}, registry, {
    sources: (registry.sources || []).slice()
  });

  if (record.account && findSourceByAccount(nextRegistry, record.account)) {
    return { ok: false, errors: ["duplicate account: " + record.account] };
  }
  if (record.url && findSourceByUrl(nextRegistry, record.url)) {
    return { ok: false, errors: ["duplicate url: " + record.url] };
  }
  if (record.source_name && findSourceByName(nextRegistry, record.source_name)) {
    return { ok: false, errors: ["duplicate source_name: " + record.source_name] };
  }

  const key = sourceRecordKey(record);
  if (
    nextRegistry.sources.some(function (entry) {
      return sourceRecordKey(entry) === key;
    })
  ) {
    return { ok: false, errors: ["duplicate source key: " + key] };
  }

  nextRegistry.sources.push(record);
  const registryErrors = validateProductionSourceRegistry(nextRegistry);
  if (registryErrors.length) {
    return { ok: false, errors: registryErrors };
  }

  return { ok: true, registry: nextRegistry };
}

function loadProductionDiscoveryPosts(registry, options) {
  options = options || {};
  return collectPatrolPostsFromRegistry(registry, {
    fixture: true,
    fixturePath: options.fixturePath || PRODUCTION_WEB_POSTS_FIXTURE,
    xFeedPath: options.xFeedPath || PRODUCTION_X_FEED_FIXTURE,
    referenceDate: options.referenceDate
  });
}

function runProductionSourceDiscovery(registry, options) {
  options = options || {};
  const registryErrors = validateProductionSourceRegistry(registry);
  if (registryErrors.length) {
    return {
      ok: false,
      AUTO_PUBLISH: AUTO_PUBLISH,
      errors: registryErrors,
      batch: null,
      collected: null
    };
  }

  const collected = loadProductionDiscoveryPosts(registry, options);
  const batch = discoverSupportServiceCandidates(collected.posts, {
    referenceDate: collected.referenceDate,
    sourceRegistry: registry,
    persistSourceRegistry: false,
    requireDiscoverable: options.requireDiscoverable !== false
  });

  const registryLookup = {};
  (registry.sources || []).forEach(function (source) {
    registryLookup[source.source_id] = source;
  });

  const candidates = (batch.candidates || []).map(function (candidate) {
    const source = registryLookup[candidate.source_id] || null;
    let next = Object.assign({}, candidate, {
      area: source && source.area ? source.area : candidate.area || "UNKNOWN"
    });
    next = applyRegistryCategories(next, source);
    return next;
  });

  const enrichedBatch = Object.assign({}, batch, {
    candidates: candidates,
    candidate_count: candidates.length,
    in_area_count: candidates.filter(function (entry) {
      return entry.status === "NEW";
    }).length,
    out_of_area_count: candidates.filter(function (entry) {
      return entry.status === "OUT_OF_AREA";
    }).length
  });

  return {
    ok: true,
    AUTO_PUBLISH: AUTO_PUBLISH,
    errors: [],
    collected: collected,
    batch: enrichedBatch
  };
}

function loadProductionRegistryFixture() {
  return JSON.parse(fs.readFileSync(PRODUCTION_REGISTRY_FIXTURE, "utf8"));
}

module.exports = {
  PRODUCTION_SOURCE_FIXTURE_DIR,
  PRODUCTION_REGISTRY_FIXTURE,
  PRODUCTION_X_FEED_FIXTURE,
  PRODUCTION_WEB_POSTS_FIXTURE,
  PRODUCTION_SOURCE_CATEGORIES,
  AUTO_PUBLISH,
  normalizeUrl,
  findSourceById,
  findSourceByAccount,
  findSourceByUrl,
  findSourceByName,
  mapRegistryCategory,
  applyRegistryCategories,
  validateProductionSourceCategories,
  validateProductionSourceDuplicates,
  validateProductionSourceRecord,
  validateProductionSourceRegistry,
  assertProductionSourceRegistration,
  loadProductionDiscoveryPosts,
  runProductionSourceDiscovery,
  loadProductionRegistryFixture
};

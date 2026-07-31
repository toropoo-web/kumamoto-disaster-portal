"use strict";

const fs = require("fs");
const path = require("path");

const { REGION_KYUSHU_SOUTH, PREFECTURES } = require("./disaster-sources");
const {
  loadMunicipalityMaster,
  matchesRegionGroupToken,
  validateMunicipalityMaster
} = require("./disaster-social-municipality-master");
const {
  loadCommunityRegionMaster,
  matchesPrefectureGroupToken,
  buildCommunityRegionHaystack
} = require("./disaster-social-region-master");
const { resolveExternalUrl } = require("./disaster-social-url");
const {
  enrichSocialIndexPayload,
  normalizeSocialSourcesPayload
} = require("./disaster-social-source-display");
const {
  filterPublicCommunityEntries,
  filterPublicCommunitySources,
  isInstagramCommunityEntry
} = require("./disaster-social-public-filter");
const {
  buildEntryContentHaystack,
  matchesMunicipalityRegionToken,
  matchesSocialSearchQuery,
  describeSocialSearchMatch,
  findMatchedCategoryKeyword
} = require("./disaster-social-search-match");

const ROOT = path.join(__dirname, "..");
const SOURCES_FILE = path.join(ROOT, "data", "community", "disaster_social_sources.json");
const INDEX_FILE = path.join(ROOT, "data", "community", "disaster_social_index.json");
const PUBLIC_SOURCES_FILE = path.join(ROOT, "data", "public", "disaster_social_sources.json");
const PUBLIC_INDEX_FILE = path.join(ROOT, "data", "public", "disaster_social_index.json");

const SOCIAL_CATEGORIES = [
  "WATER",
  "FOOD",
  "SUPPLIES",
  "TOILET",
  "CHARGING",
  "VOLUNTEER",
  "BATH",
  "SHOWER",
  "FREE_SPACE",
  "SHELTER",
  "PET_SUPPORT",
  "WIFI",
  "OTHER",
  "TRANSPORT",
  "MEDICAL"
];

const SOCIAL_CATEGORY_UI_ORDER = [
  "WATER",
  "FOOD",
  "SUPPLIES",
  "TOILET",
  "CHARGING",
  "BATH",
  "SHOWER",
  "FREE_SPACE",
  "SHELTER",
  "PET_SUPPORT",
  "WIFI",
  "VOLUNTEER",
  "OTHER",
  "TRANSPORT",
  "MEDICAL"
];

const SOCIAL_STATUS_VALUES = ["ACTIVE", "ARCHIVED", "incomplete"];

const SOCIAL_CATEGORY_LABELS = {
  WATER: "水",
  FOOD: "食事",
  SUPPLIES: "物資",
  TOILET: "トイレ",
  CHARGING: "充電",
  VOLUNTEER: "ボランティア",
  BATH: "風呂",
  SHOWER: "シャワー",
  FREE_SPACE: "無料スペース",
  SHELTER: "宿泊",
  PET_SUPPORT: "ペット・迷子情報",
  WIFI: "Wi-Fi",
  OTHER: "その他",
  TRANSPORT: "交通・輸送",
  MEDICAL: "医療"
};

const SOCIAL_CATEGORY_KEYWORDS = {
  WATER: ["井戸水", "給水", "飲み水", "生活用水", "飲料水", "水道", "水"],
  FOOD: ["炊き出し", "食事提供", "食料配布", "パン配布", "食料", "食事", "配食", "弁当", "給食"],
  SUPPLIES: ["支援物資", "物資配布", "生活用品", "衛生用品", "物資", "支援物資など"],
  TOILET: [],
  CHARGING: ["電気", "氷", "冷却", "充電"],
  VOLUNTEER: ["ボランティア", "ボランティア募集", "人手不足", "人手募集"],
  BATH: ["風呂", "銭湯", "入浴", "無料開放"],
  SHOWER: ["シャワー", "温水", "入浴設備"],
  FREE_SPACE: ["無料開放", "無料", "スペース", "フリースペース", "休憩場所", "開放場所"],
  SHELTER: ["宿泊", "寝泊まり", "一時利用", "避難場所", "車中泊"],
  PET_SUPPORT: [
    "ペット",
    "犬",
    "猫",
    "犬同伴",
    "猫同伴",
    "ペット可",
    "ペット避難",
    "迷子猫",
    "迷子犬",
    "迷い猫",
    "迷い犬",
    "保護猫",
    "保護犬",
    "飼い主捜索",
    "ペット保護",
    "ペット用品",
    "ペット支援"
  ],
  WIFI: ["wi-fi", "wifi", "ネット", "通信"],
  OTHER: [],
  TRANSPORT: [],
  MEDICAL: []
};

const REQUIRED_ENTRY_FIELDS = [
  "id",
  "source",
  "category",
  "prefecture",
  "municipality",
  "district",
  "date",
  "title",
  "content",
  "url",
  "status"
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

function normalizeSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\u3000/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDateToken(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return normalized;
  }
  const parsed = Date.parse(normalized);
  if (Number.isNaN(parsed)) {
    return normalized.slice(0, 10);
  }
  return new Date(parsed).toISOString().slice(0, 10);
}

function buildRegionHaystack(entry) {
  const keywordText = Array.isArray(entry.keywords) ? entry.keywords.join(" ") : "";
  return normalizeSearchText(
    [
      buildCommunityRegionHaystack(entry),
      entry.title,
      entry.content,
      keywordText
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function buildRegionMetaHaystack(entry) {
  return normalizeSearchText(buildCommunityRegionHaystack(entry));
}

function matchesStructuredLocation(entry, options) {
  options = options || {};
  if (options.prefecture) {
    const token = normalizeSearchText(options.prefecture);
    if (normalizeSearchText(entry.prefecture).indexOf(token) === -1) {
      return false;
    }
  }
  if (options.municipality) {
    const token = normalizeSearchText(options.municipality);
    const contentHay = buildEntryContentHaystack(entry);
    const metaHay = buildRegionMetaHaystack(entry);
    if (!matchesMunicipalityRegionToken(contentHay, metaHay, token)) {
      return false;
    }
  }
  if (options.district) {
    const token = normalizeSearchText(options.district);
    const districtHay = normalizeSearchText(entry.district);
    if (!districtHay || districtHay.indexOf(token) === -1) {
      return false;
    }
  }
  return true;
}

function matchesRegion(entry, regionQuery) {
  const tokens = normalizeSearchText(regionQuery).split(" ").filter(Boolean);
  if (!tokens.length) {
    return true;
  }
  const contentHay = buildEntryContentHaystack(entry);
  const metaHay = buildRegionMetaHaystack(entry);
  return tokens.every(function (token) {
    if (matchesMunicipalityRegionToken(contentHay, metaHay, token)) {
      return true;
    }
    if (matchesRegionGroupToken(entry, token)) {
      return true;
    }
    return matchesPrefectureGroupToken(entry, token);
  });
}

function matchesDate(entry, dateQuery) {
  const normalized = normalizeDateToken(dateQuery);
  if (!normalized) {
    return true;
  }
  return normalizeDateToken(entry.date) === normalized;
}

function buildEntrySearchHaystack(entry) {
  const keywordText = Array.isArray(entry.keywords) ? entry.keywords.join(" ") : "";
  return normalizeSearchText(
    [entry.category, entry.title, entry.content, keywordText].filter(Boolean).join(" ")
  );
}

function matchesCategory(entry, categoryQuery, rawQuery) {
  return matchesSocialSearchQuery(entry, categoryQuery, rawQuery, SOCIAL_CATEGORY_KEYWORDS);
}

function resolveCategoryFromKeyword(text) {
  const token = normalizeSearchText(text);
  if (!token) {
    return "";
  }
  if (SOCIAL_CATEGORIES.indexOf(text) !== -1) {
    return text;
  }
  let resolved = "";
  SOCIAL_CATEGORIES.forEach(function (category) {
    if (resolved) {
      return;
    }
    const keywords = SOCIAL_CATEGORY_KEYWORDS[category] || [];
    keywords.forEach(function (keyword) {
      if (!resolved && token.indexOf(normalizeSearchText(keyword)) !== -1) {
        resolved = category;
      }
    });
    if (!resolved && SOCIAL_CATEGORY_LABELS[category]) {
      if (normalizeSearchText(SOCIAL_CATEGORY_LABELS[category]).indexOf(token) !== -1) {
        resolved = category;
      }
    }
  });
  return resolved;
}

function resolveSocialCategoryInput(text) {
  const raw = String(text || "").trim();
  if (!raw) {
    return { category: "", query: "" };
  }
  if (SOCIAL_CATEGORIES.indexOf(raw) !== -1) {
    return { category: raw, query: raw };
  }
  const labelMatch = SOCIAL_CATEGORIES.find(function (categoryKey) {
    return SOCIAL_CATEGORY_LABELS[categoryKey] === raw;
  });
  if (labelMatch) {
    return { category: labelMatch, query: raw };
  }
  return {
    category: resolveCategoryFromKeyword(raw),
    query: raw
  };
}

function findCategoryMatchKeyword(entry, categoryId, rawQuery) {
  return findMatchedCategoryKeyword(
    buildEntryContentHaystack(entry),
    categoryId,
    rawQuery || "",
    SOCIAL_CATEGORY_KEYWORDS
  );
}

function describeSocialCategoryMatch(entry, resolvedCategory, userQuery) {
  return describeSocialSearchMatch(
    entry,
    resolvedCategory,
    userQuery,
    SOCIAL_CATEGORY_LABELS,
    SOCIAL_CATEGORY_KEYWORDS
  );
}

function searchDisasterSocialIndex(indexPayload, options) {
  options = options || {};
  const entries = (indexPayload && indexPayload.entries) || [];
  const categoryResolution = resolveSocialCategoryInput(options.categoryQuery || options.category || "");
  const resolvedCategory = categoryResolution.category;

  const hasStructured = Boolean(options.prefecture || options.municipality || options.district);
  const hasRegion = Boolean(normalizeSearchText(options.region));
  const hasDate = Boolean(normalizeDateToken(options.date));
  const hasCategory = Boolean(resolvedCategory);

  if (!hasRegion && !hasStructured && !hasDate && !hasCategory) {
    return [];
  }

  return entries
    .filter(function (entry) {
      if (isInstagramCommunityEntry(entry)) {
        return false;
      }
      const locationOk = hasStructured
        ? matchesStructuredLocation(entry, options) &&
          (hasRegion ? matchesRegion(entry, options.region) : true)
        : matchesRegion(entry, options.region);

      return (
        locationOk &&
        matchesDate(entry, options.date) &&
        matchesCategory(entry, resolvedCategory, categoryResolution.query)
      );
    })
    .map(function (entry) {
      return {
        entry: entry,
        matchReason: hasCategory
          ? describeSocialCategoryMatch(entry, resolvedCategory, categoryResolution.query)
          : null
      };
    });
}

function validateSocialIndexEntry(entry, index) {
  const label = "entries[" + index + "]";
  const errors = [];

  if (!entry || typeof entry !== "object") {
    errors.push(label + ": entry missing");
    return errors;
  }

  if (!entry.id) {
    errors.push(label + ": missing id");
  }

  if (entry.status === "incomplete") {
    if (entry.status && SOCIAL_STATUS_VALUES.indexOf(entry.status) === -1) {
      errors.push(label + ": invalid status " + entry.status);
    }
    return errors;
  }

  REQUIRED_ENTRY_FIELDS.forEach(function (field) {
    if (field === "url") {
      if (typeof entry.url !== "string") {
        errors.push(label + ": missing url");
      } else if (entry.url && !resolveExternalUrl(entry.url)) {
        errors.push(label + ": blocked url " + entry.url);
      }
      return;
    }
    if (!entry[field]) {
      errors.push(label + ": missing " + field);
    }
  });

  if (entry.category && SOCIAL_CATEGORIES.indexOf(entry.category) === -1) {
    errors.push(label + ": invalid category " + entry.category);
  }

  if (entry.keywords !== undefined) {
    if (!Array.isArray(entry.keywords)) {
      errors.push(label + ": keywords must be an array");
    } else {
      entry.keywords.forEach(function (keyword, keywordIndex) {
        if (typeof keyword !== "string" || !keyword.trim()) {
          errors.push(label + ": keywords[" + keywordIndex + "] must be a non-empty string");
        }
      });
    }
  }

  if (entry.source_type) {
    const SOURCE_TYPE_VALUES = ["X", "Instagram", "WEB", "MANUAL", "OTHER"];
    if (SOURCE_TYPE_VALUES.indexOf(entry.source_type) === -1) {
      errors.push(label + ": invalid source_type " + entry.source_type);
    }
  }

  if (entry.prefecture_group !== undefined && entry.prefecture_group !== null && typeof entry.prefecture_group !== "string") {
    errors.push(label + ": prefecture_group must be a string");
  }
  if (entry.region_group !== undefined && entry.region_group !== null && typeof entry.region_group !== "string") {
    errors.push(label + ": region_group must be a string");
  }

  ["prefecture", "municipality", "district"].forEach(function (field) {
    if (entry[field] === undefined || entry[field] === null) {
      errors.push(label + ": missing " + field);
    }
  });

  if (entry.status && SOCIAL_STATUS_VALUES.indexOf(entry.status) === -1) {
    errors.push(label + ": invalid status " + entry.status);
  }

  if (entry.date && !/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) {
    errors.push(label + ": invalid date format");
  }

  return errors;
}

function validateDisasterSocialIndex(payload) {
  const errors = [];
  if (!payload || !Array.isArray(payload.entries)) {
    errors.push("entries must be an array");
    return errors;
  }

  const ids = new Set();
  payload.entries.forEach(function (entry, index) {
    errors.push.apply(errors, validateSocialIndexEntry(entry, index));
    if (entry.id) {
      if (ids.has(entry.id)) {
        errors.push("duplicate id: " + entry.id);
      }
      ids.add(entry.id);
    }
  });

  return errors;
}

function validateDisasterSocialSources(payload) {
  const errors = [];
  const SOURCE_TYPE_VALUES = ["X", "Instagram", "WEB", "MANUAL", "OTHER"];
  if (!payload || !Array.isArray(payload.sources)) {
    errors.push("sources must be an array");
    return errors;
  }
  payload.sources.forEach(function (source, index) {
    const label = "sources[" + index + "]";
    if (!source.source_id) {
      errors.push(label + ": missing source_id");
    }
    if (!source.name) {
      errors.push(label + ": missing name");
    }
    if (typeof source.source_url !== "string" && typeof source.url !== "string") {
      errors.push(label + ": missing source_url");
    } else {
      const sourceUrl = source.source_url || source.url || "";
      if (sourceUrl && !resolveExternalUrl(sourceUrl)) {
        errors.push(label + ": blocked source_url " + sourceUrl);
      }
    }
    if (source.active !== false && (!source.source_type || SOURCE_TYPE_VALUES.indexOf(source.source_type) === -1)) {
      errors.push(label + ": invalid source_type " + source.source_type);
    }
  });
  return errors;
}

function buildAndWriteDisasterSocialIndex(options) {
  options = options || {};
  const sources = filterPublicCommunitySources(
    normalizeSocialSourcesPayload(
      readJson(options.sourcesPath || SOURCES_FILE, {
        version: "1.0",
        region: REGION_KYUSHU_SOUTH,
        sources: []
      })
    )
  );
  const indexPayload = enrichSocialIndexPayload(
    readJson(options.indexPath || INDEX_FILE, {
      version: "1.0",
      region: REGION_KYUSHU_SOUTH,
      entries: []
    }),
    sources
  );
  const index = Object.assign({}, indexPayload, {
    entries: filterPublicCommunityEntries(indexPayload.entries, sources)
  });

  writeJson(options.publicSourcesPath || PUBLIC_SOURCES_FILE, sources);
  writeJson(options.publicIndexPath || PUBLIC_INDEX_FILE, index);

  return {
    sources: sources,
    index: index,
    meta: {
      source_count: (sources.sources || []).length,
      entry_count: (index.entries || []).length,
      last_updated: new Date().toISOString()
    }
  };
}

module.exports = {
  SOURCES_FILE,
  INDEX_FILE,
  PUBLIC_SOURCES_FILE,
  PUBLIC_INDEX_FILE,
  SOCIAL_CATEGORIES,
  SOCIAL_CATEGORY_UI_ORDER,
  SOCIAL_STATUS_VALUES,
  SOCIAL_CATEGORY_LABELS,
  SOCIAL_CATEGORY_KEYWORDS,
  REQUIRED_ENTRY_FIELDS,
  normalizeSearchText,
  normalizeDateToken,
  buildEntrySearchHaystack,
  matchesCategory,
  resolveCategoryFromKeyword,
  resolveSocialCategoryInput,
  describeSocialCategoryMatch,
  matchesStructuredLocation,
  searchDisasterSocialIndex,
  validateSocialIndexEntry,
  validateDisasterSocialIndex,
  validateDisasterSocialSources,
  buildAndWriteDisasterSocialIndex,
  loadMunicipalityMaster,
  isKumamotoMunicipality: require("./disaster-social-municipality-master").isKumamotoMunicipality,
  matchesRegionGroupToken,
  loadCommunityRegionMaster,
  matchesPrefectureGroupToken,
  validateMunicipalityMaster
};

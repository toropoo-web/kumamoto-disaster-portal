"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const TOP_PAGE_SOURCES_FILE = path.join(
  ROOT,
  "data",
  "municipality_patrol",
  "municipality_top_page_sources.json"
);
const SOURCES_FILE = path.join(ROOT, "monitor", "sources.json");
const WATER_SOURCES_FILE = path.join(ROOT, "data", "water_sources.json");
const DISASTER_SOURCES_FILE = path.join(ROOT, "data", "disaster_sources.json");

const MUNICIPALITY_SOURCE_TYPES = {
  DISASTER_PAGE: "MUNICIPALITY_DISASTER_PAGE",
  EMERGENCY_TOP: "MUNICIPALITY_EMERGENCY_TOP",
  EMERGENCY_LIST: "MUNICIPALITY_EMERGENCY_LIST",
  IMPORTANT_NOTICE: "MUNICIPALITY_IMPORTANT_NOTICE",
  DISASTER_RADIO: "MUNICIPALITY_DISASTER_RADIO",
  WATER_OFFICIAL: "WATER_OFFICIAL",
  SOCIAL_WELFARE: "SOCIAL_WELFARE_COUNCIL",
  SUPPORT_PAGE: "MUNICIPALITY_SUPPORT_PAGE"
};

const TOP_PAGE_SECTIONS = [
  {
    section_id: "EMERGENCY_INFO",
    section_label: "緊急情報",
    slug: "emergency-info",
    municipality_source_type: MUNICIPALITY_SOURCE_TYPES.EMERGENCY_TOP
  },
  {
    section_id: "IMPORTANT_NOTICE",
    section_label: "重要なお知らせ",
    slug: "important-notice",
    municipality_source_type: MUNICIPALITY_SOURCE_TYPES.IMPORTANT_NOTICE
  },
  {
    section_id: "DISASTER_RADIO",
    section_label: "防災無線",
    slug: "disaster-radio",
    municipality_source_type: MUNICIPALITY_SOURCE_TYPES.DISASTER_RADIO
  }
];

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function normalizeUrl(url) {
  return String(url || "")
    .trim()
    .replace(/#.*$/, "")
    .replace(/\/$/, "");
}

function toPatrolSourceId(areaId, slug) {
  return areaId + "-top-" + slug;
}

function loadMunicipalityTopPageRegistry() {
  return readJson(TOP_PAGE_SOURCES_FILE, { version: 1, municipalities: [] });
}

function inferMunicipalitySourceType(entry) {
  if (entry.municipality_source_type) {
    return entry.municipality_source_type;
  }

  if (entry.public_category_id === "WATER") {
    return MUNICIPALITY_SOURCE_TYPES.WATER_OFFICIAL;
  }
  if (entry.public_category_id === "SUPPORT") {
    return MUNICIPALITY_SOURCE_TYPES.SUPPORT_PAGE;
  }
  if (entry.top_page_section_id === "EMERGENCY_INFO") {
    return MUNICIPALITY_SOURCE_TYPES.EMERGENCY_TOP;
  }
  if (entry.top_page_section_id === "IMPORTANT_NOTICE") {
    return MUNICIPALITY_SOURCE_TYPES.IMPORTANT_NOTICE;
  }
  if (entry.top_page_section_id === "DISASTER_RADIO") {
    return MUNICIPALITY_SOURCE_TYPES.DISASTER_RADIO;
  }

  const hay = [entry.url, entry.note, entry.id].filter(Boolean).join(" ");
  if (/smart_alert|防災無線|bosai.*radio/i.test(hay)) {
    return MUNICIPALITY_SOURCE_TYPES.DISASTER_RADIO;
  }
  if (/bousai|saigai|kinkyu|disaster|bosai|smart_alert/i.test(hay)) {
    return MUNICIPALITY_SOURCE_TYPES.DISASTER_PAGE;
  }
  if (entry.patrol_role === "primary") {
    return MUNICIPALITY_SOURCE_TYPES.DISASTER_PAGE;
  }
  return MUNICIPALITY_SOURCE_TYPES.EMERGENCY_LIST;
}

function inferPriority(entry) {
  if (entry.priority) {
    return entry.priority;
  }

  const sourceType = inferMunicipalitySourceType(entry);
  if (
    sourceType === MUNICIPALITY_SOURCE_TYPES.WATER_OFFICIAL ||
    sourceType === MUNICIPALITY_SOURCE_TYPES.SOCIAL_WELFARE ||
    sourceType === MUNICIPALITY_SOURCE_TYPES.SUPPORT_PAGE
  ) {
    return "LOW";
  }
  return entry.patrol_role === "secondary" ? "MEDIUM" : "HIGH";
}

function shouldPreferArticleUpdatedAt(entry) {
  if (entry.prefer_article_updated_at === true) {
    return true;
  }
  return inferMunicipalitySourceType(entry) === MUNICIPALITY_SOURCE_TYPES.WATER_OFFICIAL;
}

function enrichPatrolSource(entry) {
  const municipalitySourceType = inferMunicipalitySourceType(entry);
  return Object.assign({}, entry, {
    source_type: entry.source_type || "official",
    municipality_source_type: municipalitySourceType,
    priority: inferPriority(entry),
    prefer_article_updated_at: shouldPreferArticleUpdatedAt(entry)
  });
}

function expandMunicipalityTopPatrolSources(registry) {
  const municipalities = registry.municipalities || [];
  const sources = [];

  municipalities.forEach(function (entry) {
    TOP_PAGE_SECTIONS.forEach(function (section) {
      sources.push(
        enrichPatrolSource({
          id: toPatrolSourceId(entry.area_id, section.slug),
          area_id: entry.area_id,
          name: entry.municipality,
          category: "municipality",
          url: entry.top_page_url,
          public_category_id: "EMERGENCY",
          status: "ACTIVE",
          source_type: "official",
          patrol_role: "secondary",
          patrol_target: "MUNICIPALITY_TOP",
          top_page_section: section.section_label,
          top_page_section_id: section.section_id,
          municipality_source_type: section.municipality_source_type,
          priority: "HIGH"
        })
      );
    });
  });

  return sources;
}

function getMunicipalityTopPatrolSources() {
  const registry = loadMunicipalityTopPageRegistry();
  return expandMunicipalityTopPatrolSources(registry);
}

function findRegistryEntry(registry, municipalityName) {
  return (registry.municipalities || []).find(function (entry) {
    return entry.municipality === municipalityName;
  });
}

function buildSecondaryWaterSources(registry) {
  const waterRegistry = readJson(WATER_SOURCES_FILE, { sources: [] });
  const sources = [];

  (waterRegistry.sources || []).forEach(function (entry) {
    if (!entry || entry.official !== true || !entry.url) {
      return;
    }

    const municipality = entry.organization;
    const registryEntry = findRegistryEntry(registry, municipality);
    if (!registryEntry) {
      return;
    }

    sources.push(
      enrichPatrolSource({
        id: registryEntry.area_id + "-water-official",
        area_id: registryEntry.area_id,
        name: municipality,
        category: "municipality",
        url: entry.url,
        public_category_id: "WATER",
        status: "ACTIVE",
        source_type: "official",
        patrol_role: "secondary",
        patrol_target: "MUNICIPALITY_WATER",
        municipality_source_type: MUNICIPALITY_SOURCE_TYPES.WATER_OFFICIAL,
        priority: "LOW",
        prefer_article_updated_at: true
      })
    );
  });

  return sources;
}

function buildSocialWelfareSources(registry) {
  const disasterRegistry = readJson(DISASTER_SOURCES_FILE, { sources: [] });
  const sources = [];

  (disasterRegistry.sources || []).forEach(function (entry) {
    if (!entry || entry.official !== true || !entry.url || entry.source_type !== "SOCIAL_WELFARE") {
      return;
    }

    const registryEntry = findRegistryEntry(registry, entry.municipality);
    if (!registryEntry) {
      return;
    }

    sources.push(
      enrichPatrolSource({
        id: registryEntry.area_id + "-social-welfare",
        area_id: registryEntry.area_id,
        name: entry.municipality,
        category: "municipality",
        url: entry.url,
        public_category_id: "SUPPORT",
        status: "ACTIVE",
        source_type: "official",
        patrol_role: "secondary",
        patrol_target: "MUNICIPALITY_SOCIAL_WELFARE",
        municipality_source_type: MUNICIPALITY_SOURCE_TYPES.SOCIAL_WELFARE,
        priority: "LOW"
      })
    );
  });

  return sources;
}

function buildRegistryOverrideSources(registry) {
  const sources = [];

  (registry.municipalities || []).forEach(function (entry) {
    const overrides = [
      { field: "disaster_page_url", type: MUNICIPALITY_SOURCE_TYPES.DISASTER_PAGE, slug: "disaster-page" },
      { field: "emergency_list_url", type: MUNICIPALITY_SOURCE_TYPES.EMERGENCY_LIST, slug: "emergency-list" },
      {
        field: "important_notice_url",
        type: MUNICIPALITY_SOURCE_TYPES.IMPORTANT_NOTICE,
        slug: "important-notice-page"
      },
      { field: "disaster_radio_url", type: MUNICIPALITY_SOURCE_TYPES.DISASTER_RADIO, slug: "disaster-radio-page" },
      { field: "water_official_url", type: MUNICIPALITY_SOURCE_TYPES.WATER_OFFICIAL, slug: "water-official-page" },
      {
        field: "social_welfare_url",
        type: MUNICIPALITY_SOURCE_TYPES.SOCIAL_WELFARE,
        slug: "social-welfare-page"
      }
    ];

    overrides.forEach(function (override) {
      if (!entry[override.field]) {
        return;
      }

      sources.push(
        enrichPatrolSource({
          id: entry.area_id + "-" + override.slug,
          area_id: entry.area_id,
          name: entry.municipality,
          category: "municipality",
          url: entry[override.field],
          public_category_id:
            override.type === MUNICIPALITY_SOURCE_TYPES.WATER_OFFICIAL ? "WATER" : "EMERGENCY",
          status: "ACTIVE",
          source_type: "official",
          patrol_role: override.type === MUNICIPALITY_SOURCE_TYPES.WATER_OFFICIAL ? "secondary" : "primary",
          patrol_target: "MUNICIPALITY_REGISTRY_OVERRIDE",
          municipality_source_type: override.type,
          priority: override.type === MUNICIPALITY_SOURCE_TYPES.WATER_OFFICIAL ? "LOW" : "HIGH",
          prefer_article_updated_at: override.type === MUNICIPALITY_SOURCE_TYPES.WATER_OFFICIAL
        })
      );
    });
  });

  return sources;
}

function mergePatrolSourcesByUrl(sources) {
  const byKey = new Map();

  sources.forEach(function (source) {
    const urlKey = normalizeUrl(source.url);
    if (!urlKey) {
      return;
    }

    const dedupeKey =
      urlKey +
      "|" +
      (source.top_page_section_id || source.municipality_source_type || source.id || "default");
    const enriched = enrichPatrolSource(source);
    const existing = byKey.get(dedupeKey);
    if (!existing) {
      byKey.set(dedupeKey, enriched);
      return;
    }

    const priorityRank = { HIGH: 3, MEDIUM: 2, LOW: 1 };
    const existingRank = priorityRank[existing.priority] || 0;
    const nextRank = priorityRank[enriched.priority] || 0;
    if (nextRank > existingRank) {
      byKey.set(
        dedupeKey,
        Object.assign({}, enriched, {
          id: existing.id || enriched.id,
          prefer_article_updated_at:
            existing.prefer_article_updated_at || enriched.prefer_article_updated_at
        })
      );
    }
  });

  return Array.from(byKey.values());
}

function getMunicipalityPatrolSources() {
  const registry = loadMunicipalityTopPageRegistry();
  const baseSources = readJson(SOURCES_FILE, { municipalities: [] }).municipalities || [];
  const expanded = []
    .concat(baseSources.map(enrichPatrolSource))
    .concat(expandMunicipalityTopPatrolSources(registry))
    .concat(buildSecondaryWaterSources(registry))
    .concat(buildSocialWelfareSources(registry))
    .concat(buildRegistryOverrideSources(registry));

  return mergePatrolSourcesByUrl(expanded);
}

function countSourcesByMunicipality(sources) {
  const counts = {};
  sources.forEach(function (source) {
    counts[source.area_id] = (counts[source.area_id] || 0) + 1;
  });
  return counts;
}

module.exports = {
  TOP_PAGE_SOURCES_FILE,
  TOP_PAGE_SECTIONS,
  MUNICIPALITY_SOURCE_TYPES,
  loadMunicipalityTopPageRegistry,
  expandMunicipalityTopPatrolSources,
  getMunicipalityTopPatrolSources,
  getMunicipalityPatrolSources,
  enrichPatrolSource,
  inferMunicipalitySourceType,
  mergePatrolSourcesByUrl,
  countSourcesByMunicipality,
  normalizeUrl
};

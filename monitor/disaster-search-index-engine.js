"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  buildPatrolTimestampLookup,
  applyPatrolTimestampsToItems
} = require("./patrol-timestamp-lookup");

const {
  REGION_KYUSHU_SOUTH,
  PREFECTURES,
  CATEGORIES,
  WATER_KEYWORDS,
  VOLUNTEER_KEYWORDS,
  CAPABILITY_STATUS,
  CAPABILITY_STATUS_VALUES,
  VOLUNTEER_DISASTER_START_DATE,
  SUPPORT_SERVICE_SUBCATEGORIES,
  OPENING_TYPE,
  OPENING_TYPE_VALUES,
  PROVIDER_TYPE_VALUES,
  SUPPORT_SERVICE_VERIFICATION_STATUS,
  SUPPORT_SERVICE_VERIFICATION_STATUS_VALUES,
  buildVolunteerSchemaExample,
  buildSupportServiceSchemaExample,
  isVolunteerPublishedForCurrentDisaster,
  resolveMunicipality,
  validateVolunteerSchemaExample,
  validateSupportServiceSchemaExample
} = require("./disaster-sources");

const {
  getSupportServiceDictionaryKeywords,
  getSupportServiceDisplayCategoryLabel,
  getSupportServiceStatusLabel,
  matchesSupportServiceRegion,
  buildSupportServiceSearchHaystack,
  SUPPORT_SERVICE_DISPLAY_CATEGORY_LABELS,
  SUPPORT_SERVICE_SEARCH_DICTIONARY,
  SUPPORT_SERVICE_STATUS_LABELS,
  SUPPORT_SERVICE_USER_SEARCH_CAUTION
} = require("./support-service-search-dictionary");

const {
  buildOfficialPostSearchItems,
  POST_CATEGORY_LABELS
} = require("./disaster-post-index-engine");

const ROOT = path.join(__dirname, "..");
const DISASTER_SOURCES_FILE = path.join(ROOT, "data", "disaster_sources.json");
const CROSS_VIEW_FILE = path.join(ROOT, "data", "water_cross_view.json");
const SNAPSHOT_FILE = path.join(__dirname, "reports", "water-snapshots.json");
const SNAPSHOT_SEED_FILE = path.join(__dirname, "baselines", "water-snapshots.seed.json");
const OUTPUT_FILE = path.join(ROOT, "data", "disaster_search_index.json");
const SUPPORT_INFORMATION_PUBLIC_FILE = path.join(
  ROOT,
  "data",
  "public",
  "support_information.json"
);
const PUBLIC_OUTPUT_FILE = path.join(ROOT, "data", "public", "disaster_search_index.json");

const DISASTER_WATER_KEYWORDS = WATER_KEYWORDS.concat(["飲料水", "生活用水"]);

const SUPPORT_SERVICE_SUBCATEGORY_LABELS = {
  BATH: SUPPORT_SERVICE_DISPLAY_CATEGORY_LABELS.BATH,
  SPACE: SUPPORT_SERVICE_DISPLAY_CATEGORY_LABELS.SPACE,
  TOILET: SUPPORT_SERVICE_DISPLAY_CATEGORY_LABELS.TOILET,
  VEHICLE: SUPPORT_SERVICE_DISPLAY_CATEGORY_LABELS.VEHICLE,
  FOOD: SUPPORT_SERVICE_DISPLAY_CATEGORY_LABELS.FOOD,
  SUPPLIES: SUPPORT_SERVICE_DISPLAY_CATEGORY_LABELS.SUPPLIES,
  PET: SUPPORT_SERVICE_DISPLAY_CATEGORY_LABELS.PET
};

const SUPPORT_SERVICE_DETAIL_LABELS = {
  BATH: "風呂",
  SHOWER: "シャワー",
  REST_SPACE: "休憩スペース",
  ROOM: "個室",
  PARKING: "駐車場",
  CAR_CAMP: "車中泊",
  COOKING: "炊き出し"
};

const OPENING_TYPE_LABELS = {
  FREE_OPEN: "無料開放",
  OPEN: "開放",
  SUPPORT: "支援"
};

const PROVIDER_TYPE_LABELS = {
  MUNICIPALITY: "自治体",
  PUBLIC_ORGANIZATION: "公共団体",
  FACILITY: "施設提供",
  COMPANY: "企業",
  ORGANIZATION: "団体",
  INDIVIDUAL: "個人"
};

const SUPPORT_SERVICE_VERIFICATION_LABELS = {
  VERIFIED: "確認済",
  REQUIRES_MANUAL_REVIEW: "要確認"
};

function getSupportServiceSubcategoryLabel(subcategory) {
  return SUPPORT_SERVICE_SUBCATEGORY_LABELS[subcategory] || subcategory || "";
}

function getSupportServiceDetailLabel(detail) {
  return SUPPORT_SERVICE_DETAIL_LABELS[detail] || detail || "";
}

function getOpeningTypeLabel(openingType) {
  return OPENING_TYPE_LABELS[openingType] || openingType || "";
}

function getProviderTypeLabel(providerType) {
  return PROVIDER_TYPE_LABELS[providerType] || providerType || "";
}

function buildSupportServiceTitle(source) {
  const detailLabel = source.subcategory_detail
    ? getSupportServiceDetailLabel(source.subcategory_detail)
    : getSupportServiceSubcategoryLabel(source.subcategory);

  if (source.opening_type === OPENING_TYPE.FREE_OPEN) {
    return "無料" + detailLabel;
  }
  if (source.opening_type === OPENING_TYPE.OPEN) {
    return detailLabel + " 開放";
  }
  return detailLabel + " 支援";
}

function buildSupportServiceKeywords(source) {
  const keywords = Array.isArray(source.keywords) ? source.keywords.slice() : [];
  const dictionaryKeywords = getSupportServiceDictionaryKeywords(
    source.subcategory,
    source.subcategory_detail,
    source.opening_type
  );
  const detectedKeywords = Array.isArray(source.detected_keywords)
    ? source.detected_keywords
    : [];
  const extras = [
    source.subcategory,
    source.subcategory_detail,
    source.opening_type,
    source.provider_type,
    source.facility_name,
    getSupportServiceSubcategoryLabel(source.subcategory),
    getSupportServiceDetailLabel(source.subcategory_detail),
    getOpeningTypeLabel(source.opening_type),
    getProviderTypeLabel(source.provider_type),
    getSupportServiceDisplayCategoryLabel(
      source.subcategory,
      source.subcategory_detail,
      source.opening_type
    )
  ]
    .concat(dictionaryKeywords)
    .concat(detectedKeywords);

  return mergeKeywords(keywords, extras);
}

function buildSupportServiceContent(source, title) {
  const dictionaryKeywords = getSupportServiceDictionaryKeywords(
    source.subcategory,
    source.subcategory_detail,
    source.opening_type
  );
  const detectedKeywords = Array.isArray(source.detected_keywords)
    ? source.detected_keywords
    : [];

  return [
    source.prefecture,
    source.municipality,
    source.address,
    source.area,
    source.facility_name || source.organization,
    title,
    getSupportServiceSubcategoryLabel(source.subcategory),
    getSupportServiceDetailLabel(source.subcategory_detail),
    getOpeningTypeLabel(source.opening_type),
    getProviderTypeLabel(source.provider_type),
    getSupportServiceDisplayCategoryLabel(
      source.subcategory,
      source.subcategory_detail,
      source.opening_type
    ),
    (source.keywords || []).join(" "),
    detectedKeywords.join(" "),
    dictionaryKeywords.join(" ")
  ]
    .filter(Boolean)
    .join(" ");
}

function resolveSupportServiceSourcePlatform(sourceType, explicitPlatform) {
  if (sourceType === "X") {
    return "X";
  }
  if (explicitPlatform) {
    return explicitPlatform;
  }
  return "WEB";
}

function copySupportServicePublicTraceFields(entry, information) {
  if (!information || !entry) {
    return entry;
  }

  if (information.source_type) {
    entry.source_type = information.source_type;
  }
  if (information.source_url) {
    entry.source_url = information.source_url;
  }
  entry.source_platform = resolveSupportServiceSourcePlatform(
    entry.source_type,
    information.source_platform
  );

  if (Array.isArray(information.detected_keywords) && information.detected_keywords.length) {
    entry.detected_keywords = information.detected_keywords.slice();
    entry.keywords = mergeKeywords(entry.keywords || [], information.detected_keywords);
  }

  if (information.source_trace && typeof information.source_trace === "object") {
    entry.source_trace = {
      platform: information.source_trace.platform || information.source_type || "",
      account: information.source_trace.account || "",
      post_url: information.source_trace.post_url || "",
      detected_keywords: Array.isArray(information.source_trace.detected_keywords)
        ? information.source_trace.detected_keywords.slice()
        : entry.detected_keywords || []
    };
  }

  if (information.source_name) {
    entry.source_name = information.source_name;
  }

  return entry;
}

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

function buildIndexId(parts) {
  return (
    "DIDX-" +
    crypto
      .createHash("sha256")
      .update(parts.filter(Boolean).join("|"))
      .digest("hex")
      .slice(0, 12)
      .toUpperCase()
  );
}

function buildSourceLabel(organization) {
  if (!organization) {
    return "公式情報";
  }
  if (/公式/.test(organization)) {
    return organization;
  }
  if (/市$|町$|村$/.test(organization)) {
    return organization + "公式";
  }
  if (/防災|上下水道|企業団/.test(organization)) {
    return organization;
  }
  return organization + "公式";
}

function normalizeSearchText(value) {
  if (!value) {
    return "";
  }

  return String(value)
    .toLowerCase()
    .replace(/\u3000/g, " ")
    .replace(/[\uff01-\uff5e]/g, function (ch) {
      return String.fromCharCode(ch.charCodeAt(0) - 0xfee0);
    })
    .replace(/\s+/g, " ")
    .trim();
}

function mergeKeywords(baseKeywords, extraKeywords) {
  const merged = [];
  const seen = {};

  (baseKeywords || []).concat(extraKeywords || []).forEach(function (keyword) {
    if (!keyword || seen[keyword]) {
      return;
    }
    seen[keyword] = true;
    merged.push(keyword);
  });

  return merged;
}

function readWaterSnapshots(options) {
  options = options || {};
  const snapshotPath = options.snapshotPath || SNAPSHOT_FILE;
  const seedPath = options.snapshotSeedPath || SNAPSHOT_SEED_FILE;

  if (fs.existsSync(snapshotPath)) {
    return readJson(snapshotPath, { version: 1, category: "WATER", sources: {} });
  }

  return readJson(seedPath, { version: 1, category: "WATER", sources: {} });
}

function parseFacilitiesFromOriginalText(originalText) {
  const facilities = [];
  const lines = String(originalText || "").split(/\r?\n/);

  lines.forEach(function (line) {
    const match = line.match(/^施設名[：:]\s*(.+)$/);
    if (match && match[1]) {
      facilities.push(match[1].trim());
    }
  });

  return facilities;
}

function parseMunicipalityFromOriginalText(originalText) {
  const match = String(originalText || "").match(/^自治体[：:]\s*(.+)$/m);
  return match ? match[1].trim() : "";
}

function toLocationIndexEntry(entry, location, sourceLookup) {
  const prefecture = sourceLookup.prefecture || "熊本県";
  const organization = entry.source_label || buildSourceLabel(entry.municipality);
  const keywords = mergeKeywords(DISASTER_WATER_KEYWORDS, []);
  const title = location.status_label || entry.status_label || "給水情報";
  const content = [
    prefecture,
    entry.municipality,
    location.location_name,
    title,
    keywords.join(" ")
  ].join(" ");

  return {
    index_id: buildIndexId([
      "WATER",
      "location",
      location.location_id || entry.municipality,
      location.location_name
    ]),
    category: "WATER",
    prefecture: prefecture,
    municipality: entry.municipality,
    organization: organization,
    title: title,
    content: content,
    keywords: keywords,
    source_type: "MUNICIPALITY",
    source_url: location.source_url || entry.source_url || sourceLookup.url || "",
    official: true,
    updated_at: location.updated_at || entry.last_updated || null
  };
}

function toRegistryIndexEntry(source) {
  const keywords = mergeKeywords(
    DISASTER_WATER_KEYWORDS,
    Array.isArray(source.keywords) ? source.keywords : []
  );
  const organizationLabel = buildSourceLabel(source.organization);
  const title = "給水情報";
  const content = [
    source.prefecture,
    source.municipality,
    source.organization,
    title,
    keywords.join(" ")
  ].join(" ");

  return {
    index_id: buildIndexId(["WATER", "registry", source.source_id]),
    category: "WATER",
    prefecture: source.prefecture,
    municipality: source.municipality,
    organization: organizationLabel,
    title: title,
    content: content,
    keywords: keywords,
    source_type: source.source_type || "MUNICIPALITY",
    source_url: source.url,
    official: true,
    updated_at: null
  };
}

function toSnapshotFacilityIndexEntry(snapshot, facilityName, sourceMeta) {
  const municipality =
    snapshot.municipality ||
    parseMunicipalityFromOriginalText(snapshot.originalText) ||
    sourceMeta.municipality ||
    sourceMeta.organization;
  const prefecture = sourceMeta.prefecture || "熊本県";
  const organization = buildSourceLabel(sourceMeta.organization || municipality);
  const keywords = mergeKeywords(
    DISASTER_WATER_KEYWORDS,
    Array.isArray(snapshot.keywords) ? snapshot.keywords : []
  );
  const title = "給水情報";
  const content = [prefecture, municipality, facilityName, title, keywords.join(" ")].join(" ");

  return {
    index_id: buildIndexId([
      "WATER",
      "snapshot",
      snapshot.source_id || sourceMeta.source_id,
      facilityName
    ]),
    category: "WATER",
    prefecture: prefecture,
    municipality: municipality,
    organization: organization,
    title: title,
    content: content,
    keywords: keywords,
    source_type: sourceMeta.source_type || "MUNICIPALITY",
    source_url: snapshot.url || sourceMeta.url || "",
    official: true,
    updated_at: snapshot.fetched_at || null
  };
}

function buildSourceLookup(disasterSources) {
  const lookup = {};

  (disasterSources.sources || []).forEach(function (source) {
    if (!source || source.category !== "WATER") {
      return;
    }
    lookup[source.source_id] = source;
    lookup[source.organization] = source;
    lookup[source.municipality] = source;
  });

  return lookup;
}

function buildCrossViewLocationItems(crossView, sourceLookup) {
  const items = [];

  (crossView.municipalities || []).forEach(function (entry) {
    const sourceMeta =
      sourceLookup[entry.municipality] ||
      sourceLookup[entry.source_label] || {
        prefecture: "熊本県",
        url: entry.source_url || ""
      };

    (entry.locations || []).forEach(function (location) {
      if (!location || location.source_type !== "official") {
        return;
      }
      if (!location.source_url && !entry.source_url && !sourceMeta.url) {
        return;
      }

      items.push(toLocationIndexEntry(entry, location, sourceMeta));
    });
  });

  return items;
}

function toVolunteerRegistryIndexEntry(source) {
  const keywords = mergeKeywords(
    VOLUNTEER_KEYWORDS,
    Array.isArray(source.keywords) ? source.keywords : []
  );
  const organizationLabel = buildSourceLabel(source.organization);
  const title = "災害ボランティア募集";
  const content = [
    source.prefecture,
    source.municipality,
    source.organization,
    title,
    keywords.join(" "),
    source.capability_status
  ].join(" ");

  return {
    index_id: buildIndexId(["VOLUNTEER", "registry", source.source_id]),
    category: "VOLUNTEER",
    prefecture: source.prefecture,
    municipality: source.municipality,
    organization: organizationLabel,
    title: title,
    content: content,
    keywords: keywords,
    capability_status: source.capability_status,
    published_at: source.published_at,
    disaster_start_date: source.disaster_start_date || VOLUNTEER_DISASTER_START_DATE,
    source_type: source.source_type || "SOCIAL_WELFARE",
    source_url: source.url,
    official: true,
    updated_at: null,
    current_capability: source.current_capability || null
  };
}

function buildVolunteerRegistryItems(disasterSources) {
  const items = [];

  (disasterSources.sources || []).forEach(function (source) {
    if (!source || source.category !== "VOLUNTEER") {
      return;
    }
    if (source.official !== true || source.active !== true) {
      return;
    }
    if (!source.url) {
      return;
    }
    if (source.capability_status === CAPABILITY_STATUS.HISTORICAL_ONLY) {
      return;
    }
    if (!isVolunteerPublishedForCurrentDisaster(source)) {
      return;
    }
    items.push(toVolunteerRegistryIndexEntry(source));
  });

  return items;
}

function toSupportServiceRegistryIndexEntry(source) {
  const keywords = buildSupportServiceKeywords(source);
  const title = buildSupportServiceTitle(source);
  const organizationLabel = source.facility_name || buildSourceLabel(source.organization);
  const content = buildSupportServiceContent(source, title);
  const verificationStatus =
    source.verification_status || SUPPORT_SERVICE_VERIFICATION_STATUS.REQUIRES_MANUAL_REVIEW;

  return {
    index_id: buildIndexId(["SUPPORT_SERVICE", "registry", source.source_id]),
    category: "SUPPORT_SERVICE",
    prefecture: source.prefecture,
    municipality: source.municipality,
    organization: organizationLabel,
    title: title,
    content: content,
    keywords: keywords,
    subcategory: source.subcategory,
    subcategory_detail: source.subcategory_detail || null,
    opening_type: source.opening_type,
    provider_type: source.provider_type,
    facility_name: source.facility_name || source.organization,
    address: source.address || null,
    area: source.municipality || null,
    available_from: source.available_from || null,
    available_until: source.available_until || null,
    verification_status: verificationStatus,
    source_type: source.source_type || "PUBLIC_ORGANIZATION",
    source_url: source.url,
    official: true,
    updated_at: source.available_from || null,
    source_name: source.organization || source.facility_name || null,
    source_platform: resolveSupportServiceSourcePlatform(
      source.source_type,
      source.source_platform
    ),
    checked_at: source.available_from || null,
    information_status: "ACTIVE"
  };
}

function buildSupportServiceRegistryItems(disasterSources) {
  const items = [];

  (disasterSources.sources || []).forEach(function (source) {
    if (!source || source.category !== "SUPPORT_SERVICE") {
      return;
    }
    if (source.official !== true || source.active !== true) {
      return;
    }
    if (!source.url) {
      return;
    }
    items.push(toSupportServiceRegistryIndexEntry(source));
  });

  return items;
}

function buildSupportServiceSourceLookup(disasterSources) {
  const lookup = {};

  (disasterSources.sources || []).forEach(function (source) {
    if (!source || source.category !== "SUPPORT_SERVICE") {
      return;
    }
    lookup[source.source_id] = source;
  });

  return lookup;
}

function toSupportServicePublicIndexEntry(information, sourceMeta) {
  const source = Object.assign({}, sourceMeta || {}, {
    source_id: information.source_id,
    subcategory: information.subcategory || sourceMeta.subcategory,
    subcategory_detail: information.subcategory_detail || sourceMeta.subcategory_detail || null,
    opening_type: information.opening_type || sourceMeta.opening_type,
    provider_type: sourceMeta.provider_type,
    facility_name: information.facility_name || sourceMeta.facility_name,
    organization: information.facility_name || sourceMeta.organization,
    address: information.address || sourceMeta.address || null,
    municipality: information.municipality || sourceMeta.municipality,
    prefecture: sourceMeta.prefecture || "熊本県",
    available_from: information.available_from || sourceMeta.available_from || null,
    available_until:
      information.available_until === "UNKNOWN"
        ? null
        : information.available_until || sourceMeta.available_until || null,
    url: information.source_url || sourceMeta.url,
    source_type: information.source_type || sourceMeta.source_type || null,
    source_platform: information.source_platform || sourceMeta.source_platform || null,
    detected_keywords: Array.isArray(information.detected_keywords)
      ? information.detected_keywords.slice()
      : [],
    verification_status:
      sourceMeta.verification_status || SUPPORT_SERVICE_VERIFICATION_STATUS.REQUIRES_MANUAL_REVIEW,
    keywords: sourceMeta.keywords || []
  });

  const entry = toSupportServiceRegistryIndexEntry(source);
  entry.index_id = buildIndexId(["SUPPORT_SERVICE", "public", information.information_id]);
  entry.information_status = information.status || "ACTIVE";
  entry.published_at = information.published_at || null;
  entry.checked_at = information.checked_at || null;
  entry.updated_at = information.published_at || information.checked_at || null;
  entry.title = information.title || entry.title;
  return copySupportServicePublicTraceFields(entry, information);
}

function resolveSupportServiceSourceMeta(information, sourceLookup) {
  if (information.source_id && sourceLookup[information.source_id]) {
    return sourceLookup[information.source_id];
  }

  const candidates = Object.keys(sourceLookup)
    .map(function (key) {
      return sourceLookup[key];
    })
    .filter(function (source) {
      return (
        source &&
        source.category === "SUPPORT_SERVICE" &&
        source.subcategory === information.subcategory &&
        (source.municipality === information.municipality ||
          source.facility_name === information.facility_name)
      );
    });

  if (candidates.length === 1) {
    return candidates[0];
  }

  if (information.source_url) {
    return {
      prefecture: "熊本県",
      municipality: information.municipality || null,
      organization: information.facility_name || information.title,
      url: information.source_url,
      provider_type: "PUBLIC_ORGANIZATION",
      verification_status: SUPPORT_SERVICE_VERIFICATION_STATUS.REQUIRES_MANUAL_REVIEW
    };
  }

  return null;
}

function buildSupportServicePublicItems(publicPayload, disasterSources) {
  const items = [];
  const sourceLookup = buildSupportServiceSourceLookup(disasterSources);

  (publicPayload.informations || []).forEach(function (information) {
    if (!information || information.category !== "SUPPORT_SERVICE") {
      return;
    }
    const sourceMeta = resolveSupportServiceSourceMeta(information, sourceLookup);
    if (!sourceMeta || !sourceMeta.url) {
      return;
    }
    items.push(toSupportServicePublicIndexEntry(information, sourceMeta));
  });

  return items;
}

function buildSupportServiceIndexItems(disasterSources, options) {
  options = options || {};
  const publicPayload =
    options.supportInformationPayload ||
    readJson(options.supportInformationPath || SUPPORT_INFORMATION_PUBLIC_FILE, null);

  if (
    publicPayload &&
    Array.isArray(publicPayload.informations) &&
    publicPayload.informations.length
  ) {
    return buildSupportServicePublicItems(publicPayload, disasterSources);
  }

  return buildSupportServiceRegistryItems(disasterSources);
}

function buildRegistryItems(disasterSources) {
  const items = [];

  (disasterSources.sources || []).forEach(function (source) {
    if (!source || source.category !== "WATER") {
      return;
    }
    if (source.official !== true || source.active !== true) {
      return;
    }
    if (!source.url) {
      return;
    }
    items.push(toRegistryIndexEntry(source));
  });

  return items;
}

function buildSnapshotFacilityItems(snapshots, disasterSources) {
  const items = [];
  const sourceLookup = buildSourceLookup(disasterSources);
  const sources = snapshots.sources || {};

  Object.keys(sources).forEach(function (key) {
    const snapshot = sources[key];
    if (!snapshot || snapshot.reachable !== true) {
      return;
    }
    if (!snapshot.url) {
      return;
    }

    const sourceMeta =
      sourceLookup[snapshot.source_id] ||
      sourceLookup[snapshot.organization] ||
      sourceLookup[snapshot.municipality] || {
        prefecture: /鹿児島/.test(snapshot.region || "") ? "鹿児島県" : "熊本県",
        municipality: snapshot.municipality || snapshot.organization,
        organization: snapshot.organization,
        url: snapshot.url,
        source_type: "MUNICIPALITY"
      };

    const facilities = parseFacilitiesFromOriginalText(snapshot.originalText);
    if (!facilities.length) {
      return;
    }

    facilities.forEach(function (facilityName) {
      items.push(toSnapshotFacilityIndexEntry(snapshot, facilityName, sourceMeta));
    });
  });

  return items;
}

function dedupeIndexItems(items) {
  const seen = new Set();
  const deduped = [];

  items.forEach(function (item) {
    if (!item || !item.index_id || seen.has(item.index_id)) {
      return;
    }
    seen.add(item.index_id);
    deduped.push(item);
  });

  return deduped;
}

function readPreservedShelterRegistryEntries(options) {
  options = options || {};
  const publicPath = options.publicOutputPath || PUBLIC_OUTPUT_FILE;
  const existing = readJson(publicPath, { index: [] });
  return (existing.index || []).filter(function (entry) {
    return (
      entry &&
      entry.category === "SHELTER" &&
      entry.source_trace &&
      typeof entry.source_trace === "object" &&
      entry.area_id
    );
  });
}

function buildDisasterSearchIndex(options) {
  options = options || {};

  const disasterSources = readJson(
    options.disasterSourcesPath || DISASTER_SOURCES_FILE,
    { version: "1.0", region: REGION_KYUSHU_SOUTH, sources: [] }
  );
  const crossView = readJson(options.crossViewPath || CROSS_VIEW_FILE, { municipalities: [] });
  const snapshots = readWaterSnapshots(options);
  const sourceLookup = buildSourceLookup(disasterSources);

  const locationItems = buildCrossViewLocationItems(crossView, sourceLookup);
  const registryItems = buildRegistryItems(disasterSources);
  const snapshotItems = buildSnapshotFacilityItems(snapshots, disasterSources);
  const volunteerRegistryItems = buildVolunteerRegistryItems(disasterSources);
  const supportServiceRegistryItems = buildSupportServiceIndexItems(disasterSources, options);
  const preservedShelterItems = readPreservedShelterRegistryEntries(options);
  const officialPostItems = buildOfficialPostSearchItems(options);
  const timestampLookup = buildPatrolTimestampLookup(options);
  const index = dedupeIndexItems(
    applyPatrolTimestampsToItems(
      locationItems.concat(
        registryItems,
        snapshotItems,
        volunteerRegistryItems,
        supportServiceRegistryItems,
        preservedShelterItems,
        officialPostItems
      ),
      timestampLookup,
      ["WATER", "VOLUNTEER"]
    )
  );

  return {
    version: "1.0",
    region: REGION_KYUSHU_SOUTH,
    index: index,
    meta: {
      location_item_count: locationItems.length,
      registry_item_count: registryItems.length,
      snapshot_item_count: snapshotItems.length,
      volunteer_registry_item_count: volunteerRegistryItems.length,
      support_service_registry_item_count: supportServiceRegistryItems.length,
      shelter_registry_item_count: preservedShelterItems.length,
      official_post_item_count: officialPostItems.length,
      item_count: index.length,
      last_updated: new Date().toISOString()
    }
  };
}

function buildAndWriteDisasterSearchIndex(options) {
  options = options || {};
  const payload = buildDisasterSearchIndex(options);
  const output = {
    version: payload.version,
    region: payload.region,
    index: payload.index
  };
  writeJson(options.outputPath || OUTPUT_FILE, output);
  writeJson(options.publicOutputPath || PUBLIC_OUTPUT_FILE, output);
  return payload;
}

function searchDisasterIndex(indexPayload, query, options) {
  options = options || {};
  const items = (indexPayload && indexPayload.index) || [];
  const tokens = normalizeSearchText(query).split(" ").filter(Boolean);

  if (!tokens.length) {
    return [];
  }

  return items.filter(function (item) {
    if (options.category && item.category !== options.category) {
      return false;
    }

    if (options.prefecture && item.prefecture !== options.prefecture) {
      return false;
    }

    if (
      options.municipality &&
      item.category === "SUPPORT_SERVICE" &&
      !matchesSupportServiceRegion(item, options.municipality)
    ) {
      return false;
    }

    const hay =
      item.category === "SUPPORT_SERVICE"
        ? buildSupportServiceSearchHaystack(item, normalizeSearchText)
        : item.category === "OFFICIAL_POST"
          ? normalizeSearchText(
              [
                item.prefecture,
                item.municipality,
                item.organization,
                item.title,
                (item.keywords || []).join(" "),
                item.content,
                item.post_summary || "",
                item.post_category || "",
                item.post_category_label || "",
                POST_CATEGORY_LABELS[item.post_category] || "",
                item.subcategory || "",
                item.subcategory_detail || "",
                item.account || ""
              ].join(" ")
            )
          : normalizeSearchText(
              [
                item.prefecture,
                item.municipality,
                item.organization,
                item.title,
                (item.keywords || []).join(" "),
                item.content,
                item.capability_status || "",
                item.subcategory || "",
                item.subcategory_detail || "",
                item.opening_type || "",
                item.facility_name || "",
                item.provider_type || "",
                getSupportServiceSubcategoryLabel(item.subcategory),
                getSupportServiceDetailLabel(item.subcategory_detail),
                getOpeningTypeLabel(item.opening_type),
                getProviderTypeLabel(item.provider_type)
              ].join(" ")
            );

    const regionMatched =
      item.category !== "SUPPORT_SERVICE" ||
      !options.region ||
      matchesSupportServiceRegion(item, options.region);

    return (
      regionMatched &&
      tokens.every(function (token) {
        return hay.indexOf(token) !== -1;
      })
    );
  });
}

function validateDisasterSearchIndexEntry(entry, index) {
  const label = "index[" + index + "]";
  const errors = [];

  if (!entry || typeof entry !== "object") {
    errors.push(label + ": entry missing");
    return errors;
  }

  [
    "index_id",
    "category",
    "prefecture",
    "municipality",
    "organization",
    "title",
    "content",
    "source_type",
    "source_url"
  ].forEach(function (field) {
    if (!entry[field]) {
      errors.push(label + ": missing " + field);
    }
  });

  if (!Array.isArray(entry.keywords)) {
    errors.push(label + ": keywords must be an array");
  }

  if (entry.official !== true) {
    errors.push(label + ": official must be true");
  }

  if (CATEGORIES.indexOf(entry.category) === -1) {
    errors.push(label + ": invalid category " + entry.category);
  }

  if (PREFECTURES[REGION_KYUSHU_SOUTH].indexOf(entry.prefecture) === -1) {
    errors.push(label + ": prefecture not in KYUSHU_SOUTH coverage");
  }

  if (entry.category === "VOLUNTEER") {
    if (!entry.capability_status) {
      errors.push(label + ": missing capability_status");
    } else if (CAPABILITY_STATUS_VALUES.indexOf(entry.capability_status) === -1) {
      errors.push(label + ": invalid capability_status " + entry.capability_status);
    }
    if (!entry.published_at) {
      errors.push(label + ": missing published_at");
    }
    if (!entry.disaster_start_date) {
      errors.push(label + ": missing disaster_start_date");
    }
  }

  if (entry.source_updated_at && Number.isNaN(Date.parse(entry.source_updated_at))) {
    errors.push(label + ": invalid source_updated_at");
  }

  if (entry.checked_at && Number.isNaN(Date.parse(entry.checked_at))) {
    errors.push(label + ": invalid checked_at");
  }

  if (entry.category === "SUPPORT_SERVICE") {
    ["subcategory", "opening_type", "provider_type", "verification_status"].forEach(function (field) {
      if (!entry[field]) {
        errors.push(label + ": missing " + field);
      }
    });

    if (entry.subcategory && SUPPORT_SERVICE_SUBCATEGORIES[entry.subcategory]) {
      const allowedDetails = SUPPORT_SERVICE_SUBCATEGORIES[entry.subcategory].details;
      if (allowedDetails.length && !entry.subcategory_detail) {
        errors.push(label + ": missing subcategory_detail for " + entry.subcategory);
      }
    }

    if (entry.opening_type && OPENING_TYPE_VALUES.indexOf(entry.opening_type) === -1) {
      errors.push(label + ": invalid opening_type " + entry.opening_type);
    }

    if (entry.provider_type && PROVIDER_TYPE_VALUES.indexOf(entry.provider_type) === -1) {
      errors.push(label + ": invalid provider_type " + entry.provider_type);
    }

    if (
      entry.verification_status &&
      SUPPORT_SERVICE_VERIFICATION_STATUS_VALUES.indexOf(entry.verification_status) === -1
    ) {
      errors.push(label + ": invalid verification_status " + entry.verification_status);
    }
  }

  if (entry.category === "SHELTER" && entry.source_trace) {
    ["area_id", "source_id", "status"].forEach(function (field) {
      if (!entry[field]) {
        errors.push(label + ": missing " + field);
      }
    });
    if (entry.status && entry.status !== "PENDING") {
      errors.push(label + ": SHELTER registry status must be PENDING");
    }
    if (!entry.source_trace.queue_id) {
      errors.push(label + ": source_trace.queue_id is required");
    }
  }

  if (entry.category === "OFFICIAL_POST") {
    ["post_id", "published_at", "post_category", "post_summary"].forEach(function (field) {
      if (!entry[field]) {
        errors.push(label + ": missing " + field);
      }
    });
    if (entry.verification !== "official") {
      errors.push(label + ": verification must be official");
    }
  }

  return errors;
}

function validateSupportServiceIndexExample() {
  const source = buildSupportServiceSchemaExample({
    source_id: buildIndexId(["SUPPORT_SERVICE", "example-source"]),
    active: true
  });
  const example = toSupportServiceRegistryIndexEntry(source);
  const schemaErrors = validateSupportServiceSchemaExample();
  const indexErrors = validateDisasterSearchIndexEntry(example, 0);

  return {
    schemaErrors: schemaErrors,
    indexErrors: indexErrors,
    example: example
  };
}

function validateVolunteerIndexExample() {
  const source = buildVolunteerSchemaExample({
    source_id: buildIndexId(["VOLUNTEER", "example-source"]),
    active: true
  });
  const example = toVolunteerRegistryIndexEntry(source);
  const schemaErrors = validateVolunteerSchemaExample();
  const indexErrors = validateDisasterSearchIndexEntry(example, 0);
  const historicalHay = normalizeSearchText((source.historical_evidence || []).join(" "));
  const searchHay = normalizeSearchText(
    [
      example.prefecture,
      example.municipality,
      example.organization,
      example.title,
      (example.keywords || []).join(" "),
      example.content,
      example.capability_status || ""
    ].join(" ")
  );
  const separationErrors = [];

  if (historicalHay && searchHay.indexOf(historicalHay) !== -1) {
    separationErrors.push("historical_evidence must not be included in search haystack");
  }

  return {
    schemaErrors: schemaErrors,
    indexErrors: indexErrors.concat(separationErrors),
    example: example
  };
}

function validateDisasterSearchIndex(payload) {
  const errors = [];

  if (!payload || payload.version !== "1.0") {
    errors.push("version must be 1.0");
  }

  if (!payload || payload.region !== REGION_KYUSHU_SOUTH) {
    errors.push("region must be KYUSHU_SOUTH");
  }

  if (!payload || !Array.isArray(payload.index)) {
    errors.push("index must be an array");
    return errors;
  }

  const ids = new Set();

  payload.index.forEach(function (entry, index) {
    errors.push.apply(errors, validateDisasterSearchIndexEntry(entry, index));

    if (entry.index_id) {
      if (ids.has(entry.index_id)) {
        errors.push("duplicate index_id: " + entry.index_id);
      }
      ids.add(entry.index_id);
    }
  });

  if (!payload.index.length) {
    errors.push("index must not be empty");
  }

  return errors;
}

module.exports = {
  DISASTER_SOURCES_FILE,
  CROSS_VIEW_FILE,
  SNAPSHOT_FILE,
  SNAPSHOT_SEED_FILE,
  OUTPUT_FILE,
  PUBLIC_OUTPUT_FILE,
  SUPPORT_INFORMATION_PUBLIC_FILE,
  REGION_KYUSHU_SOUTH,
  CATEGORIES,
  DISASTER_WATER_KEYWORDS,
  VOLUNTEER_KEYWORDS,
  CAPABILITY_STATUS,
  VOLUNTEER_DISASTER_START_DATE,
  OPENING_TYPE,
  OPENING_TYPE_VALUES,
  PROVIDER_TYPE_VALUES,
  SUPPORT_SERVICE_SUBCATEGORY_LABELS,
  SUPPORT_SERVICE_DETAIL_LABELS,
  OPENING_TYPE_LABELS,
  PROVIDER_TYPE_LABELS,
  SUPPORT_SERVICE_VERIFICATION_LABELS,
  SUPPORT_SERVICE_SEARCH_DICTIONARY,
  SUPPORT_SERVICE_STATUS_LABELS,
  SUPPORT_SERVICE_USER_SEARCH_CAUTION,
  getSupportServiceDictionaryKeywords,
  getSupportServiceDisplayCategoryLabel,
  getSupportServiceStatusLabel,
  matchesSupportServiceRegion,
  buildSupportServiceSearchHaystack,
  buildDisasterSearchIndex,
  buildVolunteerRegistryItems,
  buildSupportServiceRegistryItems,
  buildSupportServicePublicItems,
  buildSupportServiceIndexItems,
  buildOfficialPostSearchItems,
  resolveSupportServiceSourceMeta,
  toSupportServicePublicIndexEntry,
  isVolunteerPublishedForCurrentDisaster,
  toVolunteerRegistryIndexEntry,
  toSupportServiceRegistryIndexEntry,
  buildAndWriteDisasterSearchIndex,
  searchDisasterIndex,
  normalizeSearchText,
  validateDisasterSearchIndex,
  validateDisasterSearchIndexEntry,
  validateVolunteerIndexExample,
  validateSupportServiceIndexExample,
  parseFacilitiesFromOriginalText
};

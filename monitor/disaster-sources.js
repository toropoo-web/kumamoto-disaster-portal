"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const DISASTER_SOURCES_FILE = path.join(ROOT, "data", "disaster_sources.json");
const WATER_SOURCES_FILE = path.join(ROOT, "data", "water_sources.json");

const REGION_KYUSHU_SOUTH = "KYUSHU_SOUTH";

const PREFECTURES = {
  KYUSHU_SOUTH: ["熊本県", "鹿児島県"]
};

const CATEGORIES = ["WATER", "VOLUNTEER", "SHELTER", "MEDICAL", "SUPPORT", "SUPPORT_SERVICE"];

const SUPPORT_SERVICE_SUBCATEGORIES = {
  BATH: { details: ["BATH", "SHOWER"] },
  SPACE: { details: ["REST_SPACE", "ROOM"] },
  TOILET: { details: [] },
  VEHICLE: { details: ["PARKING", "CAR_CAMP"] },
  FOOD: { details: ["COOKING"] },
  WATER_SUPPORT: { details: [] },
  SUPPLIES: { details: [] },
  PET: { details: [] }
};

const SUPPORT_SERVICE_SUBCATEGORY_VALUES = Object.keys(SUPPORT_SERVICE_SUBCATEGORIES);

const SUPPORT_SERVICE_DETAIL_VALUES = SUPPORT_SERVICE_SUBCATEGORY_VALUES.reduce(function (acc, key) {
  SUPPORT_SERVICE_SUBCATEGORIES[key].details.forEach(function (detail) {
    if (acc.indexOf(detail) === -1) {
      acc.push(detail);
    }
  });
  return acc;
}, []);

const OPENING_TYPE = {
  FREE_OPEN: "FREE_OPEN",
  OPEN: "OPEN",
  SUPPORT: "SUPPORT"
};

const OPENING_TYPE_VALUES = [
  OPENING_TYPE.FREE_OPEN,
  OPENING_TYPE.OPEN,
  OPENING_TYPE.SUPPORT
];

const PROVIDER_TYPE = {
  MUNICIPALITY: "MUNICIPALITY",
  PUBLIC_ORGANIZATION: "PUBLIC_ORGANIZATION",
  FACILITY: "FACILITY",
  COMPANY: "COMPANY",
  ORGANIZATION: "ORGANIZATION",
  INDIVIDUAL: "INDIVIDUAL"
};

const PROVIDER_TYPE_VALUES = [
  PROVIDER_TYPE.MUNICIPALITY,
  PROVIDER_TYPE.PUBLIC_ORGANIZATION,
  PROVIDER_TYPE.FACILITY,
  PROVIDER_TYPE.COMPANY,
  PROVIDER_TYPE.ORGANIZATION,
  PROVIDER_TYPE.INDIVIDUAL
];

const SUPPORT_SERVICE_VERIFICATION_STATUS = {
  VERIFIED: "VERIFIED",
  REQUIRES_MANUAL_REVIEW: "REQUIRES_MANUAL_REVIEW"
};

const SUPPORT_SERVICE_VERIFICATION_STATUS_VALUES = [
  SUPPORT_SERVICE_VERIFICATION_STATUS.VERIFIED,
  SUPPORT_SERVICE_VERIFICATION_STATUS.REQUIRES_MANUAL_REVIEW
];

const SUPPORT_SERVICE_ONLY_FIELDS = [
  "subcategory",
  "subcategory_detail",
  "opening_type",
  "provider_type",
  "facility_name",
  "address",
  "available_from",
  "available_until",
  "verification_status"
];

const SOURCE_TYPES = [
  "MUNICIPALITY",
  "WATERWORKS",
  "DISASTER",
  "SELF_DEFENSE",
  "FIRE",
  "COAST_GUARD",
  "SOCIAL_WELFARE",
  "NPO",
  "GOVERNMENT",
  "PUBLIC_ORGANIZATION"
];

const WATER_KEYWORDS = [
  "給水",
  "応急給水",
  "給水所",
  "給水車",
  "断水",
  "水道",
  "復旧"
];

const VOLUNTEER_KEYWORDS = ["災害ボランティア", "募集", "受付", "活動"];

const CAPABILITY_STATUS = {
  CURRENT_CONFIRMED: "CURRENT_CONFIRMED",
  CAPABILITY_UNCONFIRMED: "CAPABILITY_UNCONFIRMED",
  HISTORICAL_ONLY: "HISTORICAL_ONLY"
};

const CAPABILITY_STATUS_VALUES = [
  CAPABILITY_STATUS.CURRENT_CONFIRMED,
  CAPABILITY_STATUS.CAPABILITY_UNCONFIRMED,
  CAPABILITY_STATUS.HISTORICAL_ONLY
];

const VOLUNTEER_SCHEMA_CANDIDATES = {
  CURRENT_CONFIRMED: ["熊本県", "熊本市", "八代市", "人吉市", "益城町"],
  CAPABILITY_UNCONFIRMED: ["宇土市", "宇城市", "御船町", "菊陽町", "菊池市", "合志市"],
  HISTORICAL_ONLY: ["氷川町", "嘉島町", "美里町"]
};

const VOLUNTEER_DISASTER_START_DATE = "2026-07-28";
const VOLUNTEER_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const KAGOSHIMA_WATER_PLACEHOLDER_MUNICIPALITIES = [
  "伊佐市",
  "阿久根市",
  "指宿市"
];

function buildSourceId(category, prefecture, organization, url) {
  return (
    "DSRC-" +
    category.slice(0, 3) +
    "-" +
    crypto
      .createHash("sha256")
      .update([category, prefecture, organization, url].join("|"))
      .digest("hex")
      .slice(0, 10)
      .toUpperCase()
  );
}

function inferSourceType(organization) {
  if (!organization) {
    return "DISASTER";
  }
  if (/上下水道|水道企業団/.test(organization)) {
    return "WATERWORKS";
  }
  if (/自衛隊/.test(organization)) {
    return "SELF_DEFENSE";
  }
  if (/消防庁/.test(organization)) {
    return "FIRE";
  }
  if (/海上保安庁/.test(organization)) {
    return "COAST_GUARD";
  }
  if (/社会福祉協議会|社協/.test(organization)) {
    return "SOCIAL_WELFARE";
  }
  if (/NPO|ボランティア/.test(organization)) {
    return "NPO";
  }
  if (/防災/.test(organization)) {
    return "DISASTER";
  }
  if (/県$/.test(organization)) {
    return "GOVERNMENT";
  }
  if (/市$|町$|村$/.test(organization)) {
    return "MUNICIPALITY";
  }
  return "PUBLIC_ORGANIZATION";
}

function resolveMunicipality(prefecture, organization) {
  if (/市$|町$|村$/.test(organization)) {
    return organization;
  }
  if (/県/.test(organization)) {
    return prefecture;
  }
  return organization;
}

function readDisasterRegistry() {
  if (!fs.existsSync(DISASTER_SOURCES_FILE)) {
    return { version: "1.0", region: REGION_KYUSHU_SOUTH, sources: [] };
  }
  return JSON.parse(fs.readFileSync(DISASTER_SOURCES_FILE, "utf8"));
}

function readWaterRegistry() {
  if (!fs.existsSync(WATER_SOURCES_FILE)) {
    return { category: "WATER", regions: [], sources: [] };
  }
  return JSON.parse(fs.readFileSync(WATER_SOURCES_FILE, "utf8"));
}

function convertWaterEntryToDisasterSource(entry) {
  const prefecture = entry.region || "";
  const organization = entry.organization || "";
  const url = entry.url || "";

  return {
    source_id: buildSourceId("WATER", prefecture, organization, url),
    category: "WATER",
    prefecture: prefecture,
    municipality: resolveMunicipality(prefecture, organization),
    organization: organization,
    source_type: inferSourceType(organization),
    url: url,
    keywords: Array.isArray(entry.keywords) ? entry.keywords.slice() : WATER_KEYWORDS.slice(),
    extractor: {},
    official: entry.official === true,
    active: true
  };
}

function buildKagoshimaWaterPlaceholders() {
  return KAGOSHIMA_WATER_PLACEHOLDER_MUNICIPALITIES.map(function (municipality) {
    return {
      source_id: buildSourceId("WATER", "鹿児島県", municipality, "placeholder:" + municipality),
      category: "WATER",
      prefecture: "鹿児島県",
      municipality: municipality,
      organization: municipality,
      source_type: "MUNICIPALITY",
      url: "",
      keywords: WATER_KEYWORDS.slice(),
      extractor: {},
      official: true,
      active: false
    };
  });
}

function buildDisasterRegistryFromWater() {
  const waterRegistry = readWaterRegistry();
  const migrated = (waterRegistry.sources || []).map(convertWaterEntryToDisasterSource);
  const placeholders = buildKagoshimaWaterPlaceholders();

  return {
    version: "1.0",
    region: REGION_KYUSHU_SOUTH,
    sources: migrated.concat(placeholders)
  };
}

function getDisasterSources(category, options) {
  options = options || {};
  const registry = readDisasterRegistry();
  let sources = (registry.sources || []).filter(function (entry) {
    if (category && entry.category !== category) {
      return false;
    }
    if (options.activeOnly && entry.active !== true) {
      return false;
    }
    if (options.prefecture && entry.prefecture !== options.prefecture) {
      return false;
    }
    if (options.officialOnly && entry.official !== true) {
      return false;
    }
    return true;
  });

  return sources;
}

function toLegacyWaterSource(entry) {
  return {
    region: entry.prefecture,
    organization: entry.organization,
    source_type: "official",
    url: entry.url,
    keywords: Array.isArray(entry.keywords) ? entry.keywords.slice() : [],
    official: entry.official === true
  };
}

function loadWaterSources() {
  const sources = getDisasterSources("WATER", { activeOnly: true, officialOnly: true });
  const prefectures = {};

  sources.forEach(function (entry) {
    prefectures[entry.prefecture] = true;
  });

  return {
    category: "WATER",
    regions: Object.keys(prefectures).sort(),
    sources: sources.map(toLegacyWaterSource)
  };
}

function buildVolunteerSchemaExample(overrides) {
  const base = {
    source_id: "DSRC-VOL-EXAMPLE-0001",
    category: "VOLUNTEER",
    prefecture: "熊本県",
    municipality: "熊本県",
    organization: "社会福祉協議会",
    source_type: "SOCIAL_WELFARE",
    url: "https://example.invalid/volunteer-placeholder",
    keywords: VOLUNTEER_KEYWORDS.slice(),
    extractor: {},
    official: true,
    active: false,
    capability_status: CAPABILITY_STATUS.CURRENT_CONFIRMED,
    historical_evidence: ["熊本地震", "令和2年7月豪雨"],
    current_capability: {
      confirmed: true,
      source: "公式社会福祉協議会情報"
    },
    published_at: VOLUNTEER_DISASTER_START_DATE,
    disaster_start_date: VOLUNTEER_DISASTER_START_DATE
  };

  return Object.assign(base, overrides || {});
}

function isValidVolunteerDateString(value) {
  if (!value || typeof value !== "string" || !VOLUNTEER_DATE_PATTERN.test(value)) {
    return false;
  }

  const parts = value.split("-").map(Number);
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));

  return (
    date.getUTCFullYear() === parts[0] &&
    date.getUTCMonth() === parts[1] - 1 &&
    date.getUTCDate() === parts[2]
  );
}

function compareVolunteerDates(left, right) {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function isVolunteerPublishedForCurrentDisaster(source) {
  if (!source || source.category !== "VOLUNTEER") {
    return false;
  }

  const disasterStart = source.disaster_start_date || VOLUNTEER_DISASTER_START_DATE;

  if (!isValidVolunteerDateString(source.published_at)) {
    return false;
  }

  if (!isValidVolunteerDateString(disasterStart)) {
    return false;
  }

  return compareVolunteerDates(source.published_at, disasterStart) >= 0;
}

function isValidSupportServiceDateString(value) {
  if (!value || typeof value !== "string") {
    return false;
  }
  if (!VOLUNTEER_DATE_PATTERN.test(value)) {
    return false;
  }

  const parts = value.split("-").map(Number);
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));

  return (
    date.getUTCFullYear() === parts[0] &&
    date.getUTCMonth() === parts[1] - 1 &&
    date.getUTCDate() === parts[2]
  );
}

function validateSupportServiceSourceEntry(entry, index) {
  const label = "sources[" + index + "]";
  const errors = [];

  if (!entry || entry.category !== "SUPPORT_SERVICE") {
    return errors;
  }

  if (!entry.subcategory) {
    errors.push(label + ": subcategory missing");
  } else if (SUPPORT_SERVICE_SUBCATEGORY_VALUES.indexOf(entry.subcategory) === -1) {
    errors.push(label + ": invalid subcategory " + entry.subcategory);
  }

  if (!entry.opening_type) {
    errors.push(label + ": opening_type missing");
  } else if (OPENING_TYPE_VALUES.indexOf(entry.opening_type) === -1) {
    errors.push(label + ": invalid opening_type " + entry.opening_type);
  }

  if (!entry.provider_type) {
    errors.push(label + ": provider_type missing");
  } else if (PROVIDER_TYPE_VALUES.indexOf(entry.provider_type) === -1) {
    errors.push(label + ": invalid provider_type " + entry.provider_type);
  }

  if (entry.subcategory && SUPPORT_SERVICE_SUBCATEGORIES[entry.subcategory]) {
    const allowedDetails = SUPPORT_SERVICE_SUBCATEGORIES[entry.subcategory].details;
    if (allowedDetails.length) {
      if (!entry.subcategory_detail) {
        errors.push(label + ": subcategory_detail required for " + entry.subcategory);
      } else if (allowedDetails.indexOf(entry.subcategory_detail) === -1) {
        errors.push(
          label +
            ": invalid subcategory_detail " +
            entry.subcategory_detail +
            " for " +
            entry.subcategory
        );
      }
    } else if (entry.subcategory_detail) {
      errors.push(label + ": subcategory_detail not allowed for " + entry.subcategory);
    }
  }

  if (entry.verification_status !== undefined) {
    if (SUPPORT_SERVICE_VERIFICATION_STATUS_VALUES.indexOf(entry.verification_status) === -1) {
      errors.push(label + ": invalid verification_status " + entry.verification_status);
    }
  }

  if (entry.available_from !== undefined && entry.available_from !== null && entry.available_from !== "") {
    if (!isValidSupportServiceDateString(entry.available_from)) {
      errors.push(label + ": invalid available_from format (expected YYYY-MM-DD)");
    }
  }

  if (entry.available_until !== undefined && entry.available_until !== null && entry.available_until !== "") {
    if (!isValidSupportServiceDateString(entry.available_until)) {
      errors.push(label + ": invalid available_until format (expected YYYY-MM-DD)");
    }
  }

  if (entry.facility_name !== undefined && typeof entry.facility_name !== "string") {
    errors.push(label + ": facility_name must be a string");
  }

  if (entry.address !== undefined && typeof entry.address !== "string") {
    errors.push(label + ": address must be a string");
  }

  return errors;
}

function buildSupportServiceSchemaExample(overrides) {
  const base = {
    source_id: "DSRC-SVC-EXAMPLE-0001",
    category: "SUPPORT_SERVICE",
    prefecture: "熊本県",
    municipality: "熊本市",
    organization: "テスト支援施設",
    source_type: "PUBLIC_ORGANIZATION",
    url: "https://example.invalid/support-service-placeholder",
    keywords: ["シャワー", "無料開放", "入浴"],
    extractor: {},
    official: true,
    active: false,
    subcategory: "BATH",
    subcategory_detail: "SHOWER",
    opening_type: OPENING_TYPE.FREE_OPEN,
    provider_type: PROVIDER_TYPE.FACILITY,
    facility_name: "テスト支援施設",
    address: "熊本県熊本市中央区",
    available_from: "2026-07-28",
    available_until: null,
    verification_status: SUPPORT_SERVICE_VERIFICATION_STATUS.VERIFIED
  };

  return Object.assign(base, overrides || {});
}

function validateSupportServiceSchemaExample() {
  const example = buildSupportServiceSchemaExample();
  return validateDisasterSourceEntry(example, 0, { allowInactiveWithoutUrl: true });
}

function validateVolunteerSourceEntry(entry, index) {
  const label = "sources[" + index + "]";
  const errors = [];

  if (!entry || entry.category !== "VOLUNTEER") {
    return errors;
  }

  if (!entry.capability_status) {
    errors.push(label + ": capability_status missing");
  } else if (CAPABILITY_STATUS_VALUES.indexOf(entry.capability_status) === -1) {
    errors.push(label + ": invalid capability_status " + entry.capability_status);
  }

  if (!Array.isArray(entry.historical_evidence)) {
    errors.push(label + ": historical_evidence must be an array");
  }

  if (
    !entry.current_capability ||
    typeof entry.current_capability !== "object" ||
    Array.isArray(entry.current_capability)
  ) {
    errors.push(label + ": current_capability must be an object");
    return errors;
  }

  if (
    entry.current_capability.confirmed !== true &&
    entry.current_capability.confirmed !== false
  ) {
    errors.push(label + ": current_capability.confirmed must be boolean");
  }

  if (typeof entry.current_capability.source !== "string") {
    errors.push(label + ": current_capability.source must be a string");
  }

  if (entry.official !== true) {
    errors.push(label + ": official must be true for VOLUNTEER sources");
  }

  if (!entry.published_at) {
    errors.push(label + ": published_at missing");
  } else if (!isValidVolunteerDateString(entry.published_at)) {
    errors.push(label + ": invalid published_at format (expected YYYY-MM-DD)");
  }

  if (!entry.disaster_start_date) {
    errors.push(label + ": disaster_start_date missing");
  } else if (!isValidVolunteerDateString(entry.disaster_start_date)) {
    errors.push(label + ": invalid disaster_start_date format (expected YYYY-MM-DD)");
  } else if (entry.disaster_start_date !== VOLUNTEER_DISASTER_START_DATE) {
    errors.push(
      label +
        ": disaster_start_date must be " +
        VOLUNTEER_DISASTER_START_DATE +
        " for current disaster coverage"
    );
  }

  if (entry.capability_status === CAPABILITY_STATUS.CURRENT_CONFIRMED) {
    if (entry.current_capability.confirmed !== true) {
      errors.push(label + ": CURRENT_CONFIRMED requires current_capability.confirmed=true");
    }
    if (!entry.current_capability.source) {
      errors.push(label + ": CURRENT_CONFIRMED requires current_capability.source");
    }
  }

  if (entry.capability_status === CAPABILITY_STATUS.CAPABILITY_UNCONFIRMED) {
    if (entry.current_capability.confirmed === true) {
      errors.push(
        label + ": CAPABILITY_UNCONFIRMED must not set current_capability.confirmed=true"
      );
    }
  }

  if (entry.capability_status === CAPABILITY_STATUS.HISTORICAL_ONLY) {
    if (entry.current_capability.confirmed === true) {
      errors.push(label + ": HISTORICAL_ONLY must not set current_capability.confirmed=true");
    }
    if (!entry.historical_evidence || !entry.historical_evidence.length) {
      errors.push(label + ": HISTORICAL_ONLY requires historical_evidence entries");
    }
  }

  if (
    entry.current_capability.confirmed === true &&
    !entry.current_capability.source &&
    (!entry.historical_evidence || !entry.historical_evidence.length)
  ) {
    errors.push(
      label + ": current_capability cannot be confirmed without an explicit current_capability.source"
    );
  }

  if (
    entry.current_capability.confirmed === true &&
    !entry.current_capability.source &&
    entry.historical_evidence &&
    entry.historical_evidence.length
  ) {
    errors.push(
      label +
        ": historical_evidence alone cannot justify current_capability.confirmed=true; source required"
    );
  }

  return errors;
}

function validateVolunteerSchemaExample() {
  const example = buildVolunteerSchemaExample();
  return validateDisasterSourceEntry(example, 0, { allowInactiveWithoutUrl: true });
}

function validateVolunteerSchemaCandidates() {
  const errors = [];

  Object.keys(VOLUNTEER_SCHEMA_CANDIDATES).forEach(function (status) {
    VOLUNTEER_SCHEMA_CANDIDATES[status].forEach(function (municipality, candidateIndex) {
      const organization = municipality + "社会福祉協議会";
      const historicalEvidence =
        status === CAPABILITY_STATUS.HISTORICAL_ONLY ? ["熊本地震", "令和2年7月豪雨"] : [];
      const currentCapability = {
        confirmed: status === CAPABILITY_STATUS.CURRENT_CONFIRMED,
        source: status === CAPABILITY_STATUS.CURRENT_CONFIRMED ? "公式社会福祉協議会情報" : ""
      };
      const example = buildVolunteerSchemaExample({
        source_id: buildSourceId(
          "VOLUNTEER",
          "熊本県",
          organization,
          "placeholder:" + municipality + ":" + status
        ),
        municipality: municipality,
        organization: organization,
        url: "",
        active: false,
        capability_status: status,
        historical_evidence: historicalEvidence,
        current_capability: currentCapability
      });

      const entryErrors = validateDisasterSourceEntry(example, candidateIndex, {
        allowInactiveWithoutUrl: true
      });
      entryErrors.forEach(function (message) {
        errors.push(status + "/" + municipality + ": " + message);
      });
    });
  });

  return errors;
}

function validateDisasterSourceEntry(entry, index, options) {
  options = options || {};
  const label = "sources[" + index + "]";
  const errors = [];

  if (!entry || typeof entry !== "object") {
    errors.push(label + ": entry missing");
    return errors;
  }

  if (!entry.source_id) {
    errors.push(label + ": source_id missing");
  }

  if (CATEGORIES.indexOf(entry.category) === -1) {
    errors.push(label + ": invalid category " + entry.category);
  }

  if (!entry.prefecture) {
    errors.push(label + ": prefecture missing");
  } else if (PREFECTURES[REGION_KYUSHU_SOUTH].indexOf(entry.prefecture) === -1) {
    errors.push(label + ": prefecture not in KYUSHU_SOUTH coverage");
  }

  if (!entry.organization) {
    errors.push(label + ": organization missing");
  }

  if (SOURCE_TYPES.indexOf(entry.source_type) === -1) {
    errors.push(label + ": invalid source_type " + entry.source_type);
  }

  if (entry.official !== true && entry.official !== false) {
    errors.push(label + ": official field missing");
  }

  if (entry.active === true && !entry.url) {
    errors.push(label + ": url missing for active source");
  }

  if (entry.active !== true && entry.active !== false) {
    errors.push(label + ": active field missing");
  }

  if (!Array.isArray(entry.keywords)) {
    errors.push(label + ": keywords must be an array");
  }

  if (entry.extractor === undefined || typeof entry.extractor !== "object" || Array.isArray(entry.extractor)) {
    errors.push(label + ": extractor must be an object");
  }

  if (entry.category !== "VOLUNTEER") {
    [
      "capability_status",
      "historical_evidence",
      "current_capability",
      "published_at",
      "disaster_start_date"
    ].forEach(function (field) {
      if (entry[field] !== undefined) {
        errors.push(label + ": " + field + " only allowed for VOLUNTEER category");
      }
    });
  }

  if (entry.category !== "SUPPORT_SERVICE") {
    SUPPORT_SERVICE_ONLY_FIELDS.forEach(function (field) {
      if (entry[field] !== undefined) {
        errors.push(label + ": " + field + " only allowed for SUPPORT_SERVICE category");
      }
    });
  }

  if (entry.category === "VOLUNTEER") {
    errors.push.apply(errors, validateVolunteerSourceEntry(entry, index));
  }

  if (entry.category === "SUPPORT_SERVICE") {
    errors.push.apply(errors, validateSupportServiceSourceEntry(entry, index));
  }

  return errors;
}

function validateDisasterRegistry() {
  const errors = [];
  const registry = readDisasterRegistry();
  const ids = new Set();

  if (registry.version !== "1.0") {
    errors.push("disaster_sources.json version must be 1.0");
  }

  if (registry.region !== REGION_KYUSHU_SOUTH) {
    errors.push("disaster_sources.json region must be KYUSHU_SOUTH");
  }

  if (!Array.isArray(registry.sources) || !registry.sources.length) {
    errors.push("disaster_sources.json sources must not be empty");
    return { errors: errors, sourceCount: 0, categoryCounts: {} };
  }

  registry.sources.forEach(function (entry, index) {
    errors.push.apply(errors, validateDisasterSourceEntry(entry, index, { allowInactiveWithoutUrl: true }));

    if (entry.source_id) {
      if (ids.has(entry.source_id)) {
        errors.push("duplicate source_id: " + entry.source_id);
      }
      ids.add(entry.source_id);
    }
  });

  const categoryCounts = CATEGORIES.reduce(function (acc, name) {
    acc[name] = registry.sources.filter(function (entry) {
      return entry.category === name;
    }).length;
    return acc;
  }, {});

  if (!categoryCounts.WATER) {
    errors.push("disaster_sources.json must include WATER sources");
  }

  return {
    errors: errors,
    sourceCount: registry.sources.length,
    categoryCounts: categoryCounts
  };
}

function validateWaterCompatibility() {
  const errors = [];
  const waterRegistry = readWaterRegistry();
  const adapted = loadWaterSources();

  if (waterRegistry.category !== "WATER") {
    errors.push("water_sources.json category must remain WATER");
  }

  const legacyUrls = new Set(
    (waterRegistry.sources || [])
      .filter(function (entry) {
        return entry && entry.url;
      })
      .map(function (entry) {
        return entry.region + "|" + entry.organization + "|" + entry.url;
      })
  );

  const adaptedUrls = new Set(
    (adapted.sources || []).map(function (entry) {
      return entry.region + "|" + entry.organization + "|" + entry.url;
    })
  );

  legacyUrls.forEach(function (key) {
    if (!adaptedUrls.has(key)) {
      errors.push("disaster_sources WATER adapter missing legacy source: " + key);
    }
  });

  adaptedUrls.forEach(function (key) {
    if (!legacyUrls.has(key)) {
      errors.push("disaster_sources WATER adapter has unexpected source: " + key);
    }
  });

  (waterRegistry.sources || []).forEach(function (entry, index) {
    if (entry.official !== true) {
      errors.push("water_sources.sources[" + index + "]: official must remain true");
    }
  });

  return errors;
}

module.exports = {
  DISASTER_SOURCES_FILE,
  WATER_SOURCES_FILE,
  REGION_KYUSHU_SOUTH,
  PREFECTURES,
  CATEGORIES,
  SOURCE_TYPES,
  WATER_KEYWORDS,
  VOLUNTEER_KEYWORDS,
  CAPABILITY_STATUS,
  CAPABILITY_STATUS_VALUES,
  VOLUNTEER_SCHEMA_CANDIDATES,
  VOLUNTEER_DISASTER_START_DATE,
  VOLUNTEER_DATE_PATTERN,
  SUPPORT_SERVICE_SUBCATEGORIES,
  SUPPORT_SERVICE_SUBCATEGORY_VALUES,
  SUPPORT_SERVICE_DETAIL_VALUES,
  OPENING_TYPE,
  OPENING_TYPE_VALUES,
  PROVIDER_TYPE,
  PROVIDER_TYPE_VALUES,
  SUPPORT_SERVICE_VERIFICATION_STATUS,
  SUPPORT_SERVICE_VERIFICATION_STATUS_VALUES,
  SUPPORT_SERVICE_ONLY_FIELDS,
  buildSourceId,
  buildVolunteerSchemaExample,
  buildSupportServiceSchemaExample,
  compareVolunteerDates,
  inferSourceType,
  isValidVolunteerDateString,
  isValidSupportServiceDateString,
  isVolunteerPublishedForCurrentDisaster,
  resolveMunicipality,
  readDisasterRegistry,
  readWaterRegistry,
  convertWaterEntryToDisasterSource,
  buildDisasterRegistryFromWater,
  getDisasterSources,
  loadWaterSources,
  toLegacyWaterSource,
  validateDisasterRegistry,
  validateDisasterSourceEntry,
  validateVolunteerSourceEntry,
  validateSupportServiceSourceEntry,
  validateWaterCompatibility,
  validateVolunteerSchemaExample,
  validateVolunteerSchemaCandidates,
  validateSupportServiceSchemaExample
};

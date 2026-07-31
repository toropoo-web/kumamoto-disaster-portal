(function () {
  "use strict";

  var DATA_BASE = "./data/public/";
  var VERIFIED_STATUS = "VERIFIED";
  var INCIDENT_SCOPE = "2026_KUMAMOTO_EARTHQUAKE";
  var MAX_LATEST = 4;
  var LOAD_ERROR_MESSAGE = "情報を読み込めませんでした。自治体公式サイトの情報をご確認ください。";
  var X_FEED_STATUS_AVAILABLE = "AVAILABLE";
  var X_FEED_STATUS_UNAVAILABLE = "UNAVAILABLE";
  var X_FEED_ACCOUNT_LABEL = "公式X情報";
  var X_FEED_EXCLUDED_SOURCE_IDS = { "SRC-PER-001": true };
  var X_FEED_EXCLUDED_ACCOUNT_HANDLES = { shinjirokoiz: true };
  var AREA_DISASTER_NAV_ID = "area-disaster-nav";
  var WATER_CROSS_VIEW_ID = "water-cross-view";
  var WATER_SEARCH_ID = "water-search";
  var DISASTER_SEARCH_ID = "disaster-search";
  var DISASTER_SEARCH_VOLUNTEER_ID = "disaster-search-volunteer";
  var DISASTER_SEARCH_DEFAULT_CATEGORY = "WATER";
  var DISASTER_SEARCH_CATEGORY_CONFIG = {
    WATER: {
      sectionId: "disaster-search",
      icon: "💧",
      title: "水を探す",
      lead: "給水・断水・水道情報を検索",
      promoDescription:
        "熊本県・鹿児島県の公式水情報を横断検索します。\n\n" +
        "給水所・給水車・断水・水道復旧など、\n" +
        "災害時に必要な水の情報を探せます。"
    },
    VOLUNTEER: {
      sectionId: "disaster-search-volunteer",
      icon: "🤝",
      title: "災害ボランティア募集を探す",
      lead: "災害ボランティア情報を検索",
      promoDescription:
        "支援したい方へ。\n\n" +
        "熊本県・鹿児島県の災害ボランティア募集情報を検索できます。\n\n" +
        "募集状況・受付先・参加方法を確認できます。"
    }
  };
  var DISASTER_SEARCH_SHARED = {
    scopeLabel: "検索対象：",
    scopeRegions: "熊本県・鹿児島県",
    scopeInfoTitle: "対象情報："
  };
  var DISASTER_SEARCH_GUIDANCE = {
    WATER: {
      intro: "この検索では、自治体・水道局・防災機関などが公開している公式情報を対象にしています。",
      instruction: "地域名やキーワードで検索してください。",
      examples: ["宇城 給水", "霧島 断水", "熊本 水道 復旧"],
      placeholder: "例：宇城 給水 / 霧島 断水",
      scopeInfoItems: [
        "自治体公式情報",
        "水道局情報",
        "防災機関情報",
        "公的支援情報"
      ]
    },
    VOLUNTEER: {
      intro: "この検索では、熊本県・鹿児島県の災害ボランティアに関する公式情報を対象にしています。",
      instruction: "地域名やキーワードで検索してください。",
      examples: ["熊本 ボランティア", "鹿児島 災害VC", "霧島 ボランティア", "宇城 災害VC"],
      placeholder: "例：熊本 ボランティア / 霧島 災害VC",
      scopeInfoItems: [
        "社会福祉協議会",
        "災害ボランティアセンター",
        "自治体公式情報",
        "災害ボランティア募集情報"
      ]
    }
  };
  var DISASTER_SEARCH_PLANNED_CATEGORIES = [
    { icon: "💧", label: "水（給水・断水情報）", status: "available" },
    { icon: "🤝", label: "ボランティア", status: "available" },
    { icon: "🏠", label: "避難情報", status: "planned" },
    { icon: "🏥", label: "医療・支援情報", status: "planned" }
  ];
  var VOLUNTEER_CAPABILITY_STATUS = {
    CURRENT_CONFIRMED: "CURRENT_CONFIRMED",
    CAPABILITY_UNCONFIRMED: "CAPABILITY_UNCONFIRMED"
  };
  var DISASTER_MAP_SECTION_ID = "disaster-location-map-section";
  var VERIFIED_LOCATIONS_TITLE = "📍 支援地点一覧";
  var VERIFIED_LOCATIONS_EMPTY_DEFAULT = "該当する確認済み地点はありません。";
  var VERIFIED_LOCATIONS_EMPTY_INFO_CHECK = "自治体情報をご確認ください";
  var EMPTY_STATE_INFORMATION_CHECK = "information_check_required";
  var AREA_DISASTER_NAV_CATEGORIES = [
    { id: "WATER", icon: "💧", label: "給水・断水", locationCategory: "WATER" },
    { id: "SHELTER", icon: "🏠", label: "避難所", locationCategory: "SHELTER" },
    { id: "ROAD", icon: "🚧", label: "道路・通行情報", scrollTarget: "infra-road" },
    { id: "COMMUNICATION", icon: "📡", label: "通信情報", scrollTarget: "communication-status-title" },
    { id: "DISASTER_MAP", icon: "🗺", label: "防災マップ", opensDisasterMap: true }
  ];
  var DISASTER_MAP_AREA_IDS = {
    KM001: true, KM002: true, KM003: true, KM005: true,
    KM006: true, KM007: true, KM008: true
  };
  var DISASTER_MAP_CATEGORIES = {
    WATER: true,
    FOOD: true,
    SUPPLY: true,
    CHARGING: true,
    SHELTER: true
  };
  var DISASTER_MAP_LAYER_LOCATION = "location";
  var DISASTER_MAP_LAYER_INFRASTRUCTURE = "infrastructure";
  var DISASTER_MAP_INFRASTRUCTURE_COLORS = {
    ROAD: "#c2410c",
    WATER_SERVICE: "#2563eb",
    COMMUNICATION: "#7c3aed",
    POWER: "#ca8a04"
  };
  var INFRASTRUCTURE_INFO_ID = "infrastructure-info";
  var INFRASTRUCTURE_CATEGORIES = [
    { id: "infra-road", category: "ROAD", icon: "🚧", label: "道路・交通" },
    { id: "infra-water", category: "WATER_SERVICE", icon: "🚰", label: "水道" },
    { id: "infra-comm", category: "COMMUNICATION", icon: "📡", label: "通信" },
    { id: "infra-power", category: "POWER", icon: "⚡", label: "電力" }
  ];
  var INFRASTRUCTURE_STATUS_LABELS = {
    ROAD: {
      CLOSED: "通行止め",
      RESTRICTED: "通行規制・片側交互等",
      PASSABLE: "通行可能",
      CHECK_OFFICIAL: "公式情報を確認",
      PENDING: "確認中",
      UNKNOWN: "公式未確認"
    },
    POWER: {
      OUTAGE: "停電中",
      PARTIAL_OUTAGE: "一部停電",
      RESTORING: "復旧作業中",
      RESTORED: "復旧済み",
      CHECK_OFFICIAL: "公式情報を確認",
      PENDING: "確認中",
      UNKNOWN: "公式未確認"
    },
    WATER_SERVICE: {
      SUSPENDED: "断水",
      LOW_PRESSURE: "低水圧・節水",
      TURBID: "濁水・煮沸",
      RESTORING: "復旧作業中",
      RESTORED: "復旧済み",
      CHECK_OFFICIAL: "公式情報を確認",
      PENDING: "確認中",
      UNKNOWN: "公式未確認"
    },
    COMMUNICATION: {
      OUTAGE: "通信障害",
      PARTIAL_OUTAGE: "一部地域で障害",
      AVAILABLE: "利用可能",
      CHECK_OFFICIAL: "公式情報を確認",
      PENDING: "確認中",
      UNKNOWN: "公式未確認"
    }
  };
  var LEAFLET_VERSION = "1.9.4";
  var LEAFLET_CDN_BASE = "https://unpkg.com/leaflet@" + LEAFLET_VERSION + "/dist/";
  var GOOGLE_MAPS_SEARCH_BASE = "https://www.google.com/maps/search/?api=1&query=";

  var LOCATION_CATEGORY_ICONS = {
    SHELTER: "🏠",
    WATER: "💧",
    FOOD: "🍱",
    SUPPLY: "📦",
    CHARGING: "🔋",
    ROAD: "🚧",
    SUPPORT: "🤝",
    LIFELINE: "⚡",
    MEDICAL: "🏥",
    OTHER: "📍"
  };

  var LOCATION_NAV_CATEGORIES = [
    { id: "WATER", icon: "💧", label: "給水所" },
    { id: "SHELTER", icon: "🏠", label: "避難所" }
  ];

  var CATEGORY_ORDER = [
    { id: "EMERGENCY", anchor: "cat-emergency" },
    { id: "SHELTER", anchor: "cat-shelter" },
    { id: "WATER", anchor: "cat-water" },
    { id: "SUPPORT", anchor: "cat-support" }
  ];

  var AREA_DISPLAY_RULES = {
    KM000: {
      allowed: ["EMERGENCY", "IMPACT", "ROAD", "LIFELINE", "SUPPORT"],
      blocked: ["SHELTER", "WATER", "CERTIFICATE"]
    },
    KM001: {
      allowed: ["EMERGENCY", "SHELTER", "WATER", "LIFELINE", "CERTIFICATE", "SUPPORT"],
      blocked: ["ROAD"]
    },
    KM002: {
      allowed: ["EMERGENCY", "SHELTER", "WATER", "CERTIFICATE", "IMPACT"],
      blocked: ["ROAD", "LIFELINE"],
      blockedHeadlines: ["宇土市の被害状況"]
    },
    KM003: {
      allowed: ["EMERGENCY", "SHELTER", "WATER"],
      blocked: ["ROAD", "CERTIFICATE", "IMPACT", "SUPPORT"]
    },
    KM004: {
      allowed: [],
      requireDirectVerification: true
    },
    KM005: {
      allowed: ["EMERGENCY", "SHELTER", "WATER", "SUPPORT"],
      blocked: ["ROAD", "CERTIFICATE", "IMPACT", "LIFELINE"]
    },
    KM006: {
      allowed: ["EMERGENCY", "SHELTER", "WATER", "SUPPORT"],
      blocked: ["ROAD", "CERTIFICATE", "IMPACT", "LIFELINE"]
    },
    KM007: {
      allowed: ["EMERGENCY", "SHELTER", "WATER", "SUPPORT"],
      blocked: ["ROAD", "CERTIFICATE", "IMPACT", "LIFELINE"]
    },
    KM008: {
      allowed: ["EMERGENCY", "SHELTER", "WATER", "SUPPORT"],
      blocked: ["ROAD", "CERTIFICATE", "IMPACT", "LIFELINE"]
    },
    KM009: {
      allowed: ["EMERGENCY", "SHELTER", "WATER", "SUPPORT"],
      blocked: ["ROAD", "CERTIFICATE", "IMPACT", "LIFELINE"]
    },
    KM010: {
      allowed: ["EMERGENCY", "SHELTER", "WATER", "SUPPORT"],
      blocked: ["ROAD", "CERTIFICATE", "IMPACT", "LIFELINE"]
    },
    KM011: {
      allowed: ["EMERGENCY", "SHELTER", "WATER", "SUPPORT"],
      blocked: ["ROAD", "CERTIFICATE", "IMPACT", "LIFELINE"]
    },
    KM012: {
      allowed: ["EMERGENCY", "SHELTER", "WATER", "SUPPORT"],
      blocked: ["ROAD", "CERTIFICATE", "IMPACT", "LIFELINE"]
    },
    KM013: {
      allowed: ["EMERGENCY", "SHELTER", "WATER", "SUPPORT"],
      blocked: ["ROAD", "CERTIFICATE", "IMPACT", "LIFELINE"]
    },
    KM014: {
      allowed: ["EMERGENCY", "SHELTER", "WATER", "SUPPORT"],
      blocked: ["ROAD", "CERTIFICATE", "IMPACT", "LIFELINE"]
    },
    KM015: {
      allowed: ["EMERGENCY", "SHELTER", "WATER", "SUPPORT"],
      blocked: ["ROAD", "CERTIFICATE", "IMPACT", "LIFELINE"]
    },
    KM016: {
      allowed: ["EMERGENCY", "SHELTER", "WATER", "SUPPORT"],
      blocked: ["ROAD", "CERTIFICATE", "IMPACT", "LIFELINE"]
    },
    KM017: {
      allowed: ["EMERGENCY", "SHELTER", "WATER", "SUPPORT"],
      blocked: ["ROAD", "CERTIFICATE", "IMPACT", "LIFELINE"]
    },
    KM018: {
      allowed: ["EMERGENCY", "SHELTER", "WATER", "SUPPORT"],
      blocked: ["ROAD", "CERTIFICATE", "IMPACT", "LIFELINE"]
    },
    KM019: {
      allowed: ["EMERGENCY", "SHELTER", "WATER", "SUPPORT"],
      blocked: ["ROAD", "CERTIFICATE", "IMPACT", "LIFELINE"]
    },
    KM020: {
      allowed: ["EMERGENCY", "SHELTER", "WATER", "SUPPORT"],
      blocked: ["ROAD", "CERTIFICATE", "IMPACT", "LIFELINE"]
    },
    KM021: {
      allowed: ["EMERGENCY", "SHELTER", "WATER", "SUPPORT"],
      blocked: ["ROAD", "CERTIFICATE", "IMPACT", "LIFELINE"]
    },
    KM022: {
      allowed: ["EMERGENCY", "SHELTER", "WATER", "SUPPORT"],
      blocked: ["ROAD", "CERTIFICATE", "IMPACT", "LIFELINE"]
    }
  };

  var COMMUNICATION_STATUS_LABELS = {
    PARTIAL_OUTAGE: "一部地域",
    RESTORED: "復旧済み",
    NO_REPORTED_IMPACT: "影響情報なし",
    CHECK_OFFICIAL: "公式情報を確認"
  };

  var MAX_COMMUNICATION_AREAS = 4;

  var EXCLUDED_STATUSES = [
    "REQUIRES_MANUAL_REVIEW",
    "NOT_FOUND",
    "NOT_APPLICABLE",
    "ARCHIVED",
    "SUPERSEDED",
    "ACCESS_ERROR",
    "VERIFIED_NO_CURRENT_INFORMATION"
  ];

  function loadJson(filename) {
    return fetch(DATA_BASE + filename).then(function (response) {
      if (!response.ok) {
        throw new Error("Failed to load " + filename);
      }
      return response.json();
    });
  }

  function isValidXFeedUrl(url) {
    return typeof url === "string" && (url.indexOf("https://") === 0 || url.indexOf("http://") === 0);
  }

  function isExcludedXFeedPost(post) {
    if (!post) {
      return true;
    }

    if (post.source_id && X_FEED_EXCLUDED_SOURCE_IDS[post.source_id]) {
      return true;
    }

    if (post.account_handle && X_FEED_EXCLUDED_ACCOUNT_HANDLES[post.account_handle]) {
      return true;
    }

    if (post.account_name === "小泉進次郎") {
      return true;
    }

    return false;
  }

  function getXFeedHandleLabel(post) {
    if (post.account_handle) {
      return "@" + post.account_handle;
    }

    if (post.url) {
      var handleMatch = post.url.match(/x\.com\/([^/]+)\/status\//i);
      if (handleMatch && handleMatch[1]) {
        return "@" + handleMatch[1];
      }
    }

    return null;
  }

  function validateXFeedPreview(data) {
    if (!data || !Array.isArray(data.posts) || data.posts.length === 0) {
      return null;
    }

    var requiredFields = ["source_id", "account_name", "post_time", "text", "url"];
    var validPosts = [];
    var seenUrls = {};

    data.posts.forEach(function (post) {
      if (!post || isExcludedXFeedPost(post)) {
        return;
      }

      var hasAllFields = requiredFields.every(function (field) {
        return post[field] && String(post[field]).trim() !== "";
      });

      if (!hasAllFields || !isValidXFeedUrl(post.url)) {
        return;
      }

      if (seenUrls[post.url]) {
        return;
      }
      seenUrls[post.url] = true;
      validPosts.push(post);
    });

    if (validPosts.length === 0) {
      return null;
    }

    return validPosts;
  }

  function loadXFeedPreview() {
    return fetch(DATA_BASE + "x_feed_preview.json")
      .then(function (response) {
        if (!response.ok) {
          return { status: X_FEED_STATUS_UNAVAILABLE };
        }
        return response.json()
          .then(function (data) {
            var posts = validateXFeedPreview(data);
            if (!posts) {
              return { status: X_FEED_STATUS_UNAVAILABLE };
            }
            return {
              status: X_FEED_STATUS_AVAILABLE,
              section_title: data.section_title,
              synced_at: data.synced_at,
              posts: posts
            };
          })
          .catch(function () {
            return { status: X_FEED_STATUS_UNAVAILABLE };
          });
      })
      .catch(function () {
        return { status: X_FEED_STATUS_UNAVAILABLE };
      });
  }

  function isPublicRecord(record) {
    if (!record || record.verification_status !== VERIFIED_STATUS) {
      return false;
    }
    if (record.incident_scope !== INCIDENT_SCOPE) {
      return false;
    }
    if (!record.source_url || !record.headline) {
      return false;
    }
    if (EXCLUDED_STATUSES.indexOf(record.verification_status) !== -1) {
      return false;
    }
    return true;
  }

  function isAllowedForArea(record) {
    var rules = AREA_DISPLAY_RULES[record.area_id];
    if (!rules) {
      return false;
    }
    if (rules.blockedHeadlines && rules.blockedHeadlines.indexOf(record.headline) !== -1) {
      return false;
    }
    if (rules.requireDirectVerification) {
      return false;
    }
    if (rules.allowed.length === 0) {
      return false;
    }
    if (rules.blocked.indexOf(record.public_category_id) !== -1) {
      return false;
    }
    return rules.allowed.indexOf(record.public_category_id) !== -1;
  }

  function parseDate(value) {
    if (!value) {
      return null;
    }
    var date = new Date(value);
    return isNaN(date.getTime()) ? null : date;
  }

  function formatDateTime(value) {
    var date = parseDate(value);
    if (!date) {
      return "";
    }
    var y = date.getFullYear();
    var m = String(date.getMonth() + 1).padStart(2, "0");
    var d = String(date.getDate()).padStart(2, "0");
    var h = String(date.getHours()).padStart(2, "0");
    var min = String(date.getMinutes()).padStart(2, "0");
    return y + "年" + m + "月" + d + "日 " + h + ":" + min;
  }

  function formatConfirmedAtShort(value) {
    var date = parseDate(value);
    if (!date) {
      return "";
    }
    var m = date.getMonth() + 1;
    var d = date.getDate();
    var h = String(date.getHours()).padStart(2, "0");
    var min = String(date.getMinutes()).padStart(2, "0");
    return m + "月" + d + "日 " + h + ":" + min + "確認";
  }

  function formatSyncedAt(value) {
    var date = parseDate(value);
    if (!date) {
      return "";
    }
    var y = date.getFullYear();
    var m = String(date.getMonth() + 1).padStart(2, "0");
    var d = String(date.getDate()).padStart(2, "0");
    var h = String(date.getHours()).padStart(2, "0");
    var min = String(date.getMinutes()).padStart(2, "0");
    return y + "/" + m + "/" + d + " " + h + ":" + min;
  }

  function formatCommunicationAreas(areas) {
    if (!areas || areas.length === 0) {
      return "";
    }
    if (areas.length <= MAX_COMMUNICATION_AREAS) {
      return "（" + areas.join("・") + "）";
    }
    return "（" + areas.slice(0, MAX_COMMUNICATION_AREAS).join("・") + "ほか）";
  }

  function getCommunicationStatusText(provider) {
    var label = provider.status_label || COMMUNICATION_STATUS_LABELS[provider.status] || COMMUNICATION_STATUS_LABELS.CHECK_OFFICIAL;
    if (provider.status === "PARTIAL_OUTAGE") {
      return label + formatCommunicationAreas(provider.areas);
    }
    return label;
  }

  function getServiceStatusText(service) {
    return service.status_label || COMMUNICATION_STATUS_LABELS[service.status] || COMMUNICATION_STATUS_LABELS.CHECK_OFFICIAL;
  }

  function getCommunicationLastCheckedText(item) {
    var value = item.last_checked || item.confirmed_at || null;
    var formatted = formatSyncedAt(value);
    return formatted ? "最終確認：" + formatted : "";
  }

  function appendCommunicationLastChecked(parent, item) {
    var lastCheckedText = getCommunicationLastCheckedText(item);
    if (!lastCheckedText) {
      return;
    }
    parent.appendChild(createElement("p", "communication-status__confirmed", lastCheckedText));
  }

  function extractDomain(url) {
    try {
      return new URL(url).hostname;
    } catch (e) {
      return url;
    }
  }

  function compareByDateDesc(a, b) {
    var dateA = parseDate(a.displayed_updated_at);
    var dateB = parseDate(b.displayed_updated_at);
    if (dateA && dateB) {
      return dateB - dateA;
    }
    if (dateA) {
      return -1;
    }
    if (dateB) {
      return 1;
    }
    return (a.display_priority || 0) - (b.display_priority || 0);
  }

  function getCategoryOrderIndex(categoryId) {
    for (var i = 0; i < CATEGORY_ORDER.length; i++) {
      if (CATEGORY_ORDER[i].id === categoryId) {
        return i;
      }
    }
    return 999;
  }

  function compareByCategoryThenDate(a, b) {
    var catA = getCategoryOrderIndex(a.public_category_id);
    var catB = getCategoryOrderIndex(b.public_category_id);
    if (catA !== catB) {
      return catA - catB;
    }
    return compareByDateDesc(a, b);
  }

  function getActiveCategories(records) {
    var seen = {};
    records.forEach(function (record) {
      seen[record.public_category_id] = record.public_category_label;
    });
    return CATEGORY_ORDER.filter(function (cat) {
      return seen[cat.id];
    }).map(function (cat) {
      return { id: cat.id, anchor: cat.anchor, label: seen[cat.id] };
    });
  }

  function createElement(tag, className, text) {
    var el = document.createElement(tag);
    if (className) {
      el.className = className;
    }
    if (text !== undefined) {
      el.textContent = text;
    }
    return el;
  }

  function buildGoogleMapsSearchUrl(query) {
    return GOOGLE_MAPS_SEARCH_BASE + encodeURIComponent(query);
  }

  function getLocationCategoryDisplayLabel(category) {
    for (var i = 0; i < LOCATION_NAV_CATEGORIES.length; i++) {
      if (LOCATION_NAV_CATEGORIES[i].id === category) {
        return LOCATION_NAV_CATEGORIES[i].icon + " " + LOCATION_NAV_CATEGORIES[i].label;
      }
    }
    if (category && LOCATION_CATEGORY_ICONS[category]) {
      return LOCATION_CATEGORY_ICONS[category] + " " + category;
    }
    return category || "—";
  }

  function getLocationOriginalText(location) {
    if (!location || !location.original_text) {
      return "";
    }
    return location.original_text;
  }

  function buildLocationMapsUrl(location) {
    if (location.lat !== null && location.lat !== undefined &&
        location.lng !== null && location.lng !== undefined) {
      return buildGoogleMapsSearchUrl(location.lat + "," + location.lng);
    }

    var queryParts = [location.area_name, location.name, location.address]
      .filter(function (part) {
        return part && String(part).trim() !== "";
      });
    return buildGoogleMapsSearchUrl(queryParts.join(" "));
  }

  function getJstDateString(date) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(date || new Date());
  }

  function getLocationFreshnessLabel(location) {
    if (!location || location.update_cycle !== "DAILY") {
      return "";
    }
    if (getLocationFreshness(location) === "STALE") {
      return "🟡 前回確認情報";
    }
    return "🟢 本日確認済み";
  }

  function formatOperationDate(value) {
    if (!value) {
      return "—";
    }
    var parts = String(value).split("-");
    if (parts.length !== 3) {
      return value;
    }
    return Number(parts[1]) + "月" + Number(parts[2]) + "日";
  }

  function getLocationHoursText(location) {
    if (!location || !location.notes) {
      return "—";
    }
    var match = location.notes.match(/(\d{1,2}[:：]\d{2}.*?(?:\d{1,2}[:：]\d{2}|午後\d{1,2}時|午前\d{1,2}時))/);
    if (match) {
      return match[1].replace(/[。．]/g, "");
    }
    if (/午後\d{1,2}時まで/.test(location.notes)) {
      return location.notes.match(/午後\d{1,2}時まで/)[0];
    }
    if (/20時を目処/.test(location.notes)) {
      return "20時を目処に終了予定";
    }
    return location.notes;
  }

  function getLocationFreshness(location) {
    if (!location || location.update_cycle !== "DAILY") {
      return "ACTIVE";
    }
    if (!location.operation_date) {
      return "STALE";
    }
    if (location.operation_date === getJstDateString()) {
      return "ACTIVE";
    }
    return "STALE";
  }

  function getInfrastructureFreshness(item) {
    var checked = parseDate(item && item.last_checked_at);
    if (!checked) {
      return "OUTDATED";
    }
    var hours = (Date.now() - checked.getTime()) / (1000 * 60 * 60);
    if (hours <= 24) {
      return "CURRENT";
    }
    if (hours <= 72) {
      return "STALE";
    }
    return "OUTDATED";
  }

  function getInfrastructureFreshnessLabel(item) {
    var freshness = getInfrastructureFreshness(item);
    if (freshness === "CURRENT") {
      return "🟢 最新確認済み";
    }
    if (freshness === "STALE") {
      return "🟡 前回確認情報";
    }
    return "🟠 情報確認中";
  }

  function buildInfrastructureSourceMap(sourcesData) {
    var map = {};
    if (!sourcesData || !sourcesData.sources) {
      return map;
    }
    sourcesData.sources.forEach(function (source) {
      map[source.source_id] = source;
    });
    return map;
  }

  function buildAreaNameMap(areas) {
    var map = {};
    if (!areas) {
      return map;
    }
    areas.forEach(function (area) {
      map[area.area_id] = area.name || area.area_id;
    });
    return map;
  }

  function getInfrastructureCategoryMeta(category) {
    for (var i = 0; i < INFRASTRUCTURE_CATEGORIES.length; i++) {
      if (INFRASTRUCTURE_CATEGORIES[i].category === category) {
        return INFRASTRUCTURE_CATEGORIES[i];
      }
    }
    return null;
  }

  function getInfrastructureCategoryLabel(category) {
    var meta = getInfrastructureCategoryMeta(category);
    if (!meta) {
      return category || "—";
    }
    return meta.icon + " " + meta.label;
  }

  function getInfrastructureStatusLabel(item) {
    if (!item) {
      return "—";
    }
    var categoryLabels = INFRASTRUCTURE_STATUS_LABELS[item.category];
    if (categoryLabels && categoryLabels[item.status]) {
      return categoryLabels[item.status];
    }
    if (item.status_label) {
      return item.status_label;
    }
    return item.status || "—";
  }

  function getInfrastructureOriginalText(item) {
    if (!item) {
      return "";
    }
    if (item.original_text) {
      return item.original_text;
    }
    if (item.description) {
      return item.description;
    }
    return "";
  }

  function hasInfrastructureSourceUrl(source) {
    return !!(source && source.url && (source.url.indexOf("https://") === 0 || source.url.indexOf("http://") === 0));
  }

  function isDisplayableInfrastructureItem(item, sourceMap) {
    if (!item || item.status === "ENDED") {
      return false;
    }
    if (item.type === "EXTERNAL_LINK") {
      return hasInfrastructureSourceUrl(sourceMap[item.source_id]);
    }
    return item.type === "STATUS";
  }

  function getInfrastructureItemsForCategory(items, category, sourceMap) {
    if (!items) {
      return [];
    }
    return items.filter(function (item) {
      return item.category === category && isDisplayableInfrastructureItem(item, sourceMap);
    });
  }

  function appendInfrastructureMetaRow(card, label, value) {
    var row = createElement("div", "infrastructure-info__meta-row");
    row.appendChild(createElement("dt", "infrastructure-info__meta-label", label));
    row.appendChild(createElement("dd", "infrastructure-info__meta-value", value));
    card.appendChild(row);
  }

  function renderInfrastructureStatusCard(item, areaNameMap, sourceMap) {
    var card = createElement("article", "infrastructure-info__card");
    card.setAttribute("aria-labelledby", item.status_id + "-title");

    var header = createElement("div", "infrastructure-info__card-header");
    header.appendChild(createElement("h4", "infrastructure-info__card-title", item.title || "—"));
    header.querySelector(".infrastructure-info__card-title").id = item.status_id + "-title";

    var freshness = getInfrastructureFreshnessLabel(item);
    if (freshness) {
      header.appendChild(createElement("p", "infrastructure-info__freshness", freshness));
    }
    card.appendChild(header);

    var meta = createElement("dl", "infrastructure-info__meta");
    appendInfrastructureMetaRow(meta, "カテゴリ", getInfrastructureCategoryLabel(item.category));
    appendInfrastructureMetaRow(meta, "地域", areaNameMap[item.area_id] || item.area_id || "—");
    appendInfrastructureMetaRow(meta, "状態", getInfrastructureStatusLabel(item));

    var originalText = getInfrastructureOriginalText(item);
    if (originalText) {
      var originalRow = createElement("div", "infrastructure-info__meta-row infrastructure-info__meta-row--original");
      originalRow.appendChild(createElement("dt", "infrastructure-info__meta-label", "原文"));
      var originalValue = createElement("dd", "infrastructure-info__meta-value infrastructure-info__original-text");
      originalValue.textContent = originalText;
      originalRow.appendChild(originalValue);
      meta.appendChild(originalRow);
    }

    appendInfrastructureMetaRow(
      meta,
      "最終確認日時",
      item.last_checked_at ? formatDateTime(item.last_checked_at) : "—"
    );

    var source = sourceMap[item.source_id];
    if (source) {
      var sourceRow = createElement("div", "infrastructure-info__meta-row");
      sourceRow.appendChild(createElement("dt", "infrastructure-info__meta-label", "Source"));
      var sourceValue = createElement("dd", "infrastructure-info__meta-value");
      if (hasInfrastructureSourceUrl(source)) {
        var sourceLink = createElement("a", "infrastructure-info__source-link", source.provider || source.title || "提供元を見る");
        sourceLink.href = source.url;
        sourceLink.target = "_blank";
        sourceLink.rel = "noopener noreferrer";
        sourceValue.appendChild(sourceLink);
      } else {
        sourceValue.textContent = source.provider || source.title || item.source_id || "—";
      }
      sourceRow.appendChild(sourceValue);
      meta.appendChild(sourceRow);
    }

    card.appendChild(meta);
    return card;
  }

  function renderInfrastructureExternalLinkCard(item, sourceMap) {
    var source = sourceMap[item.source_id];
    if (!hasInfrastructureSourceUrl(source)) {
      return null;
    }

    var card = createElement("article", "infrastructure-info__card infrastructure-info__card--external");
    var title = createElement("p", "infrastructure-info__external-title", "🚗 " + (item.title || "通れた道マップ"));
    card.appendChild(title);

    var link = createElement("a", "infrastructure-info__external-link", "提供元を見る");
    link.href = source.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    card.appendChild(link);
    return card;
  }

  function renderInfrastructureCategoryBlock(container, categoryMeta, items, areaNameMap, sourceMap) {
    var block = createElement("div", "infrastructure-info__category");
    block.id = categoryMeta.id;

    var heading = createElement(
      "h3",
      "infrastructure-info__category-title",
      categoryMeta.icon + " " + categoryMeta.label
    );
    block.appendChild(heading);

    var statusItems = [];
    var externalItems = [];
    items.forEach(function (item) {
      if (item.type === "EXTERNAL_LINK") {
        externalItems.push(item);
      } else {
        statusItems.push(item);
      }
    });

    if (statusItems.length === 0 && externalItems.length === 0) {
      block.appendChild(createElement("p", "infrastructure-info__empty", "現在確認中"));
      container.appendChild(block);
      return;
    }

    var cards = createElement("div", "infrastructure-info__cards");
    statusItems.forEach(function (item) {
      cards.appendChild(renderInfrastructureStatusCard(item, areaNameMap, sourceMap));
    });
    externalItems.forEach(function (item) {
      var externalCard = renderInfrastructureExternalLinkCard(item, sourceMap);
      if (externalCard) {
        cards.appendChild(externalCard);
      }
    });
    block.appendChild(cards);
    container.appendChild(block);
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

  function loadWaterSearchIndex() {
    return loadJson("water_search_index.json").catch(function () {
      return { category: "WATER", regions: [], items: [] };
    });
  }

  function getWaterSearchPriority(item) {
    var hay = normalizeSearchText(
      [item.location, item.title, item.search_text].join(" ")
    );

    if (hay.indexOf("復旧") !== -1) {
      return 5;
    }
    if (hay.indexOf("断水") !== -1) {
      return 4;
    }
    if (hay.indexOf("給水車") !== -1) {
      return 3;
    }
    if (hay.indexOf("応急給水") !== -1) {
      return 2;
    }
    return 1;
  }

  function searchWater(index, keyword) {
    if (!index || !Array.isArray(index.items) || !keyword) {
      return [];
    }

    var tokens = normalizeSearchText(keyword).split(" ").filter(Boolean);
    if (!tokens.length) {
      return [];
    }

    return index.items
      .filter(function (item) {
        var hay = normalizeSearchText(
          [
            item.region,
            item.municipality,
            item.organization,
            item.location,
            item.title,
            item.search_text
          ].join(" ")
        );
        return tokens.every(function (token) {
          return hay.indexOf(token) !== -1;
        });
      })
      .sort(function (a, b) {
        var priorityDiff = getWaterSearchPriority(a) - getWaterSearchPriority(b);
        if (priorityDiff !== 0) {
          return priorityDiff;
        }
        return (a.location || "").localeCompare(b.location || "", "ja");
      });
  }

  function renderWaterSearchResult(resultsContainer, results, query) {
    if (!resultsContainer) {
      return;
    }

    resultsContainer.innerHTML = "";

    if (!query) {
      resultsContainer.appendChild(createElement(
        "p",
        "water-search__hint",
        "地区名やキーワードを入力して検索してください。"
      ));
      return;
    }

    if (!results.length) {
      resultsContainer.appendChild(createElement(
        "p",
        "water-search__empty",
        "該当する公式給水情報は見つかりませんでした。"
      ));
      return;
    }

    resultsContainer.appendChild(createElement(
      "p",
      "water-search__summary",
      "検索結果：" + results.length + "件"
    ));

    var list = createElement("div", "water-search__results");
    results.forEach(function (item) {
      var card = createElement("article", "water-search__card");
      card.setAttribute(
        "aria-label",
        [item.region, item.municipality, item.location].filter(Boolean).join(" ")
      );

      card.appendChild(createElement(
        "p",
        "water-search__region",
        item.region + " " + item.municipality
      ));
      if (item.item_kind === "registry") {
        card.appendChild(createElement(
          "h3",
          "water-search__location",
          item.location
        ));
      } else {
        card.appendChild(createElement(
          "h3",
          "water-search__location",
          "📍 " + item.location
        ));
      }
      card.appendChild(createElement(
        "p",
        "water-search__title",
        item.title || "給水対応中"
      ));

      var sourceText = "情報源: " + (item.source_name || "公式情報");
      if (item.source_url) {
        var sourceLink = createElement("a", "water-search__source-link", sourceText);
        sourceLink.href = item.source_url;
        sourceLink.target = "_blank";
        sourceLink.rel = "noopener noreferrer";
        card.appendChild(createElement("p", "water-search__source")).appendChild(sourceLink);
      } else {
        card.appendChild(createElement("p", "water-search__source", sourceText));
      }

      if (item.updated_at) {
        card.appendChild(createElement(
          "p",
          "water-search__updated",
          "更新：" + formatDateTime(item.updated_at)
        ));
      }

      list.appendChild(card);
    });

    resultsContainer.appendChild(list);
  }

  function renderWaterSearch(container, waterSearchIndex) {
    if (!waterSearchIndex) {
      return;
    }

    var section = createElement("section", "water-search");
    section.id = WATER_SEARCH_ID;
    section.setAttribute("aria-labelledby", "water-search-title");

    var inner = createElement("div", "container");
    var title = createElement("h2", "section-title water-search__title", "💧 水を探す");
    title.id = "water-search-title";
    inner.appendChild(title);
    inner.appendChild(createElement("p", "water-search__regions", "熊本県・鹿児島県"));
    inner.appendChild(createElement(
      "p",
      "water-search__lead",
      "給水・断水情報を検索"
    ));

    var form = createElement("form", "water-search__form");
    form.setAttribute("role", "search");
    form.setAttribute("aria-label", "給水情報検索");

    var label = createElement("label", "water-search__label", "地区名・キーワード");
    label.setAttribute("for", "water-search-input");

    var input = createElement("input", "water-search__input");
    input.id = "water-search-input";
    input.type = "search";
    input.name = "q";
    input.placeholder = "例：宇城 給水 / 霧島 断水 / 給水車";
    input.autocomplete = "off";
    input.enterKeyHint = "search";

    var button = createElement("button", "water-search__button", "検索");
    button.type = "submit";

    var resultsContainer = createElement("div", "water-search__results-wrap");
    resultsContainer.id = "water-search-results";

    function runSearch() {
      var query = input.value.trim();
      renderWaterSearchResult(resultsContainer, searchWater(waterSearchIndex, query), query);
    }

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      runSearch();
    });

    form.appendChild(label);
    form.appendChild(input);
    form.appendChild(button);
    inner.appendChild(form);
    inner.appendChild(resultsContainer);
    renderWaterSearchResult(resultsContainer, [], "");
    section.appendChild(inner);
    container.appendChild(section);
  }

  function loadDisasterSearchIndex() {
    return loadJson("disaster_search_index.json").catch(function () {
      return { version: "1.0", region: "KYUSHU_SOUTH", index: [] };
    });
  }

  function searchDisasterIndex(indexPayload, query, options) {
    options = options || {};
    var items = (indexPayload && indexPayload.index) || [];
    var tokens = normalizeSearchText(query).split(" ").filter(Boolean);

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

      var hay = normalizeSearchText(
        [
          item.prefecture,
          item.municipality,
          item.organization,
          item.title,
          (item.keywords || []).join(" "),
          item.content
        ].join(" ")
      );

      return tokens.every(function (token) {
        return hay.indexOf(token) !== -1;
      });
    });
  }

  function appendVolunteerCapabilityStatus(card, item) {
    if (!item || !item.capability_status) {
      return;
    }

    var statusBlock = createElement("div", "disaster-search__capability");

    if (item.capability_status === VOLUNTEER_CAPABILITY_STATUS.CURRENT_CONFIRMED) {
      statusBlock.appendChild(createElement(
        "p",
        "disaster-search__capability-status disaster-search__capability-status--confirmed",
        "現在対応情報確認済み"
      ));
    } else if (item.capability_status === VOLUNTEER_CAPABILITY_STATUS.CAPABILITY_UNCONFIRMED) {
      statusBlock.appendChild(createElement(
        "p",
        "disaster-search__capability-status disaster-search__capability-status--entity",
        "対応主体確認済み"
      ));
      statusBlock.appendChild(createElement(
        "p",
        "disaster-search__capability-note",
        "現在の募集状況は公式情報をご確認ください"
      ));
    }

    if (statusBlock.childNodes.length) {
      card.appendChild(statusBlock);
    }
  }

  function renderDisasterSearchResult(resultsContainer, results, query, category) {
    if (!resultsContainer) {
      return;
    }

    resultsContainer.innerHTML = "";

    if (!query) {
      resultsContainer.appendChild(createElement(
        "p",
        "disaster-search__hint",
        "地区名やキーワードを入力して検索してください。"
      ));
      return;
    }

    if (!results.length) {
      resultsContainer.appendChild(createElement(
        "p",
        "disaster-search__empty",
        "該当する公式災害情報は見つかりませんでした。"
      ));
      return;
    }

    resultsContainer.appendChild(createElement(
      "p",
      "disaster-search__summary",
      "検索結果：" + results.length + "件"
    ));

    var list = createElement("div", "disaster-search__results");
    results.forEach(function (item) {
      var card = createElement("article", "disaster-search__card");
      card.setAttribute(
        "aria-label",
        [item.prefecture, item.municipality, item.title].filter(Boolean).join(" ")
      );

      card.appendChild(createElement(
        "p",
        "disaster-search__region",
        item.prefecture + " " + item.municipality
      ));
      card.appendChild(createElement(
        "h3",
        "disaster-search__title",
        item.title || "公式情報"
      ));

      if (category === "VOLUNTEER") {
        appendVolunteerCapabilityStatus(card, item);
      }

      if (item.content) {
        card.appendChild(createElement(
          "p",
          "disaster-search__content",
          item.content
        ));
      }

      var sourceText = "情報源: " + (item.organization || "公式情報");
      card.appendChild(createElement("p", "disaster-search__source", sourceText));

      if (item.source_url) {
        var officialLink = createElement("a", "disaster-search__official-link", "公式ページへ");
        officialLink.href = item.source_url;
        officialLink.target = "_blank";
        officialLink.rel = "noopener noreferrer";
        officialLink.setAttribute(
          "aria-label",
          (item.organization || "公式情報") + "の公式ページへ（外部リンク）"
        );
        card.appendChild(officialLink);
      }

      if (item.updated_at) {
        card.appendChild(createElement(
          "p",
          "disaster-search__updated",
          "更新：" + formatDateTime(item.updated_at)
        ));
      }

      list.appendChild(card);
    });

    resultsContainer.appendChild(list);
  }

  function renderDisasterSearch(container, disasterSearchIndex, category, options) {
    if (!disasterSearchIndex) {
      return;
    }

    options = options || {};
    var categoryKey = category || DISASTER_SEARCH_DEFAULT_CATEGORY;
    var categoryConfig = DISASTER_SEARCH_CATEGORY_CONFIG[categoryKey];
    var guidance = DISASTER_SEARCH_GUIDANCE[categoryKey];
    if (!categoryConfig || !guidance) {
      return;
    }

    var sectionId = categoryConfig.sectionId || DISASTER_SEARCH_ID;
    var titleId = sectionId + "-title";
    var inputId = sectionId + "-input";
    var resultsId = sectionId + "-results";

    var section = createElement("section", "disaster-search");
    if (options.compact) {
      section.classList.add("disaster-search--compact");
    }
    section.id = sectionId;
    section.setAttribute("data-search-category", categoryKey);
    section.setAttribute("aria-labelledby", titleId);

    var inner = createElement("div", "container");
    var title = createElement(
      "h2",
      "section-title disaster-search__heading",
      categoryConfig.icon + " " + categoryConfig.title
    );
    title.id = titleId;
    inner.appendChild(title);

    if (categoryKey === "WATER") {
      inner.appendChild(createElement(
        "p",
        "disaster-search__flow-note",
        "入口 → 検索 → 詳細確認の流れで水情報を確認できます。詳細一覧は下の「給水情報一覧」へ。"
      ));
    }

    var guide = createElement("div", "disaster-search__guide");
    guide.appendChild(createElement("p", "disaster-search__guide-text", guidance.intro));
    guide.appendChild(createElement("p", "disaster-search__guide-text", guidance.instruction));
    inner.appendChild(guide);

    var examplesBlock = createElement("div", "disaster-search__examples");
    examplesBlock.appendChild(createElement("p", "disaster-search__examples-title", "検索例："));
    var examplesList = createElement("ul", "disaster-search__examples-list");
    guidance.examples.forEach(function (example) {
      var item = createElement("li", "disaster-search__examples-item", "・" + example);
      examplesList.appendChild(item);
    });
    examplesBlock.appendChild(examplesList);
    inner.appendChild(examplesBlock);

    var scopeBlock = createElement("div", "disaster-search__scope");
    scopeBlock.appendChild(createElement(
      "p",
      "disaster-search__scope-regions",
      DISASTER_SEARCH_SHARED.scopeLabel + DISASTER_SEARCH_SHARED.scopeRegions
    ));
    scopeBlock.appendChild(createElement("p", "disaster-search__scope-title", DISASTER_SEARCH_SHARED.scopeInfoTitle));
    var scopeList = createElement("ul", "disaster-search__scope-list");
    guidance.scopeInfoItems.forEach(function (itemText) {
      scopeList.appendChild(createElement("li", "disaster-search__scope-item", "・" + itemText));
    });
    scopeBlock.appendChild(scopeList);
    inner.appendChild(scopeBlock);

    if (!options.compact) {
      var categoriesBlock = createElement("div", "disaster-search__categories");
      categoriesBlock.appendChild(createElement("p", "disaster-search__categories-title", "現在対応："));
      var availableList = createElement("ul", "disaster-search__categories-list");
      var plannedList = createElement("ul", "disaster-search__categories-list disaster-search__categories-list--planned");
      var plannedTitle = createElement("p", "disaster-search__categories-title", "順次対応：");
      var hasPlanned = false;

      DISASTER_SEARCH_PLANNED_CATEGORIES.forEach(function (entry) {
        var item = createElement(
          "li",
          "disaster-search__category-item disaster-search__category-item--" + entry.status,
          entry.icon + " " + entry.label
        );
        if (entry.status === "available") {
          availableList.appendChild(item);
        } else {
          plannedList.appendChild(item);
          hasPlanned = true;
        }
      });

      categoriesBlock.appendChild(availableList);
      if (hasPlanned) {
        categoriesBlock.appendChild(plannedTitle);
        categoriesBlock.appendChild(plannedList);
      }
      inner.appendChild(categoriesBlock);
    }

    var form = createElement("form", "disaster-search__form");
    form.setAttribute("role", "search");
    form.setAttribute("aria-label", "災害情報検索");

    var label = createElement("label", "disaster-search__label", "地区名・キーワード");
    label.setAttribute("for", inputId);

    var input = createElement("input", "disaster-search__input");
    input.id = inputId;
    input.type = "search";
    input.name = "q";
    input.placeholder = guidance.placeholder;
    input.autocomplete = "off";
    input.enterKeyHint = "search";

    var button = createElement("button", "disaster-search__button", "検索");
    button.type = "submit";

    var resultsContainer = createElement("div", "disaster-search__results-wrap");
    resultsContainer.id = resultsId;

    function runSearch() {
      var query = input.value.trim();
      renderDisasterSearchResult(
        resultsContainer,
        searchDisasterIndex(disasterSearchIndex, query, { category: categoryKey }),
        query,
        categoryKey
      );
    }

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      runSearch();
    });

    form.appendChild(label);
    form.appendChild(input);
    form.appendChild(button);
    inner.appendChild(form);
    inner.appendChild(resultsContainer);
    renderDisasterSearchResult(resultsContainer, [], "", categoryKey);
    section.appendChild(inner);
    container.appendChild(section);
  }

  function renderDisasterSearchPromo(container) {
    var section = createElement("section", "portal-quick-access");
    section.setAttribute("aria-labelledby", "portal-quick-access-title");

    var inner = createElement("div", "container");
    var title = createElement("h2", "portal-quick-access__title", "支援情報を探す");
    title.id = "portal-quick-access-title";
    inner.appendChild(title);

    var grid = createElement("div", "portal-quick-access__grid");
    Object.keys(DISASTER_SEARCH_CATEGORY_CONFIG).forEach(function (categoryKey) {
      var config = DISASTER_SEARCH_CATEGORY_CONFIG[categoryKey];
      var card = createElement("a", "portal-quick-access__card");
      card.href = "#" + (config.sectionId || DISASTER_SEARCH_ID);
      card.setAttribute("aria-label", config.title + "の検索へ移動");
      card.appendChild(createElement("h3", "portal-quick-access__card-title", config.icon + " " + config.title));
      card.appendChild(createElement("p", "portal-quick-access__card-desc", config.promoDescription));
      grid.appendChild(card);
    });

    inner.appendChild(grid);
    section.appendChild(inner);
    container.appendChild(section);
  }

  // WaterCrossView: cross-municipality official water access view
  function renderWaterCrossView(container, waterCrossView) {
    if (!waterCrossView || !waterCrossView.municipalities) {
      return;
    }

    var section = createElement("section", "water-cross-view");
    section.id = WATER_CROSS_VIEW_ID;
    section.setAttribute("aria-labelledby", "water-cross-view-title");

    var inner = createElement("div", "container");
    var title = createElement("h2", "section-title water-cross-view__title", "💧 給水情報一覧");
    title.id = "water-cross-view-title";
    inner.appendChild(title);
    inner.appendChild(createElement(
      "p",
      "water-cross-view__flow-note",
      "水情報の確認手順：入口（水を探す）→ 給水情報一覧（詳細確認）"
    ));
    inner.appendChild(createElement(
      "p",
      "water-cross-view__lead",
      waterCrossView.description || "自治体公式の給水所・給水車情報を一覧で確認できます。"
    ));

    if (waterCrossView.last_updated) {
      inner.appendChild(createElement(
        "p",
        "water-cross-view__updated",
        "最終更新：" + formatDateTime(waterCrossView.last_updated)
      ));
    }

    var grid = createElement("div", "water-cross-view__grid");
    waterCrossView.municipalities.forEach(function (entry) {
      var card = createElement("article", "water-cross-view__card");
      card.setAttribute("aria-label", entry.municipality + "の給水情報");

      card.appendChild(createElement("h3", "water-cross-view__municipality", entry.municipality));

      if (entry.location_count > 0) {
        card.appendChild(createElement("p", "water-cross-view__status", entry.status_label || "給水対応中"));
        card.appendChild(createElement("p", "water-cross-view__count", entry.location_count + "箇所"));

        var list = createElement("ul", "water-cross-view__locations");
        entry.locations.slice(0, 3).forEach(function (location) {
          list.appendChild(createElement("li", "water-cross-view__location", "・" + location.location_name));
        });
        card.appendChild(list);

        if (entry.location_count > 3) {
          card.appendChild(createElement(
            "p",
            "water-cross-view__more",
            "ほか" + (entry.location_count - 3) + "箇所"
          ));
        }

        card.appendChild(createElement("p", "water-cross-view__verified", "公式更新確認済"));
      } else {
        card.appendChild(createElement(
          "p",
          "water-cross-view__empty",
          "現在、公開中の給水所情報はありません。"
        ));
      }

      var sourceLabel = entry.source_label || (entry.municipality + "公式");
      if (entry.source_url) {
        var sourceWrap = createElement("p", "water-cross-view__source");
        sourceWrap.appendChild(document.createTextNode("情報源: "));
        var sourceLink = createElement("a", "water-cross-view__source-link", sourceLabel);
        sourceLink.href = entry.source_url;
        sourceLink.target = "_blank";
        sourceLink.rel = "noopener noreferrer";
        sourceWrap.appendChild(sourceLink);
        card.appendChild(sourceWrap);
      } else {
        card.appendChild(createElement("p", "water-cross-view__source", "情報源: " + sourceLabel));
      }

      var detailLink = createElement("button", "water-cross-view__detail-link", "自治体の給水情報を見る");
      detailLink.type = "button";
      detailLink.addEventListener("click", function () {
        var navSection = document.getElementById(AREA_DISASTER_NAV_ID);
        var navSelect = document.getElementById("area-disaster-nav-select");
        if (navSelect && entry.area_id) {
          navSelect.value = entry.area_id;
          navSelect.dispatchEvent(new Event("change", { bubbles: true }));
        }
        if (navSection) {
          scrollToPageTarget(navSection);
        }
      });
      card.appendChild(detailLink);

      grid.appendChild(card);
    });

    inner.appendChild(grid);
    section.appendChild(inner);
    container.appendChild(section);
  }

  function renderInfrastructureSection(container, infrastructureStatus, infrastructureSources, areas) {
    if (!infrastructureStatus) {
      return;
    }

    var section = createElement("section", "infrastructure-info");
    section.id = INFRASTRUCTURE_INFO_ID;
    section.setAttribute("aria-labelledby", "infrastructure-info-title");

    var inner = createElement("div", "container");
    var title = createElement("h2", "section-title infrastructure-info__title", "インフラ情報");
    title.id = "infrastructure-info-title";
    inner.appendChild(title);
    inner.appendChild(createElement(
      "p",
      "infrastructure-info__lead",
      "道路・通信・電力など生活基盤情報を確認できます。"
    ));

    var collapse = createElement("details", "infrastructure-info__collapse");
    var collapseSummary = createElement("summary", "infrastructure-info__summary", "インフラ情報を表示する");
    collapse.appendChild(collapseSummary);

    var collapseBody = createElement("div", "infrastructure-info__collapse-body");
    var sourceMap = buildInfrastructureSourceMap(infrastructureSources);
    var areaNameMap = buildAreaNameMap(areas);
    var allItems = (infrastructureStatus.items || []).filter(function (item) {
      return isDisplayableInfrastructureItem(item, sourceMap);
    });

    var nav = createElement("nav", "infrastructure-info__nav");
    nav.setAttribute("aria-label", "インフラ情報カテゴリ");
    var navList = createElement("ul", "infrastructure-info__nav-list");
    INFRASTRUCTURE_CATEGORIES.forEach(function (categoryMeta) {
      var navItem = createElement("li", "infrastructure-info__nav-item");
      var navLink = createElement("a", "infrastructure-info__nav-link", categoryMeta.icon + " " + categoryMeta.label);
      navLink.href = "#" + categoryMeta.id;
      navItem.appendChild(navLink);
      navList.appendChild(navItem);
    });
    nav.appendChild(navList);
    collapseBody.appendChild(nav);

    var categoriesWrap = createElement("div", "infrastructure-info__categories");
    INFRASTRUCTURE_CATEGORIES.forEach(function (categoryMeta) {
      var categoryItems = getInfrastructureItemsForCategory(allItems, categoryMeta.category, sourceMap);
      renderInfrastructureCategoryBlock(categoriesWrap, categoryMeta, categoryItems, areaNameMap, sourceMap);
    });
    collapseBody.appendChild(categoriesWrap);
    collapse.appendChild(collapseBody);
    inner.appendChild(collapse);

    section.appendChild(inner);
    container.appendChild(section);
  }

  function isPublicLocation(location) {
    if (!location) {
      return false;
    }
    var status = location.status;
    if (status === "ENDED" || status === "UNKNOWN" || status === "PENDING_REVIEW") {
      return false;
    }
    if (status !== "ACTIVE") {
      return false;
    }
    if (location.verification_status !== "VERIFIED") {
      return false;
    }
    if (location.expires_at) {
      var expiresAt = parseDate(location.expires_at);
      if (expiresAt && expiresAt.getTime() < Date.now()) {
        return false;
      }
    }
    return true;
  }

  function getPublicLocationsForArea(disasterLocations, areaId) {
    if (!disasterLocations || !disasterLocations.locations) {
      return [];
    }

    return disasterLocations.locations
      .filter(function (location) {
        return location.area_id === areaId && isPublicLocation(location);
      })
      .sort(function (a, b) {
        var categoryA = a.category || "";
        var categoryB = b.category || "";
        if (categoryA !== categoryB) {
          return categoryA.localeCompare(categoryB);
        }
        return (a.display_priority || 50) - (b.display_priority || 50);
      });
  }

  function renderVerifiedLocationItem(location) {
    var icon = LOCATION_CATEGORY_ICONS[location.category] || "📍";
    var li = createElement("li", "verified-locations__item");

    var header = createElement("div", "verified-locations__header");
    header.appendChild(createElement("p", "verified-locations__name", icon + " " + location.name));
    if (location.status_label) {
      header.appendChild(createElement("p", "verified-locations__status", location.status_label));
    }
    li.appendChild(header);

    var sourceName = location.source && location.source.name ? location.source.name : "公式情報";
    li.appendChild(createElement("p", "verified-locations__source", "確認元：" + sourceName));

    if (location.category === "WATER") {
      var hoursText = getLocationHoursText(location);
      if (hoursText && hoursText !== "—") {
        li.appendChild(createElement("p", "verified-locations__hours", "利用時間：" + hoursText));
      }
    }

    if (location.last_checked_at) {
      li.appendChild(createElement(
        "p",
        "verified-locations__checked-at",
        "最終確認：" + formatDateTime(location.last_checked_at)
      ));
    }

    if (location.notes) {
      li.appendChild(createElement("p", "verified-locations__notes", "注意事項：" + location.notes));
    }

    var originalText = getLocationOriginalText(location);
    if (originalText) {
      var original = createElement("p", "verified-locations__original-text", originalText);
      original.setAttribute("lang", "ja");
      li.appendChild(original);
    }

    if (getLocationFreshness(location) === "STALE") {
      li.appendChild(createElement(
        "p",
        "verified-locations__stale-notice",
        "🟡 前回確認情報（実施日が前日以前）。最新情報を公式でご確認ください。"
      ));
    } else if (location.update_cycle === "DAILY") {
      li.appendChild(createElement(
        "p",
        "verified-locations__fresh-notice",
        "🟢 本日確認済み"
      ));
    }

    var mapLink = createElement("button", "verified-locations__map-link", "地図を見る");
    mapLink.type = "button";
    mapLink.setAttribute("aria-label", location.name + "を災害マップで見る");
    mapLink.addEventListener("click", function () {
      openDisasterMapSection({ locationId: location.location_id });
    });
    li.appendChild(mapLink);
    return li;
  }

  function getVerifiedLocationEmptyMessage(areaId, category, locationSources) {
    var sources = (locationSources && locationSources.sources) || [];
    var categorySources = sources.filter(function (source) {
      return source.area_id === areaId && source.category === category;
    });

    if (
      categorySources.some(function (source) {
        return source.empty_state === EMPTY_STATE_INFORMATION_CHECK;
      })
    ) {
      return VERIFIED_LOCATIONS_EMPTY_INFO_CHECK;
    }

    return VERIFIED_LOCATIONS_EMPTY_DEFAULT;
  }

  function renderVerifiedLocationList(panel, areaEntry, disasterLocations, locationSources) {
    var locations = getPublicLocationsForArea(disasterLocations, areaEntry.area_id);
    var block = createElement("div", "verified-locations");
    block.id = "verified-locations-" + areaEntry.area_id;
    block.appendChild(createElement("h4", "verified-locations__title", VERIFIED_LOCATIONS_TITLE));

    var grouped = {};
    LOCATION_NAV_CATEGORIES.forEach(function (categoryMeta) {
      grouped[categoryMeta.id] = [];
    });
    locations.forEach(function (location) {
      if (grouped[location.category]) {
        grouped[location.category].push(location);
      }
    });

    var categoryPanels = createElement("div", "verified-locations__category-panels");

    LOCATION_NAV_CATEGORIES.forEach(function (categoryMeta) {
      var categorySection = createElement("section", "verified-locations__category");
      categorySection.id = "verified-locations-cat-" + categoryMeta.id.toLowerCase() + "-" + areaEntry.area_id;
      categorySection.setAttribute("data-category", categoryMeta.id);
      categorySection.setAttribute("aria-label", categoryMeta.label);

      var categoryTitle = createElement(
        "h5",
        "verified-locations__category-title",
        categoryMeta.icon + " " + categoryMeta.label
      );
      categorySection.appendChild(categoryTitle);

      if (grouped[categoryMeta.id].length === 0) {
        categorySection.appendChild(createElement(
          "p",
          "verified-locations__empty",
          getVerifiedLocationEmptyMessage(areaEntry.area_id, categoryMeta.id, locationSources)
        ));
      } else {
        var list = createElement("ul", "verified-locations__list");
        grouped[categoryMeta.id].forEach(function (location) {
          list.appendChild(renderVerifiedLocationItem(location));
        });
        categorySection.appendChild(list);
      }

      categoryPanels.appendChild(categorySection);
    });

    function selectLocationCategory(categoryId) {
      setAreaNavCategoryActive(panel, categoryId);

      var selected = categoryPanels.querySelector('[data-category="' + categoryId + '"]');
      if (!selected) {
        scrollToPageTarget(block.id);
        return;
      }

      Array.prototype.forEach.call(
        categoryPanels.querySelectorAll(".verified-locations__category"),
        function (sectionEl) {
          sectionEl.hidden = false;
          sectionEl.classList.toggle(
            "verified-locations__category--selected",
            sectionEl.getAttribute("data-category") === categoryId
          );
        }
      );

      categoryPanels.insertBefore(selected, categoryPanels.firstChild);
      scrollToPageTarget(selected.id);
    }

    panel._selectLocationCategory = selectLocationCategory;

    block.appendChild(categoryPanels);
    panel.appendChild(block);
  }

  function scrollToPageTarget(targetId) {
    var target = document.getElementById(targetId);
    if (!target) {
      return false;
    }
    var prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({
      behavior: prefersReducedMotion ? "auto" : "smooth",
      block: "start"
    });
    return true;
  }

  function setAreaNavCategoryActive(panel, categoryId) {
    if (!panel) {
      return;
    }
    Array.prototype.forEach.call(
      panel.querySelectorAll(".area-disaster-nav__category-btn"),
      function (button) {
        var isActive = button.getAttribute("data-nav-category") === categoryId;
        button.classList.toggle("area-disaster-nav__category-btn--active", isActive);
        button.setAttribute("aria-pressed", isActive ? "true" : "false");
      }
    );
  }

  function focusMapLocationMarker(locationId) {
    var mapContainer = document.getElementById("disaster-location-map");
    if (!mapContainer || !mapContainer._leafletMap || !mapContainer._locationMarkers) {
      return false;
    }
    var marker = mapContainer._locationMarkers[locationId];
    if (!marker) {
      return false;
    }
    mapContainer._leafletMap.setView(marker.getLatLng(), 15);
    marker.openPopup();
    mapContainer._leafletMap.invalidateSize();
    return true;
  }

  function openDisasterMapSection(options) {
    options = options || {};
    var section = document.getElementById(DISASTER_MAP_SECTION_ID);
    if (!section) {
      return;
    }
    scrollToPageTarget(DISASTER_MAP_SECTION_ID);
    var toggle = section.querySelector(".disaster-map__toggle");
    var mapPanel = document.getElementById("disaster-map-panel");
    if (!toggle || !mapPanel) {
      return;
    }
    if (mapPanel.hidden) {
      toggle.click();
    }
    if (!options.locationId) {
      return;
    }
    var attempts = 0;
    var maxAttempts = 40;
    var timer = window.setInterval(function () {
      attempts += 1;
      if (focusMapLocationMarker(options.locationId) || attempts >= maxAttempts) {
        window.clearInterval(timer);
      }
    }, 250);
  }

  function handleAreaNavCategoryClick(panel, areaEntry, categoryItem) {
    setAreaNavCategoryActive(panel, categoryItem.id);
    if (categoryItem.opensDisasterMap) {
      openDisasterMapSection();
      return;
    }
    if (categoryItem.scrollTarget) {
      scrollToPageTarget(categoryItem.scrollTarget);
      return;
    }
    if (categoryItem.locationCategory && panel._selectLocationCategory) {
      panel._selectLocationCategory(categoryItem.locationCategory);
      return;
    }
    if (areaEntry && areaEntry.area_id) {
      scrollToPageTarget("verified-locations-" + areaEntry.area_id);
    }
  }

  function scrollToAreaDisasterNav() {
    var target = document.getElementById(AREA_DISASTER_NAV_ID);
    if (!target) {
      return;
    }
    var prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({
      behavior: prefersReducedMotion ? "auto" : "smooth",
      block: "start"
    });
    var select = target.querySelector(".area-disaster-nav__select");
    if (select) {
      select.focus();
    }
  }

  function renderAreaNavPromo(container) {
    var section = createElement("section", "area-nav-promo");
    section.setAttribute("aria-labelledby", "area-nav-promo-title");

    var inner = createElement("div", "container");
    inner.appendChild(createElement("h2", "area-nav-promo__title", "地域の災害情報を地図で確認"));
    inner.querySelector(".area-nav-promo__title").id = "area-nav-promo-title";
    inner.appendChild(createElement(
      "p",
      "area-nav-promo__lead",
      "お住まいの地域を選択すると、地域ごとの避難・給水・支援・公式情報を確認できます。"
    ));

    var button = createElement("button", "area-nav-promo__button", "地域を指定して見る");
    button.type = "button";
    button.setAttribute("aria-label", "地域災害ナビへ移動");
    button.addEventListener("click", scrollToAreaDisasterNav);
    inner.appendChild(button);

    section.appendChild(inner);
    container.appendChild(section);
  }

  function createAreaNavExternalLink(className, label, href, ariaLabel) {
    var link = createElement("a", className, label);
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.setAttribute("aria-label", ariaLabel);
    return link;
  }

  function renderAreaDisasterNavLinks(panel, areaEntry, disasterLocations, locationSources) {
    panel.innerHTML = "";
    panel._selectLocationCategory = null;
    if (!areaEntry || !areaEntry.navigation) {
      panel.hidden = true;
      return;
    }

    panel.hidden = false;
    panel.appendChild(createElement("h3", "area-disaster-nav__selected-name", areaEntry.name));

    var list = createElement("ul", "area-disaster-nav__links");
    list.setAttribute("role", "list");
    list.setAttribute("aria-label", "カテゴリ別支援情報");

    AREA_DISASTER_NAV_CATEGORIES.forEach(function (categoryItem) {
      var li = createElement("li", "area-disaster-nav__item");
      var button = createElement(
        "button",
        "area-disaster-nav__category-btn",
        categoryItem.icon + " " + categoryItem.label
      );
      button.type = "button";
      button.setAttribute("data-nav-category", categoryItem.id);
      button.setAttribute("aria-pressed", "false");
      button.setAttribute(
        "aria-label",
        areaEntry.name + "の" + categoryItem.label + "一覧へ移動"
      );
      button.addEventListener("click", function () {
        handleAreaNavCategoryClick(panel, areaEntry, categoryItem);
      });
      li.appendChild(button);
      list.appendChild(li);
    });

    panel.appendChild(list);
    renderVerifiedLocationList(panel, areaEntry, disasterLocations, locationSources);
  }

  function renderAreaDisasterNav(container, areaNavigation, disasterLocations, locationSources) {
    if (!areaNavigation || !areaNavigation.areas || areaNavigation.areas.length === 0) {
      return;
    }

    var section = createElement("section", "area-disaster-nav");
    section.id = AREA_DISASTER_NAV_ID;
    section.setAttribute("aria-labelledby", "area-disaster-nav-title");

    var inner = createElement("div", "container");
    var title = areaNavigation.section_title || "地域災害ナビ";
    inner.appendChild(createElement("h2", "section-title area-disaster-nav__title", title));
    inner.querySelector(".area-disaster-nav__title").id = "area-disaster-nav-title";
    inner.appendChild(createElement(
      "p",
      "area-disaster-nav__lead",
      "お住まいの地域を選ぶと、給水・避難所・道路情報などへのリンクを表示します。"
    ));

    var selectId = "area-disaster-nav-select";
    var label = createElement("label", "area-disaster-nav__label", "自治体を選択");
    label.htmlFor = selectId;

    var select = createElement("select", "area-disaster-nav__select");
    select.id = selectId;
    select.setAttribute("aria-label", "自治体を選択");

    var placeholder = createElement("option", null, "自治体を選択してください");
    placeholder.value = "";
    placeholder.disabled = true;
    placeholder.selected = true;
    select.appendChild(placeholder);

    var areaMap = {};
    areaNavigation.areas.forEach(function (area) {
      areaMap[area.area_id] = area;
      var option = createElement("option", null, area.name);
      option.value = area.area_id;
      select.appendChild(option);
    });

    var panel = createElement("div", "area-disaster-nav__panel");
    panel.hidden = true;
    panel.setAttribute("aria-live", "polite");

    select.addEventListener("change", function () {
      renderAreaDisasterNavLinks(panel, areaMap[select.value] || null, disasterLocations, locationSources);
    });

    inner.appendChild(label);
    inner.appendChild(select);
    inner.appendChild(panel);
    section.appendChild(inner);
    container.appendChild(section);
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function hasMapCoordinates(location) {
    return typeof location.lat === "number" && typeof location.lng === "number";
  }

  function getMapDisplayLocations(disasterLocations) {
    if (!disasterLocations || !disasterLocations.locations) {
      return [];
    }

    return disasterLocations.locations.filter(function (location) {
      return DISASTER_MAP_AREA_IDS[location.area_id] &&
        isPublicLocation(location) &&
        hasMapCoordinates(location) &&
        DISASTER_MAP_CATEGORIES[location.category];
    });
  }

  function getInfrastructureInfoType(item) {
    if (!item) {
      return null;
    }
    if (item.info_type) {
      return item.info_type;
    }
    if (item.geometry && item.geometry.type === "Point") {
      return "POINT";
    }
    if (item.geometry && item.geometry.type === "LineString") {
      return "LINE";
    }
    if (item.geometry && item.geometry.type === "Polygon") {
      return "AREA";
    }
    if (item.type === "STATUS") {
      return "STATUS";
    }
    return null;
  }

  function hasValidInfrastructureGeometry(item) {
    if (!item || !item.geometry || !item.geometry.type) {
      return false;
    }
    var infoType = getInfrastructureInfoType(item);
    if (infoType === "POINT") {
      return Array.isArray(item.geometry.coordinates) &&
        item.geometry.coordinates.length >= 2 &&
        typeof item.geometry.coordinates[0] === "number" &&
        typeof item.geometry.coordinates[1] === "number";
    }
    if (infoType === "LINE") {
      return Array.isArray(item.geometry.coordinates) && item.geometry.coordinates.length >= 2;
    }
    if (infoType === "AREA") {
      return Array.isArray(item.geometry.coordinates) &&
        item.geometry.coordinates.length > 0 &&
        Array.isArray(item.geometry.coordinates[0]) &&
        item.geometry.coordinates[0].length >= 3;
    }
    return false;
  }

  function getMapInfrastructureItems(infrastructureStatus, infrastructureSources) {
    var sourceMap = buildInfrastructureSourceMap(infrastructureSources);
    if (!infrastructureStatus || !infrastructureStatus.items) {
      return { geometry: [], status: [] };
    }

    var geometry = [];
    var status = [];

    infrastructureStatus.items.forEach(function (item) {
      if (!isDisplayableInfrastructureItem(item, sourceMap)) {
        return;
      }
      var infoType = getInfrastructureInfoType(item);
      if (infoType === "STATUS") {
        status.push(item);
        return;
      }
      if ((infoType === "POINT" || infoType === "LINE" || infoType === "AREA") &&
        hasValidInfrastructureGeometry(item)) {
        geometry.push(item);
      }
    });

    return { geometry: geometry, status: status };
  }

  function pointToLatLng(coordinates) {
    return [coordinates[1], coordinates[0]];
  }

  function lineToLatLngs(coordinates) {
    return coordinates.map(pointToLatLng);
  }

  function polygonToLatLngs(coordinates) {
    if (!coordinates || !coordinates.length) {
      return [];
    }
    return coordinates[0].map(pointToLatLng);
  }

  function buildInfrastructureMapMarkerIcon(category) {
    var meta = getInfrastructureCategoryMeta(category);
    var icon = meta ? meta.icon : "🚧";
    var modifier = (category || "road").toLowerCase().replace("_", "-");
    return window.L.divIcon({
      className: "disaster-map-marker disaster-map-marker--infra disaster-map-marker--infra-" + modifier,
      html: '<span class="disaster-map-marker__icon" aria-hidden="true">' + icon + "</span>",
      iconSize: [32, 32],
      iconAnchor: [16, 16],
      popupAnchor: [0, -16]
    });
  }

  function buildInfrastructureMapPopupHtml(item, areaNameMap, sourceMap) {
    var source = sourceMap[item.source_id];
    var html = "";
    html += "<div class=\"disaster-map-popup disaster-map-popup--infra\">";
    html += "<p class=\"disaster-map-popup__name\"><strong>" + escapeHtml(item.title || "—") + "</strong></p>";
    var freshness = getInfrastructureFreshnessLabel(item);
    if (freshness) {
      html += "<p class=\"disaster-map-popup__freshness\">" + escapeHtml(freshness) + "</p>";
    }
    html += "<p class=\"disaster-map-popup__row\">カテゴリ：" + escapeHtml(getInfrastructureCategoryLabel(item.category)) + "</p>";
    html += "<p class=\"disaster-map-popup__row\">地域：" + escapeHtml(areaNameMap[item.area_id] || item.area_id || "—") + "</p>";
    html += "<p class=\"disaster-map-popup__row\">状態：" + escapeHtml(getInfrastructureStatusLabel(item)) + "</p>";
    var originalText = getInfrastructureOriginalText(item);
    if (originalText) {
      html += "<p class=\"disaster-map-popup__row\">原文：" + escapeHtml(originalText) + "</p>";
    }
    html += "<p class=\"disaster-map-popup__row\">最終確認：" + escapeHtml(formatDateTime(item.last_checked_at)) + "</p>";
    if (source && hasInfrastructureSourceUrl(source)) {
      html += "<p class=\"disaster-map-popup__row\"><a href=\"" + escapeHtml(source.url) + "\" target=\"_blank\" rel=\"noopener noreferrer\">提供元を見る</a></p>";
    }
    html += "</div>";
    return html;
  }

  function addInfrastructureGeometryToMap(item, layerGroup, areaNameMap, sourceMap, bounds) {
    var infoType = getInfrastructureInfoType(item);
    var color = DISASTER_MAP_INFRASTRUCTURE_COLORS[item.category] || "#64748b";
    var popupHtml = buildInfrastructureMapPopupHtml(item, areaNameMap, sourceMap);

    if (infoType === "POINT") {
      var latLng = pointToLatLng(item.geometry.coordinates);
      var marker = window.L.marker(latLng, {
        icon: buildInfrastructureMapMarkerIcon(item.category)
      });
      marker.bindPopup(popupHtml);
      marker.addTo(layerGroup);
      bounds.push(latLng);
      return;
    }

    if (infoType === "LINE") {
      var line = window.L.polyline(lineToLatLngs(item.geometry.coordinates), {
        color: color,
        weight: 4,
        opacity: 0.85
      });
      line.bindPopup(popupHtml);
      line.addTo(layerGroup);
      line.getLatLngs().forEach(function (latLng) {
        bounds.push([latLng.lat, latLng.lng]);
      });
      return;
    }

    if (infoType === "AREA") {
      var polygon = window.L.polygon(polygonToLatLngs(item.geometry.coordinates), {
        color: color,
        weight: 2,
        fillColor: color,
        fillOpacity: 0.2
      });
      polygon.bindPopup(popupHtml);
      polygon.addTo(layerGroup);
      polygon.getLatLngs()[0].forEach(function (latLng) {
        bounds.push([latLng.lat, latLng.lng]);
      });
    }
  }

  function renderInfrastructureMapStatusList(container, statusItems, areaNameMap, sourceMap) {
    if (!statusItems.length) {
      return;
    }

    var listWrap = createElement("div", "disaster-map__infra-status");
    listWrap.setAttribute("aria-label", "インフラ状態一覧");
    listWrap.appendChild(createElement("h3", "disaster-map__infra-status-title", "インフラ状態（カード）"));

    var list = createElement("div", "disaster-map__infra-status-list");
    statusItems.forEach(function (item) {
      var card = createElement("article", "disaster-map__infra-status-card");
      card.appendChild(createElement("h4", "disaster-map__infra-status-card-title", item.title || "—"));

      var freshness = getInfrastructureFreshnessLabel(item);
      if (freshness) {
        card.appendChild(createElement("p", "disaster-map__infra-status-freshness", freshness));
      }

      var meta = createElement("dl", "disaster-map__infra-status-meta");
      function addMeta(label, value) {
        var row = createElement("div", "disaster-map__infra-status-meta-row");
        row.appendChild(createElement("dt", null, label));
        row.appendChild(createElement("dd", null, value));
        meta.appendChild(row);
      }

      addMeta("カテゴリ", getInfrastructureCategoryLabel(item.category));
      addMeta("地域", areaNameMap[item.area_id] || item.area_id || "—");
      addMeta("状態", getInfrastructureStatusLabel(item));
      var originalText = getInfrastructureOriginalText(item);
      if (originalText) {
        addMeta("原文", originalText);
      }
      addMeta("最終確認", item.last_checked_at ? formatDateTime(item.last_checked_at) : "—");

      var source = sourceMap[item.source_id];
      if (source && hasInfrastructureSourceUrl(source)) {
        var sourceRow = createElement("div", "disaster-map__infra-status-meta-row");
        sourceRow.appendChild(createElement("dt", null, "Source"));
        var sourceDd = createElement("dd", null, "");
        var sourceLink = createElement("a", null, source.provider || "提供元を見る");
        sourceLink.href = source.url;
        sourceLink.target = "_blank";
        sourceLink.rel = "noopener noreferrer";
        sourceDd.appendChild(sourceLink);
        sourceRow.appendChild(sourceDd);
        meta.appendChild(sourceRow);
      }

      card.appendChild(meta);
      list.appendChild(card);
    });

    listWrap.appendChild(list);
    container.appendChild(listWrap);
  }

  function loadLeafletAssets() {
    return new Promise(function (resolve, reject) {
      if (window.L) {
        resolve();
        return;
      }

      if (!document.querySelector('link[data-leaflet-css="true"]')) {
        var link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = LEAFLET_CDN_BASE + "leaflet.css";
        link.setAttribute("data-leaflet-css", "true");
        document.head.appendChild(link);
      }

      var existingScript = document.querySelector('script[data-leaflet-js="true"]');
      if (existingScript) {
        existingScript.addEventListener("load", function () { resolve(); });
        existingScript.addEventListener("error", function () { reject(new Error("Leaflet load failed")); });
        if (window.L) {
          resolve();
        }
        return;
      }

      var script = document.createElement("script");
      script.src = LEAFLET_CDN_BASE + "leaflet.js";
      script.setAttribute("data-leaflet-js", "true");
      script.onload = function () { resolve(); };
      script.onerror = function () { reject(new Error("Leaflet load failed")); };
      document.body.appendChild(script);
    });
  }

  function buildMapMarkerIcon(category) {
    var icon = LOCATION_CATEGORY_ICONS[category] || "📍";
    var modifierMap = {
      WATER: "water",
      FOOD: "food",
      SUPPLY: "supply",
      CHARGING: "charging",
      SHELTER: "shelter"
    };
    var modifier = modifierMap[category] || "other";
    return window.L.divIcon({
      className: "disaster-map-marker disaster-map-marker--" + modifier,
      html: '<span class="disaster-map-marker__icon" aria-hidden="true">' + icon + "</span>",
      iconSize: [32, 32],
      iconAnchor: [16, 16],
      popupAnchor: [0, -16]
    });
  }

  function buildMapPopupHtml(location) {
    var sourceName = location.source && location.source.name ? location.source.name : "公式情報";
    var sourceUrl = location.source_url || "";
    var freshnessLabel = getLocationFreshnessLabel(location);
    var hoursText = getLocationHoursText(location);
    var categoryLabel = getLocationCategoryDisplayLabel(location.category);
    var originalText = getLocationOriginalText(location);

    var html = "";
    html += "<div class=\"disaster-map-popup\">";
    html += "<p class=\"disaster-map-popup__category\">" + escapeHtml(categoryLabel) + "</p>";
    html += "<p class=\"disaster-map-popup__row\"><span class=\"disaster-map-popup__label\">施設名：</span>" + escapeHtml(location.name) + "</p>";
    html += "<p class=\"disaster-map-popup__row\"><span class=\"disaster-map-popup__label\">自治体：</span>" + escapeHtml(location.area_name) + "</p>";
    if (location.category === "WATER" && hoursText && hoursText !== "—") {
      html += "<p class=\"disaster-map-popup__row\"><span class=\"disaster-map-popup__label\">利用時間：</span>" + escapeHtml(hoursText) + "</p>";
    }
    if (location.last_checked_at) {
      html += "<p class=\"disaster-map-popup__row\"><span class=\"disaster-map-popup__label\">更新日時：</span>" + escapeHtml(formatDateTime(location.last_checked_at)) + "</p>";
    }
    html += "<p class=\"disaster-map-popup__row\"><span class=\"disaster-map-popup__label\">確認元：</span>" + escapeHtml(sourceName) + "</p>";
    if (location.notes) {
      html += "<p class=\"disaster-map-popup__row\"><span class=\"disaster-map-popup__label\">注意事項：</span>" + escapeHtml(location.notes) + "</p>";
    }
    if (originalText) {
      html += "<p class=\"disaster-map-popup__original-text\" lang=\"ja\">" + escapeHtml(originalText) + "</p>";
    }
    if (freshnessLabel) {
      html += "<p class=\"disaster-map-popup__freshness\">" + escapeHtml(freshnessLabel) + "</p>";
    }
    if (location.status_label && location.category === "SHELTER") {
      html += "<p class=\"disaster-map-popup__row\"><span class=\"disaster-map-popup__label\">状況：</span>" + escapeHtml(location.status_label) + "</p>";
    }
    if (sourceUrl) {
      html += "<p class=\"disaster-map-popup__row\"><a href=\"" + escapeHtml(sourceUrl) + "\" target=\"_blank\" rel=\"noopener noreferrer\">公式情報を見る</a></p>";
    }
    html += "</div>";
    return html;
  }

  function initDisasterMap(mapContainer, config) {
    if (!mapContainer || !window.L) {
      return null;
    }

    if (mapContainer._leafletMap) {
      mapContainer._leafletMap.remove();
      mapContainer._leafletMap = null;
    }

    var map = window.L.map(mapContainer, {
      scrollWheelZoom: false
    });

    window.L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);

    var locationGroup = window.L.layerGroup();
    var infrastructureGroup = window.L.layerGroup();
    var bounds = [];
    mapContainer._locationMarkers = {};

    if (config.showLocation) {
      config.locations.forEach(function (location) {
        var marker = window.L.marker([location.lat, location.lng], {
          icon: buildMapMarkerIcon(location.category)
        });
        marker.bindPopup(buildMapPopupHtml(location));
        mapContainer._locationMarkers[location.location_id] = marker;
        marker.addTo(locationGroup);
        bounds.push([location.lat, location.lng]);
      });
      locationGroup.addTo(map);
    }

    if (config.showInfrastructure) {
      config.infrastructureGeometry.forEach(function (item) {
        addInfrastructureGeometryToMap(
          item,
          infrastructureGroup,
          config.areaNameMap,
          config.sourceMap,
          bounds
        );
      });
      if (config.infrastructureGeometry.length > 0) {
        infrastructureGroup.addTo(map);
      }
    }

    if (bounds.length === 0) {
      map.setView([32.7898, 130.7417], 10);
    } else if (bounds.length === 1) {
      map.setView(bounds[0], 14);
    } else {
      map.fitBounds(bounds, { padding: [32, 32] });
    }

    mapContainer._leafletMap = map;
    mapContainer._layerGroups = {
      location: locationGroup,
      infrastructure: infrastructureGroup
    };
    return map;
  }

  function updateDisasterMapLayers(mapContainer, showLocation, showInfrastructure) {
    if (!mapContainer || !mapContainer._leafletMap || !mapContainer._layerGroups) {
      return;
    }
    var map = mapContainer._leafletMap;
    var groups = mapContainer._layerGroups;

    if (showLocation) {
      if (!map.hasLayer(groups.location)) {
        groups.location.addTo(map);
      }
    } else if (map.hasLayer(groups.location)) {
      map.removeLayer(groups.location);
    }

    if (showInfrastructure) {
      if (!map.hasLayer(groups.infrastructure) && groups.infrastructure.getLayers().length > 0) {
        groups.infrastructure.addTo(map);
      }
    } else if (map.hasLayer(groups.infrastructure)) {
      map.removeLayer(groups.infrastructure);
    }

    map.invalidateSize();
  }

  function renderDisasterMapSection(container, disasterLocations, infrastructureStatus, infrastructureSources, areas) {
    var locations = getMapDisplayLocations(disasterLocations);
    var infrastructureItems = getMapInfrastructureItems(infrastructureStatus, infrastructureSources);
    var hasLocationLayer = locations.length > 0;
    var hasInfrastructureLayer = infrastructureItems.geometry.length > 0 ||
      infrastructureItems.status.length > 0;

    if (!hasLocationLayer && !hasInfrastructureLayer) {
      return;
    }

    var areaNameMap = buildAreaNameMap(areas);
    var sourceMap = buildInfrastructureSourceMap(infrastructureSources);

    var section = createElement("section", "disaster-map");
    section.id = "disaster-location-map-section";
    section.setAttribute("aria-labelledby", "disaster-map-title");

    var inner = createElement("div", "container");
    inner.appendChild(createElement("h2", "section-title disaster-map__title", "確認済み災害地点マップ"));
    inner.querySelector(".disaster-map__title").id = "disaster-map-title";
    inner.appendChild(createElement(
      "p",
      "disaster-map__lead",
      "給水・避難所（Location Layer）とインフラ情報（Infrastructure Layer）を地図上で切り替えて確認できます。"
    ));

    var toggle = createElement("button", "disaster-map__toggle", "災害マップを見る");
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-controls", "disaster-map-panel");

    var panel = createElement("div", "disaster-map__panel");
    panel.id = "disaster-map-panel";
    panel.hidden = true;

    var layerToggles = createElement("div", "disaster-map__layer-toggles");
    layerToggles.setAttribute("role", "group");
    layerToggles.setAttribute("aria-label", "マップレイヤー");

    var locationToggleId = "disaster-map-layer-location";
    var infrastructureToggleId = "disaster-map-layer-infrastructure";

    var locationLabel = createElement("label", "disaster-map__layer-toggle");
    locationLabel.htmlFor = locationToggleId;
    var locationCheckbox = createElement("input", "disaster-map__layer-checkbox");
    locationCheckbox.type = "checkbox";
    locationCheckbox.id = locationToggleId;
    locationCheckbox.checked = hasLocationLayer;
    locationCheckbox.disabled = !hasLocationLayer;
    locationLabel.appendChild(locationCheckbox);
    locationLabel.appendChild(document.createTextNode(" 💧 給水・避難所"));
    layerToggles.appendChild(locationLabel);

    var infrastructureLabel = createElement("label", "disaster-map__layer-toggle");
    infrastructureLabel.htmlFor = infrastructureToggleId;
    var infrastructureCheckbox = createElement("input", "disaster-map__layer-checkbox");
    infrastructureCheckbox.type = "checkbox";
    infrastructureCheckbox.id = infrastructureToggleId;
    infrastructureCheckbox.checked = hasInfrastructureLayer;
    infrastructureCheckbox.disabled = !hasInfrastructureLayer;
    infrastructureLabel.appendChild(infrastructureCheckbox);
    infrastructureLabel.appendChild(document.createTextNode(" 🚧 インフラ情報"));
    layerToggles.appendChild(infrastructureLabel);
    panel.appendChild(layerToggles);

    var locationLegend = createElement("div", "disaster-map__legend disaster-map__legend--location");
    locationLegend.setAttribute("aria-label", "給水・避難所の凡例");
    locationLegend.innerHTML = "<span class=\"disaster-map__legend-item\">💧 給水所</span><span class=\"disaster-map__legend-item\">🏠 避難所</span><span class=\"disaster-map__legend-item\">🍱 食料配布</span><span class=\"disaster-map__legend-item\">📦 物資配布</span><span class=\"disaster-map__legend-item\">🔋 充電支援</span>";
    panel.appendChild(locationLegend);

    var infrastructureLegend = createElement("div", "disaster-map__legend disaster-map__legend--infrastructure");
    infrastructureLegend.setAttribute("aria-label", "インフラ情報の凡例");
    infrastructureLegend.innerHTML = "<span class=\"disaster-map__legend-item\">🚧 道路・交通</span><span class=\"disaster-map__legend-item\">🚰 水道</span><span class=\"disaster-map__legend-item\">📡 通信</span><span class=\"disaster-map__legend-item\">⚡ 電力</span>";
    panel.appendChild(infrastructureLegend);

    var expansionNotice = createElement("p", "disaster-map__expansion-notice", "インフラマップ機能拡張中");
    expansionNotice.id = "disaster-map-infra-expansion-notice";
    panel.appendChild(expansionNotice);

    var mapContainer = createElement("div", "disaster-map__canvas");
    mapContainer.id = "disaster-location-map";
    mapContainer.setAttribute("role", "region");
    mapContainer.setAttribute("aria-label", "災害地点マップ");
    panel.appendChild(mapContainer);

    var infraStatusContainer = createElement("div", "disaster-map__infra-status-wrap");
    if (hasInfrastructureLayer) {
      renderInfrastructureMapStatusList(
        infraStatusContainer,
        infrastructureItems.status,
        areaNameMap,
        sourceMap
      );
    }
    panel.appendChild(infraStatusContainer);

    function syncLayerVisibility() {
      var showLocation = locationCheckbox.checked && hasLocationLayer;
      var showInfrastructure = infrastructureCheckbox.checked && hasInfrastructureLayer;
      locationLegend.hidden = !showLocation;
      infrastructureLegend.hidden = !showInfrastructure;
      expansionNotice.hidden = !showInfrastructure;
      infraStatusContainer.hidden = !showInfrastructure;
      if (mapContainer._leafletMap) {
        updateDisasterMapLayers(mapContainer, showLocation, showInfrastructure);
      }
    }

    locationCheckbox.addEventListener("change", syncLayerVisibility);
    infrastructureCheckbox.addEventListener("change", syncLayerVisibility);
    syncLayerVisibility();

    var mapReady = false;
    var mapLoading = false;

    toggle.addEventListener("click", function () {
      var willOpen = panel.hidden;
      panel.hidden = !willOpen;
      toggle.setAttribute("aria-expanded", willOpen ? "true" : "false");
      toggle.textContent = willOpen ? "災害マップを閉じる" : "災害マップを見る";

      if (!willOpen || mapReady || mapLoading) {
        if (willOpen && mapReady && mapContainer._leafletMap) {
          mapContainer._leafletMap.invalidateSize();
          syncLayerVisibility();
        }
        return;
      }

      mapLoading = true;
      loadLeafletAssets()
        .then(function () {
          initDisasterMap(mapContainer, {
            locations: locations,
            infrastructureGeometry: infrastructureItems.geometry,
            areaNameMap: areaNameMap,
            sourceMap: sourceMap,
            showLocation: locationCheckbox.checked && hasLocationLayer,
            showInfrastructure: infrastructureCheckbox.checked && hasInfrastructureLayer
          });
          mapReady = true;
          syncLayerVisibility();
        })
        .catch(function () {
          panel.appendChild(createElement("p", "disaster-map__error", "地図を読み込めませんでした。しばらくしてから再度お試しください。"));
        })
        .finally(function () {
          mapLoading = false;
        });
    });

    inner.appendChild(toggle);
    inner.appendChild(panel);
    section.appendChild(inner);
    container.appendChild(section);
  }

  function renderEmergencyNotice(container) {
    var section = createElement("section", "emergency-notice");
    section.id = "page-hero";
    section.setAttribute("role", "alert");
    section.setAttribute("aria-label", "緊急時の注意");

    var inner = createElement("div", "container");
    inner.appendChild(createElement("p", "emergency-notice__text", "緊急時は、自治体・警察・消防などの指示を優先してください。"));
    section.appendChild(inner);
    container.appendChild(section);
  }

  function buildMunicipalitySubtitle(navigation) {
    if (!navigation || navigation.length === 0) {
      return "各自治体の公式情報へリンクします。";
    }
    var names = navigation.map(function (item) {
      return item.name;
    });
    return names.join("・") + "の公式情報へリンクします。";
  }

  function renderPageHeader(container, navigation, lastVerified) {
    var header = createElement("header", "page-header");
    var inner = createElement("div", "container");

    var title = createElement("h1", "page-header__title");
    title.innerHTML = "令和8年熊本地震<br>自治体公式情報まとめ";
    inner.appendChild(title);

    inner.appendChild(createElement("p", "page-header__subtitle", buildMunicipalitySubtitle(navigation)));

    if (lastVerified) {
      var verified = createElement("p", "page-header__verified");
      verified.appendChild(createElement("span", "page-header__verified-label", "最終確認："));
      verified.appendChild(document.createTextNode(lastVerified));
      inner.appendChild(verified);
    }

    header.appendChild(inner);
    container.appendChild(header);
  }

  function renderCommunicationStatus(container, communicationStatus) {
    if (!communicationStatus || !communicationStatus.providers || communicationStatus.providers.length === 0) {
      return;
    }

    var section = createElement("section", "communication-status");
    section.setAttribute("aria-labelledby", "communication-status-title");

    var inner = createElement("div", "container");
    var sectionTitle = communicationStatus.section_title || "携帯電話・通信";
    var titleEl = createElement("h2", "communication-status__title", sectionTitle);
    titleEl.id = "communication-status-title";
    inner.appendChild(titleEl);

    var list = createElement("ul", "communication-status__list");

    communicationStatus.providers.forEach(function (provider) {
      var li = createElement("li", "communication-status__item");
      var link = createElement("a", "communication-status__link");
      link.href = provider.source_url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.setAttribute("aria-label", provider.provider_name + "の公式障害情報へ（外部リンク）");

      link.appendChild(createElement("span", "communication-status__provider", provider.provider_name));
      link.appendChild(createElement("span", "communication-status__text", getCommunicationStatusText(provider)));
      li.appendChild(link);
      appendCommunicationLastChecked(li, provider);
      list.appendChild(li);
    });

    if (communicationStatus.services && communicationStatus.services.length > 0) {
      communicationStatus.services.forEach(function (service) {
        var li = createElement("li", "communication-status__item communication-status__item--service");
        var displayName = service.display_name || service.service_name;
        var link = createElement("a", "communication-status__link");
        link.href = service.source_url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.setAttribute("aria-label", displayName + "の公式情報へ（外部リンク）");

        link.appendChild(createElement("span", "communication-status__provider", service.service_name));
        link.appendChild(createElement("span", "communication-status__text", getServiceStatusText(service)));
        li.appendChild(link);
        appendCommunicationLastChecked(li, service);

        if (service.summary) {
          li.appendChild(createElement("p", "communication-status__summary", service.summary));
        }

        if (service.caution) {
          li.appendChild(createElement("p", "communication-status__caution", service.caution));
        }

        list.appendChild(li);
      });
    }

    inner.appendChild(list);

    var confirmedAt = formatConfirmedAtShort(communicationStatus.confirmed_at);
    if (confirmedAt) {
      inner.appendChild(createElement("p", "communication-status__confirmed", confirmedAt));
    }

    section.appendChild(inner);
    container.appendChild(section);
  }

  function renderPageNavigation(container, navigation, records) {
    var wrap = createElement("div", "page-nav");

    var muniNav = createElement("nav", "municipality-nav");
    muniNav.setAttribute("aria-label", "自治体から探す");

    var muniInner = createElement("div", "container");
    muniInner.appendChild(createElement("p", "page-nav__label", "自治体から探す"));

    var muniScroll = createElement("div", "municipality-nav__scroll");
    var muniList = createElement("ul", "municipality-nav__list");

    navigation.forEach(function (item) {
      var li = createElement("li", "municipality-nav__item");
      var link = createElement("a", "municipality-nav__link", item.name);
      link.href = "#" + item.anchor;
      link.setAttribute("aria-label", item.name + "の情報へ移動");
      li.appendChild(link);
      muniList.appendChild(li);
    });

    muniScroll.appendChild(muniList);
    muniInner.appendChild(muniScroll);
    muniNav.appendChild(muniInner);
    wrap.appendChild(muniNav);

    var categories = getActiveCategories(records);
    if (categories.length > 0) {
      var catNav = createElement("nav", "category-nav");
      catNav.setAttribute("aria-label", "情報の種類から探す");

      var catInner = createElement("div", "container");
      catInner.appendChild(createElement("p", "page-nav__label", "情報の種類から探す"));

      var catScroll = createElement("div", "category-nav__scroll");
      var catList = createElement("ul", "category-nav__list");

      categories.forEach(function (cat, index) {
        if (index > 0) {
          var catSep = createElement("li", "category-nav__separator");
          catSep.setAttribute("aria-hidden", "true");
          catSep.textContent = "｜";
          catList.appendChild(catSep);
        }

        var catLi = createElement("li", "category-nav__item");
        var catLink = createElement("a", "category-nav__link", cat.label);
        catLink.href = "#" + cat.anchor;
        catLink.setAttribute("aria-label", cat.label + "の情報へ移動");
        catLi.appendChild(catLink);
        catList.appendChild(catLi);
      });

      catScroll.appendChild(catList);
      catInner.appendChild(catScroll);
      catNav.appendChild(catInner);
      wrap.appendChild(catNav);
    }

    container.appendChild(wrap);
  }

  function renderXFeedSection(container, xFeedState) {
    if (!xFeedState || xFeedState.status !== X_FEED_STATUS_AVAILABLE || !xFeedState.posts || xFeedState.posts.length === 0) {
      return;
    }

    var section = createElement("section", "x-feed");
    section.setAttribute("aria-labelledby", "x-feed-title");

    var inner = createElement("div", "container");
    var titleEl = createElement("h2", "section-title x-feed__title", xFeedState.section_title || "公式X速報");
    titleEl.id = "x-feed-title";
    inner.appendChild(titleEl);

    var syncedAt = formatSyncedAt(xFeedState.synced_at);
    if (syncedAt) {
      inner.appendChild(createElement("p", "x-feed__synced", "最終取得：" + syncedAt));
    }

    inner.appendChild(createElement("p", "x-feed__role", "速報性重視"));
    inner.appendChild(createElement(
      "p",
      "x-feed__lead",
      "自治体・公的機関の公式X投稿です。リアルタイムに近い最新投稿を表示します。詳細はリンク先でご確認ください。"
    ));

    var list = createElement("ul", "x-feed__list");

    xFeedState.posts.forEach(function (post) {
      var li = createElement("li", "x-feed__item");
      var meta = createElement("div", "x-feed__meta");

      var datetime = formatDateTime(post.post_time);
      if (datetime) {
        meta.appendChild(createElement("time", "x-feed__datetime", datetime));
      }

      meta.appendChild(createElement("span", "x-feed__label", X_FEED_ACCOUNT_LABEL));

      if (post.source_type === "LOCAL_GOVERNMENT" && post.municipality) {
        meta.appendChild(createElement("span", "x-feed__municipality", post.municipality));
      }

      var handleLabel = getXFeedHandleLabel(post);
      if (handleLabel) {
        meta.appendChild(createElement("span", "x-feed__handle", handleLabel));
      } else if (post.account_name && post.source_type !== "LOCAL_GOVERNMENT") {
        meta.appendChild(createElement("span", "x-feed__account", post.account_name));
      }

      li.appendChild(meta);

      if (post.text) {
        li.appendChild(createElement("p", "x-feed__text", post.text));
      }

      var link = createElement("a", "x-feed__link", "公式X投稿へ");
      link.href = post.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      var ariaSource = post.municipality || post.account_name || X_FEED_ACCOUNT_LABEL;
      link.setAttribute("aria-label", ariaSource + "のX投稿へ（外部リンク）");
      li.appendChild(link);

      list.appendChild(li);
    });

    inner.appendChild(list);
    section.appendChild(inner);
    container.appendChild(section);
  }

  function isEmergencyInfoRecord(record) {
    return record.update_type === "EMERGENCY_INFO" || !!record.original_text;
  }

  function renderLatestUpdates(container, records) {
    var section = createElement("section", "latest-updates");
    section.setAttribute("aria-labelledby", "latest-updates-title");

    var inner = createElement("div", "container");
    inner.appendChild(createElement("h2", "section-title latest-updates__title", "最新公式情報"));
    inner.querySelector(".latest-updates__title").id = "latest-updates-title";
    inner.appendChild(createElement("p", "latest-updates__role", "整理済み公式発表"));
    inner.appendChild(createElement(
      "p",
      "latest-updates__lead",
      "自治体・公的機関の公式発表を整理して表示しています。全文と最新状況は発表元の公式ページでご確認ください。"
    ));

    var sorted = records.slice().sort(compareByDateDesc).slice(0, MAX_LATEST);
    var list = createElement("ul", "latest-updates__list");

    sorted.forEach(function (record) {
      var li = createElement("li", "latest-updates__item");
      if (isEmergencyInfoRecord(record)) {
        li.classList.add("latest-updates__item--emergency");
      }
      var meta = createElement("div", "latest-updates__meta");

      var datetime = formatDateTime(record.displayed_updated_at);
      if (datetime) {
        meta.appendChild(createElement("time", "latest-updates__datetime", datetime));
      }
      meta.appendChild(createElement("span", "latest-updates__area", record.area_name));
      meta.appendChild(createElement("span", "latest-updates__category", record.public_category_label));

      li.appendChild(meta);

      if (isEmergencyInfoRecord(record) && record.original_text) {
        li.appendChild(createElement("p", "latest-updates__original-text", record.original_text));
        var emergencyMeta = createElement("dl", "latest-updates__emergency-meta");
        if (record.published_at) {
          emergencyMeta.appendChild(createElement("dt", null, "発表日時"));
          emergencyMeta.appendChild(createElement("dd", null, formatDateTime(record.published_at)));
        }
        if (record.collected_at) {
          emergencyMeta.appendChild(createElement("dt", null, "取得日時"));
          emergencyMeta.appendChild(createElement("dd", null, formatDateTime(record.collected_at)));
        }
        var sourceLabel = record.source_name || record.department || record.area_name;
        if (sourceLabel) {
          emergencyMeta.appendChild(createElement("dt", null, "Source"));
          emergencyMeta.appendChild(createElement("dd", null, sourceLabel));
        }
        li.appendChild(emergencyMeta);
      } else {
        li.appendChild(createElement("p", "latest-updates__headline", record.headline));
      }

      var link = createElement("a", "latest-updates__link", "発表元の公式ページへ");
      link.href = record.source_url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.setAttribute("aria-label", (record.headline || record.original_text || record.area_name) + "の発表元公式ページへ（外部リンク）");
      li.appendChild(link);

      list.appendChild(li);
    });

    inner.appendChild(list);
    section.appendChild(inner);
    container.appendChild(section);
  }

  function renderOfficialInfoCard(record) {
    var card = createElement("article", "official-info-card");
    if (isEmergencyInfoRecord(record)) {
      card.classList.add("official-info-card--emergency");
    }
    card.appendChild(createElement("p", "official-info-card__category", record.public_category_label));

    if (isEmergencyInfoRecord(record) && record.original_text) {
      card.appendChild(createElement("h3", "official-info-card__headline", record.area_name + "（公式発表）"));
      card.appendChild(createElement("p", "official-info-card__original-text", record.original_text));
    } else {
      card.appendChild(createElement("h3", "official-info-card__headline", record.headline));
      if (record.summary) {
        card.appendChild(createElement("p", "official-info-card__summary", record.summary));
      }
    }

    var meta = createElement("dl", "official-info-card__meta");
    if (isEmergencyInfoRecord(record) && record.published_at) {
      meta.appendChild(createElement("dt", null, "発表日時"));
      meta.appendChild(createElement("dd", null, formatDateTime(record.published_at)));
    }
    if (isEmergencyInfoRecord(record) && record.collected_at) {
      meta.appendChild(createElement("dt", null, "取得日時"));
      meta.appendChild(createElement("dd", null, formatDateTime(record.collected_at)));
    }
    var updated = formatDateTime(record.displayed_updated_at);
    if (updated && !isEmergencyInfoRecord(record)) {
      meta.appendChild(createElement("dt", null, "更新："));
      meta.appendChild(createElement("dd", null, updated));
    }

    var sourceLabel = record.department || record.source_name || record.area_name;
    if (sourceLabel) {
      meta.appendChild(createElement("dt", null, isEmergencyInfoRecord(record) ? "Source" : "発表："));
      meta.appendChild(createElement("dd", null, sourceLabel));
    }
    card.appendChild(meta);

    var actions = createElement("div", "official-info-card__actions");
    var link = createElement("a", "official-info-card__link", "発表元の公式ページへ");
    link.href = record.source_url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.setAttribute("aria-label", record.headline + "の発表元公式ページへ（外部リンク）");
    actions.appendChild(link);
    actions.appendChild(createElement("span", "official-info-card__domain", extractDomain(record.source_url)));
    card.appendChild(actions);

    return card;
  }

  function groupRecordsByCategory(records) {
    var groups = {};
    records.forEach(function (record) {
      var id = record.public_category_id;
      if (!groups[id]) {
        groups[id] = [];
      }
      groups[id].push(record);
    });
    return groups;
  }

  function renderAreaSection(container, area, records, categoryAnchorsPlaced) {
    var section = createElement("section", "area-section");
    section.id = area.anchor;
    section.setAttribute("aria-labelledby", area.anchor + "-title");

    var inner = createElement("div", "container");
    var headerWrap = createElement("div", "area-section__header");
    var title = createElement("h2", "area-section__title", area.name);
    title.id = area.anchor + "-title";
    headerWrap.appendChild(title);
    inner.appendChild(headerWrap);

    var areaRecords = records
      .filter(function (r) { return r.area_id === area.area_id; })
      .sort(compareByCategoryThenDate);

    if (area.area_id === "KM004" && areaRecords.length === 0) {
      var empty = createElement("div", "area-section__placeholder");
      empty.appendChild(createElement("p", "area-section__placeholder-text", "現在、公開可能な公式情報を確認中です。"));
      inner.appendChild(empty);
    } else if (areaRecords.length === 0) {
      section.remove();
      return;
    } else {
      var groups = groupRecordsByCategory(areaRecords);
      var cards = createElement("div", "area-section__cards");

      CATEGORY_ORDER.forEach(function (cat) {
        var groupRecords = groups[cat.id];
        if (!groupRecords) {
          return;
        }

        groupRecords.sort(compareByDateDesc);

        var group = createElement("div", "area-section__category-group");
        var heading = createElement("h3", "area-section__category-title", groupRecords[0].public_category_label);

        if (!categoryAnchorsPlaced[cat.id]) {
          heading.id = cat.anchor;
          categoryAnchorsPlaced[cat.id] = true;
        }

        group.appendChild(heading);
        groupRecords.forEach(function (record) {
          group.appendChild(renderOfficialInfoCard(record));
        });
        cards.appendChild(group);
      });

      inner.appendChild(cards);
    }

    section.appendChild(inner);
    container.appendChild(section);
  }

  function renderAboutSection(container) {
    var section = createElement("section", "about-section");
    section.setAttribute("aria-labelledby", "about-section-title");

    var inner = createElement("div", "container");
    inner.appendChild(createElement("h2", "section-title about-section__title", "このページの情報について"));
    inner.querySelector(".about-section__title").id = "about-section-title";

    var body = createElement("div", "about-section__body");
    body.appendChild(createElement("p", null, "このページでは、自治体および公的機関が公表した情報のみを掲載しています。"));
    body.appendChild(createElement("p", null, "各情報の詳細と最新状況は、「発表元の公式ページへ」から確認してください。"));
    inner.appendChild(body);
    section.appendChild(inner);
    container.appendChild(section);
  }

  function renderCautionSection(container) {
    var section = createElement("section", "caution-section");
    section.setAttribute("aria-labelledby", "caution-section-title");

    var inner = createElement("div", "container");
    inner.appendChild(createElement("h2", "section-title caution-section__title", "公式情報確認の注意"));
    inner.querySelector(".caution-section__title").id = "caution-section-title";

    var body = createElement("div", "caution-section__body");
    body.appendChild(createElement("p", null, "掲載情報は確認時点の内容です。避難、給水、道路規制などの最新状況は、必ずリンク先の公式発表をご確認ください。"));
    inner.appendChild(body);
    section.appendChild(inner);
    container.appendChild(section);
  }

  function renderPageFooter(container) {
    var footer = createElement("footer", "page-footer");
    var inner = createElement("div", "container");
    inner.appendChild(createElement("p", "page-footer__copy", "令和8年熊本地震 自治体公式情報まとめ"));
    footer.appendChild(inner);
    container.appendChild(footer);
  }

  var BACK_TO_TOP_THRESHOLD = 400;

  function initBackToTop(heroTarget) {
    var button = createElement("button", "back-to-top");
    button.type = "button";
    button.textContent = "↑ ページ上部へ戻る";
    button.setAttribute("aria-label", "ページ上部へ戻る");
    button.setAttribute("aria-hidden", "true");
    button.tabIndex = -1;

    function updateVisibility() {
      var show = window.scrollY > BACK_TO_TOP_THRESHOLD;
      button.classList.toggle("back-to-top--visible", show);
      button.setAttribute("aria-hidden", show ? "false" : "true");
      button.tabIndex = show ? 0 : -1;
    }

    button.addEventListener("click", function () {
      var prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      var behavior = prefersReducedMotion ? "auto" : "smooth";

      if (heroTarget) {
        heroTarget.scrollIntoView({ behavior: behavior, block: "start" });
      } else {
        window.scrollTo({ top: 0, behavior: behavior });
      }
    });

    window.addEventListener("scroll", updateVisibility, { passive: true });
    updateVisibility();
    document.body.appendChild(button);
  }

  function renderLoadError(page) {
    page.innerHTML = "";
    renderEmergencyNotice(page);
    var wrap = createElement("div", "container load-error");
    wrap.setAttribute("role", "alert");
    wrap.appendChild(createElement("p", "load-error__message", LOAD_ERROR_MESSAGE));
    page.appendChild(wrap);
  }

  function init() {
    var page = document.getElementById("disaster-portal-page");
    if (!page) {
      return;
    }

    Promise.all([
      loadJson("phase1_areas.json"),
      loadJson("phase1_navigation.json"),
      loadJson("phase1_updates.json"),
      loadJson("communication_status.json"),
      loadJson("status.json"),
      loadJson("area_navigation.json"),
      loadJson("disaster_locations.json"),
      loadJson("location_sources.json"),
      loadJson("water_cross_view.json"),
      loadWaterSearchIndex(),
      loadDisasterSearchIndex(),
      loadJson("infrastructure_status.json"),
      loadJson("infrastructure_sources.json"),
      loadXFeedPreview()
    ])
      .then(function (results) {
        var areas = results[0];
        var navigation = results[1];
        var updates = results[2];
        var communicationStatus = results[3];
        var publicStatus = results[4];
        var areaNavigation = results[5];
        var disasterLocations = results[6];
        var locationSources = results[7];
        var waterCrossView = results[8];
        var waterSearchIndex = results[9];
        var disasterSearchIndex = results[10];
        var infrastructureStatus = results[11];
        var infrastructureSources = results[12];
        var xFeedState = results[13];

        var publicRecords = updates
          .filter(isPublicRecord)
          .filter(isAllowedForArea);

        var lastVerified = publicStatus && publicStatus.last_patrol_at
          ? formatDateTime(publicStatus.last_patrol_at)
          : "";

        page.innerHTML = "";

        renderEmergencyNotice(page);
        renderPageHeader(page, navigation, lastVerified);
        renderDisasterSearchPromo(page);
        renderAreaNavPromo(page);
        renderCommunicationStatus(page, communicationStatus);
        renderPageNavigation(page, navigation, publicRecords);
        renderXFeedSection(page, xFeedState);

        var categoryAnchorsPlaced = {};
        areas.forEach(function (area) {
          renderAreaSection(page, area, publicRecords, categoryAnchorsPlaced);
        });

        if (publicRecords.length > 0) {
          renderLatestUpdates(page, publicRecords);
        }

        renderAreaDisasterNav(page, areaNavigation, disasterLocations, locationSources);
        renderDisasterSearch(page, disasterSearchIndex, "WATER");
        renderDisasterSearch(page, disasterSearchIndex, "VOLUNTEER");
        renderWaterSearch(page, waterSearchIndex);
        renderWaterCrossView(page, waterCrossView);
        renderInfrastructureSection(page, infrastructureStatus, infrastructureSources, areas);
        renderDisasterMapSection(page, disasterLocations, infrastructureStatus, infrastructureSources, areas);
        renderAboutSection(page);
        renderCautionSection(page);
        renderPageFooter(page);
        initBackToTop(document.getElementById("page-hero"));
      })
      .catch(function () {
        renderLoadError(page);
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

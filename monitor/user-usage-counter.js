"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const OUTPUT_DIR = path.join(ROOT, "data", "operation_monitor");
const EVENT_LOG_FILE = path.join(OUTPUT_DIR, "user-usage-event-log.json");
const COUNTER_FILE = path.join(OUTPUT_DIR, "user-usage-counter.json");

const USAGE_EVENTS = {
  page_view: "page_view",
  search_water: "search_water",
  view_water_detail: "view_water_detail",
  search_volunteer: "search_volunteer",
  search_support_service: "search_support_service",
  view_communication: "view_communication",
  view_official_info: "view_official_info"
};

const EVENT_OUTPUT_KEYS = {
  page_view: null,
  search_water: "water_search",
  view_water_detail: "water_detail_view",
  search_volunteer: "volunteer_search",
  search_support_service: "support_service_search",
  view_communication: "communication_view",
  view_official_info: "official_info_view"
};

const FORBIDDEN_FIELDS = [
  "ip",
  "ip_address",
  "user_agent",
  "cookie",
  "session_id",
  "visitor_id",
  "email",
  "phone",
  "user_id",
  "device_id"
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
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    return fallback;
  }
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function isAllowedUsageEvent(eventName) {
  return Object.prototype.hasOwnProperty.call(USAGE_EVENTS, eventName);
}

function getJstDateString(date) {
  const value = date || new Date();
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(value);
}

function getTodayKey(date) {
  return getJstDateString(date || new Date());
}

function getRecordedDateKey(recordedAt) {
  if (!recordedAt) {
    return "";
  }
  const parsed = new Date(recordedAt);
  if (Number.isNaN(parsed.getTime())) {
    return String(recordedAt).slice(0, 10);
  }
  return getJstDateString(parsed);
}

function loadUsageEventLog(options) {
  options = options || {};
  return readJson(options.logPath || EVENT_LOG_FILE, {
    version: "1.0",
    events: []
  });
}

function writeUsageEventLog(log, options) {
  options = options || {};
  writeJson(options.logPath || EVENT_LOG_FILE, log);
  return options.logPath || EVENT_LOG_FILE;
}

function recordUsageEvent(eventName, options) {
  options = options || {};
  if (!isAllowedUsageEvent(eventName)) {
    return { ok: false, error: "invalid event: " + eventName };
  }

  const recordedAt = options.recordedAt || new Date().toISOString();
  const log = loadUsageEventLog(options);
  const events = Array.isArray(log.events) ? log.events.slice() : [];
  events.push({
    event: eventName,
    recorded_at: recordedAt
  });

  const nextLog = {
    version: "1.0",
    events: events
  };

  writeUsageEventLog(nextLog, options);

  const aggregateResult = writeUserUsageCounter({
    logPath: options.logPath,
    counterPath: options.counterPath,
    generatedAt: recordedAt
  });

  return {
    ok: true,
    event: eventName,
    recorded_at: recordedAt,
    counterPath: aggregateResult.outputPath
  };
}

function buildEventCounts(events) {
  const counts = {
    water_search: 0,
    water_detail_view: 0,
    volunteer_search: 0,
    support_service_search: 0,
    communication_view: 0,
    official_info_view: 0
  };

  (events || []).forEach(function (entry) {
    const outputKey = EVENT_OUTPUT_KEYS[entry.event];
    if (outputKey && counts[outputKey] !== undefined) {
      counts[outputKey] += 1;
    }
  });

  return counts;
}

function buildUserUsageCounter(options) {
  options = options || {};
  const generatedAt = options.generatedAt || new Date().toISOString();
  const log = loadUsageEventLog(options);
  const events = Array.isArray(log.events) ? log.events : [];
  const todayKey = getTodayKey(new Date(generatedAt));

  const pageViews = events.filter(function (entry) {
    return entry.event === USAGE_EVENTS.page_view;
  });
  const todayViews = pageViews.filter(function (entry) {
    return getRecordedDateKey(entry.recorded_at) === todayKey;
  });

  const lastAccess = events.length
    ? events
        .map(function (entry) {
          return entry.recorded_at;
        })
        .sort()
        .reverse()[0]
    : null;

  return {
    version: "1.0",
    view_type: "USER_USAGE_COUNTER",
    generated_at: generatedAt,
    constraints: {
      no_personal_data: true,
      no_cookies: true,
      no_ip_storage: true,
      no_external_analytics: true,
      public_ui_display: false
    },
    page_views: pageViews.length,
    today_views: todayViews.length,
    today_key: todayKey,
    events: buildEventCounts(events),
    last_access_at: lastAccess,
    event_log_count: events.length,
    source_files: {
      event_log_json: "data/operation_monitor/user-usage-event-log.json"
    }
  };
}

function validateUserUsageCounter(report) {
  const errors = [];

  if (!report || report.version !== "1.0") {
    return ["report version must be 1.0"];
  }
  if (report.view_type !== "USER_USAGE_COUNTER") {
    errors.push("view_type must be USER_USAGE_COUNTER");
  }

  ["page_views", "today_views", "events"].forEach(function (field) {
    if (report[field] === undefined || report[field] === null) {
      errors.push("missing field: " + field);
    }
  });

  if (report.last_access_at === undefined) {
    errors.push("missing field: last_access_at");
  }

  if (typeof report.page_views !== "number" || report.page_views < 0) {
    errors.push("page_views must be a non-negative number");
  }
  if (typeof report.today_views !== "number" || report.today_views < 0) {
    errors.push("today_views must be a non-negative number");
  }
  if (typeof report.events !== "object" || Array.isArray(report.events)) {
    errors.push("events must be an object");
  }

  const serialized = JSON.stringify(report).toLowerCase();
  FORBIDDEN_FIELDS.forEach(function (field) {
    if (serialized.indexOf('"' + field + '"') >= 0) {
      errors.push("forbidden field present: " + field);
    }
  });

  return errors;
}

function writeUserUsageCounter(options) {
  options = options || {};
  const report = buildUserUsageCounter(options);
  const errors = validateUserUsageCounter(report);
  if (errors.length > 0) {
    return { ok: false, errors: errors, report: report };
  }

  const outputPath = options.counterPath || COUNTER_FILE;
  writeJson(outputPath, report);
  return { ok: true, errors: [], report: report, outputPath: outputPath };
}

module.exports = {
  ROOT,
  EVENT_LOG_FILE,
  COUNTER_FILE,
  USAGE_EVENTS,
  EVENT_OUTPUT_KEYS,
  isAllowedUsageEvent,
  getJstDateString,
  getTodayKey,
  getRecordedDateKey,
  loadUsageEventLog,
  writeUsageEventLog,
  recordUsageEvent,
  buildUserUsageCounter,
  validateUserUsageCounter,
  writeUserUsageCounter
};

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.CommunicationDisplayAdapter = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var DISPLAY_STATUS = {
    AVAILABLE: "AVAILABLE",
    PARTIAL: "PARTIAL",
    UNAVAILABLE: "UNAVAILABLE",
    UNKNOWN: "UNKNOWN"
  };

  var DISPLAY_STATUS_LABELS = {
    AVAILABLE: "🟢 利用可能",
    PARTIAL: "🟡 一部地域で利用可能",
    UNAVAILABLE: "🔴 利用困難",
    UNKNOWN: "⚪ 情報確認中"
  };

  function parseDate(value) {
    if (!value) {
      return null;
    }
    var date = new Date(value);
    return isNaN(date.getTime()) ? null : date;
  }

  function formatCheckedAt(value) {
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

  function mapRawStatus(rawStatus) {
    switch (rawStatus) {
      case "AVAILABLE":
        return DISPLAY_STATUS.AVAILABLE;
      case "PARTIAL_OUTAGE":
        return DISPLAY_STATUS.PARTIAL;
      case "OUTAGE":
        return DISPLAY_STATUS.UNAVAILABLE;
      case "CHECK_OFFICIAL":
      case "PENDING":
      case "UNKNOWN":
        return DISPLAY_STATUS.UNKNOWN;
      default:
        return DISPLAY_STATUS.UNKNOWN;
    }
  }

  function normalizeAreas(areas) {
    if (!Array.isArray(areas)) {
      return [];
    }
    return areas.filter(function (area) {
      return typeof area === "string" && area.trim().length > 0;
    });
  }

  function adaptCommunicationEntry(entry) {
    var status = mapRawStatus(entry && entry.status);
    var areas = normalizeAreas(entry && entry.areas);
    var checkedSource = (entry && (entry.last_checked || entry.confirmed_at)) || null;

    return {
      carrier: (entry && (entry.provider_name || entry.service_name || entry.display_name)) || "",
      status: status,
      status_label: DISPLAY_STATUS_LABELS[status],
      areas: areas,
      checked_at: formatCheckedAt(checkedSource),
      source_url: (entry && entry.source_url) || ""
    };
  }

  function adaptCommunicationProvider(provider) {
    return adaptCommunicationEntry(provider);
  }

  function adaptCommunicationService(service) {
    return adaptCommunicationEntry(service);
  }

  return {
    DISPLAY_STATUS: DISPLAY_STATUS,
    DISPLAY_STATUS_LABELS: DISPLAY_STATUS_LABELS,
    mapRawStatus: mapRawStatus,
    normalizeAreas: normalizeAreas,
    formatCheckedAt: formatCheckedAt,
    adaptCommunicationEntry: adaptCommunicationEntry,
    adaptCommunicationProvider: adaptCommunicationProvider,
    adaptCommunicationService: adaptCommunicationService
  };
});

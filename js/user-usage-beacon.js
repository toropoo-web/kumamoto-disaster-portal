(function (global) {
  "use strict";

  var ENDPOINT = "/api/usage-event";
  var ALLOWED_EVENTS = {
    page_view: true,
    search_water: true,
    view_water_detail: true,
    search_volunteer: true,
    search_support_service: true,
    view_communication: true,
    view_official_info: true
  };

  function warn(message, detail) {
    if (global.console && typeof global.console.warn === "function") {
      global.console.warn("[UserUsageBeacon] " + message, detail || "");
    }
  }

  function deliverWithFetch(eventName, payload) {
    if (!global.fetch) {
      return;
    }

    global
      .fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true
      })
      .then(function (response) {
        if (!response.ok) {
          warn("request rejected", { event: eventName, status: response.status });
        }
        return response.json().catch(function () {
          return null;
        });
      })
      .then(function (body) {
        if (body && body.ok === false) {
          warn("server error", { event: eventName, error: body.error });
        }
      })
      .catch(function (err) {
        warn("network error", { event: eventName, error: err && err.message });
      });
  }

  function track(eventName) {
    if (!ALLOWED_EVENTS[eventName]) {
      return;
    }

    var payload = JSON.stringify({ event: eventName });
    try {
      if (global.navigator && typeof global.navigator.sendBeacon === "function") {
        var blob = new Blob([payload], { type: "application/json" });
        if (global.navigator.sendBeacon(ENDPOINT, blob)) {
          return;
        }
        warn("sendBeacon rejected, falling back to fetch", { event: eventName });
      }
    } catch (err) {
      warn("sendBeacon failed, falling back to fetch", { event: eventName, error: err && err.message });
    }

    deliverWithFetch(eventName, payload);
  }

  global.UserUsageBeacon = {
    track: track
  };
})(window);

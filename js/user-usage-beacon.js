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
      }
    } catch (err) {
      // fail-open
    }

    if (global.fetch) {
      global.fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true
      }).catch(function () {
        // fail-open
      });
    }
  }

  global.UserUsageBeacon = {
    track: track
  };
})(window);

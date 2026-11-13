(() => {
  "use strict";

  const apiBase = String(window.SITE_ANALYTICS_API || "").replace(/\/$/, "");
  if (!apiBase) return;

  const sessionKey = "site-analytics-session-id";

  function uuid() {
    return crypto.randomUUID();
  }

  function getSessionId() {
    let sessionId = sessionStorage.getItem(sessionKey);
    if (!sessionId) {
      sessionId = uuid();
      sessionStorage.setItem(sessionKey, sessionId);
    }
    return sessionId;
  }

  function send(path, payload) {
    const body = JSON.stringify({
      ...payload,
      session_id: payload.session_id || getSessionId(),
      page_path: payload.page_path || window.location.pathname
    });

    try {
      navigator.sendBeacon(
        `${apiBase}${path}`,
        new Blob([body], { type: "text/plain;charset=UTF-8" })
      );
    } catch {
      // Analytics must never interfere with the page or the chat.
    }
  }

  function safeDestination(anchor) {
    try {
      const url = new URL(anchor.href, window.location.href);
      if (url.protocol === "http:" || url.protocol === "https:") {
        return `${url.origin}${url.pathname}`;
      }
      return url.protocol === "mailto:" ? "mailto:" : url.protocol;
    } catch {
      return null;
    }
  }

  function shortLabel(element) {
    const explicit =
      element.dataset.analyticsLabel ||
      element.getAttribute("aria-label") ||
      element.getAttribute("title") ||
      element.getAttribute("data-target");
    if (explicit) return explicit.slice(0, 120);

    if (element.matches("a, button")) {
      return (element.innerText || element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 120) || null;
    }
    return null;
  }

  function trackClick(event) {
    const target = event.target instanceof Element
      ? event.target
      : event.target?.parentElement;
    if (!target) return;

    const anchor = target.closest("a[href]");
    const chip = target.closest(".inline-expand, [data-analytics-type='text-chip']");
    const type = anchor ? "link_click" : chip ? "text_chip_click" : "element_click";

    send("/v1/events", {
      event_id: uuid(),
      event_type: type,
      target_tag: target.tagName.toLowerCase(),
      target_id: target.id || null,
      element_tag: (anchor || chip || target).tagName.toLowerCase(),
      element_id: (anchor || chip || target).id || null,
      element_class: typeof (anchor || chip || target).className === "string"
        ? (anchor || chip || target).className.slice(0, 160)
        : null,
      label: shortLabel(anchor || chip || target),
      link_url: anchor ? safeDestination(anchor) : null
    });
  }

  window.SiteAnalytics = Object.freeze({
    sessionId: getSessionId,
    chatOpened(chatId) {
      send("/v1/events", {
        event_id: uuid(),
        event_type: "chat_opened",
        chat_id: chatId
      });
    },
    chatTurn(turn) {
      send("/v1/turns", turn);
    }
  });

  send("/v1/events", {
    event_id: uuid(),
    event_type: "page_view",
    referrer: document.referrer ? new URL(document.referrer).origin : null
  });
  document.addEventListener("click", trackClick, true);
})();

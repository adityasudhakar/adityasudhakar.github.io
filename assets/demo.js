(() => {
  "use strict";

  const CHAT_ENDPOINT = "https://chat-api-production-9a27.up.railway.app/chat";
  const panel = document.querySelector(".chat-panel");
  const backdrop = document.querySelector(".chat-backdrop");
  const log = document.getElementById("chat-log");
  const form = document.getElementById("chat-form");
  const input = document.getElementById("chat-input");
  const submit = form?.querySelector('button[type="submit"]');
  const suggestions = document.getElementById("chat-suggestions");
  const openers = document.querySelectorAll("[data-open-chat]");
  const closers = document.querySelectorAll("[data-close-chat]");

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    document.querySelectorAll("video[autoplay]").forEach((video) => video.pause());
    const tour = document.querySelector('.motion-item--sf img[src$=".gif"]');
    if (tour) tour.src = "/assets/media/sf-49-mile-tour-poster.jpg";
  }

  if (!panel || !backdrop || !log || !form || !input || !submit || !suggestions) return;

  const starterQuestions = [
    "What has Aditya built?",
    "Tell me about his robotics work",
    "What is Vanna?",
    "What is his background?"
  ];

  let previousResponseId = null;
  let chatId = null;
  let turnNumber = 0;
  let initialized = false;
  let lastFocused = null;
  let busy = false;

  function renderSources(container, citations) {
    if (!Array.isArray(citations) || !citations.length) return;

    const sources = document.createElement("div");
    sources.className = "chat-sources";

    for (const citation of citations.slice(0, 6)) {
      if (!citation?.url) continue;
      const link = document.createElement("a");
      link.className = "chat-source";
      link.href = citation.url;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = `${citation.title || new URL(citation.url).hostname} ↗`;
      sources.append(link);
    }

    if (sources.childElementCount) container.append(sources);
  }

  function addMessage(role, text, citations = []) {
    const message = document.createElement("div");
    message.className = `chat-message chat-message--${role}`;
    message.textContent = text;

    if (role === "assistant") renderSources(message, citations);
    log.append(message);
    log.scrollTop = log.scrollHeight;
    return message;
  }

  function setBusy(value) {
    busy = value;
    input.disabled = value;
    submit.disabled = value;
  }

  async function answer(question, turnId, number) {
    const startedAt = performance.now();
    setBusy(true);
    window.SiteAnalytics?.chatTurn({
      turn_id: turnId,
      chat_id: chatId,
      turn_number: number,
      user_message: question,
      status: "pending"
    });
    const pending = addMessage("assistant", "Searching Aditya’s public work…");
    pending.classList.add("chat-message--pending");

    try {
      const response = await fetch(CHAT_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: question,
          previous_response_id: previousResponseId
        })
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) throw new Error(payload.error || "The assistant is unavailable.");
      previousResponseId = payload.response_id || previousResponseId;
      window.SiteAnalytics?.chatTurn({
        turn_id: turnId,
        chat_id: chatId,
        turn_number: number,
        user_message: question,
        assistant_reply: payload.answer || "",
        citations: Array.isArray(payload.citations) ? payload.citations : [],
        openai_response_id: payload.response_id || null,
        latency_ms: Math.round(performance.now() - startedAt),
        status: "completed"
      });
      pending.remove();
      addMessage("assistant", payload.answer || "I couldn’t find a reliable answer.", payload.citations);
    } catch (error) {
      window.SiteAnalytics?.chatTurn({
        turn_id: turnId,
        chat_id: chatId,
        turn_number: number,
        user_message: question,
        latency_ms: Math.round(performance.now() - startedAt),
        status: "failed",
        error_code: error instanceof TypeError ? "network_error" : "chat_api_error"
      });
      pending.remove();
      addMessage(
        "assistant",
        error instanceof Error && error.message
          ? error.message
          : "I couldn’t reach the assistant. Please try again."
      );
    } finally {
      setBusy(false);
      input.focus();
    }
  }

  function submitQuestion(question) {
    const clean = question.trim();
    if (!clean || busy) return;
    if (!chatId) chatId = crypto.randomUUID();
    const turnId = crypto.randomUUID();
    turnNumber += 1;
    addMessage("user", clean);
    input.value = "";
    answer(clean, turnId, turnNumber);
  }

  function renderSuggestions() {
    suggestions.replaceChildren();
    for (const question of starterQuestions) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = question;
      button.addEventListener("click", () => submitQuestion(question));
      suggestions.append(button);
    }
  }

  function openChat() {
    lastFocused = document.activeElement;
    if (!chatId) chatId = crypto.randomUUID();
    window.SiteAnalytics?.chatOpened(chatId);
    panel.hidden = false;
    backdrop.hidden = false;
    document.body.classList.add("chat-open");

    if (!initialized) {
      addMessage(
        "assistant",
        "Ask me about Aditya’s projects, work, or background. I’ll search his website, GitHub, and public LinkedIn information before answering."
      );
      renderSuggestions();
      initialized = true;
    }

    window.requestAnimationFrame(() => input.focus());
  }

  function closeChat() {
    panel.hidden = true;
    backdrop.hidden = true;
    document.body.classList.remove("chat-open");
    if (lastFocused instanceof HTMLElement) lastFocused.focus();
  }

  openers.forEach((button) => button.addEventListener("click", openChat));
  closers.forEach((button) => button.addEventListener("click", closeChat));
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submitQuestion(input.value);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !panel.hidden) closeChat();
  });
})();

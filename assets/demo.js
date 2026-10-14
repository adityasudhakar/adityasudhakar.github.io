(() => {
  "use strict";

  const panel = document.querySelector(".chat-panel");
  const backdrop = document.querySelector(".chat-backdrop");
  const log = document.getElementById("chat-log");
  const form = document.getElementById("chat-form");
  const input = document.getElementById("chat-input");
  const suggestions = document.getElementById("chat-suggestions");
  const openers = document.querySelectorAll("[data-open-chat]");
  const closers = document.querySelectorAll("[data-close-chat]");

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    document.querySelectorAll("video[autoplay]").forEach((video) => video.pause());
    const tour = document.querySelector('.motion-item--sf img[src$=".gif"]');
    if (tour) tour.src = "/assets/media/sf-49-mile-tour-poster.jpg";
  }

  if (!panel || !backdrop || !log || !form || !input || !suggestions) return;

  const starterQuestions = [
    "What has Aditya built?",
    "Show me robotics",
    "What does LinkedIn say?",
    "What is Vanna?"
  ];
  const stopWords = new Set([
    "about", "aditya", "and", "are", "can", "did", "does", "for", "from",
    "has", "have", "his", "how", "into", "is", "me", "of", "on", "show",
    "tell", "that", "the", "this", "to", "was", "what", "when", "where",
    "which", "who", "with", "you"
  ]);
  const expansions = {
    bot: ["robot", "robotics"],
    robots: ["robot", "robotics", "hardware", "simulation"],
    robotics: ["robot", "hardware", "simulation", "servo", "mujoco"],
    data: ["sql", "analytics", "database", "vanna"],
    ai: ["llm", "transformer", "vanna", "agent"],
    lego: ["brick", "ldraw", "assembly", "booklet"],
    career: ["experience", "linkedin", "background"],
    work: ["project", "repository", "experience", "built"],
    built: ["project", "repository", "experiment"],
    contact: ["email", "linkedin"],
    tour: ["san francisco", "location", "audio", "ios"]
  };

  let documents = [];
  let knowledgePromise;
  let initialized = false;
  let lastFocused = null;

  function loadKnowledge() {
    if (!knowledgePromise) {
      knowledgePromise = fetch("/api/knowledge.json")
        .then((response) => {
          if (!response.ok) throw new Error(`Knowledge file returned ${response.status}`);
          return response.json();
        })
        .then((payload) => {
          documents = Array.isArray(payload.documents) ? payload.documents : [];
          return payload;
        });
    }

    return knowledgePromise;
  }

  function normalize(value) {
    return value
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9\s-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function queryTerms(query) {
    const original = normalize(query).split(" ").filter(Boolean);
    const useful = original.filter((term) => term.length > 2 && !stopWords.has(term));
    const expanded = useful.flatMap((term) => [term, ...(expansions[term] || [])]);
    return [...new Set(expanded.map(normalize).filter(Boolean))];
  }

  function occurrences(haystack, needle) {
    if (!needle) return 0;
    let count = 0;
    let position = 0;
    while ((position = haystack.indexOf(needle, position)) !== -1 && count < 4) {
      count += 1;
      position += needle.length;
    }
    return count;
  }

  function rankDocuments(query) {
    const phrase = normalize(query);
    const terms = queryTerms(query);

    if (!terms.length) return [];

    return documents
      .map((document) => {
        const title = normalize(document.title || "");
        const tags = normalize((document.tags || []).join(" "));
        const content = normalize(document.content || "");
        let score = phrase.length > 4 && title.includes(phrase) ? 18 : 0;

        for (const term of terms) {
          if (title.includes(term)) score += 8;
          if (tags.includes(term)) score += 5;
          score += occurrences(content, term) * 1.5;
        }

        if (document.source === "linkedin" && terms.includes("linkedin")) score += 12;
        if (document.source === "github" && terms.includes("repository")) score += 3;
        return { document, score };
      })
      .filter(({ score }) => score >= 4)
      .sort((a, b) => b.score - a.score)
      .slice(0, 4);
  }

  function excerpt(document, query) {
    const content = (document.content || "").replace(/\s+/g, " ").trim();
    const terms = queryTerms(query);
    const lower = content.toLowerCase();
    const positions = terms
      .map((term) => lower.indexOf(term))
      .filter((position) => position >= 0);
    const firstMatch = positions.length ? Math.min(...positions) : 0;
    const start = Math.max(0, firstMatch - 70);
    const end = Math.min(content.length, start + 290);
    let snippet = content.slice(start, end).trim();

    if (start > 0) snippet = `…${snippet}`;
    if (end < content.length) snippet = `${snippet}…`;
    return snippet;
  }

  function sourceLabel(source) {
    return { github: "GitHub", linkedin: "LinkedIn", website: "Website" }[source] || source;
  }

  function addMessage(role, text, matches = [], query = "") {
    const message = document.createElement("div");
    message.className = `chat-message chat-message--${role}`;
    message.textContent = text;

    if (role === "assistant") {
      for (const { document: sourceDocument } of matches) {
        const result = document.createElement("a");
        const title = document.createElement("strong");
        const snippet = document.createElement("span");
        const source = document.createElement("small");

        result.className = "chat-result";
        result.href = sourceDocument.url;
        result.target = "_blank";
        result.rel = "noreferrer";
        title.textContent = `${sourceDocument.title} ↗`;
        snippet.textContent = excerpt(sourceDocument, query);
        source.textContent = sourceLabel(sourceDocument.source);
        result.append(title, snippet, source);
        message.append(result);
      }
    }

    log.append(message);
    log.scrollTop = log.scrollHeight;
  }

  async function answer(question) {
    try {
      const payload = await loadKnowledge();
      const matches = rankDocuments(question);
      if (!matches.length) {
        addMessage(
          "assistant",
          "I couldn’t find a strong match in the public-source document. Try a project name, technology, company, article, or topic such as robotics, Vanna, LEGO, SQL, or audio tours."
        );
        return;
      }

      addMessage(
        "assistant",
        `I found ${matches.length} relevant source${matches.length === 1 ? "" : "s"} in the collated document (${payload.documents.length} total):`,
        matches,
        question
      );
    } catch {
      addMessage(
        "assistant",
        "The public-source document isn’t available right now. You can inspect the GitHub and LinkedIn links directly, or use the agent API page."
      );
    }
  }

  function submitQuestion(question) {
    const clean = question.trim();
    if (!clean) return;
    addMessage("user", clean);
    input.value = "";
    answer(clean);
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
    panel.hidden = false;
    backdrop.hidden = false;
    document.body.classList.add("chat-open");

    if (!initialized) {
      addMessage(
        "assistant",
        "I search one collated snapshot of this website, Aditya’s public GitHub repositories and README files, and facts visible on his public LinkedIn profile. Answers are source excerpts, not model-generated claims."
      );
      renderSuggestions();
      loadKnowledge().catch(() => {});
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

(() => {
  "use strict";

  const clock = document.getElementById("clock");
  const year = document.getElementById("year");

  function updateClock() {
    if (!clock) return;

    clock.textContent = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      hour: "numeric",
      minute: "2-digit",
      hour12: true
    })
      .format(new Date())
      .replace(" ", "")
      .toLowerCase();
  }

  if (year) year.textContent = String(new Date().getFullYear());
  updateClock();
  window.setInterval(updateClock, 30000);

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    document.querySelectorAll("video[autoplay]").forEach((video) => video.pause());
    const animatedTour = document.querySelector('.motion-card--sf img[src$=".gif"]');
    if (animatedTour) animatedTour.src = "/assets/media/sf-49-mile-tour-poster.jpg";
  }

  document.querySelectorAll("[data-copy]").forEach((button) => {
    button.addEventListener("click", async () => {
      const target = document.querySelector(button.dataset.copy);
      if (!target) return;

      try {
        await navigator.clipboard.writeText(target.textContent.trim());
        const previous = button.textContent;
        button.textContent = "Copied";
        window.setTimeout(() => {
          button.textContent = previous;
        }, 1600);
      } catch {
        button.textContent = "Select text";
      }
    });
  });

  const panel = document.querySelector(".chat-panel");
  if (!panel) return;

  const backdrop = document.querySelector(".chat-backdrop");
  const log = document.getElementById("chat-log");
  const form = document.getElementById("chat-form");
  const input = document.getElementById("chat-input");
  const suggestions = document.getElementById("chat-suggestions");
  const openers = document.querySelectorAll("[data-open-chat]");
  const closers = document.querySelectorAll("[data-close-chat]");
  const closeButton = panel.querySelector(".chat-close");

  const starterQuestions = [
    "What are you building?",
    "Show me robotics",
    "How can agents browse?",
    "How do I reach you?"
  ];

  const fallbackProjects = [
    {
      name: "Self-Rising Robot",
      slug: "self-rising-robot",
      summary: "A physical two-servo robot that learns to right itself.",
      topics: ["robotics", "hardware", "simulation"],
      stack: ["MuJoCo", "M5Atom Matrix", "Python"],
      links: { repository: "https://github.com/adityasudhakar/self-rising-robot" }
    },
    {
      name: "AI LEGO",
      slug: "ai-lego",
      summary: "Code-designed LEGO models with validation, instructions, and assembly films.",
      topics: ["lego", "CAD", "3D graphics", "generative design"],
      stack: ["Python", "Three.js", "LDraw"],
      links: { repository: "https://github.com/adityasudhakar/ai-lego" }
    },
    {
      name: "San Francisco 49-Mile GPS Audio Tour",
      slug: "sf-49-mile-tour",
      summary: "An offline, location-aware iOS driving companion for 33 San Francisco landmarks.",
      topics: ["iOS", "location", "audio", "mobile"],
      stack: ["React Native", "Swift", "Core Location"],
      links: { repository: "https://github.com/adityasudhakar/SF-49-Mile-Tour-App" }
    }
  ];

  let projects = fallbackProjects;
  let lastFocused = null;
  let initialized = false;

  fetch("/api/projects.json")
    .then((response) => {
      if (!response.ok) throw new Error("Project catalog unavailable");
      return response.json();
    })
    .then((payload) => {
      if (Array.isArray(payload.projects)) projects = payload.projects;
    })
    .catch(() => {});

  function addMessage(role, text, matches = []) {
    const message = document.createElement("div");
    message.className = `chat-message chat-message--${role}`;
    message.textContent = text;

    if (role === "assistant") {
      matches.slice(0, 3).forEach((project) => {
        const link = document.createElement("a");
        const label = document.createElement("strong");
        const summary = document.createElement("span");
        const destination =
          project.links.repository || project.links.website || Object.values(project.links)[0];

        link.className = "chat-result";
        link.href = destination;
        link.target = "_blank";
        link.rel = "noreferrer";
        label.textContent = `${project.name} ↗`;
        summary.textContent = project.summary;
        link.append(label, summary);
        message.append(link);
      });
    }

    log.append(message);
    log.scrollTop = log.scrollHeight;
  }

  function renderSuggestions() {
    suggestions.replaceChildren();
    starterQuestions.forEach((question) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = question;
      button.addEventListener("click", () => submitQuestion(question));
      suggestions.append(button);
    });
  }

  function normalize(value) {
    return value
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9\s-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function matchesAny(query, terms) {
    return terms.some((term) => query.includes(term));
  }

  function scoreProjects(query) {
    const tokens = normalize(query)
      .split(" ")
      .filter((token) => token.length > 2 && !["what", "about", "show", "tell", "with", "your", "have", "does", "that"].includes(token));

    const scored = projects
      .map((project) => {
        const title = normalize(`${project.name} ${project.slug}`);
        const topics = normalize((project.topics || []).join(" "));
        const stack = normalize((project.stack || []).join(" "));
        const body = normalize(`${project.summary} ${(project.details || []).join(" ")}`);
        let score = 0;

        tokens.forEach((token) => {
          if (title.includes(token)) score += 6;
          if (topics.includes(token)) score += 4;
          if (stack.includes(token)) score += 3;
          if (body.includes(token)) score += 1;
        });

        return { project, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score);

    const strongestScore = scored[0]?.score || 0;
    return scored
      .filter((entry) => entry.score >= Math.max(4, strongestScore * 0.35))
      .map((entry) => entry.project);
  }

  function answerQuestion(question) {
    const query = normalize(question);

    if (matchesAny(query, ["contact", "reach", "email", "talk", "hire", "connect"])) {
      return {
        text: "The direct route is email: adi@🌈.kz. LinkedIn works too. For project-specific context, send the repository or idea you want to discuss.",
        matches: []
      };
    }

    if (matchesAny(query, ["agent", "api", "cli", "json", "openapi", "machine", "llms txt"])) {
      return {
        text: "Agents can read Aditya’s complete profile, career, resume, and selected projects in one Markdown file at adityasudhakar.com/career.md. The agent guide also documents optional JSON and CLI interfaces: adityasudhakar.com/agent/",
        matches: []
      };
    }

    if (matchesAny(query, ["who", "background", "bio", "where", "experience", "diesel", "india", "california"])) {
      return {
        text: "Aditya is an engineer and product builder from Bangalore, now in Mountain View. His path runs from physical systems and diesel injectors to open-source data/AI software, robotics, and small experimental products.",
        matches: []
      };
    }

    const ranked = scoreProjects(query);
    if (ranked.length) {
      return {
        text: ranked.length === 1 ? "This is the closest match in the project catalog:" : "These are the strongest matches in the project catalog:",
        matches: ranked
      };
    }

    if (matchesAny(query, ["build", "building", "project", "work", "recent", "current"])) {
      return {
        text: "The recent work crosses physical robotics, generative LEGO design, and location-aware audio software. Start with one of these:",
        matches: projects.slice(0, 3)
      };
    }

    return {
      text: "I don’t have a reliable answer for that in the public project notes yet. Try asking about robotics, AI LEGO, data systems, the SF audio tour, Aditya’s background, or the agent API.",
      matches: []
    };
  }

  function submitQuestion(question) {
    const cleanQuestion = question.trim();
    if (!cleanQuestion) return;

    addMessage("user", cleanQuestion);
    input.value = "";

    window.setTimeout(() => {
      const answer = answerQuestion(cleanQuestion);
      addMessage("assistant", answer.text, answer.matches);
    }, 220);
  }

  function openChat() {
    lastFocused = document.activeElement;
    panel.hidden = false;
    backdrop.hidden = false;
    document.body.classList.add("chat-open");

    if (!initialized) {
      addMessage(
        "assistant",
        "Hi — I’m a small guide to Aditya’s public work. Ask about a project, his background, or how to inspect the site as an agent."
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

  openers.forEach((opener) => opener.addEventListener("click", openChat));
  closers.forEach((closer) => closer.addEventListener("click", closeChat));

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submitQuestion(input.value);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !panel.hidden) closeChat();
    if (event.key !== "Tab" || panel.hidden) return;

    const focusable = Array.from(
      panel.querySelectorAll('button:not([disabled]), input:not([disabled]), a[href]')
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  closeButton.addEventListener("keydown", (event) => {
    if (event.key === "Enter") closeChat();
  });
})();

#!/usr/bin/env node

const DEFAULT_BASE = "https://adityasudhakar.com";
const base = (process.env.ADITYA_API_BASE || DEFAULT_BASE).replace(/\/$/, "");
const argv = process.argv.slice(2);
const jsonMode = argv.includes("--json");
const args = argv.filter((argument) => argument !== "--json");
const command = args.shift() || "help";

async function get(path) {
  const response = await fetch(`${base}${path}`, {
    headers: { accept: "application/json", "user-agent": "aditya-portfolio-cli/1.0" }
  });

  if (!response.ok) {
    throw new Error(`GET ${path} returned ${response.status}`);
  }

  return response.json();
}

function output(value) {
  if (jsonMode || typeof value !== "string") {
    console.log(JSON.stringify(value, null, 2));
    return;
  }

  console.log(value);
}

function normalize(value) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function rank(projects, query) {
  const tokens = normalize(query)
    .split(" ")
    .filter((token) => token.length > 2);

  const scored = projects
    .map((project) => {
      const title = normalize(`${project.name} ${project.slug}`);
      const topics = normalize((project.topics || []).join(" "));
      const stack = normalize((project.stack || []).join(" "));
      const body = normalize(`${project.summary} ${(project.details || []).join(" ")}`);
      let score = 0;

      for (const token of tokens) {
        if (title.includes(token)) score += 6;
        if (topics.includes(token)) score += 4;
        if (stack.includes(token)) score += 3;
        if (body.includes(token)) score += 1;
      }

      return { project, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);

  const strongestScore = scored[0]?.score || 0;
  return scored.filter(({ score }) => score >= Math.max(4, strongestScore * 0.35));
}

function compactProject(project) {
  return {
    slug: project.slug,
    name: project.name,
    summary: project.summary,
    topics: project.topics,
    url: project.links.repository || project.links.website || Object.values(project.links)[0]
  };
}

function rankKnowledge(documents, query) {
  const tokens = normalize(query)
    .split(" ")
    .filter((token) => token.length > 2);

  return documents
    .map((document) => {
      const title = normalize(document.title || "");
      const tags = normalize((document.tags || []).join(" "));
      const content = normalize(document.content || "");
      let score = 0;

      for (const token of tokens) {
        if (title.includes(token)) score += 8;
        if (tags.includes(token)) score += 5;
        if (content.includes(token)) score += 2;
      }

      return { document, score };
    })
    .filter(({ score }) => score >= 4)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

function excerpt(content, length = 320) {
  const clean = content.replace(/\s+/g, " ").trim();
  return clean.length > length ? `${clean.slice(0, length).trim()}…` : clean;
}

function help() {
  return `aditya — inspect Aditya Sudhakar's public work

Usage:
  node aditya.mjs profile [--json]
  node aditya.mjs projects [topic] [--json]
  node aditya.mjs project <slug> [--json]
  node aditya.mjs ask <query> [--json]
  node aditya.mjs endpoints [--json]

Environment:
  ADITYA_API_BASE   Override ${DEFAULT_BASE} for local testing`;
}

async function main() {
  if (["help", "--help", "-h"].includes(command)) {
    output(help());
    return;
  }

  if (command === "profile") {
    const profile = await get("/api/profile.json");
    output(
      jsonMode
        ? profile
        : `${profile.name}\n${profile.summary}\n${profile.location.current}\n${profile.links.website}`
    );
    return;
  }

  if (command === "endpoints") {
    output({
      profile: `${base}/api/profile.json`,
      projects: `${base}/api/projects.json`,
      career: `${base}/career.md`,
      knowledge: `${base}/api/knowledge.json`,
      openapi: `${base}/api/openapi.json`,
      llms_txt: `${base}/llms.txt`
    });
    return;
  }

  if (command === "ask") {
    const query = args.join(" ");
    if (!query) throw new Error("The ask command needs a query.");
    const knowledge = await get("/api/knowledge.json");
    const matches = rankKnowledge(knowledge.documents || [], query);
    const result = {
      query,
      knowledge_generated_at: knowledge.generated_at,
      matches: matches.map(({ document, score }) => ({
        title: document.title,
        source: document.source,
        url: document.url,
        excerpt: excerpt(document.content),
        score
      }))
    };
    output(
      jsonMode
        ? result
        : result.matches
            .map((match) => `${match.title} · ${match.source} [score ${match.score}]\n${match.excerpt}\n${match.url}`)
            .join("\n\n") || "No public source matched that query."
    );
    return;
  }

  const payload = await get("/api/projects.json");
  const projects = payload.projects;

  if (command === "projects") {
    const query = args.join(" ");
    const selected = query ? rank(projects, query).map(({ project }) => project) : projects;
    output(
      jsonMode
        ? selected
        : selected
            .map((project) => `${project.slug}\n  ${project.summary}`)
            .join("\n\n") || "No matching projects."
    );
    return;
  }

  if (command === "project") {
    const slug = args[0];
    const project = projects.find((entry) => entry.slug === slug);
    if (!project) throw new Error(`Unknown project: ${slug || "<missing slug>"}`);
    output(
      jsonMode
        ? project
        : `${project.name}\n${project.summary}\nTopics: ${project.topics.join(", ")}\n${project.links.repository || project.links.website}`
    );
    return;
  }

  throw new Error(`Unknown command: ${command}\n\n${help()}`);
}

main().catch((error) => {
  console.error(`aditya: ${error.message}`);
  process.exitCode = 1;
});

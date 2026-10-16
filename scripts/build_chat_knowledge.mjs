#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const owner = "adityasudhakar";
const outputPath = path.join(root, "api", "knowledge.json");

function githubToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;

  try {
    return execFileSync("gh", ["auth", "token"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return "";
  }
}

const token = githubToken();
const githubHeaders = {
  accept: "application/vnd.github+json",
  "user-agent": "adityasudhakar-knowledge-builder/1.0",
  "x-github-api-version": "2022-11-28",
  ...(token ? { authorization: `Bearer ${token}` } : {})
};

async function githubJson(url) {
  const response = await fetch(url, { headers: githubHeaders });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

async function githubText(url) {
  const response = await fetch(url, {
    headers: { ...githubHeaders, accept: "application/vnd.github.raw+json" },
    signal: AbortSignal.timeout(15000)
  });
  if (response.status === 404) return "";
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.text();
}

function cleanText(value) {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<!--([\s\S]*?)-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function cleanMarkdown(value) {
  return cleanText(
    value
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/^[-|: ]{3,}$/gm, " ")
      .replace(/^#+\s*/gm, "")
      .replace(/[>*_`~]/g, " ")
  );
}

async function collectHtmlFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectHtmlFiles(fullPath)));
    if (entry.isFile() && entry.name === "index.html") files.push(fullPath);
  }

  return files;
}

function canonicalUrl(filePath) {
  const relative = path.relative(root, filePath).replaceAll(path.sep, "/");
  if (relative === "index.html") return "https://adityasudhakar.com/";
  return `https://adityasudhakar.com/${relative.replace(/index\.html$/, "")}`;
}

async function websiteDocuments() {
  const files = [
    path.join(root, "index.html"),
    path.join(root, "github", "index.html"),
    ...(await collectHtmlFiles(path.join(root, "the-sly-llama")))
  ];

  return Promise.all(
    files.map(async (filePath) => {
      const html = await readFile(filePath, "utf8");
      const title = cleanText(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || path.basename(path.dirname(filePath)));
      return {
        id: `website:${path.relative(root, filePath).replaceAll(path.sep, "/")}`,
        source: "website",
        title,
        url: canonicalUrl(filePath),
        tags: ["website", "aditya sudhakar", "personal site"],
        content: cleanText(html).slice(0, 10000)
      };
    })
  );
}

async function allRepositories() {
  const repositories = [];

  for (let page = 1; ; page += 1) {
    const batch = await githubJson(
      `https://api.github.com/users/${owner}/repos?type=owner&sort=updated&per_page=100&page=${page}`
    );
    repositories.push(...batch);
    if (batch.length < 100) break;
  }

  return repositories;
}

async function mapConcurrent(values, concurrency, mapper) {
  const output = new Array(values.length);
  let cursor = 0;

  async function worker() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await mapper(values[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return output;
}

async function githubDocuments() {
  const repositories = await allRepositories();

  return mapConcurrent(repositories, 6, async (repository) => {
    let readme = "";
    try {
      readme = await githubText(`https://api.github.com/repos/${repository.full_name}/readme`);
    } catch (error) {
      process.stderr.write(`README skipped for ${repository.full_name}: ${error.message}\n`);
    }

    const metadata = [
      repository.description,
      repository.language ? `Primary language: ${repository.language}.` : "",
      repository.topics?.length ? `Topics: ${repository.topics.join(", ")}.` : "",
      repository.fork ? "This repository is a fork." : "This is an original repository on Aditya's account.",
      `Last pushed: ${repository.pushed_at?.slice(0, 10) || "unknown"}.`
    ]
      .filter(Boolean)
      .join(" ");

    return {
      id: `github:${repository.name}`,
      source: "github",
      title: repository.name,
      url: repository.html_url,
      tags: [
        "github",
        "repository",
        repository.language || "",
        ...(repository.topics || [])
      ].filter(Boolean),
      content: `${metadata} ${cleanMarkdown(readme).slice(0, 6500)}`.trim(),
      metadata: {
        fork: repository.fork,
        archived: repository.archived,
        language: repository.language,
        stars: repository.stargazers_count,
        updated_at: repository.updated_at
      }
    };
  });
}

async function careerDocument() {
  const markdown = await readFile(path.join(root, "career.md"), "utf8");
  return {
    id: "career:owner-profile",
    source: "career",
    title: "Aditya Sudhakar — career and LinkedIn background",
    url: "https://adityasudhakar.com/career.md",
    tags: ["career", "linkedin", "resume", "experience", "product management", "founder", "co-founder"],
    content: cleanMarkdown(markdown),
    metadata: {
      provenance: "Owner-maintained career.md",
      provided_at: "2026-10-16"
    }
  };
}

const [siteDocuments, repositoryDocuments, career] = await Promise.all([
  websiteDocuments(),
  githubDocuments(),
  careerDocument()
]);

const knowledge = {
  schema_version: "1.0",
  generated_at: new Date().toISOString(),
  description: "Collated first-party website, GitHub, and owner-maintained career knowledge from adityasudhakar.com.",
  sources: {
    website: "Pages published on https://adityasudhakar.com",
    github: `Public repository metadata and README excerpts from https://github.com/${owner}`,
    career: "Owner-maintained LinkedIn and resume material from https://adityasudhakar.com/career.md"
  },
  documents: [...siteDocuments, career, ...repositoryDocuments]
};

await writeFile(outputPath, `${JSON.stringify(knowledge, null, 2)}\n`);
process.stdout.write(
  `Wrote ${knowledge.documents.length} documents (${repositoryDocuments.length} repositories) to ${outputPath}\n`
);

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

const linkedinUrl = "https://www.linkedin.com/in/adityasudhakar/";
const linkedinMetadata = {
  provenance: "Provided by Aditya from his LinkedIn profile",
  provided_at: "2026-10-16"
};
const linkedinDocuments = [
  {
    id: "linkedin:profile-overview",
    source: "linkedin",
    title: "Aditya Sudhakar — LinkedIn career overview",
    url: linkedinUrl,
    tags: ["linkedin", "background", "career", "experience", "product management", "founder", "co-founder"],
    content: [
      "Aditya Sudhakar is based in Mountain View, California, United States.",
      "He is Co-Founder of Vanna AI and previously worked at Aisera, huddl.ai, Signifyd, SenseiHub, Moody's Analytics, Accenture, and Bosch.",
      "His career spans entrepreneurship, product management, conversational analytics, enterprise AI and RAG, WebRTC meetings, fraud prevention, financial analytics, consulting, and automotive manufacturing.",
      "His public profile also identifies the University of Michigan.",
      "The public About section lists technologies spanning steel forging and machining, word2vec and gensim, WebRTC, and transformer models.",
      "Public article titles include Unnatural language processing, The nuts and bots, Aaand we're back, and Expert-ease.",
      "The profile lists English at native or bilingual proficiency, and Hindi and Kannada at professional working proficiency."
    ].join(" "),
    metadata: linkedinMetadata
  },
  {
    id: "linkedin:vanna-ai",
    source: "linkedin",
    title: "Co-Founder — Vanna AI",
    url: linkedinUrl,
    tags: ["linkedin", "Vanna AI", "co-founder", "founder", "conversational analytics", "open source", "enterprise AI", "on-prem"],
    content: [
      "Aditya has been a full-time Co-Founder of Vanna AI since June 2024 in Mountain View, California.",
      "His LinkedIn description calls Vanna a leading conversational analytics solution and reports 20,000 GitHub stars, 1,000 daily downloads, and hundreds of thousands of users.",
      "Vanna is designed to answer questions that normally require heavy analytical work, such as what a user experienced in an app or why a customer is requesting a discount.",
      "It can be deployed locally so data never leaves the customer's premises, and its open-source version costs nothing to use.",
      "Paid enterprise capabilities include access controls, governance, authentication, white-labeling, multi-user mode, service, and support.",
      "Customers can self-deploy through vanna.ai or arrange a fully featured, fully supported, fully on-premises paid pilot lasting from two weeks to three months."
    ].join(" "),
    metadata: { ...linkedinMetadata, start_date: "2024-06", end_date: null, displayed_duration: "2 yrs 5 mos", employment_type: "Full-time", location: "Mountain View, California, United States" }
  },
  {
    id: "linkedin:aisera",
    source: "linkedin",
    title: "Product Manager — Aisera",
    url: linkedinUrl,
    tags: ["linkedin", "Aisera", "product manager", "LLM", "RAG", "enterprise AI", "Automation Anywhere"],
    content: [
      "Aditya was a full-time Product Manager at Aisera from September 2022 through March 2024 in Palo Alto, California, working on-site.",
      "Aisera was acquired by Automation Anywhere and was backed by Goldman Sachs, Thoma Bravo, Norwest, and others.",
      "The company sold to CIOs at organizations including Amgen, Gap, RingCentral, and Workday.",
      "Aditya worked with a former Splunk team building an LLM- and RAG-based bot that answered questions and automated actions."
    ].join(" "),
    metadata: { ...linkedinMetadata, start_date: "2022-09", end_date: "2024-03", displayed_duration: "1 yr 7 mos", employment_type: "Full-time", location: "Palo Alto, California, United States" }
  },
  {
    id: "linkedin:huddl-ai",
    source: "linkedin",
    title: "Product Manager — huddl.ai",
    url: linkedinUrl,
    tags: ["linkedin", "huddl.ai", "product manager", "WebRTC", "meetings", "audio video"],
    content: [
      "Aditya was a Product Manager at huddl.ai from June 2019 through June 2022 in the San Francisco Bay Area.",
      "The company was backed by Bain, Bloomberg, Propel, and others, and sold to CIOs at organizations including Cisco, Nutanix, Persistent, and Ooma.",
      "Aditya worked with a team whose background included Cisco and Imagination to build a WebRTC-based audio/video meetings application."
    ].join(" "),
    metadata: { ...linkedinMetadata, start_date: "2019-06", end_date: "2022-06", displayed_duration: "3 yrs 1 mo", location: "San Francisco Bay Area" }
  },
  {
    id: "linkedin:signifyd",
    source: "linkedin",
    title: "Product Manager — Signifyd",
    url: linkedinUrl,
    tags: ["linkedin", "Signifyd", "product manager", "fraud prevention", "ecommerce", "Shopify", "BigCommerce", "Magento"],
    content: [
      "Aditya was a Product Manager at Signifyd from February 2018 through May 2019 in the San Francisco Bay Area.",
      "Signifyd was backed by Andreessen Horowitz, Menlo Ventures, and others, and sold to digital leaders at organizations including Philips, Wish, and Samsung.",
      "Aditya worked with a team whose background included PayPal and FedEx to build a credit-card-fraud-prevention product for Shopify, BigCommerce, Magento, and custom API-based stores."
    ].join(" "),
    metadata: { ...linkedinMetadata, start_date: "2018-02", end_date: "2019-05", displayed_duration: "1 yr 4 mos", location: "San Francisco Bay Area" }
  },
  {
    id: "linkedin:senseihub",
    source: "linkedin",
    title: "Founder and CEO — SenseiHub",
    url: linkedinUrl,
    tags: ["linkedin", "SenseiHub", "founder", "CEO", "entrepreneurship"],
    content: "Aditya was Founder and CEO of SenseiHub from March 2015 through February 2018 in the San Francisco Bay Area.",
    metadata: { ...linkedinMetadata, start_date: "2015-03", end_date: "2018-02", displayed_duration: "3 yrs", location: "San Francisco Bay Area" }
  },
  {
    id: "linkedin:moodys-analytics",
    source: "linkedin",
    title: "Product Manager — Moody's Analytics",
    url: linkedinUrl,
    tags: ["linkedin", "Moody's Analytics", "product manager", "financial analytics"],
    content: "Aditya was a Product Manager at Moody's Analytics from 2012 through 2014 in the New York City metropolitan area.",
    metadata: { ...linkedinMetadata, start_date: "2012", end_date: "2014", location: "New York City Metropolitan Area" }
  },
  {
    id: "linkedin:accenture",
    source: "linkedin",
    title: "Consultant — Accenture",
    url: linkedinUrl,
    tags: ["linkedin", "Accenture", "consultant", "consulting"],
    content: "Aditya was a Consultant at Accenture from 2008 through 2009 in Greater Boston.",
    metadata: { ...linkedinMetadata, start_date: "2008", end_date: "2009", location: "Greater Boston" }
  },
  {
    id: "linkedin:bosch",
    source: "linkedin",
    title: "Product Manager — Bosch",
    url: linkedinUrl,
    tags: ["linkedin", "Bosch", "product manager", "automotive", "manufacturing", "diesel injectors"],
    content: "Aditya was a full-time Product Manager at Bosch from 2005 through 2008 in the Charleston, South Carolina metropolitan area.",
    metadata: { ...linkedinMetadata, start_date: "2005", end_date: "2008", employment_type: "Full-time", location: "Charleston, South Carolina Metropolitan Area" }
  }
];

const [siteDocuments, repositoryDocuments] = await Promise.all([
  websiteDocuments(),
  githubDocuments()
]);

const knowledge = {
  schema_version: "1.0",
  generated_at: new Date().toISOString(),
  description: "Collated first-party knowledge used by the chatbot on adityasudhakar.com.",
  sources: {
    website: "Pages published on https://adityasudhakar.com",
    github: `Public repository metadata and README excerpts from https://github.com/${owner}`,
    linkedin: "Career history provided by Aditya from his LinkedIn profile."
  },
  documents: [...siteDocuments, ...linkedinDocuments, ...repositoryDocuments]
};

await writeFile(outputPath, `${JSON.stringify(knowledge, null, 2)}\n`);
process.stdout.write(
  `Wrote ${knowledge.documents.length} documents (${repositoryDocuments.length} repositories) to ${outputPath}\n`
);

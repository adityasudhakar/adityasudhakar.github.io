import { createServer } from "node:http";

const PORT = Number(process.env.PORT || 8787);
const MODEL = process.env.OPENAI_MODEL || "gpt-5.5";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const KNOWLEDGE_URL = "https://adityasudhakar.com/api/knowledge.json";
const allowedOrigins = new Set([
  "https://adityasudhakar.com",
  "https://www.adityasudhakar.com",
  "http://localhost:8000",
  "http://127.0.0.1:8000"
]);
const requestsByAddress = new Map();
let knowledgeCache = { documents: [], loadedAt: 0 };

const stopWords = new Set([
  "about", "aditya", "and", "are", "can", "did", "does", "for", "from", "has", "have",
  "his", "how", "into", "is", "me", "of", "on", "show", "tell", "that", "the", "this",
  "to", "was", "what", "when", "where", "which", "who", "with", "you"
]);
const expansions = {
  ai: ["llm", "agent", "vanna", "transformer"],
  background: ["career", "experience", "linkedin"],
  bot: ["robot", "robotics"],
  built: ["project", "repository", "experiment"],
  career: ["background", "experience", "linkedin"],
  data: ["sql", "analytics", "database", "vanna"],
  lego: ["brick", "ldraw", "assembly", "booklet"],
  robotics: ["robot", "hardware", "simulation", "servo", "mujoco"],
  robots: ["robot", "robotics", "hardware", "simulation"],
  work: ["project", "repository", "experience", "built"]
};

const instructions = `You are the public website assistant for Aditya Sudhakar.
Answer questions about Aditya's projects, work, career, writing, and public background.
You must search the web before every answer. Prefer first-party information from:
- https://adityasudhakar.com
- https://github.com/adityasudhakar
- https://www.linkedin.com/in/adityasudhakar/
Do not infer private facts or make up details. If the public sources do not answer the question, say that plainly.
Keep answers conversational and concise. Use plain text without Markdown styling. Cite factual claims using the web search citations.`;

function corsHeaders(origin) {
  const headers = {
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff"
  };
  if (origin && allowedOrigins.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function send(response, status, body, origin = "") {
  response.writeHead(status, corsHeaders(origin));
  response.end(JSON.stringify(body));
}

function clientAddress(request) {
  return (request.headers["x-forwarded-for"] || request.socket.remoteAddress || "unknown")
    .toString()
    .split(",")[0]
    .trim();
}

function withinRateLimit(request) {
  const address = clientAddress(request);
  const now = Date.now();
  const recent = (requestsByAddress.get(address) || []).filter((time) => now - time < 60_000);
  if (recent.length >= 12) return false;
  recent.push(now);
  requestsByAddress.set(address, recent);
  return true;
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 8_192) throw new Error("Request is too large.");
  }
  return JSON.parse(body || "{}");
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function queryTerms(query) {
  const useful = normalize(query)
    .split(" ")
    .filter((term) => term.length > 2 && !stopWords.has(term));
  return [...new Set(useful.flatMap((term) => [term, ...(expansions[term] || [])]))];
}

async function knowledgeDocuments() {
  if (knowledgeCache.documents.length && Date.now() - knowledgeCache.loadedAt < 10 * 60_000) {
    return knowledgeCache.documents;
  }

  const response = await fetch(KNOWLEDGE_URL, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Knowledge source returned ${response.status}.`);
  const payload = await response.json();
  knowledgeCache = {
    documents: Array.isArray(payload.documents) ? payload.documents : [],
    loadedAt: Date.now()
  };
  return knowledgeCache.documents;
}

function rankKnowledge(query, documents) {
  const terms = queryTerms(query);
  const ranked = documents
    .map((document) => {
      const title = normalize(document.title);
      const tags = normalize((document.tags || []).join(" "));
      const content = normalize(document.content);
      let score = 0;

      for (const term of terms) {
        if (title.includes(term)) score += 10;
        if (tags.includes(term)) score += 6;
        if (content.includes(term)) score += 2;
      }
      if (document.source === "linkedin" && terms.some((term) => ["career", "experience", "background", "linkedin"].includes(term))) score += 14;
      return { document, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 7)
    .map(({ document }) => document);

  for (const profile of documents.filter((document) => document.source === "linkedin" || document.url === "https://adityasudhakar.com/")) {
    if (!ranked.some((document) => document.url === profile.url)) ranked.push(profile);
  }

  return ranked.slice(0, 8);
}

function sourceContext(documents) {
  return documents
    .map((document, index) => [
      `SOURCE ${index + 1}: ${document.title}`,
      `URL: ${document.url}`,
      String(document.content || "").replace(/\s+/g, " ").slice(0, 3_500)
    ].join("\n"))
    .join("\n\n");
}

function responseText(response) {
  return (response.output || [])
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content || [])
    .filter((content) => content.type === "output_text")
    .map((content) => content.text)
    .join("\n\n")
    .replace(/\(\[([^\]]+)\]\(https?:\/\/[^)]+\)\)/g, "")
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .trim();
}

function isAdityaSource(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.hostname === "adityasudhakar.com" || url.hostname === "www.adityasudhakar.com") return true;
    if (url.hostname === "github.com") return url.pathname.toLowerCase().startsWith("/adityasudhakar");
    if (url.hostname.endsWith("linkedin.com")) return url.pathname.replace(/\/$/, "").toLowerCase() === "/in/adityasudhakar";
  } catch {
    return false;
  }
  return false;
}

function responseCitations(response) {
  const citations = [];

  for (const item of response.output || []) {
    for (const content of item.content || []) {
      for (const annotation of content.annotations || []) {
        if (annotation.type === "url_citation" && annotation.url && isAdityaSource(annotation.url)) {
          citations.push({ url: annotation.url, title: annotation.title || "Source" });
        }
      }
    }
  }

  return [...new Map(citations.map((citation) => [citation.url, citation])).values()];
}

async function createAnswer(message, previousResponseId) {
  let matchedDocuments = [];
  try {
    matchedDocuments = rankKnowledge(message, await knowledgeDocuments());
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
  }

  const groundedInput = matchedDocuments.length
    ? `QUESTION:\n${message}\n\nRELEVANT FIRST-PARTY SOURCE EXCERPTS:\n${sourceContext(matchedDocuments)}`
    : message;
  const requestBody = {
    model: MODEL,
    instructions,
    input: groundedInput,
    tools: [
      {
        type: "web_search",
        filters: {
          allowed_domains: ["adityasudhakar.com", "github.com"]
        },
        search_context_size: "medium"
      }
    ],
    tool_choice: "required",
    include: ["web_search_call.action.sources"],
    reasoning: { effort: "low" },
    max_output_tokens: 1_400,
    store: true
  };

  if (previousResponseId) requestBody.previous_response_id = previousResponseId;

  const openAIResponse = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(requestBody)
  });
  const payload = await openAIResponse.json();

  if (!openAIResponse.ok) {
    const error = new Error(payload.error?.message || "OpenAI request failed.");
    error.status = openAIResponse.status;
    throw error;
  }

  const citations = [
    ...responseCitations(payload),
    ...matchedDocuments.slice(0, 4).map((document) => ({ url: document.url, title: document.title }))
  ];

  return {
    answer: responseText(payload) || "I couldn’t find enough public information to answer that.",
    citations: [...new Map(citations.map((citation) => [citation.url, citation])).values()],
    response_id: payload.id
  };
}

const server = createServer(async (request, response) => {
  const origin = request.headers.origin || "";
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

  if (request.method === "GET" && url.pathname === "/health") {
    return send(response, OPENAI_API_KEY ? 200 : 503, { ok: Boolean(OPENAI_API_KEY) }, origin);
  }

  if (request.method === "OPTIONS" && url.pathname === "/chat") {
    if (origin && !allowedOrigins.has(origin)) return send(response, 403, { error: "Origin not allowed." });
    response.writeHead(204, corsHeaders(origin));
    return response.end();
  }

  if (request.method !== "POST" || url.pathname !== "/chat") {
    return send(response, 404, { error: "Not found." }, origin);
  }

  if (origin && !allowedOrigins.has(origin)) return send(response, 403, { error: "Origin not allowed." });
  if (!OPENAI_API_KEY) return send(response, 503, { error: "The assistant is not configured." }, origin);
  if (!withinRateLimit(request)) return send(response, 429, { error: "Please wait a minute and try again." }, origin);

  try {
    const body = await readJson(request);
    const message = typeof body.message === "string" ? body.message.trim() : "";
    const previousResponseId = typeof body.previous_response_id === "string"
      ? body.previous_response_id.trim()
      : "";

    if (!message || message.length > 800) {
      return send(response, 400, { error: "Please enter a question under 800 characters." }, origin);
    }
    if (previousResponseId && !/^resp_[A-Za-z0-9_-]{8,}$/.test(previousResponseId)) {
      return send(response, 400, { error: "Invalid conversation reference." }, origin);
    }

    const answer = await createAnswer(message, previousResponseId);
    return send(response, 200, answer, origin);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    const status = error?.status === 429 ? 429 : 502;
    return send(
      response,
      status,
      { error: status === 429 ? "The assistant is busy. Please try again shortly." : "I couldn’t search right now. Please try again." },
      origin
    );
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Chat API listening on port ${PORT}`);
});

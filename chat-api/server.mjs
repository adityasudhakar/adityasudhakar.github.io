import { createServer } from "node:http";

const PORT = Number(process.env.PORT || 8787);
const MODEL = process.env.OPENAI_MODEL || "gpt-5.5";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const CAREER_URL = "https://adityasudhakar.com/career.md";
const allowedOrigins = new Set([
  "https://adityasudhakar.com",
  "https://www.adityasudhakar.com",
  "http://localhost:8000",
  "http://127.0.0.1:8000"
]);
const requestsByAddress = new Map();
let careerCache = { markdown: "", loadedAt: 0 };

const instructions = `You are the public website assistant for Aditya Sudhakar.
Answer questions about Aditya's projects, work, career, writing, and public background.
You receive Aditya's complete owner-maintained career and resume file with every question. Treat it as the authoritative source for employment history and other LinkedIn-derived facts.
Use web search for current or detailed information about Aditya's projects, writing, website, and GitHub repositories. Search only first-party information from:
- https://adityasudhakar.com
- https://github.com/adityasudhakar
Useful first-party starting points for project lookups are:
- https://adityasudhakar.com/api/projects.json
- https://adityasudhakar.com/api/knowledge.json
- https://github.com/adityasudhakar
For a project question, search the exact project name against these sources and follow the matching repository. If the first search returns only an unrelated project, search again before concluding that the information is unavailable.
Do not infer private facts or make up details. If the public sources do not answer the question, say that plainly.
Do not search LinkedIn. The supplied career file exists because LinkedIn is not reliably accessible to agents.
When the career file answers the question, use it directly. When the question concerns projects, repositories, the website, writing, or potentially changing facts, use web search.
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

async function careerMarkdown() {
  if (careerCache.markdown && Date.now() - careerCache.loadedAt < 10 * 60_000) {
    return careerCache.markdown;
  }

  const response = await fetch(CAREER_URL, { headers: { Accept: "text/markdown, text/plain" } });
  if (!response.ok) throw new Error(`Career source returned ${response.status}.`);
  const markdown = await response.text();
  if (!markdown.trim()) throw new Error("Career source was empty.");
  careerCache = { markdown, loadedAt: Date.now() };
  return markdown;
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
  let career = "";
  try {
    career = await careerMarkdown();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
  }

  const groundedInput = career
    ? `QUESTION:\n${message}\n\nAUTHORITATIVE CAREER AND RESUME CONTEXT (owner-maintained):\n${career}`
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
    tool_choice: "auto",
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

  const citations = responseCitations(payload);
  if (career && citations.length === 0) {
    citations.push({ url: CAREER_URL, title: "Career and LinkedIn background" });
  }

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

# Aditya site analytics API

Receives browser events from the personal site, stores them in Railway Postgres, and exposes the `ask_site_analytics` MCP tool.

## Recorded data

- `site_events`: page views, link clicks, text-chip clicks, other clicks, and chatbot opens.
- `chats`: one row per chat ID, linked to the browser session ID.
- `chat_turns`: one row per submitted question, with its answer, citations, latency, status, and chat ID.

The browser does not report hover, scroll, input, or keystroke activity. Link destinations are stored without query strings or fragments. Session IDs live in session storage and are not backed by IP address data. Chat questions and responses are stored as requested.

## Railway configuration

Run this service from the `analytics-api/` root. Configure `DATABASE_URL` as a Railway reference to the project's Postgres service. Configure `OPENAI_API_KEY` through a Railway reference to the existing chat service; `OPENAI_MODEL` is optional. The service runs the idempotent `schema.sql` migration at startup.

Set `PUBLIC_BASE_URL` to the generated HTTPS domain. The browser API URL is set in `assets/analytics-config.js` after the domain is assigned.

`POST /v1/events` and `POST /v1/turns` accept events from the website origin. `/mcp` contains the schema-aware read-only `ask_site_analytics` tool and is protected by OAuth authorization code with PKCE, owner-only email/password sign-in, and refresh tokens. The first ChatGPT connection displays a consent screen; its renewable token keeps the connection active afterward.

Configure `BETTER_AUTH_SECRET` and `MCP_OWNER_EMAIL` in Railway. To create the first password, temporarily set `MCP_OWNER_PASSWORD` to the password you choose, then deploy. The service hashes and stores it as the owner login before listening for requests. After the first deploy succeeds, remove `MCP_OWNER_PASSWORD` from Railway and redeploy; sign-up is disabled when the variable is absent. Do not send the password in chat.

The Better Auth CLI applies the auth schema before the service starts. The sign-in and consent pages are `/sign-in` and `/consent`.

## Query safety

The model receives only the analytics table schema and can propose a single SELECT over the three analytics tables. Schema-qualified relations and non-allowlisted functions are rejected; queries also run in a read-only transaction with a four-second timeout and a 100-row cap. The generated SQL and result rows are returned to the MCP client, which can summarize them in natural language.

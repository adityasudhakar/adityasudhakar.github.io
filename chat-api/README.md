# Aditya site chat API

Small server-side proxy for the chatbot at `adityasudhakar.com/demo/`.

It calls the OpenAI Responses API, supplies the complete owner-maintained `career.md`, and lets the model use web search over Aditya's site and GitHub. Railway only protects the API key, fetches the Markdown, and forwards conversations; it does not rank or select knowledge entries. The API returns the answer plus source links. Conversation continuity uses `previous_response_id`; no API key is exposed to the browser.

## Environment

- `OPENAI_API_KEY` — required
- `OPENAI_MODEL` — optional; defaults to `gpt-5.5`
- `PORT` — supplied by the host; defaults to `8787`

## Run

```sh
npm start
```

`POST /chat` accepts:

```json
{
  "message": "What has Aditya built?",
  "previous_response_id": null
}
```

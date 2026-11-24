// Rough classification of who is visiting, so we can measure agent traffic.
const RULES: Array<[string, RegExp]> = [
  ["anthropic", /claudebot|claude-user|claude-searchbot|anthropic|claude-code|claude\//i],
  ["openai", /gptbot|chatgpt-user|oai-searchbot|openai/i],
  ["perplexity", /perplexity/i],
  ["google-ai", /google-cloudvertexbot|google-extended|gemini|googleother/i],
  ["googlebot", /googlebot/i],
  ["bing", /bingbot|bingpreview/i],
  ["meta", /meta-externalagent|meta-externalfetcher|facebookbot/i],
  ["mistral", /mistralai/i],
  ["cohere", /cohere/i],
  ["amazon", /amazonbot/i],
  ["apple", /applebot/i],
  ["bytedance", /bytespider/i],
  ["duckduckgo", /duckassistbot|duckduckbot/i],
  ["cursor", /cursor/i],
  ["mcp-client", /\bmcp\b|modelcontextprotocol/i],
  ["python", /python|httpx|aiohttp|requests\//i],
  ["node", /node|undici|axios|got\//i],
  ["curl", /curl|wget/i],
  ["go", /go-http-client/i],
  ["other-bot", /bot|crawler|spider|agent/i],
  ["browser", /mozilla/i],
];

export function classifyClient(ua: string | null): string {
  if (!ua) return "none";
  for (const [name, re] of RULES) if (re.test(ua)) return name;
  return "other";
}

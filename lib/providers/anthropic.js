export async function generateWithAnthropic({ model, maxTokens, prompt }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY environment variable is required for the Anthropic provider.\n" +
      "Set it: export ANTHROPIC_API_KEY=sk-ant-..."
    );
  }

  let Anthropic;
  try {
    ({ default: Anthropic } = await import("@anthropic-ai/sdk"));
  } catch {
    throw new Error(
      "@anthropic-ai/sdk is required for the Anthropic provider.\n" +
      "Install it: npm install @anthropic-ai/sdk"
    );
  }

  const client = new Anthropic();
  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    messages: [{ role: "user", content: prompt }],
  });

  return response.content
    .filter(block => block.type === "text")
    .map(block => block.text)
    .join("");
}

export type Severity = "low" | "medium" | "high" | "critical";
export type Category = "general" | "design" | "safety" | "spec" | "cost" | "schedule" | "other";

export type CommentSuggestion = {
  text: string;
  severity: Severity;
  category: Category;
};

const DEFAULT_MODEL = (import.meta.env.VITE_OPENAI_MODEL as string) || "gpt-5";

type ContentNode = { text?: string | { value?: string | undefined } | undefined; content?: string; value?: string };
type ResponsesLike = {
  output_text?: string;
  output?: Array<{ content?: Array<ContentNode> }>;
  outputs?: Array<{ content?: Array<ContentNode> }>;
  choices?: Array<{ message?: { content?: string | null } }>;
};

function extractOutputText(res: unknown): string | undefined {
  const r = res as ResponsesLike | undefined;
  if (!r) return undefined;
  if (typeof r.output_text === "string" && r.output_text.length > 0) return r.output_text;
  const out = (r.output || r.outputs) ?? [];
  for (const item of out) {
    const content = item?.content ?? [];
    for (const c of content) {
      const textNode = c?.text;
      if (typeof textNode === "string" && textNode.length > 0) return textNode;
      if (textNode && typeof textNode !== "string" && typeof textNode.value === "string" && textNode.value.length > 0) {
        return textNode.value as string;
      }
      const alt = c?.content ?? c?.value;
      if (typeof alt === "string" && alt.length > 0) return alt;
    }
  }
  const choiceContent = r.choices?.[0]?.message?.content ?? undefined;
  if (typeof choiceContent === "string" && choiceContent.length > 0) return choiceContent;
  return undefined;
}

export async function suggestComment(
  params: {
    pdfText: string;
    highlightText: string;
    pageNumber?: number;
    projectName?: string;
    model?: string;
    apiKey?: string;
    abortSignal?: AbortSignal;
  }
): Promise<CommentSuggestion | null> {
  const apiKey = params.apiKey || (import.meta.env.VITE_OPENAI_API_KEY as string | undefined);
  if (!apiKey) return null;

  const model = params.model || DEFAULT_MODEL;

  // Trim inputs to keep payload reasonable
  const pdfContext = (params.pdfText || "").slice(0, 160_000);
  const excerpt = (params.highlightText || "").slice(0, 4_000);

  const prompt = [
    "You are a professional AEC review assistant (architecture/engineering/construction).",
    "Write concise, professional comments (no emojis).",
    "Return STRICT JSON only with keys: text, severity, category.",
    "severity must be one of: low, medium, high, critical. category must be one of: general, design, safety, spec, cost, schedule, other.",
    "The comment should be concise and to the point, and should be no more than 100 words.",
    "",
    `Project: ${params.projectName || "Untitled"}`,
    `Page: ${params.pageNumber || "?"}`,
    "Highlighted excerpt:",
    excerpt,
    "",
    "Full PDF text (truncated):",
    pdfContext,
    "",
    'Respond with only JSON, e.g. {"text":"...","severity":"medium","category":"design"}.',
  ].join("\n");

  try {
    const { OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey, dangerouslyAllowBrowser: true });
    const resp = await client.responses.create({
      model,
      input: prompt,
      reasoning: { effort: "minimal" },
      text: { verbosity: "low" },
    });
    const content: string | undefined = extractOutputText(resp);
    if (!content) return null;
    // Attempt to parse JSON from the model output
    const jsonStart = content.indexOf("{");
    const jsonEnd = content.lastIndexOf("}");
    if (jsonStart === -1 || jsonEnd === -1) return null;
    const raw = content.slice(jsonStart, jsonEnd + 1);
    const parsed = JSON.parse(raw) as Partial<CommentSuggestion>;
    const suggestion: CommentSuggestion = {
      text: parsed.text || excerpt,
      severity: (parsed.severity as Severity) || "medium",
      category: (parsed.category as Category) || "general",
    };
    return suggestion;
  } catch (err: unknown) {
    // Log detailed error
    const e = err as { status?: number; message?: string; error?: { message?: string; type?: string; code?: string } };
    console.error("OpenAI Responses API error", e?.status, e?.error?.type, e?.error?.code, e?.error?.message || e?.message || e);
    // Fallback to chat.completions for resilience
    try {
      const { OpenAI } = await import("openai");
      const client = new OpenAI({ apiKey, dangerouslyAllowBrowser: true });
      const chat = await client.chat.completions.create({
        model: (import.meta.env.VITE_OPENAI_FALLBACK_MODEL as string) || model,
        messages: [
          { role: "system", content: "You are a professional AEC review assistant. Return STRICT JSON with keys: text, severity, category only." },
          { role: "user", content: prompt },
        ],
      });
      const content: string | undefined = (chat?.choices?.[0]?.message?.content as string | null) || undefined;
      if (!content) return null;
      const jsonStart = content.indexOf("{");
      const jsonEnd = content.lastIndexOf("}");
      if (jsonStart === -1 || jsonEnd === -1) return null;
      const raw = content.slice(jsonStart, jsonEnd + 1);
      const parsed = JSON.parse(raw) as Partial<CommentSuggestion>;
      const suggestion: CommentSuggestion = {
        text: parsed.text || excerpt,
        severity: (parsed.severity as Severity) || "medium",
        category: (parsed.category as Category) || "general",
      };
      return suggestion;
    } catch (err2) {
      console.error("OpenAI Chat Completions fallback error", err2);
      return null;
    }
  }
}



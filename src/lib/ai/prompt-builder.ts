import { readFile } from "node:fs/promises";
import path from "node:path";

export type PromptFileName =
  | "competition-dynamic-normalize.v1.md"
  | "competition-explain.v1.md"
  | "competition-explain.v2.md"
  | "competition-explain.v3.md"
  | "competition-normalize.v1.md"
  | "competition-rank.v1.md"
  | "competition-rank.v2.md"
  | "competition-rank.v3.md"
  | "competition-rank.v4.md";

const promptCache = new Map<PromptFileName, string>();

export async function loadPrompt(fileName: PromptFileName) {
  const cachedPrompt = promptCache.get(fileName);
  if (cachedPrompt) {
    return cachedPrompt;
  }

  const promptPath = path.join(process.cwd(), "src", "prompts", fileName);
  const prompt = await readFile(promptPath, "utf8");
  promptCache.set(fileName, prompt);
  return prompt;
}

export async function buildPrompt(fileName: PromptFileName, variables: Record<string, string | number>) {
  const template = await loadPrompt(fileName);

  return Object.entries(variables).reduce((prompt, [key, value]) => prompt.replaceAll(`{{${key}}}`, String(value)), template);
}

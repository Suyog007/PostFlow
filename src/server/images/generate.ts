/**
 * Optional paid image generation. Off unless a provider key is configured.
 * These are decorative images only — cards are the default. If you use them,
 * say so in the post ("AI-generated illustration"): readers punish undisclosed synthetic art.
 */
import sharp from "sharp";
import { env } from "../env";

export function imageGenProvider(): "bfl" | "openai" | null {
  const e = env();
  if (e.BFL_API_KEY) return "bfl";
  if (e.OPENAI_API_KEY) return "openai";
  return null;
}

export interface GeneratedImage {
  data: Buffer;
  mime: string;
  provider: "bfl" | "openai";
  width: number;
  height: number;
}

async function normalize(raw: Buffer, provider: "bfl" | "openai"): Promise<GeneratedImage> {
  const data = await sharp(raw).png().toBuffer();
  const meta = await sharp(data).metadata();
  return { data, mime: "image/png", provider, width: meta.width ?? 1024, height: meta.height ?? 1024 };
}

export async function generateImage(prompt: string): Promise<GeneratedImage> {
  const provider = imageGenProvider();
  if (!provider) throw new Error("No image-generation key is set (BFL_API_KEY or OPENAI_API_KEY). Cards are still available.");
  const clean = prompt.trim().slice(0, 800);
  if (clean.length < 10) throw new Error("Describe the image in a few more words.");
  return provider === "bfl" ? bflGenerate(clean) : openaiGenerate(clean);
}

async function bflGenerate(prompt: string): Promise<GeneratedImage> {
  const key = env().BFL_API_KEY!;
  const submit = await fetch("https://api.bfl.ai/v1/flux-2-klein", {
    method: "POST",
    headers: { "x-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, width: 1024, height: 1024 }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!submit.ok) throw new Error(`BFL rejected the request (HTTP ${submit.status}). Check BFL_API_KEY.`);
  const { polling_url } = (await submit.json()) as { polling_url?: string };
  if (!polling_url) throw new Error("BFL did not return a polling URL.");

  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const poll = await fetch(polling_url, { headers: { "x-key": key }, signal: AbortSignal.timeout(20_000) });
    if (!poll.ok) continue;
    const json = (await poll.json()) as { status?: string; result?: { sample?: string } };
    const status = (json.status ?? "").toLowerCase();
    if (status === "ready" && json.result?.sample) {
      const img = await fetch(json.result.sample, { signal: AbortSignal.timeout(30_000) });
      if (!img.ok) throw new Error("Could not download the generated image.");
      return normalize(Buffer.from(await img.arrayBuffer()), "bfl");
    }
    if (status === "error" || status === "failed" || status === "content moderated") throw new Error(`BFL could not generate that image (${json.status}).`);
  }
  throw new Error("The image took too long to generate. Try again.");
}

async function openaiGenerate(prompt: string): Promise<GeneratedImage> {
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${env().OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-image-1", prompt, n: 1, size: "1024x1024" }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`OpenAI rejected the request (HTTP ${res.status}). Check OPENAI_API_KEY.`);
  const json = (await res.json()) as { data?: { b64_json?: string }[] };
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI returned no image.");
  return normalize(Buffer.from(b64, "base64"), "openai");
}

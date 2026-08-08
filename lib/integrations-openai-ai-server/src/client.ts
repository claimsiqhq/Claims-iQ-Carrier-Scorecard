import OpenAI from "openai";

if (!process.env.GEMINI_API_KEY) {
  throw new Error(
    "GEMINI_API_KEY must be set. Add your Google Gemini API key to the environment.",
  );
}

// Google Gemini via its OpenAI-compatible endpoint. All chat.completions
// calls (including multimodal image inputs) work unchanged against Gemini.
export const gemini = new OpenAI({
  apiKey: process.env.GEMINI_API_KEY,
  baseURL:
    process.env.GEMINI_BASE_URL ??
    "https://generativelanguage.googleapis.com/v1beta/openai/",
});

// Back-compat alias for existing imports.
export const openai = gemini;

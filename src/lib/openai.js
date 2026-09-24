import OpenAI from "openai";

export const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const CHAT_MODEL = "gpt-4o-mini";

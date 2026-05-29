import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    hasGeminiKey: !!process.env.GEMINI_API_KEY,
    geminiKeyLength: process.env.GEMINI_API_KEY?.length || 0,
    geminiKeyPrefix: process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.substring(0, 10) : null,
    geminiModel: process.env.GEMINI_MODEL || null
  });
}

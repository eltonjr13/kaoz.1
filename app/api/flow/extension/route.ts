import { NextResponse } from "next/server";

let lastLogTime = 0;
const THROTTLE_MS = 90000; // 90 seconds

export async function POST() {
  const now = Date.now();
  if (now - lastLogTime >= THROTTLE_MS) {
    console.warn(
      `[API FLOW EXTENSION] POST /api/flow/extension - 404 Not Found (Warning throttled to every 90s)`
    );
    lastLogTime = now;
  }
  return NextResponse.json({ error: "Not Found" }, { status: 404 });
}

export async function GET() {
  const now = Date.now();
  if (now - lastLogTime >= THROTTLE_MS) {
    console.warn(
      `[API FLOW EXTENSION] GET /api/flow/extension - 404 Not Found (Warning throttled to every 90s)`
    );
    lastLogTime = now;
  }
  return NextResponse.json({ error: "Not Found" }, { status: 404 });
}

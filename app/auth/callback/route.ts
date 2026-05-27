import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const next = requestUrl.searchParams.get("next") ?? "/dashboard";

  return NextResponse.redirect(new URL(next, requestUrl.origin));
}

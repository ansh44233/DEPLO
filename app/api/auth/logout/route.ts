import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  const configuredBase = process.env.DEPLO_BASE_URL;
  if (!configuredBase || !origin) {
    return NextResponse.json({ error: "Request origin could not be verified." }, { status: 403 });
  }
  try {
    if (new URL(origin).origin !== new URL(configuredBase).origin) {
      return NextResponse.json({ error: "Request origin could not be verified." }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ error: "Sign-out is not configured." }, { status: 503 });
  }

  const response = NextResponse.json({ signedOut: true }, {
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
  response.cookies.set("deplo_session", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}

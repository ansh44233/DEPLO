import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const secret = process.env.DEPLO_SESSION_SECRET ?? "";
  const cookieStore = await cookies();
  const user = verifySessionToken(cookieStore.get("deplo_session")?.value, secret);
  return NextResponse.json(
    { authenticated: Boolean(user), user },
    { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } },
  );
}

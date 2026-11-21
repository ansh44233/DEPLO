import { NextResponse } from "next/server";
import { githubSessionCookieName } from "@/lib/auth/github-session";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(githubSessionCookieName, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

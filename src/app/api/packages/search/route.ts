import { NextRequest, NextResponse } from "next/server";

import { DatabaseError } from "@/lib/errors";
import { searchPackages } from "@/lib/queries";

export const dynamic = "force-dynamic";

/**
 * Type-ahead for the package picker.
 *
 * The only route handler that takes user input. The term goes into the query as
 * a `$parameter`, never into the query text, and the result count is capped
 * server-side so a one-character search cannot ask the free-tier instance for
 * every package it has.
 */
export async function GET(request: NextRequest) {
  const term = request.nextUrl.searchParams.get("q")?.trim() ?? "";

  if (term.length < 2) {
    return NextResponse.json({ results: [] });
  }

  try {
    const results = await searchPackages(term, 12);
    return NextResponse.json({ results }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof DatabaseError ? error.message : "Search is unavailable right now.";
    return NextResponse.json({ results: [], error: message }, { status: 503 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { supabaseConfig, supabaseConfigured } from "@/lib/supabase-config";

// Supabase 무료 프로젝트는 일주일 동안 아무 요청이 없으면 일시정지됩니다. 그러면 연수 당일 로그인도
// 공유 링크도 열리지 않습니다. vercel.json 의 cron 이 이 경로를 매일 한 번 불러 데이터베이스에
// 가벼운 질의를 보내 두면 잠들지 않습니다. 손으로 열어도 같은 효과가 있습니다.

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // Vercel 이 CRON_SECRET 환경변수를 두면 그 값으로 부르므로, 있을 때는 그것만 받습니다.
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!supabaseConfigured) return NextResponse.json({ ok: false, error: "supabase-not-configured" }, { status: 503 });

  // 빈 토큰의 공유 보드 조회. 아무것도 돌려주지 않지만 데이터베이스까지 다녀오는 진짜 질의입니다.
  const started = Date.now();
  try {
    const response = await fetch(`${supabaseConfig.url}/rest/v1/rpc/get_shared_board`, {
      method: "POST",
      headers: {
        apikey: supabaseConfig.anonKey,
        authorization: `Bearer ${supabaseConfig.anonKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ token: "" }),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    const ok = response.ok;
    return NextResponse.json(
      { ok, status: response.status, ms: Date.now() - started, at: new Date().toISOString() },
      { status: ok ? 200 : 502, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "fetch failed";
    return NextResponse.json({ ok: false, error: message, ms: Date.now() - started }, { status: 502, headers: { "cache-control": "no-store" } });
  }
}

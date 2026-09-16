import { NextResponse, type NextRequest } from "next/server";

// 배포 전용 주소(callum-xxxx-팀.vercel.app)로 들어온 요청을 고정 주소로 넘깁니다.
// Vercel 은 배포마다 고유 주소를 만들고 그 주소는 그 시점 코드에 고정되므로, 옛 링크로 들어와도
// 항상 최신 배포(고정 도메인)를 보게 하려는 것입니다. 프로덕션 배포에서만 동작하고 로컬·미리보기는 건너뜁니다.
export function proxy(request: NextRequest) {
  const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (process.env.VERCEL_ENV !== "production" || !productionHost) return NextResponse.next();

  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "").split(":")[0].toLowerCase();
  if (!host || host === productionHost.toLowerCase() || !host.endsWith(".vercel.app")) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.protocol = "https:";
  url.host = productionHost;
  url.port = "";
  return NextResponse.redirect(url, 308);
}

export const config = {
  // 정적 자산은 그대로 두고 페이지·API 요청만 봅니다.
  matcher: ["/((?!_next/static|_next/image).*)"],
};

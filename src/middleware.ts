import { NextResponse, type NextRequest } from "next/server";
import { createContentSecurityPolicy } from "@/lib/security/content-security-policy";

export function middleware(request: NextRequest) {
  // Deny old optimized thumbnails as well as deleted public originals.
  const imageSource = request.nextUrl.searchParams.get("url") ?? "";
  if (request.nextUrl.pathname === "/_next/image" && (imageSource.startsWith("/competition-gallery/") || imageSource.startsWith("/community/group-"))) {
    return new NextResponse(null, { status: 410, headers: { "Cache-Control": "no-store" } });
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const contentSecurityPolicy = createContentSecurityPolicy(nonce);
  const requestHeaders = new Headers(request.headers);

  // Next reads both headers while rendering and applies the nonce to its own
  // framework, page and inline script tags.
  requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);
  requestHeaders.set("x-nonce", nonce);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders
    }
  });
  response.headers.set("Content-Security-Policy", contentSecurityPolicy);

  return response;
}

export const config = {
  matcher: [
    {
      // Run for every route that can resolve to application HTML, including
      // API-looking and metadata-looking 404s.  Only exact framework asset
      // namespaces and the two exact image files are exempt; prefix matches
      // such as `/apiary` or `/_next/imagefoo` must still receive nonce CSP.
      source:
        "/((?!_next/static(?:/|$)|_next/image(?:/|$)|favicon\\.ico$|icon\\.png$).*)"
    },
    { source: "/_next/image", has: [{ type: "query", key: "url", value: "/competition-gallery/.*" }] },
    { source: "/_next/image", has: [{ type: "query", key: "url", value: "/community/group-.*" }] }
  ]
};

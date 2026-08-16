import { describe, expect, it } from "vitest";
import { routeRequest } from "../src/router";
import { env } from "cloudflare:workers";

function request(path: string, method = "GET"): Request {
  return new Request(`https://example.test${path}`, { method });
}

describe("API router", () => {
  it("redirects same-origin logout to the Access team domain", async () => {
    const response = await routeRequest(request("/api/access/logout"), env);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      `${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/logout`,
    );
  });

  it("rejects non-GET logout requests", async () => {
    const response = await routeRequest(
      request("/api/access/logout", "POST"),
      env,
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("GET");
  });

  it.each([
    ["GET", "/api/ballots/family-token"],
    ["GET", "/api/ballots/family-token/candidates"],
    ["POST", "/api/ballots/family-token/votes"],
    ["GET", "/api/admin/session"],
    ["GET", "/api/admin/roster"],
    ["GET", "/api/admin/results"],
    ["PUT", "/api/admin/voting"],
    ["GET", "/api/admin/families"],
    ["POST", "/api/admin/families"],
    ["PUT", "/api/admin/families/00000000-0000-4000-8000-000000000001"],
    ["DELETE", "/api/admin/families/00000000-0000-4000-8000-000000000001"],
    ["POST", "/api/admin/families/00000000-0000-4000-8000-000000000001/swimmers"],
    ["PUT", "/api/admin/swimmers/20000000-0000-4000-8000-000000000001"],
    ["DELETE", "/api/admin/swimmers/20000000-0000-4000-8000-000000000001"],
    ["POST", "/api/admin/notifications"],
    ["GET", "/api/admin/notifications/campaign-id"],
  ])("recognizes %s %s", async (method, path) => {
    const response = await routeRequest(request(path, method), env);

    expect(response.status).toBe(path.startsWith("/api/admin") ? 401 : 400);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: path.startsWith("/api/admin")
          ? "unauthorized"
          : "invalid_request",
      },
    });
  });

  it("returns the standard envelope for an unknown API route", async () => {
    const response = await routeRequest(request("/api/unknown"), env);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "not_found" },
    });
  });

  it("returns 405 and Allow for a recognized path with the wrong method", async () => {
    const response = await routeRequest(request("/api/admin/voting", "POST"), env);

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("PUT");
  });
});

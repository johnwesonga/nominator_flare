import { apiError } from "./responses";
import { authorizeAdmin, type AdminIdentity } from "./auth";
import { handleAdminRoute } from "./routes/admin";
import { handleBallotRoute } from "./routes/ballots";
import { handleFamilyManagementRoute } from "./routes/families";
import { handleNotificationRoute } from "./routes/notifications";
import { handleVoteRoute } from "./routes/votes";

type Route = {
  method: string;
  pattern: RegExp;
  handler: (
    request: Request,
    env: Env,
    identity?: AdminIdentity,
  ) => Response | Promise<Response>;
};

const routes: Route[] = [
  { method: "GET", pattern: /^\/api\/ballots\/[^/]+$/, handler: handleBallotRoute },
  {
    method: "GET",
    pattern: /^\/api\/ballots\/[^/]+\/candidates$/,
    handler: handleBallotRoute,
  },
  {
    method: "POST",
    pattern: /^\/api\/ballots\/[^/]+\/votes$/,
    handler: handleVoteRoute,
  },
  { method: "GET", pattern: /^\/api\/admin\/session$/, handler: handleAdminRoute },
  { method: "GET", pattern: /^\/api\/admin\/roster$/, handler: handleAdminRoute },
  { method: "GET", pattern: /^\/api\/admin\/results$/, handler: handleAdminRoute },
  { method: "PUT", pattern: /^\/api\/admin\/voting$/, handler: handleAdminRoute },
  { method: "GET", pattern: /^\/api\/admin\/families$/, handler: handleFamilyManagementRoute },
  { method: "POST", pattern: /^\/api\/admin\/families$/, handler: handleFamilyManagementRoute },
  { method: "PUT", pattern: /^\/api\/admin\/families\/[^/]+$/, handler: handleFamilyManagementRoute },
  { method: "DELETE", pattern: /^\/api\/admin\/families\/[^/]+$/, handler: handleFamilyManagementRoute },
  { method: "POST", pattern: /^\/api\/admin\/families\/[^/]+\/swimmers$/, handler: handleFamilyManagementRoute },
  { method: "PUT", pattern: /^\/api\/admin\/swimmers\/[^/]+$/, handler: handleFamilyManagementRoute },
  { method: "DELETE", pattern: /^\/api\/admin\/swimmers\/[^/]+$/, handler: handleFamilyManagementRoute },
  {
    method: "POST",
    pattern: /^\/api\/admin\/notifications$/,
    handler: handleNotificationRoute,
  },
  {
    method: "GET",
    pattern: /^\/api\/admin\/notifications\/[^/]+$/,
    handler: handleNotificationRoute,
  },
];

export async function routeRequest(request: Request, env: Env): Promise<Response> {
  const pathname = new URL(request.url).pathname;

  if (pathname === "/api/access/logout") {
    if (request.method !== "GET") {
      return apiError(
        request,
        405,
        "method_not_allowed",
        "Method not allowed.",
        { Allow: "GET" },
      );
    }

    const teamDomain = env.ACCESS_TEAM_DOMAIN.replace(/\/$/, "");
    return Response.redirect(`${teamDomain}/cdn-cgi/access/logout`, 302);
  }

  const pathRoutes = routes.filter(({ pattern }) => pattern.test(pathname));
  const route = pathRoutes.find(({ method }) => method === request.method);

  if (route) {
    if (pathname.startsWith("/api/admin/")) {
      const authorization = await authorizeAdmin(request, env);
      if (!authorization.ok) return authorization.response;
      return route.handler(request, env, authorization.identity);
    }
    return route.handler(request, env);
  }

  if (pathRoutes.length > 0) {
    return apiError(
      request,
      405,
      "method_not_allowed",
      "Method not allowed.",
      { Allow: pathRoutes.map(({ method }) => method).join(", ") },
    );
  }

  return apiError(request, 404, "not_found", "API route not found.");
}

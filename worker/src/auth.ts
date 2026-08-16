import { createRemoteJWKSet, jwtVerify } from "jose";
import { apiError } from "./responses";

export type AdminIdentity = {
  email: string;
  subject: string | null;
};

export type AuthorizationResult =
  | { ok: true; identity: AdminIdentity }
  | { ok: false; response: Response };

export async function authorizeAdmin(
  request: Request,
  env: Env,
): Promise<AuthorizationResult> {
  const token = request.headers.get("cf-access-jwt-assertion");
  if (token === null || token === "") {
    return unauthorized(request);
  }

  let teamDomain: URL;
  try {
    teamDomain = new URL(env.ACCESS_TEAM_DOMAIN);
  } catch {
    throw new Error("ACCESS_TEAM_DOMAIN is not a valid URL.");
  }
  if (
    teamDomain.protocol !== "https:" ||
    teamDomain.hostname === "replace-me.cloudflareaccess.com" ||
    env.ACCESS_AUD.trim().length === 0 ||
    env.ACCESS_AUD.startsWith("replace-with-")
  ) {
    throw new Error("Cloudflare Access configuration is invalid.");
  }

  let email: string;
  let subject: string | null;
  try {
    const jwks = createRemoteJWKSet(
      new URL("/cdn-cgi/access/certs", teamDomain),
    );
    const { payload } = await jwtVerify(token, jwks, {
      algorithms: ["RS256"],
      audience: env.ACCESS_AUD,
      issuer: teamDomain.origin,
    });

    if (typeof payload.email !== "string" || payload.email.trim() === "") {
      return unauthorized(request);
    }

    email = payload.email.trim().toLowerCase();
    subject = typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return unauthorized(request);
  }

  const allowed = await env.DB
    .prepare("SELECT 1 AS present FROM admins WHERE email = ?1 LIMIT 1")
    .bind(email)
    .first<{ present: number }>();

  if (allowed === null) {
    return {
      ok: false,
      response: apiError(
        request,
        403,
        "forbidden",
        "This identity is not authorized for administration.",
      ),
    };
  }

  return { ok: true, identity: { email, subject } };
}

function unauthorized(request: Request): AuthorizationResult {
  return {
    ok: false,
    response: apiError(
      request,
      401,
      "unauthorized",
      "A valid Cloudflare Access session is required.",
    ),
  };
}

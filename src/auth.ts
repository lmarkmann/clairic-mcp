import { createRemoteJWKSet, jwtVerify } from "jose";

let accessKeys: ReturnType<typeof createRemoteJWKSet> | undefined;

// Access sits in front of the Worker and signs every request it lets through.
// Checking the signature here keeps a route Access does not cover from serving tools.
export async function isAccessVerified(request: Request, env: Env): Promise<boolean> {
	const assertion = request.headers.get("cf-access-jwt-assertion");
	if (!assertion) return false;
	const issuer = `https://${env.ACCESS_TEAM_DOMAIN}`;
	accessKeys ??= createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
	try {
		await jwtVerify(assertion, accessKeys, { issuer, audience: env.ACCESS_AUD });
		return true;
	} catch {
		return false;
	}
}

import { createApiClient } from "@repo/contracts";

/**
 * The typed API client. Same-origin (`baseUrl: ""`): production serves the web
 * app and the API from one origin, and development proxies /api to :3001, so
 * the session cookie is first-party in both.
 */
export const api = createApiClient({ baseUrl: "" });

import { createApiClient, type ApiClient } from "@ifc-boq/api";
import { API_BASE_URL } from "@/config";
import { throwOnApiError } from "./errors";

type TokenSource = () => Promise<string | null> | string | null;
let tokenSource: TokenSource = () => null;

/** The auth adapter (FE-004) registers how to get the bearer token for each request. */
export function setAccessTokenSource(source: TokenSource) {
  tokenSource = source;
}

/** The one API client of the app. */
export const api: ApiClient = createApiClient({
  baseUrl: API_BASE_URL,
  getAccessToken: () => tokenSource(),
  middleware: [throwOnApiError],
});

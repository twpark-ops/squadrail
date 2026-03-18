const LOCALHOST_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1"]);

export function assertBypassOnlyOnLocalhost(baseUrl) {
  const parsed = new URL(baseUrl);
  const hostname = parsed.hostname.startsWith("[") && parsed.hostname.endsWith("]")
    ? parsed.hostname.slice(1, -1)
    : parsed.hostname;
  if (!LOCALHOST_HOSTNAMES.has(hostname)) {
    throw new Error(
      `dangerouslyBypassApprovalsAndSandbox is restricted to localhost runs; got ${parsed.hostname}`,
    );
  }
}

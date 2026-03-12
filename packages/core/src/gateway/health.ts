/**
 * Gateway /health endpoint checker.
 * Used in the wake polling loop to confirm H2's gateway is ready.
 */
export async function checkGatewayHealth(
  endpoint: string,
  timeoutMs = 5000,
): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(endpoint, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

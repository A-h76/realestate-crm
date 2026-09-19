import { ApiError } from "@/lib/errors";

/**
 * Demo Mode is an explicit opt-in. Production fails closed unless
 * DEMO_MODE is exactly the string "true".
 */
export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === "true";
}

export function assertDemoMode(message = "This action is only available in Demo Mode"): void {
  if (!isDemoMode()) {
    throw new ApiError(403, message);
  }
}

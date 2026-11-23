import { z } from "zod";

export const ApiErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  details: z.record(z.unknown()).default({}),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const ERROR_MESSAGES = {
  bad_request: "That request is not in the shape we expect. Check the fields listed in details.",
  unauthorized: "We could not tell who you are. Sign in again or check your key.",
  bad_signature: "The signature does not match the body we received. Check the shared secret.",
  not_found: "We could not find what you asked for.",
  conflict: "Someone else changed this while you were working. Reload and try again.",
  duplicate_delivery: "We have already seen this delivery, so we ignored it.",
  unavailable: "A service we depend on is not answering. Try again in a minute.",
  internal: "Something went wrong on our side. It has been logged.",
} as const;
export type ErrorCode = keyof typeof ERROR_MESSAGES;

export function apiError(code: ErrorCode, details: Record<string, unknown> = {}, message?: string): ApiError {
  return { code, message: message ?? ERROR_MESSAGES[code], details };
}

/** Turn a zod failure into an API error with one plain line per problem. */
export function fromZodError(err: z.ZodError): ApiError {
  const problems = err.issues.map((i) => ({
    field: i.path.join(".") || "(body)",
    problem: i.message,
  }));
  return apiError("bad_request", { problems });
}

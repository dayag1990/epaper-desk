export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details: unknown = {},
  ) {
    super(message);
  }
}
export const notFound = (what = "That item") => new ApiError(404, "not_found", `${what} was not found.`);
export const forbidden = (msg = "Your role does not allow this.") => new ApiError(403, "forbidden", msg);
export const unauthorized = () => new ApiError(401, "not_signed_in", "Please sign in first.");

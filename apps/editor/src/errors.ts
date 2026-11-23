/** Errors in plain words, written to be read on a phone at 2 am: what happened, what is safe, what to do. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
export const isNetwork = (e: unknown): boolean => e instanceof ApiError && e.status === 0;

export function plainError(e: unknown, what = "do that"): string {
  if (e instanceof ApiError) {
    switch (e.status) {
      case 0:
        return "Can't reach the server. Your changes are safe on this device and will save by themselves when it is back.";
      case 401:
        return "You've been signed out. Sign in again; nothing you typed is lost.";
      case 403:
        return "Your account can look but not change this page. Ask an editor to give you edit access.";
      case 404:
        return `That page or file could not be found. It may have been removed. Reload and try to ${what} again.`;
      case 409:
        return "Someone else saved this page while you were editing. Pick which version to keep.";
      case 423: {
        const who = (e.details as { locked_by?: { name?: string } } | undefined)?.locked_by?.name;
        return who ? `${who} is editing this page right now. You can read it, not change it.` : "Someone is editing this page right now. You can read it, not change it.";
      }
      case 413:
        return "That file is too big. Try a smaller photo (under 20 MB).";
      case 415:
        return "That file type isn't supported. Use a JPG, PNG or WebP photo.";
      case 501:
      case 503:
        return "That feature isn't switched on yet. The manual way still works.";
      default:
        if (e.status >= 500) return `The server had a problem while trying to ${what}. Your work is kept here. Try again in a minute.`;
        return `Couldn't ${what}. ${e.message}`;
    }
  }
  return `Something went wrong while trying to ${what}. Your work is kept here; reload if it keeps happening.`;
}

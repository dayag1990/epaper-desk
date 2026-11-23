import { z } from "zod";

/** ISO 8601 with an explicit offset (Z or +hh:mm). */
export const IsoTime = z.string().datetime({
  offset: true,
  message: "must be an ISO 8601 time with an offset, like 2026-04-02T10:15:00-04:00",
});

/** A 0-1 fraction (used for geometry on e-paper images). */
export const Fraction = z.number().min(0, "must be between 0 and 1").max(1, "must be between 0 and 1");

/** Millimetres on a page. */
export const Mm = z.number().finite();

export const Sha256Signature = z.string().regex(/^sha256=[0-9a-fA-F]+$/, "must look like sha256=<hex>");

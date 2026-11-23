import { z } from "zod";
import { Sha256Signature } from "../common.js";

// D6: what the website sees.

export const WebhookHeadersSchema = z.object({
  "x-epaper-signature": Sha256Signature,
  "x-epaper-delivery": z.string().uuid(), // receivers reject repeats
});

// SPEC-VAGUE: only "edition.published" is shown; other event names unknown.
export const WebhookEventNameSchema = z.string().min(1);

export const EditionPublishedPayloadSchema = z.object({
  event: WebhookEventNameSchema,
  paper: z.string().min(1), // slug
  edition: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be a date like 2026-11-18"),
  pages: z.number().int().min(1),
  url: z.string().url(),
});
export type EditionPublishedPayload = z.infer<typeof EditionPublishedPayloadSchema>;

/** The data- attributes on the embed script tag. */
export const EmbedAttributesSchema = z.object({
  "data-paper": z.string().min(1),
  "data-edition": z.string().min(1), // "latest" or a date; SPEC-VAGUE: other values unknown
});

/** Subscriber hand-off: site signs, reader verifies. JWT, 5 min, {sub, plan}. */
export const SubscriberTokenClaimsSchema = z.object({
  sub: z.string().min(1),
  plan: z.string().min(1), // SPEC-VAGUE: plan names not listed
  exp: z.number().int().optional(), // standard JWT claims; the 5 minute life is enforced by exp
  iat: z.number().int().optional(),
});
export const SUBSCRIBER_TOKEN_TTL_SECONDS = 300;

#!/usr/bin/env node
// Re-reads photo-credits.json and the photo folder and checks every acceptance rule.
// usage: node scripts/photos/verify-credits.mjs   (exit 1 on any failure)
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { classifyLicence, SECTIONS, ASSET_DIR } from "./lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const CREDITS_PATH = path.resolve(here, "../../fixtures/demo-site-ta/photo-credits.json");

export async function verify({ creditsPath = CREDITS_PATH, dir = ASSET_DIR } = {}) {
  const errors = [];
  const err = (m) => errors.push(m);
  const doc = JSON.parse(fs.readFileSync(creditsPath, "utf8"));
  const photos = doc.photos;
  if (!Array.isArray(photos)) throw new Error("photos[] missing");
  const sha = new Map(), ids = new Set();
  const perSection = Object.fromEntries(SECTIONS.map((s) => [s, 0]));
  const licCount = {};
  let big = 0, total = 0;
  const required = ["id", "file", "width", "height", "bytes", "sha256", "title", "creator", "licence_short", "licence_url", "source_url", "original_file_url", "retrieved_at", "tags", "sections", "orientation", "max_available", "credit_line"];
  for (const p of photos) {
    const w = `${p.id}:`;
    for (const k of required) if (p[k] === undefined || p[k] === null || p[k] === "") err(`${w} missing ${k}`);
    if (ids.has(p.id)) err(`${w} duplicate id`); ids.add(p.id);
    if (!/^ph-\d{3,}$/.test(p.id) || p.file !== `${p.id}.jpg`) err(`${w} bad id/file`);
    const fp = path.join(dir, String(p.file));
    if (!fs.existsSync(fp)) { err(`${w} file missing`); continue; }
    const buf = fs.readFileSync(fp);
    total += buf.length;
    if (buf.length !== p.bytes) err(`${w} bytes mismatch`);
    if (buf.length > 25e6) err(`${w} over 25MB`);
    const h = crypto.createHash("sha256").update(buf).digest("hex");
    if (h !== p.sha256) err(`${w} sha256 mismatch`);
    if (sha.has(h)) err(`${w} duplicate of ${sha.get(h)} by sha256`); sha.set(h, p.id);
    const m = await sharp(buf).metadata();
    if (m.format !== "jpeg") err(`${w} not a JPEG`);
    if (m.width !== p.width || m.height !== p.height) err(`${w} dimensions differ from record`);
    if (m.orientation && m.orientation !== 1) err(`${w} EXIF orientation not applied`);
    const long = Math.max(m.width, m.height);
    if (long < 2400) err(`${w} long edge ${long} < 2400`);
    if (long >= 3840) big++;
    if ((long < 3840) !== !!p.max_available) err(`${w} max_available inconsistent with size`);
    const lic = classifyLicence(p.licence_short, p.licence_url);
    if (!lic.ok) err(`${w} licence not allowed: ${p.licence_short}`);
    licCount[lic.family || p.licence_short] = (licCount[lic.family || p.licence_short] || 0) + 1;
    if (/\b(NC|ND)\b/.test(p.licence_short || "")) err(`${w} NC/ND licence`);
    if (!String(p.creator || "").trim()) err(`${w} creator missing`);
    if (!/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/.test(p.source_url || "")) err(`${w} source_url not a Commons File: page`);
    if ([...String(p.credit_line)].length > 70) err(`${w} credit_line > 70 chars`);
    if (!String(p.credit_line).includes(p.licence_short)) err(`${w} credit_line lacks licence`);
    if (!String(p.credit_line).startsWith("படம்: ")) err(`${w} credit_line prefix`);
    for (const s of p.sections || []) { if (!SECTIONS.includes(s)) err(`${w} unknown section ${s}`); else perSection[s]++; }
    if (!(p.sections || []).length) err(`${w} no sections`);
    if (!["horizontal", "vertical", "square"].includes(p.orientation)) err(`${w} orientation`);
  }
  if (photos.length < 80) err(`pool ${photos.length} < 80`);
  if (big < 20) err(`only ${big} photos >= 3840 px (need 20)`);
  for (const s of SECTIONS) if (perSection[s] < 8) err(`section ${s} has ${perSection[s]} < 8`);
  if (total > 2e9) err(`total ${total} bytes > 2GB`);
  return { errors, stats: { count: photos.length, big, perSection, licences: licCount, totalBytes: total } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { errors, stats } = await verify();
  console.log(JSON.stringify(stats, null, 1));
  if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
  console.log("verify-credits: OK");
}

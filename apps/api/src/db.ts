import { PrismaClient } from "@prisma/client";
import { databaseUrl } from "./env.js";
export const prisma = new PrismaClient({ datasourceUrl: databaseUrl() });

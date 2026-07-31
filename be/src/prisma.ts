import { PrismaClient } from "@prisma/client";

// Satu instance PrismaClient dipakai bersama seluruh aplikasi.
export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
});

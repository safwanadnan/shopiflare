import { PrismaClient } from "@prisma/client";
import { PrismaD1 } from "@prisma/adapter-d1";

export function getPrisma(env: Env) {
  const adapter = new PrismaD1(env.DB);
  return new PrismaClient({ adapter });
}

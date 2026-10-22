import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const rows = await prisma.session.findMany();
console.log(
  rows.map((r) => ({
    shop: r.shop,
    isOnline: r.isOnline,
    expires: r.expires,
    scope: r.scope,
    tokenLen: r.accessToken?.length,
  })),
);
await prisma.$disconnect();

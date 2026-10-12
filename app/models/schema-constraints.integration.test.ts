// Database-level guarantees that live in raw-SQL migrations (and so are
// invisible to schema.prisma). If a migration is squashed or rewritten and
// loses one of these, these tests fail.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import prisma from "../db.server";

const SHOP = "constraints-test.myshopify.com";

async function shopId() {
  const shop = await prisma.shop.upsert({
    where: { shopDomain: SHOP },
    create: { shopDomain: SHOP },
    update: {},
  });
  return shop.id;
}

const widget = (id: string, published: boolean, type = "CAROUSEL") =>
  prisma.widget.create({ data: { shopId: id, type, name: `${type} ${published}`, config: {}, published } });

describe("Widget_one_published_per_type (partial unique index)", () => {
  beforeEach(async () => {
    await prisma.shop.deleteMany({ where: { shopDomain: SHOP } });
  });

  afterAll(async () => {
    await prisma.shop.deleteMany({ where: { shopDomain: SHOP } });
  });

  it("rejects a second published widget of the same type in one shop", async () => {
    const id = await shopId();
    await widget(id, true);
    const second = widget(id, true);
    await expect(second).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    await expect(widget(id, true)).rejects.toMatchObject({ code: "P2002" });
  });

  it("allows any number of unpublished drafts of the same type", async () => {
    const id = await shopId();
    await widget(id, true);
    await widget(id, false);
    await widget(id, false);
    expect(await prisma.widget.count({ where: { shopId: id, type: "CAROUSEL" } })).toBe(3);
  });

  it("allows one published widget per type", async () => {
    const id = await shopId();
    await widget(id, true, "CAROUSEL");
    await widget(id, true, "STORIES");
    expect(await prisma.widget.count({ where: { shopId: id, published: true } })).toBe(2);
  });

  it("cascades widget rows when the shop is deleted", async () => {
    const id = await shopId();
    await widget(id, true);
    await prisma.shop.delete({ where: { id } });
    expect(await prisma.widget.count({ where: { shopId: id } })).toBe(0);
  });
});

import { describe, it, expect } from "vitest";
import { upgradeLongStringFieldsToText, LINK_COMPONENT_SCHEMA } from "../transformer";

const long = "x".repeat(300);
const short = "hello";

describe("upgradeLongStringFieldsToText", () => {
  it("upgrades a single-type string field whose seed value exceeds 255 chars", () => {
    const contentTypes: any = {
      "privacy-policy": {
        kind: "singleType",
        attributes: {
          title: { type: "string" },
          body: { type: "string" },
        },
      },
    };
    const seed = { "privacy-policy": { title: short, body: long } };

    const count = upgradeLongStringFieldsToText(contentTypes, seed);

    expect(count).toBe(1);
    expect(contentTypes["privacy-policy"].attributes.body.type).toBe("text");
    expect(contentTypes["privacy-policy"].attributes.title.type).toBe("string");
  });

  it("upgrades a collection field if ANY item exceeds 255 chars", () => {
    const contentTypes: any = {
      posts: { kind: "collectionType", attributes: { excerpt: { type: "string" } } },
    };
    const seed = { posts: [{ excerpt: short }, { excerpt: long }, { excerpt: short }] };

    const count = upgradeLongStringFieldsToText(contentTypes, seed);

    expect(count).toBe(1);
    expect(contentTypes.posts.attributes.excerpt.type).toBe("text");
  });

  it("leaves short string fields as string", () => {
    const contentTypes: any = {
      page: { attributes: { label: { type: "string" } } },
    };
    const count = upgradeLongStringFieldsToText(contentTypes, { page: { label: short } });
    expect(count).toBe(0);
    expect(contentTypes.page.attributes.label.type).toBe("string");
  });

  it("never touches non-string attribute types", () => {
    const contentTypes: any = {
      page: {
        attributes: {
          hero: { type: "media" },
          cta: { type: "component", component: "shared.link" },
          rich: { type: "richtext" },
        },
      },
    };
    // Even with long values present, non-string types are untouched.
    const seed = { page: { hero: long, rich: long } };
    const count = upgradeLongStringFieldsToText(contentTypes, seed);
    expect(count).toBe(0);
    expect(contentTypes.page.attributes.hero.type).toBe("media");
    expect(contentTypes.page.attributes.cta.type).toBe("component");
    expect(contentTypes.page.attributes.rich.type).toBe("richtext");
  });

  it("keeps a value of exactly 255 chars as string (boundary)", () => {
    const contentTypes: any = { page: { attributes: { s: { type: "string" } } } };
    const count = upgradeLongStringFieldsToText(contentTypes, {
      page: { s: "y".repeat(255) },
    });
    expect(count).toBe(0);
    expect(contentTypes.page.attributes.s.type).toBe("string");
  });

  it("is a no-op when a content type has no seed data", () => {
    const contentTypes: any = { page: { attributes: { s: { type: "string" } } } };
    const count = upgradeLongStringFieldsToText(contentTypes, {});
    expect(count).toBe(0);
    expect(contentTypes.page.attributes.s.type).toBe("string");
  });
});

describe("shared.link component", () => {
  it("types anchor text as `text`, not varchar(255)-bound `string`", () => {
    // Link text can be a full sentence/blurb (e.g. news-card links); a `string`
    // column overflows Postgres varchar(255) and fails seeding with a 500.
    expect(LINK_COMPONENT_SCHEMA.attributes.text.type).toBe("text");
  });
});

import { describe, it, expect } from "vitest";
import { upgradeLongStringFieldsToText, LINK_COMPONENT_SCHEMA, manifestToSchemas, sharedComponentTypeName } from "../transformer";

describe("shared-component single types (no global bucket)", () => {
  it("emits one un-prefixed single type per shared-global component", () => {
    const manifest = {
      version: 1,
      pages: {},
      global: {
        components: {
          Nav: {
            name: "Nav",
            role: "shared-section",
            contentMode: "shared-global",
            fields: { label: { type: "plain", selector: ".l" } },
          },
        },
      },
    } as any;
    const { contentTypes } = manifestToSchemas(manifest);
    expect(contentTypes.global).toBeUndefined();              // no flat bucket
    expect(contentTypes.nav?.kind).toBe("singleType");        // own type
    expect(Object.keys(contentTypes.nav.attributes)).toContain("label"); // un-prefixed
  });

  it("sharedComponentTypeName kebab-cases component names", () => {
    expect(sharedComponentTypeName("Nav")).toBe("nav");
    expect(sharedComponentTypeName("BodCard")).toBe("bod-card");
    expect(sharedComponentTypeName("Announcement_Bar")).toBe("announcement-bar");
  });
});

describe("collection schema names — singular must differ from plural (Strapi unicity)", () => {
  const build = (collName: string) => {
    const manifest = {
      version: 1,
      pages: {
        p: {
          route: "/p",
          fields: {},
          collections: {
            [collName]: { selector: "." + collName, fields: { name: { type: "plain", selector: ".n" } } },
          },
        },
      },
    } as any;
    return manifestToSchemas(manifest).contentTypes[collName].info;
  };

  it("pluralizes when the collection name doesn't end in 's' (e.g. 'board')", () => {
    const info = build("board");
    // singularName must equal the key (folder), pluralName must differ
    expect(info.singularName).toBe("board");
    expect(info.pluralName).toBe("boards");
  });

  it("singularizes cleanly when the name ends in 's'", () => {
    const info = build("members");
    expect(info.pluralName).toBe("members");
    expect(info.singularName).toBe("member");
  });

  it("handles underscored multi-word names without singular==plural", () => {
    const info = build("clock_card");
    expect(info.singularName).toBe("clock-card");
    expect(info.pluralName).toBe("clock-cards");
    expect(info.singularName).not.toBe(info.pluralName);
  });
});

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

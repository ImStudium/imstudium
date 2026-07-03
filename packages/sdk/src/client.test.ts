import { describe, it, expect } from "vitest";
import { StudIpClient } from "./client.js";
import { mockFetch, paginatedDoc, courseResource, userDoc } from "./test/fixtures.js";

const BASE = "https://example.edu/jsonapi.php/v1";

describe("StudIpClient", () => {
  it("paginates through all course pages", async () => {
    let call = 0;
    const fetchImpl = mockFetch({
      "GET /users/me": () =>
        new Response(JSON.stringify(userDoc()), {
          headers: { "content-type": "application/vnd.api+json" },
        }),
      "GET /users/user1/courses": () => {
        call++;
        if (call === 1) {
          return new Response(
            JSON.stringify({
              data: [courseResource("a", "Course A")],
              links: { next: "/jsonapi.php/v1/users/user1/courses?page[offset]=1" },
            }),
            { headers: { "content-type": "application/vnd.api+json" } },
          );
        }
        return new Response(JSON.stringify(paginatedDoc([courseResource("b", "Course B")])), {
          headers: { "content-type": "application/vnd.api+json" },
        });
      },
    });

    const client = new StudIpClient({ baseUrl: BASE, fetchImpl });
    const courses = await client.paginateAll("/users/user1/courses");
    expect(courses).toHaveLength(2);
    expect(call).toBe(2);
  });

  it("throws DigicampusError on 401", async () => {
    const fetchImpl = mockFetch({
      "GET /users/me": () =>
        new Response(JSON.stringify({ errors: [{ status: "401", title: "Unauthorized" }] }), {
          status: 401,
          headers: { "content-type": "application/vnd.api+json" },
        }),
    });
    const client = new StudIpClient({ baseUrl: BASE, fetchImpl });
    await expect(client.get("/users/me")).rejects.toMatchObject({ code: "API_ERROR", status: 401 });
  });
});

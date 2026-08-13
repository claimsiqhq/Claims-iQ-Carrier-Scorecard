import assert from "node:assert/strict";
import test from "node:test";
import { readDocumentRenditionMetadata } from "./documentRenditions";

test("rendition metadata is normalized and bounded to positive pages", () => {
  assert.deepEqual(
    readDocumentRenditionMetadata(
      {
        pageRenditions: {
          version: "page-jpeg-v1",
          format: "jpeg",
          status: "degraded",
          pageCount: 4,
          renderedPages: [3, 1, 3, -1, "2"],
          failedPages: [
            { page_number: 4, reason: "render failed" },
            { page_number: 0, reason: "invalid" },
          ],
        },
      },
      null,
    ),
    {
      version: "page-jpeg-v1",
      format: "jpeg",
      status: "degraded",
      pageCount: 4,
      renderedPages: [1, 3],
      failedPages: [{ page_number: 4, reason: "render failed" }],
    },
  );
});

test("unknown rendition metadata fails closed", () => {
  assert.equal(
    readDocumentRenditionMetadata({
      pageRenditions: {
        version: "unknown",
        format: "png",
        status: "ready",
      },
    }),
    null,
  );
  assert.equal(readDocumentRenditionMetadata(null), null);
});


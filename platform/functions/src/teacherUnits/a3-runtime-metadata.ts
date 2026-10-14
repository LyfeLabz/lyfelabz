/** Fixed provider endpoint: no URL, proxy, retry, redirect or identity from callers. */
import { get } from "node:http";
export type MetadataPath = "project/project-id" | "project/numeric-project-id" | "instance/region" | "instance/service-accounts/default/email";
export function readRuntimeMetadata(path: MetadataPath): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = get({ hostname: "metadata.google.internal", path: `/computeMetadata/v1/${path}`,
      headers: { "Metadata-Flavor": "Google" }, agent: false }, response => {
      const chunks: Buffer[] = []; let size = 0;
      if (response.statusCode !== 200 || response.headers["metadata-flavor"] !== "Google") {
        response.resume(); request.destroy(new Error("Untrusted metadata response")); return;
      }
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 4096) request.destroy(new Error("Oversized metadata response"));
        else chunks.push(chunk);
      });
      response.on("error", reject);
      response.on("aborted", () => reject(new Error("Incomplete metadata response")));
      response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });
    const timer = setTimeout(() => request.destroy(new Error("Metadata deadline exceeded")), 2000);
    request.on("close", () => clearTimeout(timer));
    request.on("error", reject);
  });
}

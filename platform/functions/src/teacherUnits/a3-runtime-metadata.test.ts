import { EventEmitter } from "node:events";
import { get } from "node:http";
import type { IncomingMessage } from "node:http";
import { readRuntimeMetadata } from "./a3-runtime-metadata";
jest.mock("node:http", () => ({ get: jest.fn() }));
let request: any, response: any, options: any;
beforeEach(() => {
  jest.useFakeTimers();
  request = new EventEmitter(); request.destroy = jest.fn((error: Error) => { request.emit("error", error); request.emit("close"); });
  response = new EventEmitter(); response.statusCode = 200; response.headers = { "metadata-flavor": "Google" }; response.resume = jest.fn();
  jest.mocked(get).mockImplementation(((input: unknown, callback: (response: IncomingMessage) => void) => {
    options = input; queueMicrotask(() => callback(response)); return request;
  }) as any);
});
afterEach(() => { jest.useRealTimers(); jest.clearAllMocks(); });
function start() { const promise = readRuntimeMetadata("project/project-id"); jest.runAllTicks(); return { promise }; }
test("fixed host, provider header, no caller-selected URL or redirect", async () => {
  const { promise } = start(); response.emit("data", Buffer.from("lyfelabz-prod")); response.emit("end"); request.emit("close");
  expect(await promise).toBe("lyfelabz-prod");
  expect(options).toEqual({ hostname: "metadata.google.internal", path: "/computeMetadata/v1/project/project-id", headers: { "Metadata-Flavor": "Google" }, agent: false });
  expect(jest.getTimerCount()).toBe(0);
});
test.each([301, 403, 404, 500])("HTTP %s refuses", async status => {
  response.statusCode = status; const { promise } = start(); await expect(promise).rejects.toThrow();
});
test("missing provider header refuses", async () => {
  response.headers = {}; const { promise } = start(); await expect(promise).rejects.toThrow();
});
test("oversize body refuses", async () => {
  const { promise } = start(); response.emit("data", Buffer.alloc(4097)); await expect(promise).rejects.toThrow();
});
test("deadline refuses stalled response", async () => {
  const { promise } = start(); jest.advanceTimersByTime(2000); await expect(promise).rejects.toThrow("deadline");
});
test("truncated response refuses", async () => {
  const { promise } = start(); response.emit("aborted"); request.emit("close"); await expect(promise).rejects.toThrow("Incomplete");
});

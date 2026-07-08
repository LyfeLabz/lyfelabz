import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";

export const PROJECT_ID = "lyfelabz-rules-test";

const FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
const [FIRESTORE_HOST, FIRESTORE_PORT] = FIRESTORE_EMULATOR_HOST.split(":");

export async function createTestEnvironment(): Promise<RulesTestEnvironment> {
  return initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host: FIRESTORE_HOST,
      port: Number(FIRESTORE_PORT),
      rules: readFileSync(resolve(__dirname, "..", "firestore.rules"), "utf8"),
    },
  });
}

import { getApps, initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFunctionsEmulator, getFunctions } from "firebase/functions";

import { getEmulatorEndpoints, getFirebaseClientConfig } from "../firebase-config";
import {
  LAB_REPORT_CLOUD_READY_EVENT,
  createLabReportCloudTransport,
  type LabReportCloudTransport,
} from "./cloudTransport";

// Browser entry for assets/lyfelabz-lab-report-cloud.js. The page loads this
// bundle (after assets/lyfelabz-firebase-config.js) only on a host where cloud
// saving is enabled; it initializes Firebase against the shared client config,
// installs the transport, and announces readiness. Any failure leaves no
// transport installed, and the page keeps saving in the browser only.

type WindowWithCloud = Window & {
  lyfelabz?: { labReportCloud?: LabReportCloudTransport };
};

async function install(win: WindowWithCloud): Promise<void> {
  if (win.lyfelabz?.labReportCloud) return;
  const app = getApps()[0] ?? initializeApp(getFirebaseClientConfig(win));
  const auth = getAuth(app);
  const functions = getFunctions(app);
  const emulators = getEmulatorEndpoints(win);
  if (emulators !== null) {
    try {
      connectAuthEmulator(auth, `http://${emulators.auth.host}:${emulators.auth.port}`, {
        disableWarnings: true,
      });
    } catch {
      // Already connected.
    }
    try {
      connectFunctionsEmulator(functions, emulators.functions.host, emulators.functions.port);
    } catch {
      // Already connected.
    }
  }
  const transport = createLabReportCloudTransport({ app, auth, functions });
  win.lyfelabz = { ...(win.lyfelabz ?? {}), labReportCloud: transport };
  win.dispatchEvent(new Event(LAB_REPORT_CLOUD_READY_EVENT));
}

if (typeof window !== "undefined") {
  void install(window as WindowWithCloud).catch(() => {
    try {
      // eslint-disable-next-line no-console
      console.warn("[lyfelabz] lab report cloud saving could not start");
    } catch {
      // ignore
    }
  });
}

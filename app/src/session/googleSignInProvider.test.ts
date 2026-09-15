import { configureGoogleSignInProvider } from "./googleSignInProvider";

describe("configureGoogleSignInProvider", () => {
  it("requests Google account selection via prompt=select_account", () => {
    const calls: Record<string, string>[] = [];
    const provider = {
      setCustomParameters: (params: Record<string, string>) => {
        calls.push(params);
      },
    };

    configureGoogleSignInProvider(provider);

    expect(calls).toEqual([{ prompt: "select_account" }]);
  });

  it("calls setCustomParameters exactly once", () => {
    let callCount = 0;
    const provider = {
      setCustomParameters: () => {
        callCount += 1;
      },
    };

    configureGoogleSignInProvider(provider);

    expect(callCount).toBe(1);
  });
});

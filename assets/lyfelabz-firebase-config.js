/*
 * LyfeLabz Firebase Client Config - Injection
 *
 * Sets the public Firebase Web SDK configuration on the global that
 * app/src/firebase-config.ts (getFirebaseClientConfig) reads. The
 * Firebase Web SDK config is not a secret: access is governed by
 * Firebase Auth allowlists and the certified Firestore rules.
 *
 * Loaded by:
 *   - /app/index.html  (before the authenticated shell bundle)
 *   - /assets/lyfelabz-assessment-runtime.js  (before the active bundle)
 *
 * Host-aware injection: the STAGING Hosting site
 * (lyfelabz-staging.web.app / lyfelabz-staging.firebaseapp.com) receives the
 * lyfelabz-staging web config so Firebase Google sign-in resolves against the
 * staging Auth project; every other production host receives the byte-identical
 * lyfelabz-prod config it always has (production runtime behavior unchanged).
 * localhost is unaffected because getFirebaseClientConfig() returns the emulator
 * config before this global is read.
 *
 * Values fetched via `firebase apps:sdkconfig WEB <appId> --project <project>`.
 */
(function () {
  if (typeof window === 'undefined') return;
  if (window.__lyfelabzFirebaseConfig) return;
  var host = (window.location && window.location.hostname) || '';
  var isStaging =
    host === 'lyfelabz-staging.web.app' ||
    host === 'lyfelabz-staging.firebaseapp.com';
  window.__lyfelabzFirebaseConfig = isStaging
    ? {
        apiKey: 'AIzaSyBHtcoilhAvTiqOqN0-jIoohvCoRcDTQzs',
        authDomain: 'lyfelabz-staging.firebaseapp.com',
        projectId: 'lyfelabz-staging',
        appId: '1:293337283840:web:3db072e80f0b489d1347e5',
        messagingSenderId: '293337283840',
        storageBucket: 'lyfelabz-staging.firebasestorage.app'
      }
    : {
        apiKey: 'AIzaSyDIQrzMKo3CfSzTgVON3PtvxW2jFrDECzc',
        authDomain: 'lyfelabz-prod.firebaseapp.com',
        projectId: 'lyfelabz-prod',
        appId: '1:182791689935:web:047a9e33cc45b9567809ba',
        messagingSenderId: '182791689935',
        storageBucket: 'lyfelabz-prod.firebasestorage.app'
      };
})();

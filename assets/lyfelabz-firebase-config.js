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
 * Values fetched via `firebase apps:sdkconfig WEB <appId> --project lyfelabz-prod`.
 */
(function () {
  if (typeof window === 'undefined') return;
  if (window.__lyfelabzFirebaseConfig) return;
  window.__lyfelabzFirebaseConfig = {
    apiKey: 'AIzaSyDIQrzMKo3CfSzTgVON3PtvxW2jFrDECzc',
    authDomain: 'lyfelabz-prod.firebaseapp.com',
    projectId: 'lyfelabz-prod',
    appId: '1:182791689935:web:047a9e33cc45b9567809ba',
    messagingSenderId: '182791689935',
    storageBucket: 'lyfelabz-prod.firebasestorage.app'
  };
})();

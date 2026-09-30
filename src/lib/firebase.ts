import { initializeApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app'
import { connectAuthEmulator, getAuth, signInAnonymously, type Auth } from 'firebase/auth'
import { connectFirestoreEmulator, initializeFirestore, type Firestore } from 'firebase/firestore'

// Works both under Vite (import.meta.env) and plain Node (process.env).
const viteEnv: Record<string, string | undefined> =
  (import.meta as { env?: Record<string, string | undefined> }).env ?? {}
const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
const env = (k: string): string | undefined => viteEnv[k] ?? proc?.env?.[k]

// Emulator in dev/tests or when forced; never silently in a production build.
export const USE_EMULATOR =
  env('VITE_USE_FIREBASE_EMULATOR') === 'true' ||
  (!env('VITE_FIREBASE_API_KEY') && viteEnv.MODE !== 'production')

const config: FirebaseOptions = USE_EMULATOR
  ? {
      apiKey: 'fake-api-key',
      authDomain: 'localhost',
      projectId: env('VITE_FIREBASE_PROJECT_ID') || 'koejon-3059e',
      appId: 'fake-app-id',
    }
  : {
      apiKey: env('VITE_FIREBASE_API_KEY'),
      authDomain: env('VITE_FIREBASE_AUTH_DOMAIN'),
      projectId: env('VITE_FIREBASE_PROJECT_ID'),
      appId: env('VITE_FIREBASE_APP_ID'),
      messagingSenderId: env('VITE_FIREBASE_MESSAGING_SENDER_ID'),
      storageBucket: env('VITE_FIREBASE_STORAGE_BUCKET'),
    }

if (!USE_EMULATOR && !env('VITE_FIREBASE_API_KEY')) {
  throw new Error(
    'Missing Firebase web config: build with a filled .env.local (see .env.example)',
  )
}

export const app: FirebaseApp = initializeApp(config)
export const auth: Auth = getAuth(app)
// Force long polling: ad blockers/proxies kill the WebChannel transport
// (ERR_BLOCKED_BY_CLIENT on Listen/channel); plain XHR polling is reliable.
export const db: Firestore = initializeFirestore(app, {
  experimentalForceLongPolling: true,
})

// Emulator ports match firebase.json; override via env if needed.
const FS_PORT = Number(env('VITE_EMULATOR_FIRESTORE_PORT') || 8180)
const AUTH_PORT = Number(env('VITE_EMULATOR_AUTH_PORT') || 9199)

if (USE_EMULATOR) {
  connectFirestoreEmulator(db, '127.0.0.1', FS_PORT)
  connectAuthEmulator(auth, `http://127.0.0.1:${AUTH_PORT}`, { disableWarnings: true })
}

export function signIn(): Promise<string> {
  return signInAnonymously(auth).then((c) => c.user.uid)
}

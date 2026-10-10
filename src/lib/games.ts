import { doc, setDoc } from 'firebase/firestore'
import { auth, db, signIn } from './firebase'
import type { GameDoc } from './kjn'

export const gameRef = (id: string) => doc(db, 'games', id)

/**
 * Store a finished match. The caller keeps `id` across retries, so a write
 * that lands twice hits the same doc and the second is denied (write-once).
 * No timeout: the SDK keeps a queued write, so a timeout would only start a
 * second upload next to it. Solo may still lack a uid when it started offline.
 */
export async function saveGame(id: string, game: GameDoc): Promise<void> {
  if (!auth.currentUser) await signIn()
  await setDoc(gameRef(id), game)
}

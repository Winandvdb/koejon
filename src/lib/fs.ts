/**
 * Firestore calls with a read/write counter, so the dev build can show what a
 * tab really costs. Same signatures as `firebase/firestore` for what we use.
 *
 * The counts follow the billing rules as seen from this client:
 * - a get or a document listener snapshot from the server: 1 read
 * - a query listener: its result size on the first server snapshot (min. 1),
 *   then 1 per added or changed document
 * - snapshots from the local cache or of our own pending writes: free
 * - each document set, updated or deleted, alone or in a batch: 1 write
 * Not visible here: `get()` calls inside the security rules (the `isHost`
 * check), billed as reads on the server — about 1 per host write request.
 */
import * as fs from 'firebase/firestore'
import type {
  DocumentData,
  DocumentReference,
  DocumentSnapshot,
  Firestore,
  FirestoreError,
  Query,
  QuerySnapshot,
  SetOptions,
  Unsubscribe,
  UpdateData,
} from 'firebase/firestore'
import { writable } from 'svelte/store'

export { collection, doc } from 'firebase/firestore'
export type { DocumentReference, Unsubscribe } from 'firebase/firestore'

export const usage = writable({ reads: 0, writes: 0 })

const add = (reads: number, writes: number) => {
  if (reads || writes) usage.update((u) => ({ reads: u.reads + reads, writes: u.writes + writes }))
}

export function resetUsage(): void {
  usage.set({ reads: 0, writes: 0 })
}

export async function getDoc<T>(ref: DocumentReference<T>): Promise<DocumentSnapshot<T>> {
  const snap = await fs.getDoc(ref)
  add(1, 0)
  return snap
}

export async function setDoc<T>(ref: DocumentReference<T>, data: T, options?: SetOptions): Promise<void> {
  await (options ? fs.setDoc(ref, data as never, options) : fs.setDoc(ref, data as never))
  add(0, 1)
}

export async function updateDoc(
  ref: DocumentReference<DocumentData>,
  data: UpdateData<DocumentData>,
): Promise<void> {
  await fs.updateDoc(ref, data)
  add(0, 1)
}

export async function deleteDoc<T>(ref: DocumentReference<T>): Promise<void> {
  await fs.deleteDoc(ref)
  add(0, 1)
}

/** A write batch that counts its operations once the commit lands. */
export function writeBatch(db: Firestore) {
  const batch = fs.writeBatch(db)
  let ops = 0
  const tracked = {
    set(ref: DocumentReference<DocumentData>, data: DocumentData) {
      batch.set(ref, data)
      ops++
      return tracked
    },
    update(ref: DocumentReference<DocumentData>, data: UpdateData<DocumentData>) {
      batch.update(ref, data)
      ops++
      return tracked
    },
    delete(ref: DocumentReference<DocumentData>) {
      batch.delete(ref)
      ops++
      return tracked
    },
    async commit() {
      await batch.commit()
      add(0, ops)
    },
  }
  return tracked
}

export function onSnapshot<T>(
  ref: DocumentReference<T>,
  next: (snap: DocumentSnapshot<T>) => void,
  error?: (e: FirestoreError) => void,
): Unsubscribe
export function onSnapshot<T>(
  ref: Query<T>,
  next: (snap: QuerySnapshot<T>) => void,
  error?: (e: FirestoreError) => void,
): Unsubscribe
export function onSnapshot<T>(
  ref: DocumentReference<T> | Query<T>,
  next: (snap: never) => void,
  error?: (e: FirestoreError) => void,
): Unsubscribe {
  let first = true
  const counted = (snap: DocumentSnapshot<T> | QuerySnapshot<T>) => {
    if (!snap.metadata.fromCache && !snap.metadata.hasPendingWrites) {
      if (snap instanceof fs.QuerySnapshot) {
        const changed = snap.docChanges().filter((c) => c.type !== 'removed').length
        add(first ? Math.max(1, snap.size) : changed, 0)
      } else {
        add(1, 0)
      }
      first = false
    }
    next(snap as never)
  }
  return ref instanceof fs.DocumentReference
    ? fs.onSnapshot(ref, counted, error)
    : fs.onSnapshot(ref, counted, error)
}

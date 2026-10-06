export type Suit = 'S' | 'H' | 'D' | 'C'
export type Rank = '9' | '10' | 'J' | 'Q' | 'K' | 'A'

export interface Card {
  s: Suit
  r: Rank
}

export type Phase =
  | 'LOBBY'
  | 'DEALER_DRAW'
  | 'CUTTING'
  | 'DEALING'
  | 'BIDDING_R1'
  | 'BIDDING_R2'
  | 'DEALER_CHOICE'
  | 'PLAYING'
  | 'SCORED'
  | 'GAME_OVER'

export interface TrickCard {
  seat: number
  card: Card
}

export interface DealerDraw {
  /** Seat designated to draw for each team. */
  drawer: [number, number]
  /** Completed draws this attempt. */
  draws: TrickCard[]
  /** How many cards team A lifted (kept so B draws from the remainder). */
  packetA: number | null
  /** The shuffled deck both teams lift from this attempt. Host only. */
  deck: Card[] | null
  /** 0: team A draws, 1: team B draws, 2: done, winner picks dealer. */
  pending: 0 | 1 | 2
  winnerSeat: number | null
}

export interface Turned {
  /** Face-up card = dealer's 6th card. Proposes trump for round 1. */
  first: Card
  /** Face-down card = dealer's 5th card. Proposes trump for round 2. */
  second: Card
  secondUp: boolean
}

/** One mark on the boomke trunk. `batch` groups marks crossed in the same scoring. */
export interface BoomkeMark {
  /** 0 or 1 — flat list because Firestore does not support nested arrays. */
  team: number
  t: 'line' | 'koei'
  crossed: boolean
  /** handNumber of the hand that crossed it; 0 = not crossed */
  batch: number
}

export interface HandResult {
  playingTeam: number
  points: [number, number]
  winnerTeam: number
  /** 20-20: nobody erases lines and the next level-1 stake doubles. */
  draw: boolean
  erased: number
  kapot: boolean
  /** Koei added to the playing team (defending win). */
  koei: boolean
  level: number
  multiplier: number
}

export interface LogEvent {
  t: string
  seat?: number
  card?: Card
  suit?: Suit
  team?: number
  n?: number
}

export interface State {
  phase: Phase
  /** mulberry32 internal counter. */
  rng: number
  seed: number
  /** Completed hands counter. */
  handNumber: number
  dealer: number
  dealerDraw: DealerDraw | null
  hands: Card[][]
  turned: Turned | null
  trump: Suit | null
  /** 0 undecided, 1 first turned card, 2 second turned card. */
  level: 0 | 1 | 2
  /** Stake multiplier for level-1 stakes. */
  multiplier: number
  /** Seat that said "play" (or the dealer that chose). */
  bidder: number | null
  /** Position in the current bidding round, 0..2. */
  bidIndex: number
  /** Seat to act in PLAYING. */
  turn: number
  leader: number
  trick: TrickCard[]
  lastTrick: TrickCard[] | null
  /** The trick before lastTrick — kept so the last two tricks stay reviewable. */
  prevTrick: TrickCard[] | null
  /** Seats that confirmed the completed trick; the next lead waits for all 4. */
  trickAcks: number[]
  /** The bidder asked their partner (who leads) to open with trump. */
  troefkeAsked: boolean
  tricksPlayed: number
  tricksWon: [number, number]
  /** Cards of the tricks each team won (each trick shuffled); stacked into the next deck. */
  piles: [Card[], Card[]]
  points: [number, number]
  lines: [number, number]
  /** All marks on the boomke (crossed ones included), team 0 marks first, oldest first. */
  marks: BoomkeMark[]
  koeien: [number, number]
  lastResult: HandResult | null
  /** Match winner team (0/1) once a team reached 0 lines. */
  winner: number | null
  log: LogEvent[]
}

export type Action =
  | { type: 'start'; seat: number }
  | { type: 'draw'; seat: number; n: number }
  | { type: 'cut'; seat: number; n: number }
  | { type: 'chooseDealer'; seat: number; dealer: number }
  | { type: 'deal'; seat: number }
  | { type: 'bid'; seat: number; play: boolean }
  | { type: 'choose'; seat: number; suit: Suit | null }
  | { type: 'play'; seat: number; card: Card }
  | { type: 'ack'; seat: number }
  | { type: 'troefke'; seat: number }
  | { type: 'next'; seat: number }

export const START_LINES = 13

import { derived, writable } from 'svelte/store'
import type { Card, LogEvent, Suit } from '../engine'

export type Lang = 'nl' | 'en'

const dict = {
  nl: {
    title: 'Koejonnen',
    nickname: 'Bijnaam',
    nicknamePh: 'Je naam…',
    createRoom: 'Nieuwe kamer',
    joinRoom: 'Meedoen',
    codePh: 'Kamercode',
    roomCode: 'Kamercode',
    lobby: 'Lobby',
    addBot: 'Bot toevoegen',
    remove: 'Weg',
    shuffle: 'Schud zitplaatsen',
    start: 'Start',
    leave: 'Verlaat',
    waitingHost: 'Wachten op de host…',
    needFour: '4 spelers nodig om te starten',
    roomNotFound: 'Kamer niet gevonden',
    roomFull: 'Kamer is vol',
    roomStarted: 'Spel is al begonnen',
    you: 'jij',
    bot: 'bot',
    empty: 'leeg',
    teamA: 'Team A',
    teamB: 'Team B',
    drawForDealer: 'Trekken voor eerste deler',
    draw: 'Trek',
    drawsNow: 'trekt een pakje…',
    chooseDealer: 'Kies de eerste deler',
    deal: 'Deel',
    dealWait: 'Deler deelt…',
    play: 'Ik ga',
    pass: 'Pas',
    dealerChoice: 'Deler kiest',
    trump: 'Troef',
    stake: 'Inzet',
    level: 'Stap',
    turnedCard: 'Getoonde kaart',
    secondCard: 'Tweede kaart',
    tricks: 'Slagen',
    points: 'Punten',
    yourTurn: 'Jij bent aan de beurt',
    waiting: 'Wachten…',
    boomke: 'Boomke',
    koei: 'Koei',
    kapot: 'Kapot',
    nextHand: 'Volgende hand',
    gameOver: 'Einde spel',
    wins: 'wint',
    playingTeam: 'Spelend team',
    hostLeft: 'Host is weggevallen — het spel kan niet verder.',
    rules: 'Regels',
    close: 'Sluiten',
    noUnderbuy: 'niet onderkopen',
    handHidden: 'Deler ziet de kaarten pas na het bieden',
    newMatch: 'Nieuw spel',
    scored: 'Uitslag',
    erased: 'weggestreept',
    connection: 'Verbinding…',
  },
  en: {
    title: 'Koejonnen',
    nickname: 'Nickname',
    nicknamePh: 'Your name…',
    createRoom: 'Create room',
    joinRoom: 'Join room',
    codePh: 'Room code',
    roomCode: 'Room code',
    lobby: 'Lobby',
    addBot: 'Add bot',
    remove: 'Remove',
    shuffle: 'Shuffle seats',
    start: 'Start',
    leave: 'Leave',
    waitingHost: 'Waiting for the host…',
    needFour: '4 players needed to start',
    roomNotFound: 'Room not found',
    roomFull: 'Room is full',
    roomStarted: 'Game already started',
    you: 'you',
    bot: 'bot',
    empty: 'empty',
    teamA: 'Team A',
    teamB: 'Team B',
    drawForDealer: 'Draw for first dealer',
    draw: 'Draw',
    drawsNow: 'draws a packet…',
    chooseDealer: 'Choose the first dealer',
    deal: 'Deal',
    dealWait: 'Dealer is dealing…',
    play: 'Play',
    pass: 'Pass',
    dealerChoice: 'Dealer chooses',
    trump: 'Trump',
    stake: 'Stake',
    level: 'Level',
    turnedCard: 'Turned card',
    secondCard: 'Second card',
    tricks: 'Tricks',
    points: 'Points',
    yourTurn: 'Your turn',
    waiting: 'Waiting…',
    boomke: 'Boomke',
    koei: 'Koei',
    kapot: 'Kapot',
    nextHand: 'Next hand',
    gameOver: 'Game over',
    wins: 'wins',
    playingTeam: 'Playing team',
    hostLeft: 'Host left — the game cannot continue.',
    rules: 'Rules',
    close: 'Close',
    noUnderbuy: 'no underbuy',
    handHidden: 'The dealer sees their cards after bidding',
    newMatch: 'New match',
    scored: 'Result',
    erased: 'erased',
    connection: 'Connecting…',
  },
} as const

export type Dict = (typeof dict)['nl']

export const lang = writable<Lang>('nl')
export const t = derived(lang, (l) => dict[l])

export const SUIT_GLYPH: Record<Suit, string> = { S: '♠', H: '♥', D: '♦', C: '♣' }

export function suitName(s: Suit, l: Lang): string {
  const names = {
    nl: { S: 'schoppen', H: 'harten', D: 'ruiten', C: 'klaver' },
    en: { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' },
  } as const
  return names[l][s]
}

export function cardText(c: Card): string {
  return `${SUIT_GLYPH[c.s]}${c.r}`
}

/** Render a log event to a line of text. */
export function logText(ev: LogEvent, l: Lang, name: (seat: number) => string): string {
  const seat = ev.seat !== undefined ? name(ev.seat) : ''
  const card = ev.card ? cardText(ev.card) : ''
  const team = ev.team !== undefined ? (ev.team === 0 ? 'A' : 'B') : ''
  const nl = l === 'nl'
  switch (ev.t) {
    case 'start':
      return nl ? 'Spel gestart' : 'Game started'
    case 'draw':
      return nl ? `${seat} trekt ${card}` : `${seat} draws ${card}`
    case 'draw-tie':
      return nl ? 'Gelijk — opnieuw trekken' : 'Tie — draw again'
    case 'draw-win':
      return nl ? `${seat} wint de trekking` : `${seat} wins the draw`
    case 'first-dealer':
      return nl ? `${seat} is de eerste deler` : `${seat} is the first dealer`
    case 'deal':
      return nl ? `${seat} deelt — ${card} omgedraaid` : `${seat} deals — ${card} turned`
    case 'pass':
      return nl ? `${seat} past` : `${seat} passes`
    case 'play-call':
      return nl
        ? `${seat} gaat — troef: ${SUIT_GLYPH[ev.suit!]}`
        : `${seat} plays — trump: ${SUIT_GLYPH[ev.suit!]}`
    case 'dealer-pass':
      return nl ? 'Deler past' : 'Dealer passes'
    case 'all-pass':
      return nl ? `Alles gepast — inzet ×${ev.n}` : `All passed — stake ×${ev.n}`
    case 'second-card':
      return nl ? `Tweede kaart omgedraaid: ${card}` : `Second card turned: ${card}`
    case 'card':
      return nl ? `${seat} speelt ${card}` : `${seat} plays ${card}`
    case 'trick':
      return nl ? `${seat} wint de slag` : `${seat} wins the trick`
    case 'score':
      return nl ? `Team ${team} streept ${ev.n} weg` : `Team ${team} erases ${ev.n}`
    case 'game-over':
      return nl ? `Team ${team} wint het spel` : `Team ${team} wins the game`
    default:
      return ev.t
  }
}

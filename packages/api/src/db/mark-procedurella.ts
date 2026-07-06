/**
 * Ordförande-detektion: hittar procedurella anföranden (mötesledning) så att
 * debattmetriker inte räknar presidiets "Tack X, ordet går till Y" som
 * debattaktivitet (docs/ANALYS-2026-07.md, punkt 17).
 *
 * KF:s presidium (ordförande + vice) lägger ett kort inlägg mellan i princip
 * varje riktigt anförande — i ett debattärende står mötesledaren för ~hälften
 * av alla inlägg, med median-textlängd långt under ett riktigt anförande.
 * Talarattributionen i yttrandeprotokollet är alltså KORREKT; inläggen är
 * bara inte debatt.
 *
 * Regel, per (datum, ärende) med ≥3 distinkta talare (kravet gör att ett
 * kort replikskifte mellan två debattörer aldrig felmarkeras — i ett lett
 * ärende är mötesledaren alltid en tredje röst). En talare med ≥3 inlägg
 * och median-textlängd < 300 tecken leder mötet om ETT av två dominanskrav
 * håller:
 * 1. ≥35% av ärendets alla inlägg (vanliga debattärenden), ELLER
 * 2. minst dubbelt så många inlägg som den flitigaste "riktiga" talaren
 *    (median ≥ 300) — fångar maratonärenden (budgetdebatter) där presidiet
 *    roterar ordförandeskapet och ingen enskild ledare når 35%, men var och
 *    en ligger 10× över närmaste debattör med en bråkdel av textlängden.
 * Alla den detekterade mötesledarens inlägg i ärendet markeras.
 *
 * Andra passet: rena administrationspunkter (justering, upprop, mötets
 * öppnande) har ofta mötesledaren som ENDA talare och fångas inte ovan —
 * ett ärende vars enda talare redan detekterats som mötesledare samma datum
 * markeras också, om alla inläggen är < 600 tecken.
 */

export interface Utterance {
  /** Anropar-definierad nyckel (edge-uuid, nod-id, …) som returneras vid träff */
  key: string
  datum: string
  ärende: string | number
  talare: string
  textLen: number
}

const MIN_INLÄGG = 3
const MIN_ANDEL = 0.35
const MAX_MEDIAN_TEXTLEN = 300
const MIN_DISTINKTA_TALARE = 3
const MAX_SOLO_TEXTLEN = 600
const DOMINANS_FAKTOR = 2

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

export function detectProcedurella(utterances: Utterance[]): Set<string> {
  const marked = new Set<string>()

  const byDatum = new Map<string, Map<string, Utterance[]>>()
  for (const u of utterances) {
    let ärenden = byDatum.get(u.datum)
    if (!ärenden) byDatum.set(u.datum, (ärenden = new Map()))
    const k = String(u.ärende)
    const grupp = ärenden.get(k)
    if (grupp) grupp.push(u)
    else ärenden.set(k, [u])
  }

  for (const ärenden of byDatum.values()) {
    const mötesledare = new Set<string>()

    for (const inlägg of ärenden.values()) {
      const perTalare = new Map<string, Utterance[]>()
      for (const u of inlägg) {
        const egna = perTalare.get(u.talare)
        if (egna) egna.push(u)
        else perTalare.set(u.talare, [u])
      }
      if (perTalare.size < MIN_DISTINKTA_TALARE) continue
      let flitigasteRiktiga = 0
      for (const egna of perTalare.values()) {
        if (median(egna.map((u) => u.textLen)) >= MAX_MEDIAN_TEXTLEN) {
          flitigasteRiktiga = Math.max(flitigasteRiktiga, egna.length)
        }
      }
      for (const [talare, egna] of perTalare) {
        if (egna.length < MIN_INLÄGG) continue
        if (median(egna.map((u) => u.textLen)) >= MAX_MEDIAN_TEXTLEN) continue
        const högAndel = egna.length / inlägg.length >= MIN_ANDEL
        const dominerar =
          flitigasteRiktiga > 0 && egna.length >= DOMINANS_FAKTOR * flitigasteRiktiga
        if (högAndel || dominerar) {
          mötesledare.add(talare)
          for (const u of egna) marked.add(u.key)
        }
      }
    }

    for (const inlägg of ärenden.values()) {
      const talare = new Set(inlägg.map((u) => u.talare))
      if (
        talare.size === 1 &&
        mötesledare.has(inlägg[0].talare) &&
        inlägg.every((u) => u.textLen < MAX_SOLO_TEXTLEN)
      ) {
        for (const u of inlägg) marked.add(u.key)
      }
    }
  }

  return marked
}

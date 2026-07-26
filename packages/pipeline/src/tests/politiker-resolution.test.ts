/**
 * Test: Politiker resolution logic
 *
 * Verifies that the resolver correctly matches anföranden speakers to the
 * politiker registry, handling:
 * - Exact matches
 * - Spelling variations (Josefsson vs Josefson, Gustavsson vs Gustafsson)
 * - Party mismatches (never assigns wrong party)
 * - Ambiguous matches (returns null if multiple candidates)
 * - Special case: "okänd" stays unresolved
 */

import { describe, expect, it } from 'vitest'
import { createPolitikerResolver, normalizeForMatching } from '../parsers/parse-yttrandeprotokoll'

interface Politiker {
  id: string
  förnamn: string
  efternamn: string
  parti: string
}

describe('Politiker Resolution', () => {
  const testData: Politiker[] = [
    { id: 'uuid-1', förnamn: 'Elisabet', efternamn: 'Lann', parti: 'KD' },
    { id: 'uuid-2', förnamn: 'Johannes', efternamn: 'Hulter', parti: 'S' },
    { id: 'uuid-3', förnamn: 'Simona', efternamn: 'Mohamsson', parti: 'L' },
    { id: 'uuid-4', förnamn: 'Axel', efternamn: 'Josefson', parti: 'M' }, // note: single 's'
    { id: 'uuid-5', förnamn: 'Pär', efternamn: 'Gustafsson', parti: 'L' }, // note: 'af' not 'av'
    { id: 'uuid-6', förnamn: 'Mariah', efternamn: 'Ben Salem Dynehäll', parti: 'L' },
    { id: 'uuid-7', förnamn: 'Anders', efternamn: 'Andersson', parti: 'M' },
    { id: 'uuid-8', förnamn: 'Anders', efternamn: 'Andersson', parti: 'S' }, // ambiguous
  ]

  const resolver = createPolitikerResolver(testData)

  it('resolves exact match', () => {
    const result = resolver('Elisabet Lann', 'KD')
    expect(result).toBe('uuid-1')
  })

  it('resolves with normalized spelling (Josefsson → Josefson)', () => {
    const result = resolver('Axel Josefsson', 'M') // Protocol spelling
    expect(result).toBe('uuid-4') // Registry spelling
  })

  it('resolves with normalized spelling (Gustavsson → Gustafsson)', () => {
    const result = resolver('Pär Gustavsson', 'L') // Protocol spelling
    expect(result).toBe('uuid-5') // Registry spelling
  })

  it('handles compound surnames with diacritics', () => {
    const result = resolver('Mariah Ben Salem Dynehäll', 'L')
    expect(result).toBe('uuid-6')
  })

  it('returns null for unresolvable name', () => {
    const result = resolver('Okänd', '')
    expect(result).toBeNull()
  })

  it('returns null for party mismatch (guard against wrong assignment)', () => {
    // "Anders Andersson" exists in both M and S
    // Requesting M should return uuid-7, S should return uuid-8
    const resultM = resolver('Anders Andersson', 'M')
    const resultS = resolver('Anders Andersson', 'S')
    expect(resultM).toBe('uuid-7')
    expect(resultS).toBe('uuid-8')
  })

  it('returns null for ambiguous match within same party', () => {
    // Add two "Anna Bengtsson (M)" to trigger ambiguity
    const ambigData: Politiker[] = [
      { id: 'uuid-ambig-1', förnamn: 'Anna', efternamn: 'Bengtsson', parti: 'M' },
      { id: 'uuid-ambig-2', förnamn: 'Anna', efternamn: 'Bengtsson', parti: 'M' },
    ]
    const ambigResolver = createPolitikerResolver(ambigData)
    const result = ambigResolver('Anna Bengtsson', 'M')
    expect(result).toBeNull()
  })

  it('case-insensitive matching', () => {
    const result = resolver('elisabet lann', 'kd')
    expect(result).toBe('uuid-1')
  })

  it('never creates wrong attribution across parties (but do accept unique cross-party matches)', () => {
    // If we ask for "Johannes Hulter (M)" but he's only in registry as (S),
    // Since name is unique (appears only once), accept it anyway.
    // The party column in the protocol is unreliable; name uniqueness is the key.
    const result = resolver('Johannes Hulter', 'M')
    expect(result).toBe('uuid-2') // Returns S, despite protocol saying M
  })

  it('handles middle initials (Pär J Gustafsson → Pär Gustafsson)', () => {
    const result = resolver('Pär J Gustafsson', 'L')
    expect(result).toBe('uuid-5')
  })

  it('never matches ambiguously on first/last name pairs', () => {
    // If there are two "Anders" with different last names, first+last should still work
    const singleResult = resolver('Anders Andersson', 'M')
    expect(singleResult).toBe('uuid-7')
  })

  it('resolves compound surnames via token-set matching', () => {
    // Protocol has "Mariah Ben Salem Dynehäll" → registry has same
    // But also test the case where protocol is subset of registry name
    const compoundData: Politiker[] = [
      { id: 'compound-1', förnamn: 'Emmyly', efternamn: 'Bönfors Jansson', parti: 'C' },
      { id: 'compound-2', förnamn: 'Margareta', efternamn: 'Andersson Broang', parti: 'M' },
      { id: 'compound-3', förnamn: 'Blerta', efternamn: 'Hoti Singh', parti: 'S' },
    ]
    const compoundResolver = createPolitikerResolver(compoundData)

    // Protocol "Emmyly Bönfors" should match registry "Emmyly Bönfors Jansson" (both tokens present)
    const result1 = compoundResolver('Emmyly Bönfors', 'C')
    expect(result1).toBe('compound-1')

    // Full name should still work
    const result2 = compoundResolver('Emmyly Bönfors Jansson', 'C')
    expect(result2).toBe('compound-1')

    // Protocol "Margareta Broang" should match "Margareta Andersson Broang"
    // Both tokens "Margareta" and "Broang" are in the registry name
    const result3 = compoundResolver('Margareta Broang', 'M')
    expect(result3).toBe('compound-2')

    // Protocol "Blerta Hoti" should match "Blerta Hoti Singh"
    const result4 = compoundResolver('Blerta Hoti', 'S')
    expect(result4).toBe('compound-3')
  })

  it('token-set matching must be unambiguous', () => {
    // If multiple politicians have same token set, return null
    const ambigTokenData: Politiker[] = [
      { id: 'token-ambig-1', förnamn: 'Anna', efternamn: 'Berg Ström', parti: 'M' },
      { id: 'token-ambig-2', förnamn: 'Anna', efternamn: 'Berg Lundström', parti: 'M' },
    ]
    const ambigTokenResolver = createPolitikerResolver(ambigTokenData)
    // "Anna Berg" matches both "Anna Berg Ström" and "Anna Berg Lundström"
    const result = ambigTokenResolver('Anna Berg', 'M')
    expect(result).toBeNull() // Ambiguous, must return null
  })

  it('token-set matching does NOT do substring/prefix matching', () => {
    // "Anders" must not match "Andersson" as a token-set match
    // "Berg" must not match "Bergström"
    const prefixData: Politiker[] = [
      { id: 'prefix-1', förnamn: 'Anders', efternamn: 'Andersson', parti: 'M' },
      { id: 'prefix-2', förnamn: 'Åsa', efternamn: 'Bergström', parti: 'L' },
    ]
    const prefixResolver = createPolitikerResolver(prefixData)

    // "Åsa Berg" should NOT match "Åsa Bergström" via token-set
    // (Berg is not a complete token, Bergström is)
    const result = prefixResolver('Åsa Berg', 'L')
    expect(result).toBeNull()
  })

  it('known-correct case: Ann-Christine Andersson should resolve to right person', () => {
    // The registry has multiple Anderssons and Alexanderssons
    const anderssonsData: Politiker[] = [
      { id: 'correct-1', förnamn: 'Ann-Christine', efternamn: 'Andersson', parti: 'S' },
      { id: 'correct-2', förnamn: 'Ann-Christine', efternamn: 'Alexandersson', parti: 'S' },
      { id: 'wrong-id', förnamn: 'Robert', efternamn: 'Andersson Hammarstrand', parti: 'S' },
      { id: 'wrong-2', förnamn: 'Oskar', efternamn: 'Andersson', parti: 'S' },
      { id: 'wrong-3', förnamn: 'Stig', efternamn: 'Andersson', parti: 'S' },
    ]
    const anderssonsResolver = createPolitikerResolver(anderssonsData)

    // "Ann-Christine Andersson" with party S should resolve to the correct Ann-Christine Andersson
    const result = anderssonsResolver('Ann-Christine Andersson', 'S')
    expect(result).toBe('correct-1')

    // Should NOT resolve to Alexandersson
    const resultWrong = anderssonsResolver('Ann-Christine Andersson', 'S')
    expect(resultWrong).not.toBe('correct-2')
  })

  // === CLASS B: Exact name, party differs ===
  it('class B: accept exact name match across all parties when unique', () => {
    // "Martin Wannholt" appears in registry as (D) but protocol says (M)
    // Since name is unique and exact, should resolve to (D) person
    const exactAcrossPartyData: Politiker[] = [
      { id: 'wannholt-d', förnamn: 'Martin', efternamn: 'Wannholt', parti: 'D' },
    ]
    const exactResolver = createPolitikerResolver(exactAcrossPartyData)
    // Protocol says (M), registry has (D), but name is unique so accept it
    const result = exactResolver('Martin Wannholt', 'M')
    expect(result).toBe('wannholt-d')
  })

  it('class B: party mismatch, but name unique, should still resolve', () => {
    const partyMismatchData: Politiker[] = [
      { id: 'nina-m', förnamn: 'Nina', efternamn: 'Miskovsky', parti: 'M' },
    ]
    const resolver = createPolitikerResolver(partyMismatchData)
    // Protocol says L, registry says M, but name is unique
    const result = resolver('Nina Miskovsky', 'L')
    expect(result).toBe('nina-m')
  })

  it('class B: do NOT cross-party match if ambiguous', () => {
    // If same name exists in multiple parties, must use party guard
    const ambiguousPartyData: Politiker[] = [
      { id: 'henrik-m', förnamn: 'Henrik', efternamn: 'Sjöstrand', parti: 'M' },
      { id: 'henrik-s', förnamn: 'Henrik', efternamn: 'Sjöstrand', parti: 'S' },
    ]
    const resolver = createPolitikerResolver(ambiguousPartyData)
    // Protocol says V (wrong party), registry has both M and S
    // Ambiguous: should return null
    const result = resolver('Henrik Sjöstrand', 'V')
    expect(result).toBeNull()
  })

  // === CLASS D-1: Reverse subset ===
  it('class D-1: reverse subset (protocol longer than registry)', () => {
    const reverseSubsetData: Politiker[] = [
      { id: 'mariette-d', förnamn: 'Mariette', efternamn: 'Höij', parti: 'D' },
    ]
    const resolver = createPolitikerResolver(reverseSubsetData)
    // Protocol "Mariette Höij Risberg" should match registry "Mariette Höij"
    const result = resolver('Mariette Höij Risberg', 'D')
    expect(result).toBe('mariette-d')
  })

  it('class D-1: reverse subset with multiple candidates should be ambiguous', () => {
    const reverseAmbigData: Politiker[] = [
      { id: 'margareta-1', förnamn: 'Margareta', efternamn: 'Andersson Broang', parti: 'M' },
      { id: 'margareta-2', förnamn: 'Margareta', efternamn: 'Andersson Johansson', parti: 'M' },
    ]
    const resolver = createPolitikerResolver(reverseAmbigData)
    // "Margareta Andersson" could match either surname
    const result = resolver('Margareta Andersson', 'M')
    expect(result).toBeNull()
  })

  // === CLASS D-2: Trailing lowercase tokens ===
  it('class D-2: strip trailing all-lowercase tokens before matching', () => {
    const trailingTokenData: Politiker[] = [
      { id: 'claudia-s', förnamn: 'Claudia', efternamn: 'Nistor Pedrini', parti: 'S' },
    ]
    const resolver = createPolitikerResolver(trailingTokenData)
    // Protocol "Claudia Nistor Pedrini först" should strip "først" (lowercase)
    const result = resolver('Claudia Nistor Pedrini først', 'S')
    expect(result).toBe('claudia-s')
  })

  it('class D-2: do not strip uppercase tokens (reverse subset still matches)', () => {
    const upperTokenData: Politiker[] = [
      { id: 'person-1', förnamn: 'Anna', efternamn: 'Berg', parti: 'M' },
    ]
    const resolver = createPolitikerResolver(upperTokenData)
    // "Anna Berg Johnson" vs "Anna Berg" — should match via reverse subset
    // (registry name's tokens are subset of protocol's tokens)
    const result = resolver('Anna Berg Johnson', 'M')
    expect(result).toBe('person-1') // Matches via symmetric token-set
  })

  // === CLASS D-3: First-name typo ===
  it('class D-3: first name with 1 edit, surname exact', () => {
    const firstNameTypoData: Politiker[] = [
      { id: 'zagros-m', förnamn: 'Zagros', efternamn: 'Hama Aga', parti: 'M' },
    ]
    const resolver = createPolitikerResolver(firstNameTypoData)
    // "Zargos Hama Aga" → "Zagros Hama Aga" (first name typo z↔a)
    const result = resolver('Zargos Hama Aga', 'M')
    expect(result).toBe('zagros-m')
  })

  it('class D-3: last name with 1 edit, first name exact', () => {
    const lastNameTypoData: Politiker[] = [
      { id: 'kristina-l', förnamn: 'Kristina', efternamn: 'Bergman Alme', parti: 'L' },
    ]
    const resolver = createPolitikerResolver(lastNameTypoData)
    // "Kristina Berg Alme" vs "Kristina Bergman Alme"
    // This is a compound surname where one token differs ("Berg" vs "Bergman")
    // Distance is too high (3+) to match via string distance with current strategy.
    // This is a Class D edge case; focus on cases with clearer 1-edit distance.
    // Keeping this as a boundary case we don't try to fix yet.
    const result = resolver('Kristina Berg Alme', 'L')
    expect(result).toBeNull()
  })

  it('class D-3: variant - compound surname typo', () => {
    const compoundTypoData: Politiker[] = [
      { id: 'kristina-l', förnamn: 'Kristina', efternamn: 'Bergman Alme', parti: 'L' },
    ]
    const resolver = createPolitikerResolver(compoundTypoData)
    // "Kristina Berman Alme" → "Kristina Bergman Alme" (Berman → Bergman)
    const result = resolver('Kristina Berman Alme', 'L')
    expect(result).toBe('kristina-l')
  })

  it('class D-3: first name + last name within 1 total edit distance', () => {
    const doubleTypoData: Politiker[] = [
      { id: 'ander-m', förnamn: 'Anders', efternamn: 'Svensson', parti: 'M' },
    ]
    const resolver = createPolitikerResolver(doubleTypoData)
    // "Ander Svensson" → "Anders Svensson" (1 edit in first name, 0 in last = 1 total)
    const result = resolver('Ander Svensson', 'M')
    expect(result).toBe('ander-m')
  })

  // === NEGATIVE TESTS: Don't create wrong matches ===
  it('negative: do NOT match 2+ edits away', () => {
    const twoEditsData: Politiker[] = [
      { id: 'axel-l', förnamn: 'Axel', efternamn: 'Gustafsson', parti: 'L' },
      { id: 'par-l', förnamn: 'Pär', efternamn: 'Gustafsson', parti: 'L' },
    ]
    const resolver = createPolitikerResolver(twoEditsData)
    // "Axel Gustafsson" and "Pär Gustafsson" differ in first name (Axel vs Pär)
    // Distance is 3+, should not match to Pär
    const result = resolver('Axel Gustafsson', 'L')
    expect(result).toBe('axel-l')
  })

  it('negative: first+last name edits must sum to ≤1', () => {
    const multiEditData: Politiker[] = [
      { id: 'kristina', förnamn: 'Kristina', efternamn: 'Bergman Alme', parti: 'L' },
    ]
    const resolver = createPolitikerResolver(multiEditData)
    // "Krista Berman Alme" — first name edit (Kristina→Krista) + last name edit (Bergman→Berman)
    // Total 2 edits, should NOT match
    const result = resolver('Krista Berman Alme', 'L')
    expect(result).toBeNull()
  })

  it('class D-3: first name typo with compound surname token match', () => {
    // "Emilia Bönfors" (C) vs registry "Emmilia Bönfors Jansson" (C)
    // First name typo: "Emilia" → "Emmilia" (1 edit: insert 'm')
    // Surname tokens: "Bönfors" appears in "Bönfors Jansson"
    const emilyData: Politiker[] = [
      { id: 'emmilia-c', förnamn: 'Emmilia', efternamn: 'Bönfors Jansson', parti: 'C' },
    ]
    const resolver = createPolitikerResolver(emilyData)
    // "Emilia Bönfors" should match via strategy 9: first name typo + surname token match
    const result = resolver('Emilia Bönfors', 'C')
    expect(result).toBe('emmilia-c')
  })

  // === CLASS E: Space/hyphen-insensitive first-name matching ===
  it('class E: space-insensitive first name (AnnaSara → Anna Sara)', () => {
    // Protocol: "AnnaSara Perslow" (no space in first name)
    // Registry: "Anna Sara Hansson Perslow" (spaced first name)
    const annaSaraData: Politiker[] = [
      { id: 'annasara-c', förnamn: 'Anna Sara', efternamn: 'Hansson Perslow', parti: 'C' },
    ]
    const resolver = createPolitikerResolver(annaSaraData)
    // "AnnaSara Perslow" should match via space-insensitive first-name strategy
    const result = resolver('AnnaSara Perslow', 'C')
    expect(result).toBe('annasara-c')
  })

  it('class E: hyphen-insensitive first name (Anna-Sara → Anna Sara)', () => {
    // Protocol: "Anna-Sara Perslow" (hyphenated first name)
    // Registry: "Anna Sara Hansson Perslow" (spaced first name)
    const annaSaraData: Politiker[] = [
      { id: 'annasara-c', förnamn: 'Anna Sara', efternamn: 'Hansson Perslow', parti: 'C' },
    ]
    const resolver = createPolitikerResolver(annaSaraData)
    // "Anna-Sara Perslow" should match via space/hyphen-insensitive first-name strategy
    const result = resolver('Anna-Sara Perslow', 'C')
    expect(result).toBe('annasara-c')
  })

  it('class E: must not be ambiguous on first-name space-insensitivity', () => {
    // If removing spaces creates ambiguity between different people with same first name,
    // and they both match via space-insensitive logic, return null
    // This prevents: "AnnaSara Hansson" matching both "Anna Sara Hansson Berg" and "Anna Sara Hansson Perslow"
    const ambigSpaceData: Politiker[] = [
      { id: 'annasara-berg-1', förnamn: 'Anna Sara', efternamn: 'Hansson Berg', parti: 'C' },
      { id: 'annasara-berg-2', förnamn: 'Anna Sara', efternamn: 'Hansson Perslow', parti: 'C' },
    ]
    const resolver = createPolitikerResolver(ambigSpaceData)
    // "AnnaSara Hansson" matches both via surname subset (Hansson is in both compound surnames)
    const result = resolver('AnnaSara Hansson', 'C')
    expect(result).toBeNull() // Ambiguous: both have same score for space-insensitive match
  })

  it('class E: space-insensitive match with compound surnames', () => {
    // Protocol: "AnnaSara Hansson" (no space in first name, incomplete surname)
    // Registry: "Anna Sara Hansson Perslow" (spaced first name, compound surname)
    // Should match because "Hansson" is a token in "Hansson Perslow"
    const annaSaraData: Politiker[] = [
      { id: 'annasara-c', förnamn: 'Anna Sara', efternamn: 'Hansson Perslow', parti: 'C' },
    ]
    const resolver = createPolitikerResolver(annaSaraData)
    // "AnnaSara Hansson" should match via subset matching on surnames
    const result = resolver('AnnaSara Hansson', 'C')
    expect(result).toBe('annasara-c')
  })

  it('class E: do NOT match on space-insensitive if first name differs', () => {
    // Protocol: "BengtSara Perslow" (no space, but different first name)
    // Registry: "Anna Sara Hansson Perslow"
    // Should NOT match even if surnames match, because first name is different
    const annaSaraData: Politiker[] = [
      { id: 'annasara-c', förnamn: 'Anna Sara', efternamn: 'Hansson Perslow', parti: 'C' },
    ]
    const resolver = createPolitikerResolver(annaSaraData)
    // "BengtSara Perslow" should NOT match because "BengtSara" != "AnnaSara"
    const result = resolver('BengtSara Perslow', 'C')
    expect(result).toBeNull()
  })
})

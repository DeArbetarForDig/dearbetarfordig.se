# Спецификация: поимённые голосования из KS-протоколов

*Составлено 2026-07-02 для реализации в следующей сессии. Пункт 12 в [ANALYS-2026-07.md](ANALYS-2026-07.md).*

## Цель

KS-протоколы записывают результаты поимённых голосований **прозой в тексте параграфа** (секция «Omröstning»), а не отдельными voteringsbilagor, как КФ. Сейчас `parse-protokoll-ks.ts` эту секцию игнорирует — голоса теряются, хотя видны в сыром `fulltext` на страницах beslut. Задача: извлечь их в тот же структурированный формат, что у КФ (`röstade_*`-рёбра + `votering`-счётчики), чтобы API, фронтенд и метрики (Rice Index) подхватили данные без изменений.

**Объём данных:** 51 KS-протокол в `.tmp/ks-protokoll-*.pdf` (2024-01 … 2026-06), в них **224 секции Omröstning** ≈ 2 900 индивидуальных голосов (13 голосующих в КС).

## Исходные данные

- PDF лежат в `.tmp/ks-protokoll-YYYY-MM-DD.pdf` (директория **gitignored** — если файлов нет, перекачать через `packages/pipeline/src/scrapers/handlingar-ks.ts` / batch-скрипт `batch-reparse-protokoll-ks.ts`)
- Текущий парсер: `packages/pipeline/src/parsers/parse-protokoll-ks.ts` → `data/graf/ks-{datum}.json` (nodes + edges)
- Извлечение текста: `pdftotext "<pdf>" -` (**без** `-layout` — так сейчас в KS-парсере; для прозы это правильно)

## Анатомия секции Omröstning (все вариации зафиксированы на реальных PDF)

Базовая структура внутри текста параграфа:

```
Propositionsordning
Ordföranden … ställer propositioner … Omröstning begärs.

Omröstning

Godkänd voteringsproposition: ”Ja för avslag och Nej för bifall till yrkandet från
L, M, D, KD och SD.”
Daniel Bernmar (V), Viktoria Tryggvadottir Rolka (S), Blerta Hoti Singh (S),
Jenny Broman (V), Karin Pleijel (MP), tjänstgörande ersättaren Johannes Hulter (S) och
ordföranden Jonas Attenius (S) röstar Ja (7).
Axel Josefson (M), Hampus Magnusson (M), Martin Wannholt (D),
Jörgen Fogelklou (SD), Axel Darvik (L) och Dan-Ove Marcelind (KD) röstar Nej (6).
```

### Вариации, которые парсер обязан обрабатывать

| # | Вариация | Реальный пример |
|---|---|---|
| 1 | Кавычки двух типов | `”…”` (typographic) и `"…"` (straight) — встречаются оба |
| 2 | Пропозиция «Ja = avslag» | `"Ja för avslag och Nej för bifall till tilläggsyrkande från SD."` — **Ja означает голос ПРОТИВ предложения** |
| 3 | Пропозиция «Ja = bifall» | `"Ja för bifall och Nej för avslag på stadsledningskontorets förslag."` |
| 4 | Дуэль двух yrkanden | `"Ja för bifall till Jonas Attenius yrkande och Nej för bifall till Axel Josefsons yrkande."` — нет «за/против», есть выбор между альтернативами |
| 5 | Воздержавшиеся | `Axel Josefson (M) och Hampus Magnusson (M) avstår från att rösta (2).` |
| 6 | Префикс ед. числа | `tjänstgörande ersättaren Johannes Hulter (S)` |
| 7 | Префикс мн. числа — относится к НЕСКОЛЬКИМ следующим именам | `tjänstgörande ersättarna Johannes Hulter (S) och Marie Brynolfsson (V)` |
| 8 | `ordföranden` перед именем | `och ordföranden Jonas Attenius (S) röstar Ja (7).` |
| 9 | Разделители в перечислении | запятая, `och`, `samt` — в одном списке могут быть все три |
| 10 | Перенос строки ВНУТРИ имени | `Viktoria\nTryggvadottir Rolka (S)` — нельзя парсить построчно |
| 11 | Page-header разрывает секцию | между `Omröstning` и пропозицией может вклиниться `Göteborgs Stad Kommunstyrelsen protokoll`, `Protokoll nr 13`, `Sammanträdesdatum: …`, `NN (NN)` (номер страницы) |
| 12 | Не-голосование рядом | `deltar inte i beslutet`, `Jäv: … deltar inte i handläggningen` — НЕ путать с avstår; фиксировать отдельно или игнорировать |

**Важно:** чистку page-артефактов делать ДО матчинга — регексы для этого уже есть в `parse-protokoll-ks.ts` (блок «Clean fulltext», строки ~117-123). Парсить votering из уже очищенного `fulltext` — самый простой путь.

## Дизайн решения

### Место в коде

Расширить `parseParagrafer()` в `parse-protokoll-ks.ts` (текст параграфа уже изолирован, чистка уже есть) — новая функция `parseOmröstning(fulltext: string)`. Отдельный файл-парсер не нужен: в отличие от КФ, здесь голоса живут внутри § и попадают в тот же `ks-{datum}.json`.

### Алгоритм

1. Найти в fulltext параграфа блок от `Omröstning\n` до следующего известного заголовка (`Reservation`, `Protokollsanteckning`, `Protokollsutdrag`, конец §)
2. Извлечь `Godkänd voteringsproposition: [”"](.+?)[”"]` (мультистрочно, схлопнуть переносы)
3. Разобрать семантику пропозиции:
   - `Ja för bifall … Nej för avslag` → `ja = bifall`, `nej = avslag`
   - `Ja för avslag … Nej för bifall` → `ja = avslag`, `nej = bifall`
   - `Ja för bifall till X … Nej för bifall till Y` → `ja = bifall X`, `nej = bifall Y` (хранить строки-описания)
   - Ничего не распозналось → `betydelse: null` + warning (голоса всё равно сохранить)
4. Найти группы голосов: сегменты, заканчивающиеся на `röstar Ja (N).`, `röstar Nej (N).`, `avstår från att rösta (N).`
5. В каждом сегменте: схлопнуть переносы строк → срезать префиксы `tjänstgörande ersättaren/ersättarna`, `ordföranden` → сплит по `,` / `och` / `samt` → извлечь `Namn (Parti)` из каждого элемента
6. **Валидация:** число извлечённых имён === N из скобок. Несовпадение → `console.warn` с датой/§ и пропуск записи счётчиков не делать — записать что распарсилось, но пометить `verified: false`

### Матчинг имён на политиков

Переиспользовать подход `parse-voteringar.ts:113-133` (КФ): карта `"förnamn efternamn".toLowerCase()` → `politiker-{uuid}` из `data/politiker/goteborg.json`, с fallback по частям составных фамилий. Члены КС — подмножество этих политиков, покрытие должно быть 100%; нематч → warning.

### Выходной формат (зеркалит КФ)

В `data/graf/ks-{datum}.json`:

```jsonc
// В data существующего paragraf-узла (id: "ks-{datum}-§{nr}") добавить:
"votering": {
  "ja": 7, "nej": 6, "avstår": 0,
  "proposition": "Ja för avslag och Nej för bifall till yrkandet från L, M, D, KD och SD.",
  "jaBetyder": "avslag",   // или "bifall", или описание yrkande при дуэли, или null
  "nejBetyder": "bifall"
}

// Новые рёбра (как у КФ, см. parse-voteringar.ts:146-151):
{ "from": "politiker-{uuid}", "to": "ks-{datum}-§{nr}", "typ": "röstade_ja" }
{ "from": "politiker-{uuid}", "to": "ks-{datum}-§{nr}", "typ": "röstade_nej" }
{ "from": "politiker-{uuid}", "to": "ks-{datum}-§{nr}", "typ": "röstade_avstår" }
```

`db:seed` уже грузит все `data/graf/*.json` целиком — изменений в seed не требуется. API отдаёт `data->'votering'` для beslut — проверить, что KS-beslut эндпоинты его подхватывают.

### Batch-прогон

`batch-reparse-protokoll-ks.ts` уже перегенерирует все `ks-*.json` — после реализации прогнать его по всем 51 PDF, затем `pnpm --filter @daf/api db:seed`.

## Сопутствующий баг: «KF»-метки на KS-beslut (чинить в этой же задаче)

Страница beslut показывает KS-решения с подписью «KF § 478» / «KF beslut — Avslag». Источник: **`packages/web/src/pages/goteborg/beslut/[id].astro:98`** — литерал `` `KF beslut — ${...}` `` без учёта organ. Организацию выводить из префикса id узла (`kf-` / `ks-`) или из `data.organ` («Kommunfullmäktige» / «Kommunstyrelsen» — KS-парсер его уже пишет). Проверить и заголовок «KF § N» на той же странице.

## Golden-тесты (первые фикстуры)

| Фикстура | Что покрывает |
|---|---|
| KS 2026-06-17 § 478 (SLK-2026-00676) | Базовый случай: Ja=avslag, 7-6, префиксы ersättaren+ordföranden, typographic кавычки |
| KS 2026-06-17, § с «Ja för bifall till Jonas Attenius yrkande…» | Дуэль двух yrkanden |
| KS 2024-04-24, § с «avstår från att rösta (2)» | Воздержавшиеся + `ersättarna` (мн. число) + `samt` + перенос внутри имени (Viktoria Tryggvadottir Rolka) |

Формат теста: пара «сырой текст секции (вставить в тест как строку) → ожидаемый объект votering + списки politiker-id». Vitest уже настроен в `@daf/api`; для pipeline добавить `vitest` по аналогии.

## Приёмочные критерии

1. `batch-reparse-protokoll-ks.ts` по всем 51 PDF: ≥ 220 из 224 voteringar распарсены с `verified: true`; остальные перечислены warning-ами (не молча)
2. Сумма `ja+nej+avstår` каждой votering совпадает с числами в скобках из PDF
3. 100% имён замачены на `politiker-{uuid}` (КС — известные политики)
4. После seed: `curl localhost:3000/api/v1/goteborg/beslut/ks-2026-06-17-§478` содержит votering и röster
5. Страница beslut для KS-решения показывает поимённые голоса (как уже умеет для КФ) и правильную метку «KS»
6. Golden-тесты зелёные; `pnpm lint` и полный `pnpm build` проходят
7. В голосах хранится и сырой Ja/Nej, и betydelse — фактчекинг «кто был за/против yrkandet» не инвертирован

## Чего НЕ делать

- Не трогать КФ-парсер (`parse-voteringar.ts`) — другой формат входа, работает
- Не менять формат существующих рёбер/узлов — только добавлять
- Не удалять сырую секцию из `fulltext` — она остаётся источником для проверки человеком
- `deltar inte i beslutet` / jäv — не записывать как avstår (можно отдельным полем `deltarInte`, но это опционально)

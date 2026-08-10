# Reference Sources — dearbetarfordig.se

> Аналоги, исходники и архитектурные решения из мира civic tech.
> Папки с исходниками в `.gitignore` — клонируй локально при необходимости.

## Клонирование

```bash
# Все сразу (≈800 MB)
git clone --depth 1 https://github.com/mysociety/theyworkforyou.git docs/reference/theyworkforyou
git clone --depth 1 https://github.com/demokratie-live/bundestag.io.git docs/reference/abgeordnetenwatch
git clone --depth 1 https://github.com/decidim/decidim.git docs/reference/decidim
git clone --depth 1 https://github.com/OAndell/Riksdagskollen.git docs/reference/riksdagskollen
git clone --depth 1 https://github.com/openpolis/openparlamento.git docs/reference/openparlamento
git clone --depth 1 https://github.com/Partiguiden/partiguiden.git docs/reference/partiguiden
git clone --depth 1 https://github.com/everypolitician/everypolitician-data.git docs/reference/everypolitician
git clone --depth 1 https://github.com/rotsee/protokollen.git docs/reference/protokollen
git clone --depth 1 https://github.com/okfse/opengovse.git docs/reference/opengovse
```

---

## Индекс источников

### 1. TheyWorkForYou (mySociety) — 🇬🇧

| | |
|---|---|
| **Папка** | `theyworkforyou/` |
| **Репо** | [mysociety/theyworkforyou](https://github.com/mysociety/theyworkforyou) |
| **Стек** | PHP, Perl (parser), MySQL |
| **Лицензия** | BSD |
| **Размер** | ~169 MB |

**Что это:** Главный reference — парламентский мониторинг UK. Показывает дебаты, голосования, выступления MP. Делает Hansard (протоколы парламента) читабельным.

**Что берём:**
- Архитектура парсера (отдельный репо [parlparse](https://github.com/mysociety/parlparse))
- Философия "делаем парламент понятным для людей"
- URL-дизайн: `/mp/anna-svensson` → страница политика
- Подход к данным дебатов и голосований
- Curl-friendly HTML (вдохновение для нашего подхода)

**Ключевые файлы:**
- `www/docs/api/` — API дизайн
- `classes/` — модели данных (Member, Division, Debate)
- `scripts/` — загрузка и парсинг Hansard

---

### 2. Bundestag.io / DEMOCRACY (demokratie-live) — 🇩🇪

| | |
|---|---|
| **Папка** | `abgeordnetenwatch/` |
| **Репо** | [demokratie-live/bundestag.io](https://github.com/demokratie-live/bundestag.io) |
| **Стек** | Node.js, GraphQL, MongoDB |
| **Лицензия** | Apache 2.0 |
| **Размер** | ~1 MB |
| **Статус** | ⚠️ Archived → moved to [democracy-development monorepo](https://github.com/demokratie-live/democracy-development) |

**Что это:** GraphQL API для данных Бундестага. Backend для приложения DEMOCRACY, которое позволяет гражданам голосовать параллельно с парламентом.

**Что берём:**
- GraphQL schema для парламентских данных
- Модель: процедуры (Procedure), голосования (Vote), периоды (Period)
- Подход к скрапингу bundestag.de
- Монорепо-архитектура (позже перенесли в единый репо)

**Ключевые файлы:**
- `src/graphql/schemas/` — GraphQL типы
- `src/services/` — бизнес-логика
- `docker-compose.yml` — инфраструктура

---

### 3. Decidim — 🇪🇸

| | |
|---|---|
| **Папка** | `decidim/` |
| **Репо** | [decidim/decidim](https://github.com/decidim/decidim) |
| **Стек** | Ruby on Rails, PostgreSQL |
| **Лицензия** | AGPL-3.0 |
| **Размер** | ~115 MB |

**Что это:** Крупнейшая open-source платформа для participatory democracy. Используется Барселоной, Хельсинки и сотнями городов. Не просто мониторинг — активное участие граждан.

**Что берём:**
- Multi-tenant архитектура (organization = tenant)
- Модульность: компоненты как gems (proposals, meetings, budgets, debates)
- Система авторизации и верификации участников
- i18n подход (мультиязычность из коробки)
- Дизайн-система и accessibility

**Ключевые файлы:**
- `decidim-core/` — ядро платформы
- `decidim-proposals/` — предложения (аналог наших motioner)
- `decidim-budgets/` — бюджетирование
- `decidim-meetings/` — заседания
- `docs/` — архитектура и philosophy
- `decidim-api/` — GraphQL API

---

### 4. Riksdagskollen — 🇸🇪

| | |
|---|---|
| **Папка** | `riksdagskollen/` |
| **Репо** | [OAndell/Riksdagskollen](https://github.com/OAndell/Riksdagskollen) |
| **Стек** | Android (Java/Kotlin) |
| **Лицензия** | MIT |
| **Размер** | ~14 MB |
| **Статус** | ⚠️ No longer maintained |

**Что это:** Android-приложение для отслеживания шведского Riksdag. Показывает решения, голосования, документы — ровно то, что мы делаем, но для национального уровня и только Android.

**Что берём:**
- Понимание API Riksdagen (data.riksdagen.se)
- Модели данных: решения, голосования, партии, документы
- UX-паттерны для шведской политической информации
- Шведская терминология (beslut, votering, motion, interpellation)

**Ключевые файлы:**
- `app/src/main/java/se/oandell/riksdagen/` — модели и UI
- Структура данных из Riksdagens öppna data API

---

### 5. OpenParlamento (Openpolis) — 🇮🇹

| | |
|---|---|
| **Папка** | `openparlamento/` |
| **Репо** | [openpolis/openparlamento](https://github.com/openpolis/openparlamento) |
| **Стек** | PHP (Symfony 1.0) |
| **Лицензия** | GPL-3.0 |
| **Размер** | ~74 MB |

**Что это:** Итальянская платформа парламентского мониторинга. Показывает активность депутатов, голосования, законопроекты. Часть экосистемы Openpolis.

**Что берём:**
- Подход к "индексу активности" политиков (сколько присутствовал, голосовал, выступал)
- Визуализация: парламентское кресло → данные
- Legacy-код, но ценные модели данных
- Связь между atti (акты), votazioni (голосования), parlamentari (депутаты)

**Ключевые файлы:**
- `apps/fe/modules/` — frontend модули (politici, atti, votazioni)
- `lib/model/` — ORM модели
- `config/schema.yml` — схема данных

---

### 6. Partiguiden — 🇸🇪

| | |
|---|---|
| **Папка** | `partiguiden/` |
| **Репо** | [Partiguiden/partiguiden](https://github.com/Partiguiden/partiguiden) |
| **Стек** | Next.js, TypeScript, pnpm, Turbo |
| **Лицензия** | ISC |
| **Размер** | ~5.7 MB |

**Что это:** Шведский сайт для сравнения партий по позициям. Использует данные Riksdagen. **Наиболее близкий по стеку** к нашему проекту (TypeScript, monorepo, pnpm).

**Что берём:**
- TypeScript + monorepo структура (turbo/pnpm) — прямой reference для нашей архитектуры
- Интеграция с Riksdagens API
- Шведские модели: partier, standpunkter, voteringar
- Frontend-подход (Next.js, но паттерны применимы к Astro)
- UI-компоненты для политических данных

**Ключевые файлы:**
- `apps/web/` — фронтенд
- `packages/` — shared packages
- `package.json` — конфигурация монорепо

---

### 7. EveryPolitician (mySociety) — 🌍

| | |
|---|---|
| **Папка** | `everypolitician/` |
| **Репо** | [everypolitician/everypolitician-data](https://github.com/everypolitician/everypolitician-data) |
| **Стек** | Data (JSON, CSV), Ruby (tooling) |
| **Лицензия** | CC0 / Public Domain |
| **Размер** | ~420 MB |
| **Статус** | ⚠️ On hold since 2019 |

**Что это:** Глобальная база данных политиков всех стран в стандартизированном формате Popolo. Использовалась для Gender-Balance.org и других проектов.

**Что берём:**
- **Popolo standard** — международный стандарт для данных о политиках
- Структура данных: person, organization, membership, area
- Подход к мультистрановым данным
- CSV/JSON схемы для импорта/экспорта
- `countries.json` — мета-индекс всех стран и легислатур

**Ключевые файлы:**
- `data/Sweden/` — данные по Швеции (Riksdag)
- `countries.json` — мастер-индекс
- Любая папка `data/*/` — пример Popolo-формата

---

### 8. Protokollen / ProtoCollection (Journalism++ Stockholm) — 🇸🇪

| | |
|---|---|
| **Папка** | `protokollen/` |
| **Репо** | [rotsee/protokollen](https://github.com/rotsee/protokollen) |
| **Стек** | Python 2, Selenium, Tesseract OCR, AbiWord/wv, Elasticsearch |
| **Лицензия** | не указана |
| **Размер** | ~8 MB |
| **Статус** | ⚠️ Неактивен с 2015, сайт protokollen.net не работает |

**Что это:** Ближайший прямой предшественник нашего проекта. Финансированный Vinnova харвестер, который собирал и распознавал протоколы **kommunstyrelse** (не KF, а стиокholm) всех 290 шведских kommuner и выкладывал их как открытые данные для поиска и анализа. Найден через каталог `_tools/protokollen.md` на opengov.se.

**Что берём:**
- Подтверждение подхода: полнотекстовое извлечение протоколов уже пытались делать на муниципальном уровне в Швеции — но остановились на харвестинге сырого текста, без структурирования по ärenden/beslut, и проект не пережил 2015 год
- `harvest.py` — паттерн обхода сайтов kommun (Selenium, т.к. у многих kommuner нет стабильного API/URL-схемы для протоколов)
- `extract.py` + `modules/extractors/` — пайплайн OCR/парсинга разных форматов (PDF, DOC, RTF) до текста и метаданных
- `modules/tagger.py`, `modules/documents.py` — попытка разбить файл на under-документы (dagordning, protokoll, bilagor)
- Компаньон-репо [jplusplus/protokollen-queries](https://github.com/jplusplus/protokollen-queries) — `municipalities.md`, список kommun-сайтов и их особенностей парсинга (полезно как сверка при добавлении новых kommuner)

**Ключевые файлы:**
- `harvest.py`, `harvest_args.py` — сбор файлов
- `extract.py` — извлечение текста/метаданных
- `modules/extractors/` — форматно-специфичные парсеры
- `README.md` / `README-database-api.md` — архитектура и DB-схема

---

### 9. OpenGov.se (Open Knowledge Sverige) — 🇸🇪

| | |
|---|---|
| **Папка** | `opengovse/` |
| **Репо** | [okfse/opengovse](https://github.com/okfse/opengovse) |
| **Стек** | Jekyll 4 (Ruby), статический сайт |
| **Лицензия** | CC0-1.0 |
| **Размер** | ~105 MB (в основном ассеты и зеркала PDF-отчётов) |

**Что это:** Не платформа мониторинга, а каталог/агрегатор шведских transparency-инициатив, который ведёт Open Knowledge Sverige. Ценность не в коде сайта (Jekyll-шаблон), а в курируемых данных: списки открытых порталов, инструментов и кейсов Швеции/Nordics/EU.

**Что берём:**
- `_data/portals.yml` — курированный список открытых дата-порталов (dataportal.se, DIGG, Riksdagens öppna data, SCB, Nordics, data.europa.eu, DCAT-AP, OGP)
- `_tools/*.md` — 23 карточки шведских/EU transparency-инструментов со статусом (active/archived) — источник, откуда найден `protokollen` (см. п.8) и `handlingar.se`/`allmanhandling.se` (уже используем как reference для FOI-флоу)
- `_cases/*.md` — прецеденты (protokollen, handlingar, vardbetyg, postnummerupproret, eu-data-portal, danish-address-data)
- Паттерн карточки: frontmatter `status: active|archived` + `archived_reason` — удобная модель для нашего собственного `docs/reference/README.md`, если список источников разрастётся

**Ключевые файлы:**
- `_data/portals.yml`, `_data/reports.yml`, `_data/archived-resources.yml`
- `_tools/`, `_cases/`

---

## Сравнительная матрица

| Проект | Уровень | Стек | Multi-tenant | API | Дебаты | Голосования | Бюджет |
|--------|---------|------|:---:|:---:|:---:|:---:|:---:|
| TheyWorkForYou | Национальный | PHP | ❌ | ✅ REST | ✅ | ✅ | ❌ |
| Bundestag.io | Национальный | Node/GraphQL | ❌ | ✅ GraphQL | ❌ | ✅ | ❌ |
| Decidim | Муниципальный+ | Ruby/Rails | ✅ | ✅ GraphQL | ✅ | ✅ | ✅ |
| Riksdagskollen | Национальный | Android | ❌ | (uses riksdagen API) | ✅ | ✅ | ❌ |
| OpenParlamento | Национальный | PHP/Symfony | ❌ | ❌ | ✅ | ✅ | ❌ |
| Partiguiden | Национальный | Next.js/TS | ❌ | ❌ | ❌ | ✅ | ❌ |
| EveryPolitician | Глобальный | Data/Ruby | N/A | ✅ JSON | ❌ | ❌ | ❌ |
| Protokollen (2015) | Муниципальный (kommunstyrelse) | Python/OCR-харвестер | ❌ | ❌ (сырой текст) | ❌ | ❌ | ❌ |
| **dearbetarfordig.se** | **Муниципальный** | **TS/Astro/Hono** | **✅** | **✅ REST** | **✅** | **✅** | **✅** |

---

## Что уникально в dearbetarfordig.se

1. **Фокус на kommun** — из "живых" аналогов ни один не работает на муниципальном уровне Швеции; единственная попытка (Protokollen, Journalism++) остановилась на сыром харвестинге kommunstyrelse-протоколов и не пережила 2015 год
2. **Полный стек на TypeScript** — единый язык для фронта, API, pipeline
3. **Static-first + curl-friendly** — HTML как API (как TheyWorkForYou, но ещё чище)
4. **Структурированные полнотекстовые анфёранден** — Yttrandeprotokoll (официальный PDF) для KF-möten, разобранные по ärenden/beslut (Protokollen извлекал только плоский текст без такой структуры)
5. **Бюджетная визуализация** — объединяем Decidim-подход с финансовой прозрачностью
6. **EU-sovereign** — Hetzner, без US-cloud, GDPR by design

---

## Дополнительные ресурсы (не клонированы)

| Проект | URL | Что интересно |
|--------|-----|---------------|
| Kolada (RKA/SKR) | [kolada.se](https://www.kolada.se/) | Шведская муниципальная статистика — API для benchmarking |
| Riksdagens öppna data | [data.riksdagen.se](https://data.riksdagen.se/) | Официальный API шведского парламента |
| Open Knowledge Foundation | [okfn.org](https://okfn.org/) | Стандарты открытых данных |
| OpenGov Inc. | [opengov.com](https://opengov.com) | Коммерческий (закрытый исходник) SaaS для US local government: бюджетирование, permitting, procurement, tax & revenue, CRM. Нет GitHub-репо — не для клонирования, но полезен как срез фич-набора govtech-платформы у которых, в отличие от нас, нет упора на прозрачность решений |
| protokollen-queries (jplusplus) | [GitHub](https://github.com/jplusplus/protokollen-queries) | Компаньон-репо к Protokollen (п.8 выше) — `municipalities.md` со списком kommun-сайтов и особенностями их протокол-страниц |
| Popolo standard | [popoloproject.com](http://www.popoloproject.com/) | Формат данных о политиках (используется EveryPolitician) |
| mySociety philosophy | [mysociety.org/about](https://www.mysociety.org/about/) | Философия civic tech |
| democracy-development | [GitHub](https://github.com/demokratie-live/democracy-development) | Актуальный монорепо DEMOCRACY (замена bundestag.io) |

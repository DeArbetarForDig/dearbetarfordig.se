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
| **dearbetarfordig.se** | **Муниципальный** | **TS/Astro/Hono** | **✅** | **✅ REST** | **✅** | **✅** | **✅** |

---

## Что уникально в dearbetarfordig.se

1. **Фокус на kommun** — ни один из аналогов не работает на муниципальном уровне Швеции
2. **Полный стек на TypeScript** — единый язык для фронта, API, pipeline
3. **Static-first + curl-friendly** — HTML как API (как TheyWorkForYou, но ещё чище)
4. **Транскрипция дебатов** — Whisper для KF-möten (никто из аналогов не делает)
5. **Бюджетная визуализация** — объединяем Decidim-подход с финансовой прозрачностью
6. **EU-sovereign** — Hetzner, без US-cloud, GDPR by design

---

## Дополнительные ресурсы (не клонированы)

| Проект | URL | Что интересно |
|--------|-----|---------------|
| Kolada (RKA/SKR) | [kolada.se](https://www.kolada.se/) | Шведская муниципальная статистика — API для benchmarking |
| Riksdagens öppna data | [data.riksdagen.se](https://data.riksdagen.se/) | Официальный API шведского парламента |
| Open Knowledge Foundation | [okfn.org](https://okfn.org/) | Стандарты открытых данных |
| Popolo standard | [popoloproject.com](http://www.popoloproject.com/) | Формат данных о политиках (используется EveryPolitician) |
| mySociety philosophy | [mysociety.org/about](https://www.mysociety.org/about/) | Философия civic tech |
| democracy-development | [GitHub](https://github.com/demokratie-live/democracy-development) | Актуальный монорепо DEMOCRACY (замена bundestag.io) |

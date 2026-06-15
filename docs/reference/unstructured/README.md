# Unstructured.io — Архитектурный референс

> https://unstructured.io/
> Коммерческая платформа ETL для неструктурированных данных. **Мы не используем их продукт** — только как архитектурный референс.

## Почему здесь

Unstructured.io решает ту же фундаментальную задачу что и наш pipeline: берёт "грязные" источники (PDF, HTML, видео) и превращает в чистый структурированный JSON. Их архитектура Extract → Transform → Load — валидный паттерн, который мы реализуем самостоятельно.

## Наше позиционирование

| | Unstructured.io | dearbetarfordig.se |
|---|---|---|
| Лицензия | Проприетарное SaaS + open-source core | **100% AGPL-3.0** |
| Зависимости | US-cloud, закрытые API | **Self-hosted, EU only, zero vendor lock-in** |
| Фокус | Generic ETL для GenAI/RAG | **Domain-specific: шведская демократия** |
| Цена | $0.01/page, enterprise tier | **Бесплатно навсегда** |

## Что мы берём от них (паттерны, не код)

1. **Connector isolation** — каждый источник = отдельный модуль с единым output-форматом
2. **ETL separation** — чёткое разделение Extract/Transform/Load
3. **Incremental processing** — не перескрейпить всё каждый раз

## Что мы делаем сами

- PDF-парсинг протоколов → собственный парсер (Playwright + Cheerio)
- Транскрипция видео → whisper.cpp (self-hosted)
- HTML-скрейпинг → Cheerio (plain HTML sites) + Playwright (JS-формы)
- Валидация → Zod schemas
- Хранение → PostgreSQL (self-hosted, Hetzner EU)

## Ссылки (для изучения)

- Архитектура: https://docs.unstructured.io/
- Open source core: https://github.com/Unstructured-IO/unstructured (Apache 2.0)

// Content types for v2/public/content/*.json. Each workstream appends its own section; keep ids stable strings.
export interface ContentFile<T> { version: number; items: T[] }

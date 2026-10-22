// Content types for v2/public/content/*.json. Each workstream appends its own section; keep ids stable strings.
export interface ContentFile<T> { version: number; items: T[] }

// ---------------------------------------------------------------- features agent: shops.json (paint, plates, trackers, identity, decor)
export type ShopItem =
  | { kind: 'site'; id: string; site: 'paint' | 'lga'; name: string; lat: number; lon: number; lga?: string; blurb?: string; carMart?: boolean }
  | { kind: 'colour'; id: string; name: string; hex: string }
  | { kind: 'finish'; id: string; name: string; desc: string; mult: number; secs: number; metalness: number; roughness: number; clearcoat: number; flake?: number; iridescence?: number; envBoost?: number }
  | { kind: 'plate-code'; id: string; lga: string; code: string }
  | { kind: 'plate-tier'; id: string; name: string; minLen: number; maxLen: number; price: number }
  | { kind: 'tracker'; id: string; name: string; desc: string; price: number; ping: number; range: number; battery: string }
  | { kind: 'fee'; id: string; name: string; price: number; desc?: string }
  | { kind: 'car'; id: string; name: string; vehicle: 'sedan' | 'hatch' | 'jeep' | 'suv' | 'danfo'; price: number; blurb: string }
  | { kind: 'wallpaint'; id: string; name: string; hex: string }
  | { kind: 'walltex'; id: string; name: string; pattern: string; price: number }
  | { kind: 'floor'; id: string; name: string; pattern: string; hex: string; price: number }
  | { kind: 'decor'; id: string; name: string; cat: string; where: 'out' | 'in' | 'both'; mount: 'floor' | 'wall' | 'roof'; price: number; size: [number, number, number]; scale: [number, number]; solid?: boolean; tint?: boolean; text?: boolean; blurb?: string };
export type ShopsFile = ContentFile<ShopItem>;

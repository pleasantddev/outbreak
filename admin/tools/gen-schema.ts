// Reads the game's content types (v2/src/content/schema.ts) with the TypeScript compiler and writes src/generated/schema.json,
// which the admin forms use to label and type fields. Interfaces are matched to content files by name (Mission -> missions,
// GameEvent/EventDef -> events, ...) or by a JSDoc tag:  /** @content missions */ export interface Foo { ... }
// Run automatically before dev and build. Never fails the build: with no matches the forms fall back to inferring from data.
import ts from 'typescript';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, '../../v2/src/content/schema.ts'); const OUT = resolve(here, '../src/generated/schema.json');
mkdirSync(dirname(OUT), { recursive: true });
const KINDS = ['missions', 'events', 'routes', 'skills', 'npcs', 'shops', 'economy', 'iap'];
if (!existsSync(SRC)) { writeFileSync(OUT, '{}'); process.exit(0); }
const sf = ts.createSourceFile(SRC, readFileSync(SRC, 'utf8'), ts.ScriptTarget.ES2022, true);
const ifaces = new Map<string, ts.InterfaceDeclaration>(); const aliases = new Map<string, ts.TypeAliasDeclaration>();
sf.forEachChild((n) => { if (ts.isInterfaceDeclaration(n)) ifaces.set(n.name.text, n); else if (ts.isTypeAliasDeclaration(n)) aliases.set(n.name.text, n); });
const humanize = (k: string) => k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[._-]+/g, ' ').replace(/^./, (c) => c.toUpperCase());

function field(key: string, t: ts.TypeNode | undefined, optional: boolean, doc: string | undefined, depth = 0): any {
  const base: any = { key, label: humanize(key), optional, ...(doc ? { help: doc } : {}) };
  if (!t || depth > 4) return { ...base, type: 'json' };
  if (t.kind === ts.SyntaxKind.StringKeyword) return { ...base, type: 'string' };
  if (t.kind === ts.SyntaxKind.NumberKeyword) return { ...base, type: 'number' };
  if (t.kind === ts.SyntaxKind.BooleanKeyword) return { ...base, type: 'boolean' };
  if (ts.isParenthesizedTypeNode(t)) return field(key, t.type, optional, doc, depth);
  if (ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal)) return { ...base, type: 'enum', options: [t.literal.text] };
  if (ts.isUnionTypeNode(t)) {
    const parts = t.types.filter((x) => !(ts.isLiteralTypeNode(x) && x.literal.kind === ts.SyntaxKind.NullKeyword) && x.kind !== ts.SyntaxKind.UndefinedKeyword);
    if (parts.length && parts.every((x) => ts.isLiteralTypeNode(x) && ts.isStringLiteral(x.literal))) return { ...base, type: 'enum', options: parts.map((x: any) => x.literal.text) };
    if (parts.length === 1) return field(key, parts[0], optional, doc, depth);
    return { ...base, type: 'json' };
  }
  if (ts.isArrayTypeNode(t)) { const e = field('#', t.elementType, false, undefined, depth + 1); return e.type === 'string' ? { ...base, type: 'stringlist', wide: true } : e.type === 'number' ? { ...base, type: 'numberlist' } : { ...base, type: 'array', wide: true, item: e }; }
  if (ts.isTypeLiteralNode(t)) return { ...base, type: 'object', wide: true, children: members(t.members, depth + 1) };
  if (ts.isTypeReferenceNode(t)) {
    const n = t.typeName.getText(sf); const i = ifaces.get(n); if (i) return { ...base, type: 'object', wide: true, children: members(i.members, depth + 1) };
    const a = aliases.get(n); if (a) return field(key, a.type, optional, doc, depth + 1);
    if (n === 'Array' && t.typeArguments?.[0]) return field(key, ts.factory.createArrayTypeNode(t.typeArguments[0]), optional, doc, depth);
  }
  return { ...base, type: 'json' };
}
function members(ms: ts.NodeArray<ts.TypeElement>, depth: number) {
  const out: any[] = [];
  for (const m of ms) if (ts.isPropertySignature(m) && m.name) { const doc = ts.getJSDocCommentsAndTags(m).map((d: any) => (typeof d.comment === 'string' ? d.comment : '')).filter(Boolean)[0]; out.push(field(m.name.getText(sf), m.type, !!m.questionToken, doc, depth)); }
  return out;
}
const result: Record<string, any[]> = {};
for (const [name, decl] of ifaces) {
  const tag = ts.getJSDocTags(decl).find((t) => t.tagName.text === 'content'); const tagged = tag && typeof tag.comment === 'string' ? tag.comment.trim() : null;
  const lower = name.toLowerCase().replace(/(def|item|entry|data)$/, '');
  const kind = tagged ?? KINDS.find((k) => lower === k.replace(/ies$/, 'y').replace(/s$/, '') || lower === 'game' + k.replace(/s$/, '') || lower === k);
  if (kind) result[kind] = members(decl.members, 0);
}
writeFileSync(OUT, JSON.stringify(result, null, 1));
console.log('schema.json:', Object.keys(result).join(', ') || '(no content interfaces yet, forms will infer from data)');

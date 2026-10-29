/** JSON with object keys sorted and `undefined` keys omitted, so equal values give equal text. */
export function stableJson(value: unknown): string {
  return JSON.stringify(sorted(value)) ?? 'null';
}

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sorted(v);
    }
    return out;
  }
  return value;
}

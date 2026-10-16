import type { IdKind } from './kind';
import { spawnGuidKind } from './spawn-guid';

/** Every kind of id the project is checked for. A new kind is a new file implementing `IdKind`, plus one line here. */
export const ID_KINDS: readonly IdKind[] = [spawnGuidKind];

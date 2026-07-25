import type { ResolvedCode } from '../import/cobiss/cobiss-util/cobiss-code-map';

/**
 * Describes a single metadata field for client-side form rendering.
 */
export interface FieldDescriptor {
  key: string;
  type: 'string' | 'number' | 'boolean' | 'date' | 'enum' | 'array' | 'object';
  required: boolean;

  /** For array types, the type of each element. */
  itemType?: 'string' | 'enum' | 'object';

  /** For enum / coded fields, the allowed code→label maps. */
  allowedValues?: ResolvedCode[];

  /** Shape descriptor for nested object fields. */
  objectShape?: FieldDescriptor[];

  /** Grouping key for UI sections. */
  group: string;

  /** Display order within the group (lower = earlier). */
  order: number;

  /**
   * Whether a linked parent record can pass this field down to children
   * (e.g. serial title, publisher, place, language, subject).
   */
  parentInheritable: boolean;

  /**
   * Whether the field identifies a specific issue
   * (volume/year, issue number, issue date) — must be filled per child
   * even when a parent is linked.
   */
  issueIdentifying: boolean;

  /** Which levels this field appears on. */
  levels: ('main' | 'child')[];
}

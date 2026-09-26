import { Injectable, OnModuleInit } from '@nestjs/common';
import { buildRecordSchemaV2 } from './v2/build-schema';
import type { SchemaV2 } from './v2/schema-v2.types';
import { assertSchemaV2 } from './v2/self-check';

@Injectable()
export class SchemaService implements OnModuleInit {
  private readonly recordSchemaV2: SchemaV2 = buildRecordSchemaV2();

  // A schema that advertises a field the API drops, a rule on an undeclared
  // context key or a suggest field outside the allowlist must not boot.
  onModuleInit() {
    assertSchemaV2(this.recordSchemaV2);
  }

  /** One schema for every material type and parent, the conditions inside. */
  getRecordSchemaV2(): SchemaV2 {
    return this.recordSchemaV2;
  }
}

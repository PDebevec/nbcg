declare global {
  namespace PrismaJson {
    type RecordMetadata = import('./metadata.types').RecordMetadata;
    type FieldChangeList = import('./revision.types').FieldChangeList;
  }
}

export {};

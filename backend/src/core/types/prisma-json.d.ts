declare global {
  namespace PrismaJson {
    type RecordMetadata = import('./metadata.types').RecordMetadata;
  }
}

export {};

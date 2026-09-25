declare global {
  namespace PrismaJson {
    type RecordMetadata = import('./metadata.types').RecordMetadata;
    type FieldChangeList = import('./revision.types').FieldChangeList;
    type TaskHandoffStack = import('./task.types').TaskHandoffStack;
  }
}

export {};

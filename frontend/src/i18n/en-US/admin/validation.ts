// The dialog for a 400 METADATA_VALIDATION_FAILED (metadata schema v2).
export default {
  title: {
    publish: 'Not ready to publish',
    save: 'Cannot save',
    toDraft: 'Cannot return to draft',
  },
  batch: {
    publish: '{failed} of {total} items are not ready to publish.',
    save: '{failed} of {total} items cannot be saved.',
    toDraft: '{failed} of {total} items cannot be returned to draft.',
  },
  batchNothing: 'Nothing was changed: the whole batch is refused until every item passes.',
  single: {
    publish: 'The item was not published. Fill in what is listed below and try again.',
    save: 'Nothing was saved. Fix what is listed below and save again.',
    toDraft: 'The item was not moved. Fix what is listed below and try again.',
  },
  checkedAs: {
    DRAFT: 'checked as a draft',
    RECORD: 'checked as a record',
  },
  missing: 'Missing',
  check: 'Check',
  newItem: 'New item',
  footNote:
    'The same check runs on every save, on publishing and returning to draft, and when a review task is completed.',
  constraints: {
    minLength: 'at least {limit} characters',
    maxLength: 'at most {limit} characters',
    min: 'must be at least {limit}',
    max: 'must be at most {limit}',
    minItems: 'at least {limit} entries',
    maxItems: 'at most {limit} entries',
    pattern: 'the format is not valid',
    unit: 'stored in a different unit; re-enter the number so the unit ({limit}) is written again',
  },
};

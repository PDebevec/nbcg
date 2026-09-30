// The item editor. Field captions are NOT here: they come from the metadata schema (en / cnr).
export default {
  title: 'Edit item',
  loadFailed: 'Item could not be loaded.',
  schemaFailed:
    'The metadata schema could not be loaded, so every field is shown and nothing is checked before saving. The server still checks each save.',
  tabForm: 'Form',
  tabJson: 'JSON',
  tabFiles: 'Files',
  tabHistory: 'History',
  tabTasks: 'Tasks',
  assignTask: 'Assign task',

  // Field markers and hints
  neededToPublish: 'needed to publish',
  requiredToSave: 'Required: the item cannot be saved without it.',
  requiredToPublish: 'Needed before the item can be published.',
  noExtentUnit: 'This material type has no unit for a numeric extent; use the extent statement.',
  nRequiredEmpty: '{count} required empty',
  nNeededToPublish: '{count} needed to publish',
  searchVocabulary: 'Type to search …',
  listHint: 'Type a value and press Enter',
  addNote: 'Add note',
  addUrl: 'Add link',

  // Section cards
  sectionEmpty: 'Nothing filled in yet. Expand to add: {fields}',
  collapse: 'Collapse {section}',
  expand: 'Expand {section}',
  sections: {
    issue: { title: 'Issue', summary: 'Volume, number and date of this issue' },
    identification: {
      title: 'Identification',
      summary: 'Title, collection type, subtitle, other titles, typology',
    },
    responsibility: { title: 'Responsibility', summary: 'Statements, authors, corporate bodies' },
    publication: { title: 'Publication', summary: 'Publisher, place, year, edition, manufacture' },
    physical: {
      title: 'Physical description',
      summary: 'Extent statement, extent, other details, dimensions',
    },
    series: { title: 'Series', summary: 'Series title, ISSN, volume' },
    identifiers: { title: 'Identifiers', summary: 'COBISS ID and standard numbers' },
    languages: {
      title: 'Languages and countries',
      summary: 'Languages of the text, translations, summaries, countries',
    },
    notes: { title: 'Subject and notes', summary: 'Summary, notes, keywords, online locations' },
    coded: {
      title: 'Coded data for text (105)',
      summary: 'Illustrations, content types, literary form, biography, flags',
    },
  },
  other: {
    title: 'Other fields ({count})',
    caption:
      'not used by this material type, but you can still fill them in. A hidden field that holds a value is never dropped.',
  },

  // Material type band and parent band
  type: {
    shows: 'The form shows the fields this type uses, in {count} sections; the rules come from the metadata schema.',
    chooseFirst: 'Choose the material type first.',
    chooseFirstText: 'It decides which fields the form shows and which of them are required.',
    folded: 'Fields folded away ({count}):',
    showAll: 'Show all fields',
  },
  parent: {
    issueOf: 'Issue of a serial collection:',
    partOf: 'Part of:',
    children: 'items: {count}',
    serialNote:
      'Authors, collection type, ISBN, edition and the coded text data live on the parent, so this form folds them away.',
    open: 'Open parent',
  },

  // Save readiness
  readiness: {
    recordBlocked: 'This record cannot be saved yet:',
    draftBlocked: 'This draft cannot be saved yet:',
    recordTail: 'A record must stay complete. Fill it in, or return the record to draft.',
    draftTail: 'A draft needs a title and a material type.',
    publishLead: 'Still needed to publish ({count}):',
    publishTail: 'The draft can be saved without them.',
  },
  saveDraft: 'Save draft',
  saved: 'Saved.',
  saveBlocked: 'Save is off until these are filled in: {fields}.',
  unsavedIn: 'Unsaved changes in {fields}.',
  allSaved: 'All changes saved',
  newDraftUnsaved: 'New draft, not saved yet',
  newRecordUnsaved: 'New record, not saved yet',
  notSavedYet: 'not yet saved',
  lastSaved: 'last saved {when}',
  lastSavedBy: 'last saved {when} by {name}',
  conflictRefreshed:
    'This item was modified by another user, so your changes were not saved. The form has been refreshed with the latest data — re-apply your changes, or choose "Save anyway" to overwrite.',
  saveAnyway: 'Save anyway',
  dismiss: 'Dismiss',
  published: 'Published as a record.',
  returnedToDraft: 'Returned to draft.',

  // Right-hand column
  nav: {
    title: 'On this page',
    other: 'Other fields',
    hidden: '{count} hidden',
    expandAll: 'Expand all',
    collapseAll: 'Collapse all',
  },
  status: {
    title: 'Status',
    type: 'Type',
    source: 'Source',
    sourceCobiss: 'COBISS import',
    sourceManual: 'Created by hand',
    created: 'Created',
    updated: 'Updated',
    ready: 'All required fields are filled in. Ready to publish.',
    notReady: 'Still needed to publish ({count}):',
    publish: 'Publish as record',
    publishHelp:
      'Saves the draft first, then the server runs the same check. Publishing closes any open review task on this item.',
    publishBlockedHelp: 'Turns on when the fields listed above are filled in.',
    toDraftHelp:
      'Moves the record to Drafts together with your changes. A draft needs only a title and a material type.',
  },
  openTask: {
    title: 'Open task',
    all: 'All tasks',
  },

  // Tabs
  jsonHint: 'Full metadata as JSON. Unknown fields are dropped by the server.',
  jsonValid: 'Valid JSON',
  invalidJson: 'Invalid JSON',
  filesTitle: 'Attached files',
  filesSummary: 'files: {count} · {size}',
  filesManage: 'Manage',
  dropFiles: 'Drop files here or',
  chooseFiles: 'choose files',
  uploadedOn: 'uploaded {date}',
  download: 'Download',
  uploaded: 'Files uploaded.',
  noFiles: 'No attached files.',
  deleteFileConfirm: 'Delete file "{name}"?',
  fileDeleted: 'File deleted.',
  pdfOk: 'PDF text extracted',
  pdfProblems: 'PDFs without usable text: {count}',

  // Authors and corporate bodies (sub-field captions fall back to these)
  authors: {
    find: 'Find an existing author …',
    add: 'Add author',
    familyName: 'Family name',
    firstName: 'First name',
    prefix: 'Prefix',
    romanNumerals: 'Numerals',
    dates: 'Dates',
    datesPlaceholder: '1813-1851',
    role: 'Role',
    responsibility: 'Responsibility',
  },
  corporate: {
    name: 'Corporate body name',
    add: 'Add corporate body',
  },
  responsibility: {
    primary: 'Primary',
    alternative: 'Alternative',
    secondary: 'Secondary',
  },

  // Leaving with unsaved changes
  unsaved: {
    title: 'Unsaved changes',
    text: 'You changed {fields} in “{title}”. If you leave now, those changes are lost.',
    changed: 'changed',
    discard: 'Discard changes',
    stay: 'Stay on the page',
    save: 'Save and leave',
    cannotSave: 'The item cannot be saved as it is: a required field is empty.',
  },
};

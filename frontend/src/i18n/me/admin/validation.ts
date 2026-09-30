// Dijalog za 400 METADATA_VALIDATION_FAILED (šema metapodataka v2).
export default {
  title: {
    publish: 'Nije spremno za objavu',
    save: 'Čuvanje nije moguće',
    toDraft: 'Vraćanje u nacrt nije moguće',
  },
  batch: {
    publish: '{failed} od {total} zapisa nije spremno za objavu.',
    save: '{failed} od {total} zapisa nije moguće sačuvati.',
    toDraft: '{failed} od {total} zapisa nije moguće vratiti u nacrt.',
  },
  batchNothing: 'Ništa nije promijenjeno: cijela grupa se odbija dok svaki zapis ne prođe provjeru.',
  single: {
    publish: 'Zapis nije objavljen. Popunite navedeno i pokušajte ponovo.',
    save: 'Ništa nije sačuvano. Ispravite navedeno i sačuvajte ponovo.',
    toDraft: 'Zapis nije premješten. Ispravite navedeno i pokušajte ponovo.',
  },
  checkedAs: {
    DRAFT: 'provjereno kao nacrt',
    RECORD: 'provjereno kao zapis',
  },
  missing: 'Nedostaje',
  check: 'Provjeriti',
  newItem: 'Novi zapis',
  footNote:
    'Ista provjera se izvršava pri svakom čuvanju, pri objavi i vraćanju u nacrt, kao i pri završetku zadatka pregleda.',
  constraints: {
    minLength: 'najmanje {limit} znakova',
    maxLength: 'najviše {limit} znakova',
    min: 'mora biti najmanje {limit}',
    max: 'može biti najviše {limit}',
    minItems: 'najmanje {limit} unosa',
    maxItems: 'najviše {limit} unosa',
    pattern: 'format nije ispravan',
    unit: 'sačuvano u drugoj jedinici; unesite broj ponovo da bi se jedinica ({limit}) upisala iznova',
  },
};

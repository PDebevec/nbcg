// Uređivač zapisa. Nazivi polja NIJESU ovdje: dolaze iz šeme metapodataka (en / cnr).
export default {
  title: 'Uređivanje zapisa',
  loadFailed: 'Zapis nije moguće učitati.',
  schemaFailed:
    'Šemu metapodataka nije moguće učitati, pa su prikazana sva polja i ništa se ne provjerava prije čuvanja. Server i dalje provjerava svako čuvanje.',
  tabForm: 'Obrazac',
  tabJson: 'JSON',
  tabFiles: 'Datoteke',
  tabHistory: 'Istorija',
  tabTasks: 'Zadaci',
  assignTask: 'Dodijeli zadatak',

  // Oznake i napomene uz polja
  neededToPublish: 'potrebno za objavu',
  requiredToSave: 'Obavezno: bez ovog polja zapis se ne može sačuvati.',
  requiredToPublish: 'Potrebno prije nego što se zapis može objaviti.',
  noExtentUnit: 'Ova vrsta građe nema jedinicu za brojčani obim; koristite podatak o obimu.',
  nRequiredEmpty: 'obaveznih praznih: {count}',
  nNeededToPublish: 'potrebno za objavu: {count}',
  searchVocabulary: 'Kucajte za pretragu …',
  listHint: 'Unesite vrijednost i pritisnite Enter',
  addNote: 'Dodaj napomenu',
  addUrl: 'Dodaj link',

  // Kartice sekcija
  sectionEmpty: 'Još ništa nije popunjeno. Proširite da dodate: {fields}',
  collapse: 'Skupi: {section}',
  expand: 'Proširi: {section}',
  sections: {
    issue: { title: 'Podaci o broju', summary: 'Godište, broj i datum ovog broja' },
    identification: {
      title: 'Identifikacija',
      summary: 'Naslov, vrsta zbirke, podnaslov, ostali naslovi, tipologija',
    },
    responsibility: { title: 'Odgovornost', summary: 'Podaci o odgovornosti, autori, korporativna tijela' },
    publication: { title: 'Izdavanje', summary: 'Izdavač, mjesto, godina, izdanje, štampanje' },
    physical: {
      title: 'Fizički opis',
      summary: 'Podatak o obimu, obim, ostali detalji, dimenzije',
    },
    series: { title: 'Edicija', summary: 'Naslov edicije, ISSN, sveska' },
    identifiers: { title: 'Identifikatori', summary: 'COBISS ID i standardni brojevi' },
    languages: {
      title: 'Jezici i države',
      summary: 'Jezici teksta, prevodi, sažeci, države',
    },
    notes: { title: 'Predmet i napomene', summary: 'Sažetak, napomene, ključne riječi, lokacije na internetu' },
    coded: {
      title: 'Kodirani podaci za tekst (105)',
      summary: 'Ilustracije, vrste sadržaja, književna forma, biografija, oznake',
    },
  },
  other: {
    title: 'Ostala polja ({count})',
    caption:
      'ova vrsta građe ih ne koristi, ali ih i dalje možete popuniti. Skriveno polje koje ima vrijednost nikada se ne briše.',
  },

  // Traka vrste građe i traka nadređenog zapisa
  type: {
    shows: 'Obrazac prikazuje polja koja ova vrsta građe koristi, u {count} sekcija; pravila dolaze iz šeme metapodataka.',
    chooseFirst: 'Prvo izaberite vrstu građe.',
    chooseFirstText: 'Ona određuje koja polja obrazac prikazuje i koja su od njih obavezna.',
    folded: 'Sklonjena polja ({count}):',
    showAll: 'Prikaži sva polja',
  },
  parent: {
    issueOf: 'Broj serijske zbirke:',
    partOf: 'Dio zbirke:',
    children: 'jedinica: {count}',
    serialNote:
      'Autori, vrsta zbirke, ISBN, izdanje i kodirani podaci za tekst nalaze se na nadređenom zapisu, pa ih ovaj obrazac sklanja.',
    open: 'Otvori nadređeni zapis',
  },

  // Spremnost za čuvanje
  readiness: {
    recordBlocked: 'Ovaj zapis se još ne može sačuvati:',
    draftBlocked: 'Ovaj nacrt se još ne može sačuvati:',
    recordTail: 'Zapis mora ostati potpun. Popunite polje ili vratite zapis u nacrt.',
    draftTail: 'Nacrtu su potrebni naslov i vrsta građe.',
    publishLead: 'Još potrebno za objavu ({count}):',
    publishTail: 'Nacrt se može sačuvati i bez njih.',
  },
  saveDraft: 'Sačuvaj nacrt',
  saved: 'Sačuvano.',
  saveBlocked: 'Čuvanje nije moguće dok se ne popuni: {fields}.',
  unsavedIn: 'Nesačuvane izmjene: {fields}.',
  allSaved: 'Sve izmjene su sačuvane',
  newDraftUnsaved: 'Novi nacrt, još nije sačuvan',
  newRecordUnsaved: 'Novi zapis, još nije sačuvan',
  notSavedYet: 'još nije sačuvano',
  lastSaved: 'posljednji put sačuvano {when}',
  lastSavedBy: 'posljednji put sačuvano {when}, {name}',
  conflictRefreshed:
    'Ovaj zapis je u međuvremenu izmijenio drugi korisnik, pa vaše izmjene nijesu sačuvane. Obrazac je osvježen najnovijim podacima — ponovo unesite izmjene ili izaberite „Ipak sačuvaj“ da prepišete tuđe izmjene.',
  saveAnyway: 'Ipak sačuvaj',
  dismiss: 'Zatvori',
  published: 'Objavljeno kao zapis.',
  returnedToDraft: 'Vraćeno u nacrt.',

  // Desna kolona
  nav: {
    title: 'Na ovoj stranici',
    other: 'Ostala polja',
    hidden: 'skriveno: {count}',
    expandAll: 'Proširi sve',
    collapseAll: 'Skupi sve',
  },
  status: {
    title: 'Status',
    type: 'Vrsta',
    source: 'Izvor',
    sourceCobiss: 'Uvoz iz COBISS-a',
    sourceManual: 'Ručno kreirano',
    created: 'Kreirano',
    updated: 'Izmijenjeno',
    ready: 'Sva obavezna polja su popunjena. Spremno za objavu.',
    notReady: 'Još potrebno za objavu ({count}):',
    publish: 'Objavi kao zapis',
    publishHelp:
      'Prvo čuva nacrt, zatim server izvršava istu provjeru. Objava zatvara otvoreni zadatak pregleda za ovaj zapis.',
    publishBlockedHelp: 'Postaje dostupno kada se popune gore navedena polja.',
    toDraftHelp:
      'Premješta zapis u nacrte zajedno sa vašim izmjenama. Nacrtu su potrebni samo naslov i vrsta građe.',
  },
  openTask: {
    title: 'Otvoren zadatak',
    all: 'Svi zadaci',
  },

  // Kartice
  jsonHint: 'Kompletni metapodaci u JSON formatu. Nepoznata polja server odbacuje.',
  jsonValid: 'Ispravan JSON',
  invalidJson: 'Neispravan JSON',
  filesTitle: 'Priložene datoteke',
  filesSummary: 'datoteka: {count} · {size}',
  filesManage: 'Upravljaj',
  dropFiles: 'Prevucite datoteke ovdje ili',
  chooseFiles: 'izaberite datoteke',
  uploadedOn: 'otpremljeno {date}',
  download: 'Preuzmi',
  uploaded: 'Datoteke su otpremljene.',
  noFiles: 'Nema priloženih datoteka.',
  deleteFileConfirm: 'Obrisati datoteku "{name}"?',
  fileDeleted: 'Datoteka je obrisana.',
  pdfOk: 'Tekst iz PDF-a je izdvojen',
  pdfProblems: 'PDF datoteka bez upotrebljivog teksta: {count}',

  // Autori i korporativna tijela (rezervni nazivi potpolja)
  authors: {
    find: 'Pronađi postojećeg autora …',
    add: 'Dodaj autora',
    familyName: 'Prezime',
    firstName: 'Ime',
    prefix: 'Prefiks',
    romanNumerals: 'Brojevi',
    dates: 'Godine',
    datesPlaceholder: '1813-1851',
    role: 'Uloga',
    responsibility: 'Odgovornost',
  },
  corporate: {
    name: 'Naziv korporativnog tijela',
    add: 'Dodaj korporativno tijelo',
  },
  responsibility: {
    primary: 'Primarna',
    alternative: 'Alternativna',
    secondary: 'Sekundarna',
  },

  // Napuštanje stranice sa nesačuvanim izmjenama
  unsaved: {
    title: 'Nesačuvane izmjene',
    text: 'Izmijenili ste: {fields} u zapisu „{title}“. Ako sada napustite stranicu, te izmjene se gube.',
    changed: 'izmijenjeno',
    discard: 'Odbaci izmjene',
    stay: 'Ostani na stranici',
    save: 'Sačuvaj i napusti',
    cannotSave: 'Zapis se ovakav ne može sačuvati: obavezno polje je prazno.',
  },
};

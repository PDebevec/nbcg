import admin from './admin';

export default {
  nav: {
    home: 'Početna',
    about: 'O nama',
    terms: 'Uslovi korišćenja',
    advancedSearch: 'Napredna pretraga',
    contact: 'Kontakt',
    profile: 'Profil',
  },

  common: {
    library: 'Digitalna biblioteka',
    readMore: 'Saznaj više',
    search: 'Pretraga',
    reset: 'Poništi',
    back: 'Nazad',
    backHome: 'Nazad na početnu',
  },

  index: {
    searchPlaceholder: 'Pretraži po naslovu, autoru, temi …',
    fullTextOn: 'Pretraga cijelog teksta uključena',
    fullTextOff: 'Pretraga cijelog teksta isključena',
    searchTypes: {
      all: 'Sve',
      books: 'Knjige',
      periodicals: 'Periodika',
      manuscripts: 'Rukopisi',
    },
    collectionsTitle: 'Pretraga po kolekcijama',
    collections: {
      books: 'Knjige',
      newspapers: 'Novine',
      magazines: 'Časopisi',
      manuscripts: 'Rukopisi i dokumenta',
      maps: 'Karte i planovi',
      posters: 'Plakati i likovna građa',
      photographs: 'Fotografije i razglednice',
      audiovisual: 'Muzička i video građa',
    },
    thematicTitle: 'Pretraga po temama',
    newestTitle: 'Nedavno dodato',
    thematic: {
      oldRareBooks: {
        title: 'Stare i rijetke knjige',
        description: 'Izbor najvrednijih i najstarijih naslova iz fonda Nacionalne biblioteke.',
      },
      montenegrinPress: {
        title: 'Crnogorska periodika',
        description: 'Istorijske novine i časopisi štampani na teritoriji Crne Gore.',
      },
      cetinjeHeritage: {
        title: 'Cetinjska baština',
        description: 'Građa vezana za istoriju i kulturu prijestonice Cetinje.',
      },
      cartography: {
        title: 'Kartografska baština',
        description: 'Istorijske karte i planovi crnogorskih gradova i teritorija.',
      },
      artAndPosters: {
        title: 'Umjetnost i plakati',
        description: 'Likovna građa, plakati i promotivni materijali iz fonda biblioteke.',
      },
      folkHeritage: {
        title: 'Narodno stvaralaštvo',
        description: 'Zapisi i publikacije o crnogorskoj tradiciji i narodnom stvaralaštvu.',
      },
      njegos: {
        title: 'Njegoš i njegovo doba',
        description: 'Djela Petra II Petrovića Njegoša i građa o njegovom životu i epohi.',
      },
    },
    aboutKicker: 'O nama',
    aboutTitle: 'O Digitalnoj biblioteci Crne Gore',
    aboutP1:
      'Digitalna biblioteka Crne Gore je projekat Nacionalne biblioteke Crne Gore „Đurđe Crnojević“ zahvaljujući kojoj su digitalizovani i prezentovani najvredniji primjerci bibliotečke građe iz kolekcija Nacionalne biblioteke u kojima se čuvaju stare i rijetke knjige, rukopisi, dokumenta, novine, časopisi, karte, plakati i likovna, muzička i video građa…',
    aboutP2:
      'Cilj ovog projekta je zaštita originalnih dokumenata i njihovo predstavljanje u digitalnom obliku, odnosno obezbjeđivanje njihove dostupnosti najširem krugu korisnika u čitavom svijetu putem interneta.',
    aboutP3:
      'Najveći dio građe koji se nalazi na portalu Digitalne biblioteke digitalizovan je u Centru za mikrofilmovanje i digitalizaciju Nacionalne biblioteke, koji je formiran 2008. godine u okviru Odjeljenja za razvoj bibliotečke djelatnosti. U ovom centru mikrofilmovani su neki od najvažnijih naslova crnogorske periodike, kao što su Glas Crnogorca, Crnogorac, Crnogorka, Grlica, ali i skenirano više od 400 naslova periodike, stare i rijetke knjige, rukopisa, fotografija i plakata.',
    aboutP4:
      'Projekat Digitalna biblioteka Crne Gore realizovan je uz pomoć Ministarstva kulture Crne Gore, a u skladu sa Nacionalnim programom za digitalizaciju, koji je Vlada Crne Gore usvojila 2008. godine. Svrha Nacionalnog programa za digitalizaciju je da omogući ujednačeni pristup digitalizaciji bibliotečke građe u Crnoj Gori. Program je usmjeren ka dugoročnoj strategiji digitalizacije, a cilj mu je da podstakne unaprjeđenje institucionalne, tehnološke, stručne i organizacione infrastrukture za projekte digitalizacije.',
  },

  about: {
    kicker: 'O nama',
    title: 'O Digitalnoj biblioteci Crne Gore',
  },

  terms: {
    title: 'Uslovi korišćenja',
    p1: 'Nacionalna biblioteka Crne Gore „Đurđe Crnojević“ zadržava sva autorska prava na digitalizovani i objavljeni materijal na portalu Digitalna biblioteka Crne Gore.',
    p2: 'Korisnici portala Digitalna biblioteka Crne Gore mogu besplatno koristiti digitalizovani materijal pod uslovom da se na taj način ne ostvaruje materijalna korist. Materijal se ne može distribuirati, razmjenjivati ili prodavati bez pismene saglasnosti vlasnika autorskih prava.',
  },

  advanced: {
    title: 'Napredna pretraga',
    titleField: 'Naslov',
    author: 'Autor',
    publisher: 'Izdavač',
    materialType: 'Vrsta građe',
    language: 'Jezik',
    yearFrom: 'Godina od',
    yearTo: 'Godina do',
    types: {
      all: 'Sve vrste',
    },
    languages: {
      all: 'Svi jezici',
    },
  },

  contact: {
    title: 'Kontakt',
    phone: 'Telefon',
    email: 'E-mail',
    address: 'Adresa',
    addressValue: 'Nacionalna biblioteka Crne Gore „Đurđe Crnojević“, Cetinje, Crna Gora',
  },

  auth: {
    login: 'Prijava',
    logout: 'Odjava',
    sessionExpired: 'Vaša sesija je istekla. Nesačuvane izmjene ostaju na ovoj stranici — prijavite se ponovo da nastavite.',
  },

  profile: {
    title: 'Korisnički profil',
    unavailableTitle: 'Prijava nije dostupna',
    unavailableText:
      'Korisnički nalozi će uskoro biti omogućeni na portalu Digitalne biblioteke Crne Gore.',
    username: 'Korisničko ime',
    email: 'E-pošta',
    fullName: 'Ime',
    roles: 'Uloge',
    noRoles: 'Nema dodijeljenih uloga',
  },

  footer: {
    mission: 'Naša misija',
    missionText:
      'Cilj ovog projekta je zaštita originalnih dokumenata i njihovo predstavljanje u digitalnom obliku, odnosno obezbjeđivanje njihove dostupnosti najširem krugu korisnika u čitavom svijetu putem interneta.',
    navigation: 'Navigacija',
    contact: 'Kontakt',
    phone: 'Tel: + 382 41 234 243, lokal 13',
    email: "e-mail: info{'@'}dlib.me",
    copyright: 'Digitalna biblioteka Crne Gore.',
  },

  catalog: {
    kicker: 'Digitalna biblioteka',
    title: 'Katalog građe',
    searchWithin: 'Pretraži unutar kataloga …',
    fullTextOn: 'Pretraga cijelog teksta uključena',
    fullTextOff: 'Pretraga cijelog teksta isključena',
    clearSearch: 'Očisti pretragu',
    hideSearch: 'Sakrij pretragu',
    showSearch: 'Prikaži pretragu',
    filters: 'Filteri',
    itemType: 'Vrsta građe',
    language: 'Jezik',
    allTypes: 'Sve vrste',
    allLanguages: 'Svi jezici',
    period: 'Period',
    resetFilters: 'Poništi filtere',
    showing: 'Prikazano',
    of: 'od',
    items: 'jedinica',
    sortBy: 'Sortiraj po',
    view: 'Pregled',
    details: 'Detalji',
    eras: {
      all: 'Sve',
      pre1800: 'Prije 1800',
      c19: '1800–1900',
      e1900: '1900–1950',
      e1950: '1950–2000',
      post2000: 'Poslije 2000',
    },
    sort: {
      relevance: 'Relevantnost',
      newest: 'Najnovije',
    },
  },

  record: {
    backToCatalog: 'Nazad na katalog',
    notFound: 'Jedinica nije pronađena.',
    bibliographic: 'Bibliografski podaci',
    authors: 'Autori',
    notes: 'Napomene',
    series: 'Edicija',
    classification: 'Klasifikacija',
    attachments: 'Prilozi',
    links: 'Na internetu',
    download: 'Preuzmi',
    share: 'Podijeli',
    openInNewTab: 'Otvori u novoj kartici',
    linkCopied: 'Link je kopiran',
    noPreview: 'Pregled nije dostupan za ovaj fajl.',
    noFiles: 'Ovaj zapis nema priloženih fajlova.',
    zoomIn: 'Uvećaj',
    zoomOut: 'Umanji',
    rotate: 'Rotiraj',
    fullscreen: 'Cijeli ekran',
    exitFullscreen: 'Izađi iz cijelog ekrana',
    tabs: {
      main: 'Glavni metapodaci',
      all: 'Svi metapodaci',
    },
    relatedCollections: 'Povezane zbirke',
    noCollections: 'Ovaj zapis još nije dio nijedne zbirke.',
    fields: {
      title: 'Naslov',
      mediumDesignation: 'Opšta oznaka građe',
      subtitle: 'Podnaslov',
      parallelTitle: 'Paralelni naslov',
      titleInOtherScript: 'Naslov na drugom pismu',
      titleByAnotherAuthor: 'Naslov drugog autora',
      responsibility: 'Odgovornost',
      addResponsibility: 'Dodatna odgovornost',
      edition: 'Izdanje',
      publisher: 'Izdavač',
      place: 'Mjesto',
      year: 'Godina',
      publicationDate2: 'Drugi datum',
      placeOfManufacture: 'Mjesto štampanja',
      manufacturer: 'Štamparija',
      extent: 'Obim',
      otherPhysicalDetails: 'Ostali fizički detalji',
      dimensions: 'Dimenzije',
      cartographic: 'Matematički podaci',
      numbering: 'Numeracija',
      musicEdition: 'Muzičko izdanje',
      isbn: 'ISBN',
      issn: 'ISSN',
      ismn: 'ISMN',
      cobissId: 'COBISS ID',
      language: 'Jezik',
      originalLanguage: 'Izvorni jezik',
      translationLanguages: 'Jezik sažetka',
      country: 'Država',
      materialType: 'Vrsta građe',
      recordType: 'Vrsta zapisa',
      bibLevel: 'Bibliografski nivo',
      docTypology: 'Tipologija dokumenta',
      illustrations: 'Ilustracije',
      contentTypes: 'Vrsta sadržaja',
      literaryForm: 'Književna forma',
      biography: 'Biografija',
      seriesTitle: 'Naslov edicije',
      seriesSubtitle: 'Podnaslov edicije',
      seriesResponsibility: 'Odgovornost za ediciju',
      seriesIssn: 'ISSN edicije',
      volume: 'Kolo / svezak',
    },
  },

  error: {
    notFoundTitle: 'Ups. Ovdje nema ničega…',
    goHome: 'Nazad na početnu',
  },

  forbidden: {
    title: 'Pristup odbijen',
    text: 'Nemate dozvolu za pregled ove stranice.',
  },

  // The admin area: src/i18n/<locale>/admin/*.ts, one file per page
  admin,
};

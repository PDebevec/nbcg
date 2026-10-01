// Quick publication periods shared by the catalogue filters and the advanced
// search. `from` / `to` are the 4-digit inclusive `yearFrom` / `yearTo` params.

export interface Era {
  key: 'pre1800' | 'c19' | 'e1900' | 'e1950' | 'post2000';
  from?: string;
  to?: string;
}

export const ERAS: Era[] = [
  { key: 'pre1800', to: '1799' },
  { key: 'c19', from: '1800', to: '1899' },
  { key: 'e1900', from: '1900', to: '1949' },
  { key: 'e1950', from: '1950', to: '1999' },
  { key: 'post2000', from: '2000' },
];

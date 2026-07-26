import { ref } from 'vue';

// Module-level state: the catalog search input lives in MainLayout's header
// while CatalogPage consumes it, so both need the same refs.
const searchText = ref('');
const fullText = ref(false);
const searchOpen = ref(true);

export function useCatalogSearch() {
  return { searchText, fullText, searchOpen };
}

import { ref, watch, type Ref } from 'vue';
import { getItem, type ResolvedCode } from 'src/api/search';
import type { ItemType } from 'src/api/admin';

// ---------------------------------------------------------------------------
// The few facts about an item that a task view shows next to the task: title,
// author, year, material type. A task itself carries only `itemId` and
// `itemType`.
//
// ONE item per call site, on purpose: `GET /search/:id` counts an item view
// (it is the public detail read), so this must never be used per row of a
// list — task lists show the task, not the item's title.
// ---------------------------------------------------------------------------

export interface ItemSummary {
  id: string;
  title: string;
  author: string;
  year: string;
  cobissId: string;
  materialType: ResolvedCode | undefined;
  itemType: ItemType | null;
}

export function useItemSummary(itemId: Ref<string | null | undefined>) {
  const item = ref<ItemSummary | null>(null);
  const loading = ref(false);

  async function load(id: string | null | undefined) {
    item.value = null;
    if (!id) return;
    loading.value = true;
    try {
      const hit = await getItem(id);
      // A slower answer for a previous id must not overwrite the current one.
      if (itemId.value !== id) return;
      const m = hit.source.metadata;
      item.value = {
        id,
        title: m?.title ?? '',
        author: m?.firstResponsibility ?? '',
        year: m?.publication?.year ?? m?.publicationDate1 ?? '',
        cobissId: m?.cobissId ?? '',
        materialType: m?.materialType,
        itemType: hit.index === 'records' ? 'RECORD' : hit.index === 'drafts' ? 'DRAFT' : null,
      };
    } catch {
      // The item is gone or not visible to the caller — the task still renders.
      item.value = null;
    } finally {
      if (itemId.value === id) loading.value = false;
    }
  }

  watch(itemId, (id) => void load(id), { immediate: true });

  return { item, loading, reload: () => load(itemId.value) };
}

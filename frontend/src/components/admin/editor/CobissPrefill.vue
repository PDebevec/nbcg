<template>
  <q-card flat bordered>
    <div class="adm-card__body adm-card__body--stack-sm">
      <div class="row items-end q-gutter-x-sm no-wrap">
        <div class="col">
          <label for="cobiss-prefill" class="cobiss-prefill__label">{{ t('admin.edit.cobiss.label') }}</label>
          <q-input
            v-model="cobissId"
            outlined
            dense
            for="cobiss-prefill"
            input-class="adm-mono"
            :placeholder="t('admin.edit.cobiss.placeholder')"
            @keyup.enter="fill"
          />
        </div>
        <q-btn
          unelevated
          no-caps
          color="primary"
          icon="o_cloud_download"
          :label="t('admin.edit.cobiss.fill')"
          :loading="loading"
          :disable="!cobissId.trim()"
          @click="fill"
        />
      </div>
      <span class="text-caption adm-muted">{{ t('admin.edit.cobiss.hint') }}</span>

      <div v-if="existing" class="adm-note adm-note--warning" role="status">
        <q-icon name="o_warning_amber" />
        <span>
          {{ t('admin.edit.cobiss.exists', { type: t(`admin.itemType.${existing.type}`).toLowerCase() }) }}
          <router-link :to="`/admin/items/${existing.id}`">{{ t('admin.edit.cobiss.open') }}</router-link>
        </span>
      </div>
    </div>
  </q-card>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useQuasar } from 'quasar';
import { previewCobiss, type ItemType } from 'src/api/admin';
import { apiErrorMessage, apiErrorStatus } from 'src/api/errors';

// A new item can start from one COBISS record: the form is filled with what an
// import would write, and the save keeps the COBISS ID, so the server gives the
// item the same id an import would — one COBISS record never exists twice.

const emit = defineEmits<{
  (e: 'fill', metadata: Record<string, unknown>): void;
}>();

const { t } = useI18n();
const $q = useQuasar();

const cobissId = ref('');
const loading = ref(false);
/** Already in the catalogue: saving would be refused, so point to it instead. */
const existing = ref<{ id: string; type: ItemType } | null>(null);

async function fill() {
  const id = cobissId.value.trim();
  if (!id || loading.value) return;
  loading.value = true;
  existing.value = null;
  try {
    const preview = await previewCobiss(id);
    if (preview.alreadyExists) {
      existing.value = { id: preview.itemId, type: preview.existsAs ?? 'DRAFT' };
      return;
    }
    emit('fill', preview.metadata);
    $q.notify({ type: 'positive', message: t('admin.edit.cobiss.filled', { id }) });
  } catch (err) {
    $q.notify({
      type: 'negative',
      message:
        apiErrorStatus(err) === 404
          ? t('admin.edit.cobiss.notFound', { id })
          : (apiErrorMessage(err) ?? t('admin.edit.cobiss.failed')),
    });
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped lang="sass">
.cobiss-prefill__label
  display: block
  margin-bottom: 6px
  font-size: 13px
  font-weight: 600
</style>

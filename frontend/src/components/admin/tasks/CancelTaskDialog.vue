<template>
  <q-dialog
    :model-value="modelValue"
    :persistent="saving"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <q-card class="adm-dialog">
      <div class="adm-dialog__head">
        <div class="col column">
          <h2 class="adm-dialog__title">{{ t('admin.tasks.cancel.title') }}</h2>
          <span class="adm-dialog__sub ellipsis">{{ subtitle }}</span>
        </div>
        <q-btn v-close-popup flat round dense icon="o_close" color="grey-8" :disable="saving" />
      </div>

      <div class="adm-dialog__body">
        <div class="adm-note adm-note--warning" role="note">
          <q-icon name="o_warning_amber" />
          <span>{{ t('admin.tasks.cancel.warning') }}</span>
        </div>

        <dl class="cancel-summary">
          <dt>{{ t('admin.tasks.columns.kind') }}</dt>
          <dd><q-badge class="badge-soft badge-soft--outline">{{ t(`admin.tasks.kinds.${task.kind}`) }}</q-badge></dd>
          <dt>{{ t('admin.tasks.detail.assignedTo') }}</dt>
          <dd>
            <UserAvatar :name="task.assignedToName" :size="24" />
            <span>{{ task.assignedToName }}</span>
          </dd>
          <dt>{{ t('admin.tasks.detail.createdBy') }}</dt>
          <dd>
            <UserAvatar :name="task.createdByName" :size="24" />
            <span>{{ task.createdByName }} · {{ formatDate(task.createdAt, locale) }}</span>
          </dd>
        </dl>

        <FormField :label="t('admin.tasks.cancel.reason')" :hint="t('admin.tasks.cancel.reasonHint')">
          <q-input
            v-model="note"
            outlined
            dense
            type="textarea"
            autogrow
            maxlength="5000"
            input-style="min-height: 72px"
          />
        </FormField>
      </div>

      <div class="adm-dialog__foot">
        <span class="adm-dialog__foot-note">{{ t('admin.tasks.cancel.footNote') }}</span>
        <q-btn v-close-popup flat no-caps color="primary" :label="t('admin.tasks.cancel.keep')" :disable="saving" />
        <q-btn
          unelevated
          no-caps
          color="negative"
          icon="o_block"
          :label="t('admin.tasks.cancel.submit')"
          :loading="saving"
          @click="submit"
        />
      </div>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useQuasar } from 'quasar';
import { apiErrorMessage } from 'src/api/errors';
import { cancelTask, type Task, type TaskDetail } from 'src/api/tasks';
import { useCodeLabel } from 'src/composables/useCodeLabel';
import type { ItemSummary } from 'src/composables/useItemSummary';
import { formatDate } from 'src/utils/adminFormat';
import FormField from 'src/components/admin/FormField.vue';
import UserAvatar from 'src/components/admin/UserAvatar.vue';

// Cancel — final. There is no reopen: if the work is still needed, a new task
// is filed, and this one stays in the item's task history.

const props = defineProps<{
  modelValue: boolean;
  task: TaskDetail;
  item: ItemSummary | null;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'done', task: Task): void;
}>();

const { t, locale } = useI18n();
const $q = useQuasar();
const { codeLabel } = useCodeLabel();

const note = ref('');
const saving = ref(false);

const subtitle = computed(() =>
  [
    props.task.title,
    props.item?.title,
    props.item?.materialType ? codeLabel(props.item.materialType) : undefined,
  ]
    .filter(Boolean)
    .join(' · '),
);

watch(
  () => props.modelValue,
  (open) => {
    if (open) note.value = '';
  },
  { immediate: true },
);

async function submit() {
  saving.value = true;
  try {
    const trimmed = note.value.trim();
    const task = await cancelTask(props.task.id, trimmed ? { note: trimmed } : {});
    $q.notify({ type: 'positive', message: t('admin.tasks.cancel.done') });
    emit('done', task);
    emit('update:modelValue', false);
  } catch (err) {
    $q.notify({
      type: 'negative',
      message: apiErrorMessage(err) ?? t('admin.tasks.detail.actionFailed'),
    });
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped lang="sass">
.cancel-summary
  margin: 0
  display: grid
  grid-template-columns: 110px minmax(0, 1fr)
  row-gap: 10px
  column-gap: 12px
  align-items: center
  font-size: 14px
  dt
    color: $muted

  dd
    margin: 0
    display: flex
    align-items: center
    gap: 8px
</style>

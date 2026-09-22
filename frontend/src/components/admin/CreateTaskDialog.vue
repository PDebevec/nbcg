<template>
  <q-dialog :model-value="modelValue" @update:model-value="emit('update:modelValue', $event)">
    <q-card class="create-task-card">
      <q-card-section class="row items-center">
        <div class="text-h6">{{ t('admin.tasks.create.title') }}</div>
        <q-space />
        <q-btn v-close-popup flat round dense icon="close" />
      </q-card-section>

      <q-card-section class="q-gutter-md">
        <q-select
          v-model="kind"
          :options="kindOptions"
          emit-value
          map-options
          outlined
          :label="t('admin.tasks.create.kind')"
        />

        <q-input
          v-model="title"
          outlined
          maxlength="200"
          counter
          :label="t('admin.tasks.create.taskTitle')"
          :error="submitted && !title.trim()"
          :error-message="t('admin.tasks.create.titleRequired')"
          @update:model-value="titleTouched = true"
        />

        <q-input
          v-model="description"
          outlined
          type="textarea"
          autogrow
          maxlength="5000"
          :label="t('admin.tasks.create.description')"
        />

        <AssigneePicker
          v-model="assignee"
          :kind="kind"
          status="OPEN"
          :error="submitted && !assignee"
          :error-message="t('admin.tasks.create.assigneeRequired')"
        />
      </q-card-section>

      <q-card-actions align="right" class="q-pa-md">
        <q-btn v-close-popup flat no-caps :label="t('admin.items.cancel')" />
        <q-btn
          unelevated
          no-caps
          color="primary"
          icon="assignment_ind"
          :label="t('admin.tasks.create.submit')"
          :loading="saving"
          @click="submit"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useQuasar } from 'quasar';
import type { ItemType } from 'src/api/admin';
import { apiErrorMessage, createTask, TASK_KINDS, type Task, type TaskKind } from 'src/api/tasks';
import type { PickedUser } from 'src/api/users';
import AssigneePicker from 'src/components/admin/AssigneePicker.vue';

// ---------------------------------------------------------------------------
// "Assign task" — kind → title → description → capability-aware picker → POST.
// The server re-derives the required capability from the kind and re-checks
// the assignee, so a 400 here is surfaced verbatim: its message says what to
// do (including the users/sync hint for a stale directory).
// ---------------------------------------------------------------------------

const props = defineProps<{
  modelValue: boolean;
  itemId: string;
  /** Picks the default kind: a draft is usually ready for review, a record usually needs a fix. */
  itemType: ItemType | null;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'created', task: Task): void;
}>();

const { t } = useI18n();
const $q = useQuasar();

const kind = ref<TaskKind>('GENERAL');
const title = ref('');
const titleTouched = ref(false);
const description = ref('');
const assignee = ref<PickedUser | null>(null);
const submitted = ref(false);
const saving = ref(false);

const kindOptions = computed(() =>
  TASK_KINDS.map((k) => ({ label: t(`admin.tasks.kinds.${k}`), value: k })),
);

function reset() {
  kind.value = props.itemType === 'RECORD' ? 'FIX_METADATA' : 'REVIEW_PUBLISH';
  title.value = t(`admin.tasks.create.defaultTitle.${kind.value}`);
  titleTouched.value = false;
  description.value = '';
  assignee.value = null;
  submitted.value = false;
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) reset();
  },
);

// Prefill the title per kind until the user types their own.
watch(kind, (k) => {
  if (!titleTouched.value) title.value = t(`admin.tasks.create.defaultTitle.${k}`);
});

async function submit() {
  submitted.value = true;
  if (!title.value.trim() || !assignee.value) return;

  saving.value = true;
  try {
    const task = await createTask({
      itemId: props.itemId,
      kind: kind.value,
      title: title.value.trim(),
      ...(description.value.trim() ? { description: description.value.trim() } : {}),
      assignedToUserId: assignee.value.userId,
    });
    $q.notify({
      type: 'positive',
      message: t('admin.tasks.create.created', { name: task.assignedToName }),
    });
    emit('created', task);
    emit('update:modelValue', false);
  } catch (err) {
    $q.notify({
      type: 'negative',
      message: apiErrorMessage(err) ?? t('admin.tasks.create.failed'),
    });
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped lang="sass">
.create-task-card
  width: 560px
  max-width: 95vw
</style>

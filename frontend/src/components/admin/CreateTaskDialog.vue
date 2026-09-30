<template>
  <q-dialog :model-value="modelValue" @update:model-value="emit('update:modelValue', $event)">
    <q-card class="adm-dialog">
      <div class="adm-dialog__head">
        <div class="col column">
          <h2 class="adm-dialog__title">{{ t('admin.tasks.create.title') }}</h2>
          <span v-if="itemTitle" class="adm-dialog__sub ellipsis">{{ itemTitle }}</span>
        </div>
        <q-btn v-close-popup flat round dense icon="o_close" color="grey-8" />
      </div>

      <div class="adm-dialog__body">
        <!-- One open task per item: the server said there already is one. -->
        <div v-if="blockingTaskId" class="adm-note adm-note--warning" role="alert">
          <q-icon name="o_info" />
          <span>
            {{ t('admin.tasks.create.hasOpenTask') }}
            <router-link v-close-popup :to="`/admin/tasks/${blockingTaskId}`">
              {{ t('admin.tasks.openTask') }}
            </router-link>
          </span>
        </div>

        <div class="row q-col-gutter-md">
          <div class="col-12 col-sm-6">
            <FormField :label="t('admin.tasks.create.kind')">
              <q-select v-model="kind" :options="kindOptions" emit-value map-options outlined dense />
            </FormField>
          </div>
          <div class="col-12 col-sm-6">
            <AssigneePicker
              v-model="assignee"
              :kind="kind"
              :item-type="itemType"
              required
              show-assign-to-me
              :error="submitted && !assignee"
              :error-message="t('admin.tasks.create.assigneeRequired')"
            />
          </div>
        </div>

        <FormField :label="t('admin.tasks.create.taskTitle')" required>
          <q-input
            v-model="title"
            outlined
            dense
            maxlength="200"
            hide-bottom-space
            :error="submitted && !title.trim()"
            :error-message="t('admin.tasks.create.titleRequired')"
            @update:model-value="titleTouched = true"
          />
        </FormField>

        <FormField :label="t('admin.tasks.create.description')">
          <q-input v-model="description" outlined dense type="textarea" autogrow maxlength="5000" />
        </FormField>
      </div>

      <div class="adm-dialog__foot">
        <span class="adm-dialog__foot-note">{{ t('admin.tasks.create.footNote') }}</span>
        <q-btn v-close-popup flat no-caps color="primary" :label="t('admin.common.cancel')" />
        <q-btn
          unelevated
          no-caps
          color="primary"
          icon="o_person_add"
          :label="t('admin.tasks.create.submit')"
          :loading="saving"
          :disable="!!blockingTaskId"
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
import type { ItemType } from 'src/api/admin';
import { apiErrorMessage, openTaskConflict } from 'src/api/errors';
import { createTask, TASK_KINDS, type Task, type TaskKind } from 'src/api/tasks';
import type { PickedUser } from 'src/api/users';
import AssigneePicker from 'src/components/admin/AssigneePicker.vue';
import FormField from 'src/components/admin/FormField.vue';

// ---------------------------------------------------------------------------
// "Assign task" on one item — stage → assignee → title → description → POST.
// The server re-derives the required capability from the stage and re-checks
// the assignee, so a 400 here is surfaced verbatim: its message says what to
// do (including the users/sync hint for a stale directory). A
// `409 ITEM_HAS_OPEN_TASK` links to the task that is in the way.
// ---------------------------------------------------------------------------

const props = defineProps<{
  modelValue: boolean;
  itemId: string;
  /** Picks the default stage: a draft is usually ready for review, a record usually needs a fix. */
  itemType: ItemType | null;
  itemTitle?: string | undefined;
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
const blockingTaskId = ref<string | undefined>();

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
  blockingTaskId.value = undefined;
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) reset();
  },
);

// Prefill the title per stage until the user types their own.
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
    blockingTaskId.value = openTaskConflict(err);
    if (!blockingTaskId.value) {
      $q.notify({
        type: 'negative',
        message: apiErrorMessage(err) ?? t('admin.tasks.create.failed'),
      });
    }
  } finally {
    saving.value = false;
  }
}
</script>

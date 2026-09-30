<template>
  <q-dialog
    :model-value="modelValue"
    :persistent="saving"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <q-card class="adm-dialog">
      <div class="adm-dialog__head">
        <div class="col column">
          <h2 class="adm-dialog__title">{{ t('admin.tasks.reassign.title') }}</h2>
          <span class="adm-dialog__sub ellipsis">{{ subtitle }}</span>
        </div>
        <q-btn v-close-popup flat round dense icon="o_close" color="grey-8" :disable="saving" />
      </div>

      <div class="adm-dialog__body">
        <div class="holder-strip">
          <UserAvatar :name="task.assignedToName" :size="28" />
          <span class="col">
            <i18n-t keypath="admin.tasks.reassign.nowWith" tag="span">
              <template #name>
                <strong>{{ task.assignedToName }}</strong>
              </template>
            </i18n-t>
            <template v-if="task.assignedToUserId === auth.userId"> ({{ t('admin.common.you') }})</template>
          </span>
          <q-badge class="badge-soft badge-soft--outline">{{ t(`admin.tasks.kinds.${task.kind}`) }}</q-badge>
        </div>

        <!-- Never yourself, never the current holder — the server refuses both. -->
        <AssigneePicker
          v-model="assignee"
          :kind="task.kind"
          :item-type="task.itemType"
          :label="t('admin.tasks.reassign.newAssignee')"
          required
          :exclude-user-ids="excluded"
          :error="submitted && !assignee"
          :error-message="t('admin.tasks.create.assigneeRequired')"
        />

        <FormField :label="t('admin.tasks.dialogs.noteOptional')">
          <q-input
            v-model="note"
            outlined
            dense
            type="textarea"
            autogrow
            maxlength="5000"
            :placeholder="t('admin.tasks.reassign.notePlaceholder')"
            input-style="min-height: 72px"
          />
        </FormField>
      </div>

      <div class="adm-dialog__foot">
        <span class="adm-dialog__foot-note">
          {{ t('admin.tasks.reassign.footNote', { stage: t(`admin.tasks.kinds.${task.kind}`) }) }}
        </span>
        <q-btn v-close-popup flat no-caps color="primary" :label="t('admin.common.cancel')" :disable="saving" />
        <q-btn
          unelevated
          no-caps
          color="primary"
          icon="o_swap_horiz"
          :label="t('admin.tasks.reassign.submit')"
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
import { reassignTask, type Task, type TaskDetail } from 'src/api/tasks';
import type { PickedUser } from 'src/api/users';
import { auth } from 'src/services/keycloak';
import { useCodeLabel } from 'src/composables/useCodeLabel';
import type { ItemSummary } from 'src/composables/useItemSummary';
import AssigneePicker from 'src/components/admin/AssigneePicker.vue';
import FormField from 'src/components/admin/FormField.vue';
import UserAvatar from 'src/components/admin/UserAvatar.vue';

// Reassign — the same stage, a different person. The new holder goes on top of
// the handoff stack, so they can return the task to whoever reassigned it.

const props = defineProps<{
  modelValue: boolean;
  task: TaskDetail;
  item: ItemSummary | null;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'done', task: Task): void;
}>();

const { t } = useI18n();
const $q = useQuasar();
const { codeLabel } = useCodeLabel();

const assignee = ref<PickedUser | null>(null);
const note = ref('');
const submitted = ref(false);
const saving = ref(false);

const excluded = computed(() =>
  [props.task.assignedToUserId, auth.userId].filter((id): id is string => !!id),
);

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
    if (!open) return;
    assignee.value = null;
    note.value = '';
    submitted.value = false;
  },
  { immediate: true },
);

async function submit() {
  submitted.value = true;
  if (!assignee.value) return;

  saving.value = true;
  try {
    const trimmed = note.value.trim();
    const task = await reassignTask(props.task.id, {
      assignedToUserId: assignee.value.userId,
      ...(trimmed ? { note: trimmed } : {}),
    });
    $q.notify({
      type: 'positive',
      message: t('admin.tasks.reassign.done', { name: assignee.value.displayName }),
    });
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
.holder-strip
  display: flex
  align-items: center
  gap: 10px
  padding: 12px 14px
  background: $paper-deep
  border: 1px solid $divider
  border-radius: $radius
  font-size: 14px
</style>

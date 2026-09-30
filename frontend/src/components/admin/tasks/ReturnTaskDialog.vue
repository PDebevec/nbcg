<template>
  <q-dialog
    :model-value="modelValue"
    :persistent="saving"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <q-card v-if="target" class="adm-dialog">
      <div class="adm-dialog__head">
        <div class="col column">
          <h2 class="adm-dialog__title">{{ t('admin.tasks.return.title') }}</h2>
          <span class="adm-dialog__sub ellipsis">{{ subtitle }}</span>
        </div>
        <q-btn v-close-popup flat round dense icon="o_close" color="grey-8" :disable="saving" />
      </div>

      <div class="adm-dialog__body">
        <!-- Where it goes: person AND stage, from the task's handoff stack -->
        <div class="target-strip">
          <UserAvatar :name="(override ?? target).displayName" :size="28" />
          <span class="col">
            <i18n-t :keypath="goesToMe ? 'admin.tasks.return.goesBackToYou' : 'admin.tasks.return.goesBackTo'" tag="span">
              <template #name>
                <strong>{{ (override ?? target).displayName }}</strong>
              </template>
            </i18n-t>
          </span>
          <q-badge class="badge-soft badge-soft--outline">{{ t(`admin.tasks.kinds.${target.kind}`) }}</q-badge>
        </div>

        <FormField :label="t('admin.tasks.return.note')" required :hint="t('admin.tasks.return.noteHint')">
          <q-input
            v-model="note"
            outlined
            dense
            type="textarea"
            autogrow
            autofocus
            maxlength="5000"
            hide-bottom-space
            input-style="min-height: 88px"
            :error="submitted && !note.trim()"
            :error-message="t('admin.tasks.return.noteRequired')"
          />
        </FormField>

        <!-- The stored person may have left; the stage is not negotiable. -->
        <AssigneePicker
          v-model="override"
          :kind="target.kind"
          :item-type="task.itemType"
          :label="t('admin.tasks.return.someoneElse')"
          :placeholder="target.displayName"
          :hint="t('admin.tasks.return.someoneElseHint')"
          :exclude-user-ids="[task.assignedToUserId]"
        />
      </div>

      <div class="adm-dialog__foot">
        <span class="adm-dialog__foot-note">{{ t('admin.tasks.return.footNote') }}</span>
        <q-btn v-close-popup flat no-caps color="primary" :label="t('admin.common.cancel')" :disable="saving" />
        <q-btn
          unelevated
          no-caps
          color="primary"
          icon="o_undo"
          :label="t('admin.tasks.return.submit')"
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
import { returnTask, type Task, type TaskDetail } from 'src/api/tasks';
import type { PickedUser } from 'src/api/users';
import { auth } from 'src/services/keycloak';
import { useCodeLabel } from 'src/composables/useCodeLabel';
import type { ItemSummary } from 'src/composables/useItemSummary';
import AssigneePicker from 'src/components/admin/AssigneePicker.vue';
import FormField from 'src/components/admin/FormField.vue';
import UserAvatar from 'src/components/admin/UserAvatar.vue';

// ---------------------------------------------------------------------------
// Return — one step back on the task's handoff stack: to the previous holder
// in the stage they held it, or to the person who filed it (a returned review
// lands there as a metadata fix). `returnTarget` on the task is exactly that
// computation. A note is required; choosing someone else changes the person,
// never the stage.
// ---------------------------------------------------------------------------

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

const target = computed(() => props.task.returnTarget);

const note = ref('');
const override = ref<PickedUser | null>(null);
const submitted = ref(false);
const saving = ref(false);

const goesToMe = computed(() => (override.value ?? target.value)?.userId === auth.userId);

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
    note.value = '';
    override.value = null;
    submitted.value = false;
  },
  { immediate: true },
);

async function submit() {
  submitted.value = true;
  const trimmed = note.value.trim();
  if (!trimmed || !target.value) return;

  saving.value = true;
  try {
    const task = await returnTask(props.task.id, {
      note: trimmed,
      ...(override.value ? { assignedToUserId: override.value.userId } : {}),
    });
    $q.notify({
      type: 'positive',
      message: t('admin.tasks.return.done', { name: task.assignedToName }),
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
.target-strip
  display: flex
  align-items: center
  gap: 12px
  padding: 12px 14px
  background: $paper-deep
  border: 1px solid $divider
  border-radius: $radius
  font-size: 14px
</style>

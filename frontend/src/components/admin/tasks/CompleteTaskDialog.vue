<template>
  <q-dialog
    :model-value="modelValue"
    :persistent="saving"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <q-card class="adm-dialog" :class="{ 'adm-dialog--wide': mode === 'publish' }">
      <div class="adm-dialog__head">
        <div class="col column">
          <h2 class="adm-dialog__title">{{ t(`admin.tasks.complete.title.${mode}`) }}</h2>
          <span class="adm-dialog__sub ellipsis">{{ subtitle }}</span>
        </div>
        <q-btn v-close-popup flat round dense icon="o_close" color="grey-8" :disable="saving" />
      </div>

      <div class="adm-dialog__body">
        <!-- GENERAL: finish, or hand the same task on to one of two stages -->
        <template v-if="mode === 'general'">
          <FormField :label="t('admin.tasks.complete.whatNext')" required>
            <div class="column q-gutter-y-sm">
              <label
                v-for="option in nextOptions"
                :key="option.value"
                class="next-option"
                :class="{ 'next-option--active': next === option.value }"
              >
                <q-radio v-model="next" :val="option.value" dense />
                <span class="column">
                  <span class="next-option__title">{{ option.title }}</span>
                  <span class="next-option__text">{{ option.text }}</span>
                </span>
              </label>
            </div>
          </FormField>
          <AssigneePicker
            v-if="nextKind"
            v-model="assignee"
            :kind="nextKind"
            :item-type="task.itemType"
            :label="t('admin.tasks.complete.handOnTo')"
            required
            show-assign-to-me
            :error="submitted && !assignee"
            :error-message="t('admin.tasks.create.assigneeRequired')"
          />
        </template>

        <!-- FIX_METADATA: always handed on for review -->
        <template v-else-if="mode === 'handOn'">
          <div class="stage-strip">
            <q-badge class="badge-soft badge-soft--outline">{{ t('admin.tasks.kinds.FIX_METADATA') }}</q-badge>
            <q-icon name="o_arrow_forward" size="16px" />
            <q-badge class="badge-soft badge-soft--primary">{{ t('admin.tasks.kinds.REVIEW_PUBLISH') }}</q-badge>
            <span class="col">{{ t('admin.tasks.complete.sameTask') }}</span>
          </div>
          <AssigneePicker
            v-model="assignee"
            kind="REVIEW_PUBLISH"
            :item-type="task.itemType"
            :label="t('admin.tasks.complete.reviewer')"
            :hint="reviewerHint"
            required
            show-assign-to-me
            :error="submitted && !assignee"
            :error-message="t('admin.tasks.create.assigneeRequired')"
          />
        </template>

        <!-- REVIEW_PUBLISH on a draft: completing it publishes the item -->
        <template v-else-if="mode === 'publish'">
          <div class="adm-note adm-note--warning publish-warning" role="alert">
            <q-icon name="o_warning_amber" />
            <span>{{ t('admin.tasks.complete.publishWarning') }}</span>
          </div>

          <div class="column q-gutter-y-sm">
            <div class="row items-baseline q-gutter-x-sm">
              <span class="check-label">{{ t('admin.tasks.complete.checkTitle') }}</span>
              <span class="text-caption adm-muted">{{ t('admin.tasks.complete.checkCaption') }}</span>
            </div>
            <q-list bordered class="check-list">
              <q-item v-if="checking">
                <q-item-section><q-skeleton type="text" /></q-item-section>
              </q-item>
              <q-item v-else-if="checkFailed">
                <q-item-section class="adm-muted">{{ t('admin.tasks.complete.checkFailed') }}</q-item-section>
              </q-item>
              <template v-else>
                <q-item v-for="row in problems" :key="row.key" class="check-list__problem">
                  <q-item-section side class="check-list__kind" :class="{ 'check-list__kind--check': !row.missing }">
                    {{ row.missing ? t('admin.validation.missing') : t('admin.validation.check') }}
                  </q-item-section>
                  <q-item-section>
                    <span>
                      <strong>{{ row.label }}</strong>
                      <span v-if="row.text" class="adm-muted"> · {{ row.text }}</span>
                    </span>
                  </q-item-section>
                  <q-item-section side>
                    <router-link v-close-popup :to="`/admin/items/${task.itemId}`" class="adm-link check-list__link">
                      {{ t('admin.common.openInEditor') }}
                      <q-icon name="o_arrow_forward" size="14px" />
                    </router-link>
                  </q-item-section>
                </q-item>
                <q-item v-if="problems.length === 0">
                  <q-item-section side><q-icon name="o_check" color="positive" size="18px" /></q-item-section>
                  <q-item-section>{{ t('admin.tasks.complete.checkOk') }}</q-item-section>
                </q-item>
              </template>
            </q-list>
          </div>
        </template>

        <!-- REVIEW_PUBLISH on a record: nothing to publish, the review is confirmed -->
        <div v-else class="adm-note">
          <q-icon name="o_info" />
          <span>{{ t('admin.tasks.complete.alreadyPublished') }}</span>
        </div>

        <FormField :label="t('admin.tasks.dialogs.noteOptional')">
          <q-input
            v-model="note"
            outlined
            dense
            type="textarea"
            autogrow
            maxlength="5000"
            :placeholder="t('admin.tasks.complete.notePlaceholder')"
            input-style="min-height: 56px"
          />
        </FormField>

        <div v-if="mode === 'handOn'" class="row no-wrap items-start q-gutter-x-sm text-caption adm-muted">
          <q-icon name="o_info" size="16px" />
          <span>
            {{
              task.itemType === 'RECORD'
                ? t('admin.tasks.complete.reviewOfRecord')
                : t('admin.tasks.complete.reviewOfDraft')
            }}
          </span>
        </div>
      </div>

      <div class="adm-dialog__foot">
        <span class="adm-dialog__foot-note">{{ footNote }}</span>
        <q-btn v-close-popup flat no-caps color="primary" :label="t('admin.common.cancel')" :disable="saving" />
        <q-btn
          v-if="mode !== 'publish' || canTransition"
          unelevated
          no-caps
          :color="mode === 'publish' ? 'positive' : 'primary'"
          :icon="submitIcon"
          :label="submitLabel"
          :loading="saving"
          :disable="mode === 'publish' && (checking || problems.length > 0)"
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
import { getItemValidation } from 'src/api/admin';
import { apiErrorMessage, validationFailure } from 'src/api/errors';
import { completeTask, type Task, type TaskDetail, type TaskKind } from 'src/api/tasks';
import type { PickedUser } from 'src/api/users';
import { useAuthz } from 'src/composables/useAuthz';
import { useCodeLabel } from 'src/composables/useCodeLabel';
import type { ItemSummary } from 'src/composables/useItemSummary';
import { useSchemaLabel } from 'src/composables/useSchemaForm';
import type { CheckResult } from 'src/utils/schemaRules';
import { completeMode } from 'src/utils/taskRules';
import AssigneePicker from 'src/components/admin/AssigneePicker.vue';
import FormField from 'src/components/admin/FormField.vue';

// ---------------------------------------------------------------------------
// Complete — what it does depends on the stage (task workflow v2):
//
//   GENERAL                     finish, or hand on to FIX_METADATA / REVIEW_PUBLISH
//   FIX_METADATA                always handed on for review (a reviewer is required)
//   REVIEW_PUBLISH on a DRAFT   PUBLISHES the item — warning + the publish check
//   REVIEW_PUBLISH on a RECORD  the review is confirmed, nothing else happens
//
// The publish check shown here is the server's dry run of the save check; the
// server runs it again inside the publish, and a refusal comes back as
// `400 METADATA_VALIDATION_FAILED` with the task still open.
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
const { canTransition } = useAuthz();
const { codeLabel } = useCodeLabel();
const { tl } = useSchemaLabel();

const mode = computed(() => completeMode(props.task));

const subtitle = computed(() =>
  [
    props.task.title,
    props.item?.title,
    props.item?.materialType ? codeLabel(props.item.materialType) : undefined,
  ]
    .filter(Boolean)
    .join(' · '),
);

// ── State ──

/** GENERAL only: 'done', or the stage to hand on to. */
const next = ref<'done' | TaskKind>('done');
const assignee = ref<PickedUser | null>(null);
const note = ref('');
const submitted = ref(false);
const saving = ref(false);
/** The reviewer was prefilled from the history (the person who returned the task). */
const suggested = ref(false);

const nextKind = computed<TaskKind | null>(() => {
  if (mode.value === 'handOn') return 'REVIEW_PUBLISH';
  if (mode.value === 'general' && next.value !== 'done') return next.value;
  return null;
});

const nextOptions = computed(() => [
  {
    value: 'done' as const,
    title: t('admin.tasks.complete.next.done'),
    text: t('admin.tasks.complete.next.doneText'),
  },
  {
    value: 'FIX_METADATA' as const,
    title: t('admin.tasks.complete.next.fix'),
    text: t('admin.tasks.complete.next.fixText'),
  },
  {
    value: 'REVIEW_PUBLISH' as const,
    title: t('admin.tasks.complete.next.review'),
    text: t('admin.tasks.complete.next.reviewText'),
  },
]);

const reviewerHint = computed(() =>
  suggested.value && assignee.value
    ? t('admin.tasks.complete.reviewerSuggested', { name: assignee.value.displayName })
    : undefined,
);

// ── Publish check (review of a draft) ──

const check = ref<CheckResult | null>(null);
const checking = ref(false);
const checkFailed = ref(false);

const problems = computed(() => [
  ...(check.value?.missing ?? []).map((m) => ({
    key: `m-${m.path}`,
    missing: true,
    label: tl(m.label) || m.path,
    text: '',
  })),
  ...(check.value?.violations ?? []).map((v) => ({
    key: `v-${v.path}-${v.constraint}`,
    missing: false,
    label: tl(v.label) || v.path,
    text:
      v.constraint === 'pattern' && v.hint
        ? tl(v.hint)
        : t(`admin.validation.constraints.${v.constraint}`, { limit: v.limit ?? '' }),
  })),
]);

async function runCheck() {
  checking.value = true;
  checkFailed.value = false;
  try {
    const result = await getItemValidation(props.task.itemId, 'RECORD');
    check.value = { missing: result.missing, violations: result.violations };
  } catch {
    // Not blocking: the server checks again when the button is pressed.
    check.value = null;
    checkFailed.value = true;
  } finally {
    checking.value = false;
  }
}

function reset() {
  next.value = 'done';
  note.value = '';
  submitted.value = false;
  assignee.value = null;
  suggested.value = false;
  check.value = null;

  if (mode.value === 'handOn') {
    // The person who sent it back is the obvious reviewer for the fix.
    const returned = [...props.task.history].reverse().find((entry) => entry.action === 'RETURNED');
    if (returned) {
      assignee.value = { userId: returned.userId, displayName: returned.userName };
      suggested.value = true;
    }
  }
  if (mode.value === 'publish') void runCheck();
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) reset();
  },
  { immediate: true },
);

watch(assignee, (value, previous) => {
  if (previous && value?.userId !== previous.userId) suggested.value = false;
});

// ── Footer ──

const footNote = computed(() => {
  switch (mode.value) {
    case 'general':
      return t('admin.tasks.complete.footGeneral');
    case 'handOn':
      return t('admin.tasks.complete.footHandOn');
    case 'publish':
      if (!canTransition.value) return t('admin.tasks.complete.publisherOnly');
      return problems.value.length > 0
        ? t('admin.tasks.complete.footMissing', { count: problems.value.length })
        : t('admin.tasks.complete.footPublish');
    default:
      return t('admin.tasks.complete.footConfirm');
  }
});

const submitLabel = computed(() => {
  if (mode.value === 'publish') return t('admin.tasks.complete.submit.publish');
  if (mode.value === 'confirm') return t('admin.tasks.complete.submit.confirm');
  return nextKind.value
    ? t('admin.tasks.complete.submit.handOn')
    : t('admin.tasks.complete.submit.done');
});

const submitIcon = computed(() => {
  if (mode.value === 'publish') return 'o_publish';
  return nextKind.value ? 'o_arrow_forward' : 'o_check';
});

async function submit() {
  submitted.value = true;
  if (nextKind.value && !assignee.value) return;

  saving.value = true;
  try {
    const trimmed = note.value.trim();
    const task = await completeTask(props.task.id, {
      ...(trimmed ? { note: trimmed } : {}),
      ...(nextKind.value && assignee.value
        ? { next: { kind: nextKind.value, assignedToUserId: assignee.value.userId } }
        : {}),
    });
    $q.notify({
      type: 'positive',
      message:
        nextKind.value && assignee.value
          ? t('admin.tasks.complete.doneHandOn', { name: assignee.value.displayName })
          : mode.value === 'publish'
            ? t('admin.tasks.complete.donePublish')
            : t('admin.tasks.complete.doneCompleted'),
    });
    emit('done', task);
    emit('update:modelValue', false);
  } catch (err) {
    // The server's own check refused the publish: show what IT found.
    const failure = validationFailure(err);
    if (failure?.items[0]) {
      check.value = { missing: failure.items[0].missing, violations: failure.items[0].violations };
      checkFailed.value = false;
    }
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
.next-option
  display: flex
  align-items: flex-start
  gap: 12px
  padding: 12px 14px
  border: 1px solid $divider
  border-radius: $radius
  background: $surface
  cursor: pointer

.next-option--active
  border-color: $primary
  background: #EEF0F6

.next-option__title
  font-size: 14px
  font-weight: 600

.next-option__text
  font-size: 13px
  line-height: 1.4
  color: $muted

.stage-strip
  display: flex
  align-items: center
  gap: 10px
  padding: 12px 14px
  background: $paper-deep
  border: 1px solid $divider
  border-radius: $radius
  font-size: 14px
  color: $ink-soft

.publish-warning
  align-items: center
  font-weight: 700
  letter-spacing: 0.04em
  text-transform: uppercase

.check-label
  font-size: 13px
  font-weight: 600
  color: $ink-soft

.check-list
  border-color: $divider
  border-radius: $radius
  overflow: hidden
  font-size: 14px

.check-list__problem
  background: #FBF3E2
  border-bottom: 1px solid $divider

.check-list__kind
  width: 72px
  font-size: 11px
  font-weight: 700
  letter-spacing: 0.06em
  text-transform: uppercase
  color: $soft-warning-ink

.check-list__kind--check
  color: $soft-negative-ink

.check-list__link
  font-size: 13px
</style>

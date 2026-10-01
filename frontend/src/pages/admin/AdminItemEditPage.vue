<template>
  <q-page class="adm-page">
    <AdminPageHeader
      :eyebrow="targetState === 'RECORD' ? t('admin.nav.records') : t('admin.nav.drafts')"
      :back-to="listPath"
      :title="headerTitle"
      :caption="headerCaption"
    >
      <template v-if="!loading && !loadError" #title-append>
        <VisibilityBadge :status="visibilityStatus" />
      </template>
      <template v-if="!isNew && !loading && !loadError" #actions>
        <q-btn
          v-if="itemType === 'RECORD'"
          outline
          no-caps
          color="primary"
          icon="o_open_in_new"
          :label="t('admin.items.openPublic')"
          :to="`/catalog/${itemId}`"
          target="_blank"
        />
        <q-btn
          v-if="isStaff && openTask"
          outline
          no-caps
          color="primary"
          icon="o_assignment_turned_in"
          :label="t('admin.tasks.openTask')"
          :to="`/admin/tasks/${openTask.id}`"
        />
        <q-btn
          v-else-if="isStaff"
          outline
          no-caps
          color="primary"
          icon="o_person_add"
          :label="t('admin.edit.assignTask')"
          @click="assignOpen = true"
        />
      </template>
    </AdminPageHeader>

    <q-banner v-if="loadError" class="bg-negative text-white" rounded>
      {{ t('admin.edit.loadFailed') }}
    </q-banner>

    <div v-else class="edit-grid">
      <div class="edit-main">
        <!-- TAB STRIP: its own slim card -->
        <q-card flat bordered class="tabs-card">
          <q-tabs
            v-model="tab"
            align="left"
            active-color="primary"
            indicator-color="primary"
            narrow-indicator
            no-caps
            inline-label
            @update:model-value="onTabChange"
          >
            <q-tab name="form" icon="o_edit" :label="t('admin.edit.tabForm')" />
            <q-tab name="json" icon="o_data_object" :label="t('admin.edit.tabJson')" />
            <q-tab v-if="!isNew" name="files" icon="o_attach_file" :label="t('admin.edit.tabFiles')">
              <q-badge
                v-if="files.length"
                class="badge-soft badge-soft--sm q-ml-sm"
                :class="tab === 'files' ? 'badge-soft--solid' : 'badge-soft--muted'"
              >
                {{ files.length }}
              </q-badge>
            </q-tab>
            <q-tab v-if="!isNew" name="history" icon="o_history" :label="t('admin.edit.tabHistory')" />
            <q-tab
              v-if="!isNew && isStaff"
              name="tasks"
              icon="o_assignment_turned_in"
              :label="t('admin.edit.tabTasks')"
            >
              <q-badge v-if="openTask" class="badge-soft badge-soft--sm badge-soft--warning q-ml-sm">1</q-badge>
            </q-tab>
          </q-tabs>
        </q-card>

        <div v-if="loading">
          <q-skeleton v-for="i in 6" :key="i" type="rect" height="56px" class="q-mb-md" />
        </div>

        <!-- ───────────── FORM ───────────── -->
        <template v-else-if="tab === 'form'">
          <q-banner v-if="schemaStore.failed" dense rounded class="adm-note adm-note--warning">
            {{ t('admin.edit.schemaFailed') }}
          </q-banner>

          <!-- SAVE READINESS: the same rules the API's save check runs -->
          <div
            v-if="readiness"
            class="adm-note readiness"
            :class="readiness.blocking ? 'adm-note--negative' : 'adm-note--warning'"
            role="status"
          >
            <q-icon :name="readiness.blocking ? 'o_error_outline' : 'o_info'" />
            <span>
              <strong>{{ readiness.lead }}</strong>
              <template v-for="(item, index) in readiness.items" :key="item.path">
                {{ index === 0 ? ' ' : ', ' }}
                <a href="#" @click.prevent="editor.goToField(item.path)">{{ item.label }}</a>
              </template>.
              {{ readiness.tail }}
            </span>
          </div>

          <!-- PARENT: the context the rules need -->
          <div v-for="parent in parents" :key="parent.id" class="parent-band">
            <q-avatar square size="40px" class="parent-band__icon">
              <q-icon name="o_account_tree" size="20px" />
            </q-avatar>
            <div class="col column parent-band__text">
              <span>
                <strong>
                  {{ parent.serial ? t('admin.edit.parent.issueOf') : t('admin.edit.parent.partOf') }}
                </strong>
                <router-link :to="`/admin/items/${parent.id}`">{{ parent.title || parent.id }}</router-link>
                <template v-if="parent.issn"> · ISSN {{ parent.issn }}</template>
                <template v-if="parent.children"> · {{ t('admin.edit.parent.children', { count: parent.children }) }}</template>
              </span>
              <span v-if="parent.serial" class="parent-band__note">{{ t('admin.edit.parent.serialNote') }}</span>
            </div>
            <q-btn
              outline
              no-caps
              dense
              color="primary"
              :label="t('admin.edit.parent.open')"
              :to="`/admin/items/${parent.id}`"
            />
          </div>

          <!-- MATERIAL TYPE: the first decision — it sets which fields the form shows -->
          <div id="section-type" class="type-band">
            <q-avatar square size="44px" class="type-band__icon">
              <q-icon :name="materialTypeIcon(form.materialType?.code)" size="22px" />
            </q-avatar>
            <div class="type-band__field">
              <label for="input-materialType" class="type-band__label">
                {{ schemaForm.label('materialType') }} <span class="type-band__star">*</span>
              </label>
              <CodeSelect
                :model-value="form.materialType"
                :options="schemaStore.codes('materialType')"
                for-id="input-materialType"
                show-code
                class="type-band__select"
                :class="{ 'type-band__select--missing': !form.materialType }"
                @update:model-value="onMaterialTypeChange"
              />
            </div>
            <div class="col column type-band__text">
              <span v-if="form.materialType">
                <strong>{{ typeLine }}.</strong>
                {{ t('admin.edit.type.shows', { count: editor.sections.value.length }) }}
              </span>
              <span v-else>
                <strong>{{ t('admin.edit.type.chooseFirst') }}</strong>
                {{ t('admin.edit.type.chooseFirstText') }}
              </span>
              <span v-if="editor.hiddenFields.value.length" class="type-band__folded">
                {{ t('admin.edit.type.folded', { count: editor.hiddenFields.value.length }) }}
                {{ foldedLabels }}.
                <a href="#" @click.prevent="showOtherFields">{{ t('admin.edit.type.showAll') }}</a>
              </span>
            </div>
          </div>

          <ItemMetadataForm v-model:visibility="visibilityStatus" />
        </template>

        <!-- ───────────── JSON ───────────── -->
        <q-card v-else-if="tab === 'json'" flat bordered>
          <div class="adm-card__body adm-card__body--stack">
            <div class="row items-center q-gutter-x-md">
              <span class="col text-caption adm-muted">{{ t('admin.edit.jsonHint') }}</span>
              <q-badge class="badge-soft" :class="jsonValid ? 'badge-soft--positive' : 'badge-soft--negative'">
                <q-icon :name="jsonValid ? 'o_check' : 'o_error_outline'" size="13px" />
                {{ jsonValid ? t('admin.edit.jsonValid') : t('admin.edit.invalidJson') }}
              </q-badge>
            </div>
            <q-input
              v-model="jsonText"
              outlined
              type="textarea"
              spellcheck="false"
              input-class="adm-mono json-input"
              input-style="min-height: 460px; font-size: 13px; line-height: 1.65; white-space: pre"
              :aria-label="t('admin.edit.tabJson')"
              :error="!!jsonError"
              :error-message="jsonError"
              @update:model-value="jsonError = ''"
            />
          </div>
        </q-card>

        <!-- ───────────── FILES ───────────── -->
        <q-card v-else-if="tab === 'files' && itemId" flat bordered>
          <div class="adm-card__body">
            <ItemFilesTab v-model:files="files" :item-id="itemId" @changed="historyKey++" />
          </div>
        </q-card>

        <!-- ───────────── HISTORY ───────────── -->
        <q-card v-else-if="tab === 'history' && itemId" flat bordered>
          <div class="adm-card__body">
            <HistoryTimeline :key="historyKey" :item-id="itemId" />
          </div>
        </q-card>

        <!-- ───────────── TASKS: what happened around this item, across every task ever filed ───────────── -->
        <q-card v-else-if="tab === 'tasks' && itemId" flat bordered>
          <div class="adm-card__body">
            <ItemTaskHistory :item-id="itemId" :refresh-key="tasksRefreshKey">
              <template #actions>
                <q-btn
                  outline
                  no-caps
                  dense
                  color="primary"
                  icon="o_person_add"
                  :label="t('admin.edit.assignTask')"
                  :disable="!!openTask"
                  @click="assignOpen = true"
                >
                  <q-tooltip v-if="openTask">{{ t('admin.tasks.history.assignBlocked') }}</q-tooltip>
                </q-btn>
              </template>
            </ItemTaskHistory>
          </div>
        </q-card>

        <!-- SAVE BAR: sticks to the bottom of the column -->
        <q-card v-if="!loading && (tab === 'form' || tab === 'json')" flat bordered class="save-bar">
          <span class="save-bar__status" :class="{ 'save-bar__status--dirty': dirty || isNew }">
            <span class="adm-dot" :class="dirty || isNew ? 'adm-dot--warning' : 'adm-dot--positive'" />
            {{ saveStatus }}
          </span>
          <q-space />
          <q-btn flat no-caps color="primary" :label="t('admin.common.cancel')" @click="goBack" />
          <q-btn
            unelevated
            no-caps
            color="primary"
            icon="o_save"
            :label="isNew && targetState === 'DRAFT' ? t('admin.edit.saveDraft') : t('admin.common.save')"
            :loading="saving"
            :disable="!schemaForm.canSave.value || (!dirty && !isNew)"
            @click="onSaveClick"
          >
            <q-tooltip v-if="!schemaForm.canSave.value">{{ blockedTooltip }}</q-tooltip>
          </q-btn>
        </q-card>
      </div>

      <!-- ───────────── RIGHT COLUMN ───────────── -->
      <aside v-if="!loading" class="edit-side">
        <q-card v-if="tab === 'form'" flat bordered class="page-nav">
          <div class="page-nav__title">{{ t('admin.edit.nav.title') }}</div>
          <q-list dense>
            <q-item clickable class="page-nav__item page-nav__item--type" @click="scrollTo('section-type')">
              <q-item-section avatar>
                <span class="page-nav__tile page-nav__tile--solid">
                  <q-icon :name="materialTypeIcon(form.materialType?.code)" size="13px" />
                </span>
              </q-item-section>
              <q-item-section>{{ schemaForm.label('materialType') }}</q-item-section>
              <q-item-section side class="page-nav__count">
                {{ form.materialType ? codeLabel(form.materialType) : '—' }}
              </q-item-section>
            </q-item>
            <q-item
              v-for="section in editor.sections.value"
              :key="section.key"
              clickable
              class="page-nav__item"
              :class="{ 'page-nav__item--empty': section.filled === 0 }"
              @click="goToSection(section.key)"
            >
              <q-item-section avatar>
                <span class="page-nav__tile" :class="{ 'page-nav__tile--empty': section.filled === 0 }">
                  {{ section.number }}
                </span>
              </q-item-section>
              <q-item-section>{{ t(`admin.edit.sections.${section.key}.title`) }}</q-item-section>
              <q-item-section side class="page-nav__count">
                <span class="row items-center no-wrap q-gutter-x-sm">
                  <span
                    v-if="section.blocking || section.neededToPublish"
                    class="adm-dot page-nav__dot"
                    :class="section.blocking ? 'page-nav__dot--negative' : 'adm-dot--warning'"
                  />
                  <span>{{ section.filled }} / {{ section.total }}</span>
                </span>
              </q-item-section>
            </q-item>
            <q-item
              v-if="editor.hiddenFields.value.length"
              clickable
              class="page-nav__item page-nav__item--empty"
              @click="showOtherFields"
            >
              <q-item-section avatar><span class="page-nav__tile page-nav__tile--dashed" /></q-item-section>
              <q-item-section>{{ t('admin.edit.nav.other') }}</q-item-section>
              <q-item-section side class="page-nav__count">
                {{ t('admin.edit.nav.hidden', { count: editor.hiddenFields.value.length }) }}
              </q-item-section>
            </q-item>
          </q-list>
          <div class="page-nav__buttons">
            <q-btn outline dense no-caps color="primary" class="col" :label="t('admin.edit.nav.expandAll')" @click="editor.expandAll()" />
            <q-btn outline dense no-caps color="primary" class="col" :label="t('admin.edit.nav.collapseAll')" @click="editor.collapseAll()" />
          </div>
        </q-card>

        <!-- STATUS, and the move between draft and record (nice-to-have A2) -->
        <q-card flat bordered>
          <div class="adm-card__body adm-card__body--stack">
            <h2 class="adm-card__title adm-card__title--sm">{{ t('admin.edit.status.title') }}</h2>
            <dl class="status-list">
              <dt>{{ t('admin.edit.status.type') }}</dt>
              <dd class="text-weight-medium">{{ t(`admin.itemType.${targetState}`) }}</dd>
              <dt>{{ t('admin.items.columns.visibility') }}</dt>
              <dd><VisibilityBadge :status="visibilityStatus" dense /></dd>
              <template v-if="!isNew">
                <dt>{{ t('admin.edit.status.source') }}</dt>
                <dd>{{ sourceLabel }}</dd>
                <dt>{{ t('admin.edit.status.created') }}</dt>
                <dd>{{ stamp(info.createdAt, info.createdByName) }}</dd>
                <dt>{{ t('admin.edit.status.updated') }}</dt>
                <dd>{{ stamp(info.updatedAt, info.updatedByName) }}</dd>
              </template>
            </dl>

            <template v-if="targetState === 'DRAFT'">
              <div v-if="schemaForm.canPublish.value" class="adm-note adm-note--positive status-note">
                <q-icon name="o_check_circle" />
                <span>{{ t('admin.edit.status.ready') }}</span>
              </div>
              <div v-else class="adm-note adm-note--warning status-note">
                <q-icon name="o_info" />
                <span>
                  {{ t('admin.edit.status.notReady', { count: publishProblems.length }) }}
                  {{ publishProblems.map((p) => p.label).join(', ') }}.
                </span>
              </div>
            </template>

            <template v-if="!isNew && canTransition">
              <q-btn
                v-if="itemType === 'DRAFT'"
                unelevated
                no-caps
                color="positive"
                icon="o_publish"
                :label="t('admin.edit.status.publish')"
                :loading="transitioning"
                :disable="!schemaForm.canPublish.value"
                @click="transition('RECORD')"
              />
              <q-btn
                v-else
                outline
                no-caps
                color="primary"
                icon="o_unpublished"
                :label="t('admin.items.toDraft')"
                :loading="transitioning"
                @click="transition('DRAFT')"
              />
              <span class="status-help">
                {{
                  itemType === 'DRAFT'
                    ? schemaForm.canPublish.value
                      ? t('admin.edit.status.publishHelp')
                      : t('admin.edit.status.publishBlockedHelp')
                    : t('admin.edit.status.toDraftHelp')
                }}
              </span>
            </template>
          </div>
        </q-card>

        <q-card v-if="openTask" flat bordered>
          <div class="adm-card__body adm-card__body--stack">
            <div class="row items-center justify-between">
              <h2 class="adm-card__title adm-card__title--sm">{{ t('admin.edit.openTask.title') }}</h2>
              <a href="#" class="adm-link side-link" @click.prevent="setTab('tasks')">
                {{ t('admin.edit.openTask.all') }}
              </a>
            </div>
            <router-link :to="`/admin/tasks/${openTask.id}`" class="open-task">
              <div class="row items-center justify-between no-wrap q-gutter-x-sm">
                <span class="open-task__title ellipsis">{{ openTask.title }}</span>
                <TaskStatusBadge :status="openTask.status" :returned="openTask.lastHandoff === 'RETURNED'" dense />
              </div>
              <span class="open-task__sub">
                {{ t(`admin.tasks.kinds.${openTask.kind}`) }} ·
                {{
                  openTask.assignedToUserId === auth.userId
                    ? t('admin.dashboard.review.assignedToYou')
                    : t('admin.dashboard.review.assignedTo', { name: openTask.assignedToName })
                }}
                · {{ t('admin.dashboard.filedBy', { name: openTask.createdByName }) }}
              </span>
            </router-link>
          </div>
        </q-card>

        <q-card v-if="!isNew" flat bordered>
          <div class="adm-card__body adm-card__body--stack-sm">
            <div class="row items-center justify-between">
              <h2 class="adm-card__title adm-card__title--sm">{{ t('admin.edit.tabFiles') }}</h2>
              <a href="#" class="adm-link side-link" @click.prevent="setTab('files')">
                {{ t('admin.edit.filesManage') }}
              </a>
            </div>
            <div class="side-line">
              <q-icon name="o_attach_file" size="16px" />
              <span>{{ filesSummary }}</span>
            </div>
            <div v-if="pdfSummary" class="side-line">
              <q-icon :name="pdfSummary.ok ? 'o_check_circle' : 'o_warning_amber'" size="16px" />
              <span>{{ pdfSummary.text }}</span>
            </div>
          </div>
        </q-card>
      </aside>
    </div>

    <CreateTaskDialog
      v-if="itemId"
      v-model="assignOpen"
      :item-id="itemId"
      :item-type="itemType"
      :item-title="form.title"
      @created="onTaskCreated"
    />

    <ValidationErrorDialog
      v-model="validationOpen"
      :failure="validation"
      :action="validationAction"
      :items="validationItems"
      :current-item-id="itemId"
    />

    <UnsavedChangesDialog
      v-model="leaveOpen"
      :item-title="form.title"
      :changes="changes"
      :can-save="schemaForm.canSave.value"
      :saving="saving"
      @save="leaveAfterSave"
      @stay="resolveLeave(false)"
      @discard="resolveLeave(true)"
    />
  </q-page>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, ref, shallowRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router';
import { useQuasar } from 'quasar';
import {
  getItem,
  type FileAttachment,
  type IndexedRecord,
  type ResolvedCode,
} from 'src/api/search';
import {
  conflictCurrentVersion,
  createItem,
  isVersionConflict,
  listFiles,
  transitionItems,
  updateItem,
  type ItemType,
  type MetadataPayload,
  type VisibilityStatus,
} from 'src/api/admin';
import { apiErrorMessage, apiErrorStatus, validationFailure, type ValidationFailure } from 'src/api/errors';
import { listTasks, type Task } from 'src/api/tasks';
import { auth } from 'src/services/keycloak';
import { useAuthz } from 'src/composables/useAuthz';
import { useCodeLabel } from 'src/composables/useCodeLabel';
import { useSchemaForm } from 'src/composables/useSchemaForm';
import { useSchemaStore } from 'src/stores/schema-store';
import { useTaskCountStore } from 'src/stores/task-count-store';
import { formatDate, formatDateTime, formatFileSize } from 'src/utils/adminFormat';
import { materialTypeIcon } from 'src/utils/materialType';
import { forgetItem, rememberItem } from 'src/utils/recentItems';
import type { ItemState, TargetState } from 'src/utils/schemaRules';
import AdminPageHeader from 'src/components/admin/AdminPageHeader.vue';
import CreateTaskDialog from 'src/components/admin/CreateTaskDialog.vue';
import HistoryTimeline from 'src/components/admin/HistoryTimeline.vue';
import ItemTaskHistory from 'src/components/admin/ItemTaskHistory.vue';
import TaskStatusBadge from 'src/components/admin/TaskStatusBadge.vue';
import ValidationErrorDialog, {
  type ValidationAction,
  type ValidationItemInfo,
} from 'src/components/admin/ValidationErrorDialog.vue';
import VisibilityBadge from 'src/components/admin/VisibilityBadge.vue';
import ItemFilesTab from 'src/components/admin/editor/ItemFilesTab.vue';
import ItemMetadataForm from 'src/components/admin/editor/ItemMetadataForm.vue';
import UnsavedChangesDialog, {
  type UnsavedChange,
} from 'src/components/admin/editor/UnsavedChangesDialog.vue';
import {
  createEditorContext,
  EDITOR_KEY,
  ownerField,
} from 'src/components/admin/editor/editorContext';
import CodeSelect from 'src/components/admin/form/CodeSelect.vue';
import { isFilled, type SectionKey } from 'src/components/admin/form/fields';
import {
  emptyForm,
  formToMetadata,
  metadataForDisplay,
  metadataToForm,
  type MetadataForm,
} from 'src/components/admin/form/metadataForm';

// ---------------------------------------------------------------------------
// The item editor.
//
// The form is hand-laid-out (one card per section); the metadata schema (v2)
// decides per item which fields are visible / required and what they are
// called, and the same evaluator the API runs tells — before any request —
// whether a save or a publish would be refused:
//
//   draft   needs a title and a material type to be SAVED;
//           what publishing also needs is listed, but never blocks a save
//   record  must stay complete: Save is off while a required field is empty
//
// Saves use optimistic concurrency (`expectedVersion`; a 409 is merged when
// the two sides touched different fields, otherwise shown). Publish / return
// to draft live in the Status card; leaving with unsaved changes asks first.
// ---------------------------------------------------------------------------

type Tab = 'form' | 'json' | 'files' | 'history' | 'tasks';
const TABS: Tab[] = ['form', 'json', 'files', 'history', 'tasks'];

const { t, locale } = useI18n();
const route = useRoute();
const router = useRouter();
const $q = useQuasar();
const { isStaff, canTransition } = useAuthz();
const { codeLabel } = useCodeLabel();
const schemaStore = useSchemaStore();
const taskCount = useTaskCountStore();

const itemId = computed(() => route.params.id as string | undefined);
const isNew = computed(() => !itemId.value);

/** Which collection the item lives in — from the search hit's index name. `null` until loaded / for a new item. */
const itemType = ref<ItemType | null>(null);

/** The state a save goes to: the chosen one for a new item, the current one otherwise. */
const targetState = computed<TargetState>(() => {
  if (isNew.value) return route.query.type === 'RECORD' ? 'RECORD' : 'DRAFT';
  return itemType.value ?? 'DRAFT';
});

const itemState = computed<ItemState>(() => (isNew.value ? 'NEW' : targetState.value));

const listPath = computed(() => (targetState.value === 'RECORD' ? '/admin/records' : '/admin/drafts'));

const tab = ref<Tab>(TABS.find((name) => name === route.query.tab) ?? 'form');
const loading = ref(!!route.params.id);
const loadError = ref(false);
const saving = ref(false);
const visibilityStatus = ref<VisibilityStatus>('PRIVATE');

// Metadata as loaded — the base every payload is built on, so keys the form
// does not own (_source, children counters) pass through.
const metadata = shallowRef<Record<string, unknown>>({});

// Optimistic concurrency: last version we know of, plus a snapshot of the
// loaded state so a 409 can be resolved by comparing what changed on each side
// and the page can tell whether (and where) the form is dirty.
const currentVersion = ref(0);
let original: Record<string, unknown> = {};
const originalVisibility = ref<VisibilityStatus>('PRIVATE');
/** Bumped whenever `original` is replaced, so computeds that read it re-run. */
const originalKey = ref(0);

/** Who created and last changed the item — for the header and the Status card. */
interface ItemInfo {
  createdAt: string;
  updatedAt: string;
  /** Display-name snapshots; absent unless the caller may see attribution. */
  createdByName?: string | undefined;
  updatedByName?: string | undefined;
}

const info = ref<ItemInfo>({ createdAt: '', updatedAt: '' });

// The structured form over every editable field. ItemMetadataForm binds into
// this object directly.
const form = ref<MetadataForm>(emptyForm());

// ---------------------------------------------------------------------------
// Schema: evaluated field states and the save / publish check
// ---------------------------------------------------------------------------

interface ParentInfo {
  id: string;
  title: string;
  metadata: Record<string, unknown>;
  /** A serial collection: this item is one of its issues. */
  serial: boolean;
  issn: string;
  children: number;
}

const parents = ref<ParentInfo[]>([]);

/** What the rules look at, straight from the form — see `contextMetadata` in useSchemaForm. */
const contextMetadata = computed<Record<string, unknown>>(() => ({
  materialType: form.value.materialType,
  recordType: form.value.recordType,
  bibliographicLevel: form.value.bibliographicLevel,
  collectionType: form.value.collectionType,
}));

/**
 * The extent's unit follows the material type. While the number is the stored
 * one, the stored unit is kept — a unit the rules no longer agree with is then
 * reported by the check, not rewritten behind the user's back.
 */
const extentUnit = computed<string | null>(() => {
  const stored = metadata.value.extent as { value?: unknown; unit?: unknown } | undefined;
  if (
    stored &&
    typeof stored.unit === 'string' &&
    stored.value === form.value.extentValue
  ) {
    return stored.unit;
  }
  return schemaForm.state('extent').unit?.code ?? null;
});

function buildPayload(): MetadataPayload {
  return formToMetadata(
    form.value,
    metadata.value,
    isNew.value ? 'create' : 'update',
    extentUnit.value,
  );
}

/** The metadata as it would be stored after a save — what the checks run on and the JSON tab shows. */
const currentMetadata = computed(() => metadataForDisplay(buildPayload()));

const schemaForm = useSchemaForm({
  metadata: currentMetadata,
  contextMetadata,
  parents: computed(() => parents.value.map((parent) => parent.metadata)),
  itemState,
  targetState,
});

const editor = createEditorContext(form, schemaForm);
provide(EDITOR_KEY, editor);

// Choosing a material type sets the record type and the bibliographic level it
// implies (its two characters) — the rules read those, and a stale pair from a
// previous choice would show the wrong fields. Only on the user's own choice:
// loaded data keeps the pair it was stored with.
function onMaterialTypeChange(value: ResolvedCode | null) {
  form.value.materialType = value;
  if (!value) return;
  const recordType = schemaStore.codes('recordType').find((c) => c.code === value.code.charAt(0));
  const level = schemaStore
    .codes('bibliographicLevel')
    .find((c) => c.code === value.code.charAt(1));
  form.value.recordType = recordType ?? null;
  form.value.bibliographicLevel = level ?? null;
}

/** "Textual material, printed · Monograph" */
const typeLine = computed(() => {
  const parts = [form.value.recordType, form.value.bibliographicLevel]
    .filter((c): c is NonNullable<typeof c> => !!c)
    .map((c) => codeLabel(c));
  return parts.length ? parts.join(' · ') : form.value.materialType ? codeLabel(form.value.materialType) : '';
});

const foldedLabels = computed(() =>
  editor.hiddenFields.value
    .map((path) => schemaForm.label(path).toLowerCase())
    .join(', '),
);

// ── Readiness ──

interface Problem {
  path: string;
  label: string;
}

function problemsOf(check: { missing: { path: string }[]; violations: { path: string }[] }): Problem[] {
  const seen = new Set<string>();
  const out: Problem[] = [];
  for (const entry of [...check.missing, ...check.violations]) {
    const path = ownerField(entry.path);
    if (seen.has(path)) continue;
    seen.add(path);
    out.push({ path, label: schemaForm.label(path) });
  }
  return out;
}

const saveProblems = computed(() => problemsOf(schemaForm.saveCheck.value));
const publishProblems = computed(() => problemsOf(schemaForm.publishCheck.value));

const readiness = computed(() => {
  if (saveProblems.value.length > 0) {
    return {
      blocking: true,
      lead:
        targetState.value === 'RECORD'
          ? t('admin.edit.readiness.recordBlocked')
          : t('admin.edit.readiness.draftBlocked'),
      items: saveProblems.value,
      tail:
        targetState.value === 'RECORD' && !isNew.value
          ? t('admin.edit.readiness.recordTail')
          : t('admin.edit.readiness.draftTail'),
    };
  }
  if (targetState.value === 'DRAFT' && publishProblems.value.length > 0) {
    return {
      blocking: false,
      lead: t('admin.edit.readiness.publishLead', { count: publishProblems.value.length }),
      items: publishProblems.value,
      tail: t('admin.edit.readiness.publishTail'),
    };
  }
  return null;
});

const blockedTooltip = computed(() =>
  t('admin.edit.saveBlocked', { fields: saveProblems.value.map((p) => p.label).join(', ') }),
);

// ---------------------------------------------------------------------------
// Dirty state and what changed
// ---------------------------------------------------------------------------

// `null` in a payload means "cleared", which is the same as absent on the
// stored side — so both normalise to null before comparing.
function changedKeys(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter(
    (k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null),
  );
}

function takeSnapshot() {
  original = structuredClone(metadataForDisplay(buildPayload()));
  originalVisibility.value = visibilityStatus.value;
  originalKey.value++;
}

function scalar(value: unknown): string | undefined {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return undefined;
}

/** What differs from the loaded state, field by field — for the save bar and the leave dialog. */
const changes = computed<UnsavedChange[]>(() => {
  void originalKey.value;
  const out: UnsavedChange[] = [];
  const current = currentMetadata.value;

  for (const key of changedKeys(original, current)) {
    const before = original[key];
    const after = current[key];
    const nested = [before, after].some(
      (v) => v !== null && typeof v === 'object' && !Array.isArray(v),
    );
    if (nested && key !== 'materialType' && key !== 'recordType' && key !== 'bibliographicLevel') {
      // publication, issue, extent, textualMaterialCodes: name the sub-field
      const b = (before ?? {}) as Record<string, unknown>;
      const a = (after ?? {}) as Record<string, unknown>;
      for (const sub of changedKeys(b, a)) {
        const path = key === 'extent' ? 'extent' : `${key}.${sub}`;
        if (key === 'extent' && sub !== 'value') continue;
        out.push({
          label: key === 'extent' ? schemaForm.label(path) : `${schemaForm.label(key)} · ${schemaForm.label(path)}`,
          before: scalar(b[sub]),
          after: scalar(a[sub]),
        });
      }
      continue;
    }
    out.push({ label: schemaForm.label(key), before: scalar(before), after: scalar(after) });
  }

  if (visibilityStatus.value !== originalVisibility.value) {
    out.push({
      label: t('admin.items.columns.visibility'),
      before: t(`admin.visibility.${originalVisibility.value}`),
      after: t(`admin.visibility.${visibilityStatus.value}`),
    });
  }
  return out;
});

const dirty = computed(() => changes.value.length > 0);

const saveStatus = computed(() => {
  if (dirty.value) {
    const labels = changes.value.map((c) => c.label);
    const shown = labels.slice(0, 2).join(', ') + (labels.length > 2 ? ` +${labels.length - 2}` : '');
    const base = t('admin.edit.unsavedIn', { fields: shown });
    return schemaForm.canSave.value ? base : `${base} ${blockedTooltip.value}`;
  }
  if (isNew.value) {
    return targetState.value === 'RECORD' ? t('admin.edit.newRecordUnsaved') : t('admin.edit.newDraftUnsaved');
  }
  return t('admin.edit.allSaved');
});

// ---------------------------------------------------------------------------
// Header and side cards
// ---------------------------------------------------------------------------

const headerTitle = computed(() => {
  if (form.value.title.trim()) return form.value.title;
  if (!isNew.value) return t('admin.edit.title');
  return targetState.value === 'RECORD' ? t('admin.dashboard.newRecord') : t('admin.dashboard.newDraft');
});

const headerCaption = computed(() => {
  const parts: string[] = [];
  if (form.value.materialType) parts.push(codeLabel(form.value.materialType));
  if (form.value.cobissId) parts.push(`COBISS ${form.value.cobissId}`);
  if (isNew.value) {
    parts.push(t('admin.edit.notSavedYet'));
  } else if (info.value.updatedAt) {
    parts.push(
      info.value.updatedByName
        ? t('admin.edit.lastSavedBy', {
            when: formatDateTime(info.value.updatedAt, locale.value),
            name: info.value.updatedByName,
          })
        : t('admin.edit.lastSaved', { when: formatDateTime(info.value.updatedAt, locale.value) }),
    );
  }
  return parts.join(' · ');
});

const sourceLabel = computed(() =>
  metadata.value._source === 'cobiss' ? t('admin.edit.status.sourceCobiss') : t('admin.edit.status.sourceManual'),
);

function stamp(iso: string | undefined, name: string | undefined): string {
  const date = formatDate(iso, locale.value);
  return name ? `${date} · ${name}` : date;
}

// ── Files ──

const files = ref<FileAttachment[]>([]);

const filesSummary = computed(() =>
  t('admin.edit.filesSummary', {
    count: files.value.length,
    size: formatFileSize(files.value.reduce((sum, file) => sum + file.sizeBytes, 0)),
  }),
);

/** One line about PDF text extraction: fine, or how many need another look. */
const pdfSummary = computed(() => {
  const pdfs = files.value.filter((file) => file.fileType === 'PDF');
  if (pdfs.length === 0) return null;
  const bad = pdfs.filter((file) => file.textExtractionStatus !== 'EXTRACTED').length;
  return bad === 0
    ? { ok: true, text: t('admin.edit.pdfOk') }
    : { ok: false, text: t('admin.edit.pdfProblems', { count: bad }) };
});

// ── Tasks ──

const openTask = ref<Task | null>(null);
const assignOpen = ref(false);
const tasksRefreshKey = ref(0);
const historyKey = ref(0);

// An item has at most one open task.
async function loadOpenTask() {
  if (!isStaff.value || !itemId.value) return;
  try {
    const result = await listTasks({ itemId: itemId.value, status: 'OPEN', limit: 1 });
    openTask.value = result.tasks[0] ?? null;
  } catch {
    // Decoration only.
    openTask.value = null;
  }
}

function onTaskCreated() {
  tasksRefreshKey.value++;
  void loadOpenTask();
  void taskCount.refresh();
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

const jsonText = ref('{}');
const jsonError = ref('');

const jsonValid = computed(() => {
  try {
    const parsed: unknown = JSON.parse(jsonText.value);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
  } catch {
    return false;
  }
});

function renderJson() {
  jsonText.value = JSON.stringify(currentMetadata.value, null, 2);
}

// Keep JSON tab and form in sync: entering the JSON tab renders the current
// state; leaving it (or saving from it) parses the text back. Only apply the
// JSON when actually coming FROM the json tab — applying it on any other tab
// switch (e.g. form → files) would overwrite the form with a stale snapshot.
let previousTab: Tab = tab.value;
function syncJsonForTab(next: Tab) {
  if (next === 'json') {
    renderJson();
  } else if (previousTab === 'json') {
    applyJson(false);
  }
  previousTab = next;
}

function onTabChange(next: Tab) {
  syncJsonForTab(next);
  void router.replace({ query: { ...route.query, tab: next === 'form' ? undefined : next } });
}

function setTab(next: Tab) {
  tab.value = next;
  onTabChange(next);
}

// A link to `?tab=tasks` from this same page (the open-task card, the item's
// task list) changes only the query, so the component is not remounted.
watch(
  () => route.query.tab,
  (value) => {
    const next = TABS.find((name) => name === value) ?? 'form';
    if (next !== tab.value) {
      tab.value = next;
      syncJsonForTab(next);
    }
  },
);

function applyJson(showError = true): boolean {
  try {
    const parsed = JSON.parse(jsonText.value) as Record<string, unknown>;
    // A key deleted in the JSON is cleared on save: the form no longer holds
    // it, so the payload sends `null` for it (update) or omits it (create).
    metadata.value = parsed;
    form.value = metadataToForm(parsed);
    jsonError.value = '';
    return true;
  } catch {
    if (showError) jsonError.value = t('admin.edit.invalidJson');
    return false;
  }
}

function scrollTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function goToSection(key: SectionKey) {
  editor.open[key] = true;
  scrollTo(`section-${key}`);
}

function showOtherFields() {
  editor.open.other = true;
  scrollTo('section-other');
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

function applyServerState(source: IndexedRecord) {
  metadata.value = (source.metadata as unknown as Record<string, unknown>) ?? {};
  visibilityStatus.value = source.visibilityStatus;
  currentVersion.value = source.version ?? 0;
  info.value = {
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
    createdByName: source.createdByName,
    updatedByName: source.updatedByName,
  };
  form.value = metadataToForm(metadata.value);
  takeSnapshot();
  if (tab.value === 'json') renderJson();
}

/** A section that holds nothing starts collapsed — except on a new item, where everything is still to fill in. */
function collapseEmptySections() {
  for (const section of editor.sections.value) {
    editor.open[section.key] = section.filled > 0 || section.blocking > 0 || section.neededToPublish > 0;
  }
  // "Other fields" opens by itself when one of them holds a value, so nothing is hidden.
  editor.open.other = editor.hiddenFields.value.some((path) => isFilled(form.value, path));
}

// The rules for an issue of a serial need the parents' collection type. An
// item normally has one parent; each is one read.
async function loadParents(source: IndexedRecord) {
  const relations = source.parent_relations ?? [];
  const loaded = await Promise.all(
    relations.map(async (relation): Promise<ParentInfo | null> => {
      try {
        const hit = await getItem(relation.parentId);
        const m = (hit.source.metadata as unknown as Record<string, unknown>) ?? {};
        const issn = Array.isArray(m.issn) && typeof m.issn[0] === 'string' ? m.issn[0] : '';
        return {
          id: relation.parentId,
          title: typeof m.title === 'string' ? m.title : '',
          metadata: m,
          serial: m.collectionType === 4,
          issn,
          children: Number(m.childrenInDrafts ?? 0) + Number(m.childrenInRecords ?? 0),
        };
      } catch {
        return null;
      }
    }),
  );
  parents.value = loaded.filter((parent): parent is ParentInfo => parent !== null);
}

// pgsync → OpenSearch indexing is eventually consistent: an item created a
// moment ago may not be in the index yet, so its first read is retried.
async function fetchItem(id: string, attempts: number) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await getItem(id);
    } catch (err) {
      if (attempt >= attempts - 1) throw err;
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
  }
}

onMounted(async () => {
  await schemaStore.load();

  if (isNew.value) {
    takeSnapshot();
    return;
  }
  const id = itemId.value!;
  try {
    const hit = await fetchItem(id, route.query.created === '1' ? 6 : 1);
    itemType.value = hit.index === 'records' ? 'RECORD' : hit.index === 'drafts' ? 'DRAFT' : null;
    await loadParents(hit.source);
    applyServerState(hit.source);
    collapseEmptySections();
    files.value = await listFiles(id);
    rememberItem(auth.userId, { id, title: form.value.title, itemType: itemType.value });
    void loadOpenTask();
  } catch (err) {
    loadError.value = true;
    takeSnapshot(); // nothing to lose, so no leave guard
    // Deleted since it was last opened: drop it from "Recently opened"
    if (apiErrorStatus(err) === 404) forgetItem(auth.userId, id);
  } finally {
    loading.value = false;
  }
});

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

const validation = ref<ValidationFailure | null>(null);
const validationOpen = ref(false);
const validationAction = ref<ValidationAction>('save');

const validationItems = computed<Record<string, ValidationItemInfo>>(() =>
  itemId.value
    ? {
        [itemId.value]: {
          title: form.value.title,
          type: form.value.materialType ? codeLabel(form.value.materialType) : undefined,
        },
      }
    : {},
);

/** Shows a refused write. Returns true when the error was the save check (the dialog is open). */
function showFailure(err: unknown, action: ValidationAction): boolean {
  const failure = validationFailure(err);
  if (failure) {
    validation.value = failure;
    validationAction.value = action;
    validationOpen.value = true;
    return true;
  }
  $q.notify({ type: 'negative', message: apiErrorMessage(err) ?? t('admin.common.actionFailed') });
  return false;
}

/** The form as saved becomes the new base: later payloads and the dirty check start from it. */
function markSaved(saved: MetadataPayload, version: number) {
  metadata.value = metadataForDisplay(saved);
  currentVersion.value = version;
  info.value = {
    ...info.value,
    updatedAt: new Date().toISOString(),
    updatedByName: auth.fullName || auth.username || info.value.updatedByName,
  };
  takeSnapshot();
  historyKey.value++;
  if (itemId.value) {
    rememberItem(auth.userId, { id: itemId.value, title: form.value.title, itemType: itemType.value });
  }
}

/** Saves the form. Resolves to whether the item is now saved. */
async function save(): Promise<boolean> {
  if (tab.value === 'json' && !applyJson()) return false;
  if (!schemaForm.canSave.value) {
    setTab('form');
    const first = saveProblems.value[0];
    if (first) editor.goToField(first.path);
    $q.notify({ type: 'negative', message: blockedTooltip.value });
    return false;
  }

  saving.value = true;
  try {
    const meta = buildPayload();
    if (isNew.value) {
      const created = await createItem({
        visibilityStatus: visibilityStatus.value,
        targetState: targetState.value,
        metadata: meta,
      });
      $q.notify({ type: 'positive', message: t('admin.edit.saved') });
      // The new item has its own route; the index may need a moment to show it.
      leaving = true;
      await router.replace({ path: `/admin/items/${created.id}`, query: { created: '1' } });
      return true;
    }

    try {
      const result = await updateItem(itemId.value!, {
        visibilityStatus: visibilityStatus.value,
        metadata: meta,
        expectedVersion: currentVersion.value,
      });
      markSaved(meta, result?.version ?? currentVersion.value);
    } catch (err) {
      if (!isVersionConflict(err)) throw err;
      return await handleConflict(meta, err);
    }
    $q.notify({ type: 'positive', message: t('admin.edit.saved') });
    return true;
  } catch (err) {
    showFailure(err, 'save');
    return false;
  } finally {
    saving.value = false;
  }
}

function onSaveClick() {
  void save();
}

// ---------------------------------------------------------------------------
// Optimistic concurrency (409) handling
// ---------------------------------------------------------------------------

// Poll until the index has caught up with the version the 409 reported.
async function fetchFreshItem(minVersion: number): Promise<IndexedRecord | undefined> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 800));
    try {
      const hit = await getItem(itemId.value!);
      if ((hit.source.version ?? 0) >= minVersion) return hit.source;
    } catch {
      // keep polling
    }
  }
  return undefined;
}

async function handleConflict(attemptedMeta: MetadataPayload, err: unknown): Promise<boolean> {
  const attempted = attemptedMeta as Record<string, unknown>;
  const attemptedVisibility = visibilityStatus.value;
  const serverVersion = conflictCurrentVersion(err);
  const server = await fetchFreshItem(serverVersion ?? currentVersion.value + 1);

  if (server) {
    const serverMeta = (server.metadata as unknown as Record<string, unknown>) ?? {};
    const userKeys = changedKeys(original, attempted);
    const serverKeys = changedKeys(original, serverMeta);
    const metadataOverlap = userKeys.some(
      (k) =>
        serverKeys.includes(k) &&
        JSON.stringify(attempted[k] ?? null) !== JSON.stringify(serverMeta[k] ?? null),
    );
    const visibilityOverlap =
      attemptedVisibility !== originalVisibility.value &&
      server.visibilityStatus !== originalVisibility.value &&
      server.visibilityStatus !== attemptedVisibility;

    if (!metadataOverlap && !visibilityOverlap) {
      // Both sides touched different fields (e.g. the server-side count
      // trigger bumped the version): merge onto the server state and retry
      // without bothering the user.
      const mergedMeta: Record<string, unknown> = { ...serverMeta };
      for (const k of userKeys) mergedMeta[k] = attempted[k];
      try {
        const result = await updateItem(itemId.value!, {
          visibilityStatus: attemptedVisibility,
          metadata: mergedMeta as MetadataPayload,
          expectedVersion: server.version ?? 0,
        });
        markSaved(mergedMeta as MetadataPayload, result?.version ?? (server.version ?? 0) + 1);
        form.value = metadataToForm(metadata.value);
        takeSnapshot();
        $q.notify({ type: 'positive', message: t('admin.edit.saved') });
        return true;
      } catch (retryErr) {
        if (!isVersionConflict(retryErr)) throw retryErr;
      }
    }
    applyServerState(server);
  }

  $q.notify({
    type: 'warning',
    timeout: 0,
    multiLine: true,
    message: t('admin.edit.conflictRefreshed'),
    actions: [
      {
        label: t('admin.edit.saveAnyway'),
        color: 'dark',
        noCaps: true,
        handler: () => void forceSave(attemptedMeta, attemptedVisibility),
      },
      { label: t('admin.edit.dismiss'), color: 'dark', noCaps: true },
    ],
  });
  return false;
}

// Last-write-wins override: re-apply the user's attempted changes on top of
// the freshest version we can determine.
async function forceSave(attemptedMeta: MetadataPayload, attemptedVisibility: VisibilityStatus) {
  saving.value = true;
  try {
    let expected = currentVersion.value;
    try {
      const hit = await getItem(itemId.value!);
      expected = Math.max(expected, hit.source.version ?? 0);
    } catch {
      // fall back to the last version we know
    }
    const payload = { visibilityStatus: attemptedVisibility, metadata: attemptedMeta };
    let result: { version: number } | undefined;
    try {
      result = await updateItem(itemId.value!, { ...payload, expectedVersion: expected });
    } catch (err) {
      const current = isVersionConflict(err) ? conflictCurrentVersion(err) : undefined;
      if (current === undefined) throw err;
      expected = current;
      result = await updateItem(itemId.value!, { ...payload, expectedVersion: current });
    }
    visibilityStatus.value = attemptedVisibility;
    markSaved(attemptedMeta, result?.version ?? expected + 1);
    form.value = metadataToForm(metadata.value);
    takeSnapshot();
    $q.notify({ type: 'positive', message: t('admin.edit.saved') });
  } catch (err) {
    showFailure(err, 'save');
  } finally {
    saving.value = false;
  }
}

// ---------------------------------------------------------------------------
// Publish / return to draft
// ---------------------------------------------------------------------------

const transitioning = ref(false);

/**
 * The order matters, because each write is checked against the rules of the
 * state the item is in at that moment:
 *   publish          save as a draft first, then move (checked as a record)
 *   return to draft  move first, then save — a record that is missing a
 *                    required field cannot be saved, but it can be returned
 */
async function transition(target: ItemType) {
  if (!itemId.value) return;
  transitioning.value = true;
  try {
    if (target === 'RECORD' && dirty.value && !(await save())) return;

    const [moved] = await transitionItems([itemId.value], target);
    itemType.value = target;
    if (moved) currentVersion.value = moved.version;
    historyKey.value++;
    $q.notify({
      type: 'positive',
      message: target === 'RECORD' ? t('admin.edit.published') : t('admin.edit.returnedToDraft'),
    });
    // Publishing closes the item's open review task.
    void loadOpenTask();
    void taskCount.refresh();
    tasksRefreshKey.value++;
    rememberItem(auth.userId, { id: itemId.value, title: form.value.title, itemType: target });

    if (target === 'DRAFT' && dirty.value) await save();
  } catch (err) {
    showFailure(err, target === 'RECORD' ? 'publish' : 'toDraft');
  } finally {
    transitioning.value = false;
  }
}

// ---------------------------------------------------------------------------
// Leaving with unsaved changes (nice-to-have A1)
// ---------------------------------------------------------------------------

const leaveOpen = ref(false);
/** Set once the user has decided (or a save moved on by itself): the guard lets the navigation through. */
let leaving = false;
let pendingLeave: ((proceed: boolean) => void) | undefined;

onBeforeRouteLeave(() => {
  if (leaving || !dirty.value) return true;
  leaveOpen.value = true;
  return new Promise<boolean>((resolve) => {
    pendingLeave = resolve;
  });
});

function resolveLeave(proceed: boolean) {
  leaveOpen.value = false;
  if (proceed) leaving = true;
  pendingLeave?.(proceed);
  pendingLeave = undefined;
}

async function leaveAfterSave() {
  // A new item navigates to its own page on save; the pending navigation is dropped.
  const wasNew = isNew.value;
  const saved = await save();
  if (wasNew) {
    leaveOpen.value = false;
    pendingLeave?.(false);
    pendingLeave = undefined;
    return;
  }
  if (saved) resolveLeave(true);
}

function onBeforeUnload(event: BeforeUnloadEvent) {
  if (dirty.value && !leaving) event.preventDefault();
}

onMounted(() => window.addEventListener('beforeunload', onBeforeUnload));
onBeforeUnmount(() => window.removeEventListener('beforeunload', onBeforeUnload));

function goBack() {
  void router.push(listPath.value);
}
</script>

<style scoped lang="sass">
.edit-grid
  display: grid
  grid-template-columns: minmax(0, 1fr) 320px
  gap: 24px
  align-items: start

.edit-main
  display: flex
  flex-direction: column
  gap: 16px
  min-width: 0

.edit-side
  display: flex
  flex-direction: column
  gap: 16px

.tabs-card
  padding: 0 12px

.readiness
  align-items: center
  a
    text-decoration: underline

.parent-band
  display: flex
  align-items: center
  gap: 16px
  padding: 14px 20px
  background: $soft-primary
  border: 1px solid #C9CEDD
  border-radius: $radius

.parent-band__icon
  border-radius: 10px
  background: $primary
  color: $paper

.parent-band__text
  gap: 3px
  font-size: 13px
  line-height: 1.45
  color: $primary
  a
    font-weight: 600
    margin-left: 4px

.parent-band__note
  color: #4B4F6B

.type-band
  display: flex
  align-items: center
  gap: 16px
  padding: 18px 20px
  background: $primary
  color: #fff
  border-radius: $radius
  scroll-margin-top: 16px

.type-band__icon
  border-radius: 10px
  background: rgba(250, 247, 240, 0.14)
  color: $paper

.type-band__field
  display: flex
  flex-direction: column
  gap: 6px
  width: 260px
  flex: none

.type-band__label
  font-size: 12px
  font-weight: 600
  letter-spacing: 0.06em
  text-transform: uppercase
  color: #A9B0C7

.type-band__star
  color: #F2B8A8

.type-band__select
  :deep(.q-field__native),
  :deep(.q-field__input)
    font-weight: 600

.type-band__select--missing
  :deep(.q-field__control:before)
    border-color: $warning
    border-width: 2px

.type-band__text
  gap: 4px
  font-size: 13px
  line-height: 1.45
  color: #E1E4EE
  strong
    color: #fff

.type-band__folded
  color: #A9B0C7
  a
    font-weight: 600
    color: #fff

.save-bar
  position: sticky
  bottom: 16px
  z-index: 5
  display: flex
  align-items: center
  gap: 8px
  padding: 12px 20px
  box-shadow: 0 -6px 20px rgba(28, 26, 21, 0.06)

.save-bar__status
  display: inline-flex
  align-items: center
  gap: 6px
  min-width: 0
  font-size: 13px
  color: $soft-positive-ink

.save-bar__status--dirty
  color: $soft-warning-ink

.page-nav
  padding: 14px 12px

.page-nav__title
  padding: 0 8px 8px
  font-size: 12px
  letter-spacing: 0.08em
  text-transform: uppercase
  font-weight: 700
  color: $muted

.page-nav__item
  min-height: 38px
  padding: 0 8px
  border-radius: 6px
  font-size: 14px
  :deep(.q-item__section--avatar)
    min-width: 0
    padding-right: 10px

.page-nav__item--type
  background: $paper-deep
  color: $primary
  font-weight: 600

.page-nav__item--empty
  color: $muted

.page-nav__tile
  display: inline-flex
  align-items: center
  justify-content: center
  width: 22px
  height: 22px
  border-radius: 6px
  background: $soft-primary
  color: $primary
  font-size: 11px
  font-weight: 700

.page-nav__tile--solid
  background: $primary
  color: $paper

.page-nav__tile--empty
  background: $soft-muted
  color: $soft-muted-ink

.page-nav__tile--dashed
  background: transparent
  border: 1px dashed $field-border

.page-nav__count
  font-size: 12px
  color: $muted
  font-variant-numeric: tabular-nums

.page-nav__dot
  width: 6px
  height: 6px

.page-nav__dot--negative
  background: $negative

.page-nav__buttons
  display: flex
  gap: 8px
  padding: 10px 8px 2px
  margin-top: 6px
  border-top: 1px solid $divider-soft
  :deep(.q-btn)
    min-height: 32px
    font-size: 12.5px

.status-list
  margin: 0
  display: grid
  grid-template-columns: 90px minmax(0, 1fr)
  row-gap: 10px
  column-gap: 12px
  font-size: 13px
  dt
    color: $muted

  dd
    margin: 0

.status-note
  padding: 10px 12px
  font-size: 13px
  :deep(.q-icon)
    font-size: 18px

.status-help
  font-size: 12px
  line-height: 1.45
  color: $muted

.side-link
  font-size: 13px

.side-line
  display: flex
  align-items: center
  gap: 10px
  font-size: 13px
  color: $ink-soft

.open-task
  display: flex
  flex-direction: column
  gap: 8px
  padding: 12px 14px
  background: #FBF8F1
  border: 1px solid $divider
  border-radius: $radius
  text-decoration: none
  color: $ink
  &:hover
    border-color: $field-border
    color: $ink

.open-task__title
  font-size: 14px
  font-weight: 600

.open-task__sub
  font-size: 12px
  color: $muted

@media (max-width: 1200px)
  .edit-grid
    grid-template-columns: minmax(0, 1fr)
</style>

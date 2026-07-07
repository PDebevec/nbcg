<template>
  <div class="fullscreen bg-primary text-white text-center q-pa-md flex flex-center">
    <div>
      <div style="font-size: 24vh">403</div>
      <div class="text-h4" style="opacity: 0.6">{{ t('forbidden.title') }}</div>
      <div class="q-mt-sm" style="opacity: 0.5">{{ t('forbidden.text') }}</div>
      <q-btn
        class="q-mt-xl"
        color="white"
        text-color="primary"
        unelevated
        no-caps
        :label="t('common.backHome')"
        to="/"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
</script>

<script setup lang="ts">
// Logistics' verb in the dashboard action strip (#90): start a new order.
import { useI18n } from 'vue-i18n';
import { ShoppingCart } from '@lucide/vue';
import { DashboardAction } from '@makekeeper/frontend-core';

const { t } = useI18n();
</script>

<template>
  <DashboardAction
    :label="t('logistics.bench.newOrder')"
    :icon="ShoppingCart"
    to="/logistics/new"
  />
</template>

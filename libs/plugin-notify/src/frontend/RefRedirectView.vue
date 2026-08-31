<script setup lang="ts">
import { onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Spinner, resolveObjectRefRoute } from '@makekeeper/frontend-core';

// Where a link in a channel message lands (#311).
//
// A message sent to a phone or a chat client cannot carry an in-app route — the
// route belongs to whichever plugin owns the object, and that is only knowable
// in the browser. So the link carries the canonical ORef and this view resolves
// it, exactly as the chat renderer resolves one inside a reply.
const route = useRoute();
const router = useRouter();

onMounted(async () => {
  const raw = route.params.ref;
  const ref = Array.isArray(raw) ? raw[0] : raw;
  const target = ref ? resolveObjectRefRoute(decodeURIComponent(ref)) : null;
  // An object that has been deleted, or belongs to a plugin that is switched
  // off, resolves to nothing: home is a better landing than an error page for
  // somebody who just tapped a banner.
  await router.replace(target ?? '/');
});
</script>

<template>
  <div class="flex items-center justify-center py-24">
    <Spinner />
  </div>
</template>

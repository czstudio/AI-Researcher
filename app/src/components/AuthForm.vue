<script setup>
import { computed, ref } from 'vue';
import { login, signup, toast } from '../stores/app.js';

const props = defineProps({
  initialMode: { type: String, default: 'login' },
  referralCode: { type: String, default: '' },
  compact: { type: Boolean, default: false },
});
const emit = defineEmits(['success']);
const mode = ref(props.initialMode === 'signup' ? 'signup' : 'login');
const email = ref('');
const password = ref('');
const name = ref('');
const busy = ref(false);
const error = ref('');

const title = computed(() => (mode.value === 'login' ? 'Sign in' : 'Create your account'));
const submitLabel = computed(() => (mode.value === 'login' ? 'Sign in' : 'Create account'));

async function submit() {
  error.value = '';
  if (busy.value) return;
  if (email.value.trim() === '' || password.value === '') {
    error.value = 'Email and password are required.';
    return;
  }
  if (password.value.length < 6) {
    error.value = 'Password must be at least 6 characters.';
    return;
  }
  busy.value = true;
  try {
    if (mode.value === 'login') await login(email.value.trim(), password.value);
    else await signup(email.value.trim(), password.value, name.value.trim(), props.referralCode);
    toast(mode.value === 'login' ? 'Signed in' : 'Account created');
    emit('success');
  } catch (e) {
    error.value = String(e.message || e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <form class="auth-form" :class="{ compact }" @submit.prevent="submit">
    <div class="head">
      <h2>{{ title }}</h2>
      <p class="muted">Use an email account on this instance. Your session token is stored locally.</p>
    </div>
    <label v-if="mode === 'signup'" class="field">
      <span>Name</span>
      <input v-model="name" autocomplete="name" placeholder="Researcher name" />
    </label>
    <label class="field">
      <span>Email</span>
      <input v-model="email" type="email" autocomplete="email" placeholder="you@example.com" />
    </label>
    <label class="field">
      <span>Password</span>
      <input v-model="password" type="password" autocomplete="current-password" placeholder="At least 6 characters" @keydown.enter.prevent="submit" />
    </label>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <button class="btn primary submit" type="submit" :disabled="busy">{{ busy ? 'Please wait…' : submitLabel }}</button>
    <button type="button" class="btn ghost switch" @click="mode = mode === 'login' ? 'signup' : 'login'; error = ''">
      {{ mode === 'login' ? 'Need an account? Create one' : 'Already have an account? Sign in' }}
    </button>
    <p class="muted tiny">Anonymous sessions work without an account and are bound to this browser fingerprint.</p>
  </form>
</template>

<style scoped>
.auth-form { display: flex; flex-direction: column; gap: 12px; width: 100%; }
.auth-form:not(.compact) { max-width: 420px; }
.head h2 { margin: 0 0 4px; font-family: var(--font-display); font-size: 26px; }
.head p { margin: 0; font-size: var(--fs-12); }
.field { display: flex; flex-direction: column; gap: 4px; font-size: var(--fs-12); font-weight: 600; }
.field input { height: 38px; border: 1px solid var(--input); border-radius: var(--r-8); padding: 0 11px; background: var(--background); font-weight: 400; }
.submit { justify-content: center; height: 38px; margin-top: 2px; }
.switch { justify-content: center; }
.error { margin: 0; color: var(--destructive); font-size: var(--fs-12); padding: 7px 9px; background: color-mix(in oklch, var(--destructive) 9%, transparent); border-radius: var(--r-8); }
.tiny { font-size: var(--fs-10); margin: 2px 0 0; }
</style>

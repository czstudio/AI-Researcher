<script setup>
import { ref } from 'vue';
import { store, toast, refreshUser } from '../stores/app.js';
import { api, setToken } from '../lib/api.js';
import { navigate } from '../lib/router.js';

const email = ref('');
const password = ref('');
const name = ref('');
const mode = ref('login'); // login | signup
const busy = ref(false);

async function submit() {
  busy.value = true;
  try {
    if (mode.value === 'login') {
      const r = await api.login(email.value, password.value);
      setToken(r.token);
    } else {
      const r = await api.signUp(email.value, password.value, name.value);
      setToken(r.token);
    }
    await refreshUser();
    store.overlays.login = false;
    toast('Welcome back', 'success');
    navigate('/');
  } catch (e) {
    toast(String(e.message || e), 'error');
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="overlay" @click.self="store.overlays.login = false">
    <div class="card">
      <h2>{{ mode === 'login' ? 'Sign in' : 'Create account' }}</h2>
      <p class="sub">Continue to your research workspace</p>
      <input v-if="mode === 'signup'" v-model="name" placeholder="Name" class="input" />
      <input v-model="email" placeholder="Email" type="email" class="input" />
      <input v-model="password" placeholder="Password" type="password" class="input" />
      <button class="btn primary" :disabled="busy" @click="submit">
        {{ busy ? '…' : (mode === 'login' ? 'Sign in' : 'Create account') }}
      </button>
      <p class="toggle">
        {{ mode === 'login' ? "No account?" : "Already have an account?" }}
        <a href="#" @click.prevent="mode = mode === 'login' ? 'signup' : 'login'">
          {{ mode === 'login' ? 'Create one' : 'Sign in' }}
        </a>
      </p>
      <button class="close" @click="store.overlays.login = false">&times;</button>
    </div>
  </div>
</template>

<style scoped>
.overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.35); display: grid; place-items: center; z-index: 120; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 28px; width: 380px; max-width: 92vw; position: relative; }
h2 { margin: 0 0 6px; font-size: 20px; }
.sub { margin: 0 0 18px; color: var(--muted); font-size: 13px; }
.input { width: 100%; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--border); background: var(--input-bg); color: var(--text); margin-bottom: 10px; font-size: 14px; }
.btn { width: 100%; padding: 10px; border-radius: 10px; border: none; background: var(--accent); color: #fff; font-weight: 600; cursor: pointer; }
.btn:disabled { opacity: 0.6; }
.toggle { text-align: center; margin-top: 14px; font-size: 13px; color: var(--muted); }
.toggle a { color: var(--accent); text-decoration: none; }
.close { position: absolute; top: 10px; right: 14px; background: none; border: none; font-size: 22px; color: var(--muted); cursor: pointer; }
</style>

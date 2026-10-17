import { createApp } from 'vue';
import App from './App.vue';
import './styles/tokens.css';
import './styles/app.css';
import { bootstrap } from './stores/app.js';

bootstrap().finally(() => {
  createApp(App).mount('#app');
});

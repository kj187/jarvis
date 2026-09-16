import DefaultTheme from 'vitepress/theme'
import Layout from './Layout.vue'
import MeshCanvas from './components/MeshCanvas.vue'
import './style.css'
import type { Theme } from 'vitepress'

export default {
  extends: DefaultTheme,
  Layout,
  enhanceApp({ app }) {
    app.component('MeshCanvas', MeshCanvas)
  },
} satisfies Theme

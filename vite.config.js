import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// WebXR exige HTTPS. Em desenvolvimento usamos um certificado autoassinado
// para o Quest acessar direto pela rede Wi-Fi. Defina NO_SSL=1 para servir
// HTTP puro (por exemplo, atrás de um túnel ngrok que já fornece HTTPS).
const useSsl = !process.env.NO_SSL;

export default defineConfig({
  // Caminhos relativos: o build funciona em qualquer subpasta (ex.: GitHub Pages).
  base: './',
  plugins: useSsl ? [basicSsl()] : [],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          rapier: ['@dimforge/rapier3d-compat'],
        },
      },
    },
  },
});

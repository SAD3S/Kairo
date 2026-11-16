import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.kairo.mobile',
  appName: 'Kairo',
  webDir: 'dist',
  backgroundColor: '#0A0A0B',
  server: { androidScheme: 'https' },
  android: {
    // Permet d'appeler Ollama sur ton Mac en http://192.168.x.x:11434
    allowMixedContent: true,
  },
};

export default config;

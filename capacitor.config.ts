import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.daymark.scheduler',
  appName: 'Daymark',
  webDir: 'dist',
  plugins: {
    LocalNotifications: {
      smallIcon: 'ic_stat_daymark',
      iconColor: '#2e5948',
      presentationOptions: ['badge', 'sound', 'banner', 'list']
    }
  }
};

export default config;

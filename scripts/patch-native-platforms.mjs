import fs from 'node:fs';
import path from 'node:path';

const platform = process.argv[2];
if (!['android', 'ios'].includes(platform)) {
  console.error('Usage: node scripts/patch-native-platforms.mjs android|ios');
  process.exit(2);
}
if (platform === 'android') {
  const manifest = path.join('android', 'app', 'src', 'main', 'AndroidManifest.xml');
  if (!fs.existsSync(manifest)) throw new Error(`Missing ${manifest}. Run "npx cap add android" first.`);
  let xml = fs.readFileSync(manifest, 'utf8');
  const permissions = [
    'android.permission.POST_NOTIFICATIONS',
    'android.permission.SCHEDULE_EXACT_ALARM'
  ];
  for (const permission of permissions) {
    if (!xml.includes(permission)) xml = xml.replace(/<manifest\b[^>]*>/, match => `${match}\n    <uses-permission android:name="${permission}" />`);
  }
  const deepLink = `\n            <intent-filter>\n                <action android:name="android.intent.action.VIEW" />\n                <category android:name="android.intent.category.DEFAULT" />\n                <category android:name="android.intent.category.BROWSABLE" />\n                <data android:scheme="com.daymark.scheduler" android:host="auth-callback" />\n            </intent-filter>`;
  if (!xml.includes('android:host="auth-callback"')) {
    const activityBlock = /(<activity\b[^>]*android:name="\.MainActivity"[^>]*>)([\s\S]*?)(<\/activity>)/;
    if (!activityBlock.test(xml)) throw new Error('Could not locate MainActivity in AndroidManifest.xml; add the Daymark auth callback intent filter manually.');
    xml = xml.replace(activityBlock, (_all, start, body, end) => `${start}${body}${deepLink}\n        ${end}`);
  }
  fs.writeFileSync(manifest, xml);
  const drawableDir = path.join('android', 'app', 'src', 'main', 'res', 'drawable');
  fs.mkdirSync(drawableDir, { recursive: true });
  fs.writeFileSync(path.join(drawableDir, 'ic_stat_daymark.xml'), `<?xml version="1.0" encoding="utf-8"?>\n<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24">\n    <path android:fillColor="#FFFFFFFF" android:pathData="M19,4h-1V2h-2v2H8V2H6v2H5c-1.1,0 -2,0.9 -2,2v14c0,1.1 0.9,2 2,2h14c1.1,0 2,-0.9 2,-2V6c0,-1.1 -0.9,-2 -2,-2zM19,20H5V9h14v11zM7,11h4v4H7z" />\n</vector>\n`);
  console.log('Configured Android notification permissions, monochrome status icon, and Daymark OAuth deep link.');
} else {
  const file = path.join('ios', 'App', 'App', 'Info.plist');
  if (!fs.existsSync(file)) throw new Error(`Missing ${file}. Run "npx cap add ios" first (requires macOS/Xcode).`);
  let plist = fs.readFileSync(file, 'utf8');
  if (!plist.includes('<string>com.daymark.scheduler</string>')) {
    const entry = `\t<key>CFBundleURLTypes</key>\n\t<array>\n\t\t<dict>\n\t\t\t<key>CFBundleURLName</key>\n\t\t\t<string>com.daymark.scheduler</string>\n\t\t\t<key>CFBundleURLSchemes</key>\n\t\t\t<array><string>com.daymark.scheduler</string></array>\n\t\t</dict>\n\t</array>\n`;
    if (/<\/dict>\s*<\/plist>/.test(plist)) plist = plist.replace(/<\/dict>\s*<\/plist>/, `${entry}</dict>\n</plist>`);
    else throw new Error('Could not locate the main Info.plist dictionary closing tag. Add CFBundleURLTypes manually.');
    fs.writeFileSync(file, plist);
  }
  console.log('Configured iOS Daymark OAuth callback scheme. Open the project in Xcode to sign and build.');
}

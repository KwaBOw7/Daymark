
import fs from 'node:fs';
import path from 'node:path';

const platform = process.argv[2];

if (!['android', 'ios'].includes(platform)) {
  console.error('Usage: node scripts/patch-native-platforms.mjs android|ios');
  process.exit(2);
}

if (platform === 'android') {
  const manifest = path.join(
    'android', 'app', 'src', 'main', 'AndroidManifest.xml'
  );

  if (!fs.existsSync(manifest)) {
    throw new Error(`Missing ${manifest}. Run "npx cap add android" first.`);
  }

  let xml = fs.readFileSync(manifest, 'utf8');

  const permissions = [
    'android.permission.POST_NOTIFICATIONS',
    'android.permission.SCHEDULE_EXACT_ALARM'
  ];

  for (const permission of permissions) {
    if (!xml.includes(permission)) {
      xml = xml.replace(
        /<manifest\b[^>]*>/,
        match => `${match}\n    <uses-permission android:name="${permission}" />`
      );
    }
  }

  const deepLink = `
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="com.daymark.scheduler" android:host="auth-callback" />
            </intent-filter>`;

  if (!xml.includes('android:host="auth-callback"')) {
    const activityBlock =
      /(<activity\b[^>]*android:name="\.MainActivity"[^>]*>)([\s\S]*?)(<\/activity>)/;

    if (!activityBlock.test(xml)) {
      throw new Error('Could not locate MainActivity in AndroidManifest.xml.');
    }

    xml = xml.replace(
      activityBlock,
      (_all, start, body, end) =>
        `${start}${body}${deepLink}\n        ${end}`
    );
  }

  fs.writeFileSync(manifest, xml);

  // Apply Daymark's existing launcher artwork.
  const sourceIcon = path.join('public', 'icons', 'icon-512.png');

  if (!fs.existsSync(sourceIcon)) {
    throw new Error(`Missing launcher icon: ${sourceIcon}`);
  }

  const resDir = path.join(
    'android', 'app', 'src', 'main', 'res'
  );

  for (const dir of [
    'mipmap-mdpi',
    'mipmap-hdpi',
    'mipmap-xhdpi',
    'mipmap-xxhdpi',
    'mipmap-xxxhdpi'
  ]) {
    const targetDir = path.join(resDir, dir);
    fs.mkdirSync(targetDir, { recursive: true });

    for (const name of ['ic_launcher.png', 'ic_launcher_round.png']) {
      fs.copyFileSync(sourceIcon, path.join(targetDir, name));
    }
  }

  // Generate adaptive launcher icons.
  const adaptiveDir = path.join(resDir, 'mipmap-anydpi-v26');
  fs.mkdirSync(adaptiveDir, { recursive: true });

  const adaptiveIcon = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@drawable/ic_launcher_foreground" />
</adaptive-icon>
`;

  fs.writeFileSync(
    path.join(adaptiveDir, 'ic_launcher.xml'),
    adaptiveIcon
  );

  fs.writeFileSync(
    path.join(adaptiveDir, 'ic_launcher_round.xml'),
    adaptiveIcon
  );

  const drawableDir = path.join(resDir, 'drawable');
  fs.mkdirSync(drawableDir, { recursive: true });

  fs.writeFileSync(
    path.join(drawableDir, 'ic_stat_daymark.xml'),
    `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <path
        android:fillColor="#FFFFFFFF"
        android:pathData="M19,4h-1V2h-2v2H8V2H6v2H5c-1.1,0 -2,0.9 -2,2v14c0,1.1 0.9,2 2,2h14c1.1,0 2,-0.9 2,-2V6c0,-1.1 -0.9,-2 -2,-2zM19,20H5V9h14v11zM7,11h4v4H7z" />
</vector>
`
  );

  const valuesDir = path.join(resDir, 'values');
  fs.mkdirSync(valuesDir, { recursive: true });

  fs.writeFileSync(
    path.join(valuesDir, 'ic_launcher_background.xml'),
    `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#263D35</color>
</resources>
`
  );

  const foregroundDir = path.join(resDir, 'drawable-nodpi');
  fs.mkdirSync(foregroundDir, { recursive: true });

  fs.copyFileSync(
    sourceIcon,
    path.join(foregroundDir, 'ic_launcher_foreground.png')
  );

  console.log('Configured Daymark permissions, OAuth deep link and launcher icon.');
} else {
  const file = path.join('ios', 'App', 'App', 'Info.plist');

  if (!fs.existsSync(file)) {
    throw new Error(`Missing ${file}. Run "npx cap add ios" first.`);
  }

  let plist = fs.readFileSync(file, 'utf8');

  if (!plist.includes('<string>com.daymark.scheduler</string>')) {
    const entry = `\t<key>CFBundleURLTypes</key>
\t<array>
\t\t<dict>
\t\t\t<key>CFBundleURLName</key>
\t\t\t<string>com.daymark.scheduler</string>
\t\t\t<key>CFBundleURLSchemes</key>
\t\t\t<array><string>com.daymark.scheduler</string></array>
\t\t</dict>
\t</array>
`;

    if (!/<\/dict>\s*<\/plist>/.test(plist)) {
      throw new Error('Could not locate the main Info.plist dictionary.');
    }

    plist = plist.replace(
      /<\/dict>\s*<\/plist>/,
      `${entry}</dict>\n</plist>`
    );

    fs.writeFileSync(file, plist);
  }

  console.log('Configured iOS Daymark OAuth callback scheme.');
}

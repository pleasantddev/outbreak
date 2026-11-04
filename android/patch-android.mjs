// Full screen, landscape-friendly, keeps the screen on, and lets the game reach a server on your Wi-Fi (plain http).
import { readFileSync, writeFileSync } from 'node:fs';
const f = 'android/app/src/main/AndroidManifest.xml'; let m = readFileSync(f, 'utf8');
m = m.replace('<application', '<application android:usesCleartextTraffic="true"');
m = m.replace(/<activity([^>]*?)android:name=".MainActivity"/, '<activity$1android:name=".MainActivity" android:screenOrientation="sensorLandscape" android:hardwareAccelerated="true"');
if (!m.includes('android.permission.RECORD_AUDIO')) m = m.replace('<application', '<uses-permission android:name="android.permission.RECORD_AUDIO" />\n    <application');
writeFileSync(f, m);
const s = 'android/app/src/main/res/values/styles.xml'; let st = readFileSync(s, 'utf8');
st = st.replace(/(<style name="AppTheme.NoActionBar"[^>]*>)/, '$1\n        <item name="android:windowFullscreen">true</item>\n        <item name="android:windowLayoutInDisplayCutoutMode">shortEdges</item>');
writeFileSync(s, st);
console.log('android patched');

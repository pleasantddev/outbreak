import '@fontsource/barlow-condensed/500.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/barlow-condensed/800.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import '@fontsource/jetbrains-mono/500.css';

const params = new URLSearchParams(location.search);
if (params.get('dev')) {
  import('./dev/viewer').then((m) => m.runViewer(params));
} else {
  import('./app/app').then((m) => m.boot());
}

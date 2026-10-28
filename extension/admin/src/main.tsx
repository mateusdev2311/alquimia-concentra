import { render } from 'preact';
import '../../comum/estilo.css';
import { sdk } from '../../comum/omni';
import './admin.css';
import { App } from './app';

const omni = sdk();
omni.ready((ctx) => {
  render(<App omni={omni} ctx={ctx ?? {}} />, document.getElementById('app')!);
});

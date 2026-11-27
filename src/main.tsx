import {createRoot} from 'react-dom/client';
import {initNetworkDiagnostic, observeReactMount} from './utils/networkDiagnostic';
import {runNeutralNetworkProbe} from './utils/networkReachabilityProbe';
import App from './App.tsx';
import './index.css';

initNetworkDiagnostic();
void runNeutralNetworkProbe();

const rootEl = document.getElementById('root')!;
observeReactMount(rootEl);
createRoot(rootEl).render(<App />);


import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'pads' },
  { path: 'pads', title: 'MPC · Pads', loadComponent: () => import('./features/pads/pads').then((m) => m.PadsView) },
  {
    path: 'samples',
    title: 'MPC · Samples',
    loadComponent: () => import('./features/samples/samples').then((m) => m.SamplesView),
  },
  { path: 'synth', title: 'MPC · Synthé', loadComponent: () => import('./features/synth/synth').then((m) => m.SynthView) },
  {
    path: 'keyboard',
    title: 'MPC · Clavier',
    loadComponent: () => import('./features/keyboard/keyboard').then((m) => m.KeyboardView),
  },
  { path: 'help', title: 'MPC · Guide des potards', loadComponent: () => import('./features/help/help').then((m) => m.HelpView) },
  { path: '**', redirectTo: 'pads' },
];

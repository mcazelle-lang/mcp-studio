import { cutoffToHz, formatHz, formatSeconds, noteName } from '../../core/audio-utils';
import { DECAY_HOLD, Envelope, PlaybackSettings, SynthPatch, defaultPatch } from '../../core/models';
import {
  Figure,
  adsrFigure,
  attackFigure,
  countInFigure,
  detuneFigure,
  driveFigure,
  meterFigure,
  quantizeFigure,
  tempoFigure,
  filterEnvAmountFigure,
  filterFigure,
  gateFigure,
  levelFigure,
  lfoCurveFigure,
  lfoTargetFigure,
  noiseFigure,
  oscPitchFigure,
  padDecayFigure,
  panFigure,
  reverbFigure,
  reverseFigure,
  samplePitchFigure,
  startFigure,
  velocityFigure,
  waveShapeFigure,
} from './help-figures';

export type DemoSample = 'chord' | 'snare';

/** Ce que la page d'aide sait jouer pour faire entendre un réglage. */
export interface Demo {
  sample(
    which: DemoSample,
    settings?: Partial<PlaybackSettings>,
    options?: { velocity?: number; pitch?: number; holdFor?: number; release?: number; delay?: number },
  ): void;
  synth(change: (patch: SynthPatch) => void, options?: { notes?: number[]; hold?: number }): void;
}

export type HelpControl =
  | { type: 'knob'; min: number; max: number; step?: number; value: number; bipolar?: boolean; format: (v: number) => string }
  | { type: 'choice'; options: string[]; value: number };

export interface HelpEntry {
  id: string;
  name: string;
  range: string;
  /** Ce qu'on entend, en une phrase. */
  effect: string;
  details: string;
  tip?: string;
  control: HelpControl;
  figure: (value: number) => Figure;
  listen?: (demo: Demo, value: number) => void;
}

export interface HelpGroup {
  title: string;
  intro?: string;
  entries: HelpEntry[];
}

export interface HelpSection {
  id: 'pads' | 'synth' | 'keyboard' | 'recorder' | 'samples';
  title: string;
  intro: string;
  groups: HelpGroup[];
}

const percent = (v: number) => `${Math.round(v * 100)}`;
const hz = (v: number) => `${formatHz(cutoffToHz(v))}Hz`;
const signed = (v: number) => (v > 0 ? `+${Math.round(v)}` : `${Math.round(v)}`);
const pan = (v: number) => (Math.abs(v) < 0.02 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`);

const AMP_ENV = defaultPatch().ampEnv;
const FILTER_ENV = defaultPatch().filterEnv;
const WAVES: OscillatorType[] = ['sine', 'triangle', 'sawtooth', 'square'];
const WAVE_LABELS = ['SIN', 'TRI', 'SAW', 'SQR'];
const FILTER_TYPES = ['lowpass', 'bandpass', 'highpass'] as const;
const LFO_TARGETS = ['pitch', 'filter', 'amp'] as const;

/** Son de synthé neutre, pour entendre un seul oscillateur à la fois. */
function soloOsc1(p: SynthPatch): void {
  p.osc2.level = 0;
  p.filter.cutoff = 0.85;
  p.filter.envAmount = 0;
}

function envelopeEntry(
  target: 'ampEnv' | 'filterEnv',
  key: keyof Envelope,
  texts: { effect: string; details: string; tip?: string },
): HelpEntry {
  const base = target === 'ampEnv' ? AMP_ENV : FILTER_ENV;
  const knob: Record<keyof Envelope, HelpControl> = {
    attack: { type: 'knob', min: 0, max: 2, value: base.attack, format: formatSeconds },
    decay: { type: 'knob', min: 0.01, max: 3, value: base.decay, format: formatSeconds },
    sustain: { type: 'knob', min: 0, max: 1, value: base.sustain, format: percent },
    release: { type: 'knob', min: 0.01, max: 4, value: base.release, format: formatSeconds },
  };
  const ranges: Record<keyof Envelope, string> = {
    attack: '0 – 2 s',
    decay: '10 ms – 3 s',
    sustain: '0 – 100',
    release: '10 ms – 4 s',
  };
  const names: Record<keyof Envelope, string> = { attack: 'Attack', decay: 'Decay', sustain: 'Sustain', release: 'Release' };
  return {
    id: `${target}-${key}`,
    name: names[key],
    range: ranges[key],
    ...texts,
    control: knob[key],
    figure: (v) => adsrFigure({ ...base, [key]: v }, key),
    listen: (demo, v) =>
      demo.synth(
        (p) => {
          p[target][key] = v;
          if (target === 'filterEnv') {
            p.filter.cutoff = 0.3;
            p.filter.envAmount = 0.7;
            p.filter.resonance = 6;
          }
        },
        { hold: Math.max(0.6, (key === 'attack' ? v : 0) + 0.4) },
      ),
  };
}

export const HELP: HelpSection[] = [
  {
    id: 'pads',
    title: 'Pads',
    intro:
      'Chaque pad a ses propres réglages : ils s’appliquent au sample du pad sélectionné (son nom est affiché au-dessus des potards). Rien n’est modifié dans le fichier audio : les réglages agissent à la lecture.',
    groups: [
      {
        title: 'Potards du pad',
        entries: [
          {
            id: 'pad-volume',
            name: 'Volume',
            range: '0 – 100',
            effect: 'Le pad joue plus ou moins fort.',
            details:
              'Règle le niveau de sortie du pad. Quand « Full level » est désactivé, ce niveau est en plus multiplié par la force de frappe.',
            tip: 'Pour un beat équilibré : kick et snare vers 85–95, charleston (hats) vers 40–55, percussions entre les deux.',
            control: { type: 'knob', min: 0, max: 1, value: 0.8, format: percent },
            figure: levelFigure,
            listen: (demo, v) => demo.sample('chord', { volume: v }),
          },
          {
            id: 'pad-tune',
            name: 'Tune',
            range: '−24 à +24 demi-tons',
            effect: 'Le son devient plus aigu et plus court, ou plus grave et plus long.',
            details:
              'Le sample est lu plus vite ou plus lentement, comme sur un échantillonneur classique : la hauteur et la durée sont liées. +12 = une octave au-dessus et deux fois plus court, −12 = une octave en dessous et deux fois plus long.',
            tip: 'Accordez le kick sur la tonalité du morceau, ou faites une ligne de basse avec un seul sample réparti sur plusieurs pads.',
            control: { type: 'knob', min: -24, max: 24, step: 1, value: 0, bipolar: true, format: signed },
            figure: samplePitchFigure,
            listen: (demo, v) => demo.sample('chord', { pitch: v }),
          },
          {
            id: 'pad-pan',
            name: 'Pan',
            range: 'L100 · C · R100',
            effect: 'Le son se déplace vers la gauche ou la droite.',
            details: 'Place le pad dans l’image stéréo. Au centre (C), il sort autant des deux côtés.',
            tip: 'Gardez kick, snare et basse au centre ; écartez légèrement hats et percussions (L/R 20 à 35) pour aérer le mix.',
            control: { type: 'knob', min: -1, max: 1, value: 0, bipolar: true, format: pan },
            figure: panFigure,
            listen: (demo, v) => demo.sample('chord', { pan: v }),
          },
          {
            id: 'pad-filter',
            name: 'Filtre',
            range: '20 Hz – 20 kHz',
            effect: 'Le son devient plus sourd, comme entendu derrière un mur.',
            details:
              'Filtre passe-bas : il laisse passer les graves et coupe les aigus au-dessus de la fréquence choisie. À 20 kHz (potard au maximum), rien n’est coupé. L’échelle est logarithmique : le milieu du potard correspond à environ 630 Hz.',
            tip: 'Baissez le filtre d’une boucle pour un effet « lo-fi », ou remontez-le progressivement pour faire entrer un élément.',
            control: { type: 'knob', min: 0, max: 1, value: 1, format: hz },
            figure: (v) => filterFigure(v, 0.8),
            listen: (demo, v) => demo.sample('chord', { cutoff: v }),
          },
          {
            id: 'pad-attack',
            name: 'Attaque',
            range: '0 – 1 s',
            effect: 'Le début du son est adouci : il « gonfle » au lieu de claquer.',
            details: 'Temps que met le volume pour monter de zéro à son maximum au début du son. À 0, l’attaque est franche.',
            tip: 'Entre 20 et 80 ms pour enlever le clic d’un sample enregistré au micro ; plus long pour transformer un accord en nappe.',
            control: { type: 'knob', min: 0, max: 1, value: 0, format: formatSeconds },
            figure: attackFigure,
            listen: (demo, v) => demo.sample('snare', { attack: v }),
          },
          {
            id: 'pad-decay',
            name: 'Decay',
            range: '20 ms – ∞',
            effect: 'Le son s’éteint plus ou moins vite.',
            details:
              'Durée de l’extinction après l’attaque. Potard au maximum (∞) : le sample est joué jusqu’au bout sans être raccourci.',
            tip: 'Raccourcissez un open hat pour en faire un hat fermé, ou une basse 808 pour la rendre plus percutante.',
            control: { type: 'knob', min: 0.02, max: DECAY_HOLD, value: DECAY_HOLD, format: (v) => (v >= DECAY_HOLD ? '∞' : formatSeconds(v)) },
            figure: padDecayFigure,
            listen: (demo, v) => demo.sample('chord', { decay: v }),
          },
          {
            id: 'pad-start',
            name: 'Start',
            range: '0 – 95 %',
            effect: 'Le début du sample est sauté.',
            details: 'Point de départ de la lecture, en pourcentage de la durée du sample. La partie grisée n’est pas jouée.',
            tip: 'Supprimez le silence au début d’un enregistrement, ou jouez seulement la fin d’un son pour un effet différent.',
            control: { type: 'knob', min: 0, max: 0.95, value: 0, format: percent },
            figure: startFigure,
            listen: (demo, v) => demo.sample('chord', { start: v }),
          },
          {
            id: 'pad-reverb',
            name: 'Reverb',
            range: '0 – 100',
            effect: 'Le son prend de l’espace, comme joué dans une grande pièce.',
            details:
              'Quantité de son envoyée vers la réverbe commune (environ 2,4 s de queue). Le son d’origine garde le même niveau : la réverbe s’y ajoute.',
            tip: 'Un peu sur la snare ou le clap (15 à 30). Évitez-la sur le kick et la basse : ils perdent de leur impact.',
            control: { type: 'knob', min: 0, max: 1, value: 0, format: percent },
            figure: reverbFigure,
            listen: (demo, v) => demo.sample('snare', { reverb: v }),
          },
        ],
      },
      {
        title: 'Boutons du pad',
        entries: [
          {
            id: 'pad-mode',
            name: 'One-shot / Gate',
            range: '2 modes',
            effect: 'Gate : le son s’arrête dès qu’on lève le doigt.',
            details:
              'One-shot : le sample est joué en entier, même si vous relâchez le pad tout de suite (idéal pour la batterie). Gate : le son est coupé (fondu de 40 ms) au relâchement.',
            tip: 'Gate pour les nappes, accords et basses longues que vous voulez contrôler au doigt.',
            control: { type: 'choice', options: ['One-shot', 'Gate'], value: 0 },
            figure: (v) => gateFigure(v === 1),
            listen: (demo, v) => demo.sample('chord', { mode: v === 1 ? 'gate' : 'oneshot' }, { holdFor: 0.35 }),
          },
          {
            id: 'pad-reverse',
            name: 'Reverse',
            range: 'activé / désactivé',
            effect: 'Le sample est joué à l’envers : il monte au lieu de s’éteindre.',
            details: 'L’attaque se retrouve à la fin. Combiné à Start et Decay, on obtient des effets d’aspiration.',
            tip: 'Une cymbale inversée juste avant un temps fort crée une montée efficace.',
            control: { type: 'choice', options: ['Normal', 'Reverse'], value: 0 },
            figure: (v) => reverseFigure(v === 1),
            listen: (demo, v) => demo.sample('snare', { reverse: v === 1, reverb: 0.3 }),
          },
        ],
      },
      {
        title: 'Réglages généraux',
        entries: [
          {
            id: 'master',
            name: 'Master',
            range: '0 – 100',
            effect: 'Tout le son de l’app monte ou baisse.',
            details:
              'Volume général : pads, clavier et synthé. Un limiteur placé après le master évite la saturation quand plusieurs sons se superposent.',
            control: { type: 'knob', min: 0, max: 1, value: 0.8, format: percent },
            figure: levelFigure,
            listen: (demo, v) => demo.sample('chord', { volume: v }),
          },
          {
            id: 'full-level',
            name: 'Full level',
            range: 'activé / désactivé',
            effect: 'Désactivé : plus vous tapez haut sur le pad, plus c’est fort.',
            details:
              'Activé, chaque frappe joue à force maximale. Désactivé, la force dépend de l’endroit touché : 100 % en haut du pad, environ 25 % en bas. Cela simule la sensibilité à la vélocité d’une vraie MPC.',
            tip: 'Désactivez-le pour jouer des charlestons vivants, avec des coups forts et des « ghost notes » légères.',
            control: { type: 'choice', options: ['Activé', 'Désactivé'], value: 0 },
            figure: (v) => velocityFigure(v === 0),
            listen: (demo, v) =>
              (v === 0 ? [1, 1, 1, 1] : [1, 0.75, 0.5, 0.25]).forEach((velocity, i) =>
                demo.sample('snare', {}, { velocity, delay: i * 0.22 }),
              ),
          },
        ],
      },
    ],
  },
  {
    id: 'synth',
    title: 'Synthé',
    intro:
      'Le synthé est soustractif : deux oscillateurs (et du bruit) produisent un son riche, le filtre en retire une partie, puis les enveloppes et le LFO le font évoluer dans le temps. Les démos partent toujours du même son de base, pas de votre réglage en cours.',
    groups: [
      {
        title: 'Oscillateurs',
        intro: 'Les deux oscillateurs ont les mêmes réglages ; leurs sons sont mélangés.',
        entries: [
          {
            id: 'osc-wave',
            name: 'Forme d’onde',
            range: 'SIN · TRI · SAW · SQR',
            effect: 'Change le timbre de base, du plus doux au plus riche.',
            details:
              'SIN (sinus) : son pur, sans harmoniques, idéal pour les sub-basses. TRI (triangle) : doux, proche d’une flûte. SAW (dent de scie) : riche et brillant, la base des cordes, cuivres et basses. SQR (carré) : creux, sonorité « jeu vidéo » ou clarinette.',
            control: { type: 'choice', options: WAVE_LABELS, value: 2 },
            figure: waveShapeFigure,
            listen: (demo, v) =>
              demo.synth((p) => {
                soloOsc1(p);
                p.osc1.wave = WAVES[v];
              }),
          },
          {
            id: 'osc-octave',
            name: 'Octave',
            range: '−2 à +2',
            effect: 'L’oscillateur sonne une ou deux octaves plus grave ou plus aigu.',
            details: 'Transpose l’oscillateur par octaves entières, sans changer la durée du son.',
            tip: 'Mettez l’oscillateur 2 à −1 pour épaissir une basse ou un lead.',
            control: { type: 'knob', min: -2, max: 2, step: 1, value: 0, bipolar: true, format: signed },
            figure: oscPitchFigure,
            listen: (demo, v) =>
              demo.synth((p) => {
                soloOsc1(p);
                p.osc1.octave = v;
              }),
          },
          {
            id: 'osc-detune',
            name: 'Détune',
            range: '−50 à +50 cents',
            effect: 'Le son devient plus large et « ondule ».',
            details:
              'Désaccorde légèrement l’oscillateur (100 cents = 1 demi-ton). Deux oscillateurs désaccordés en sens opposés produisent un battement, comme un chœur : c’est le secret des sons « supersaw » et « Reese ». L’illustration exagère l’effet pour le rendre visible.',
            tip: 'Entre ±6 et ±15 pour épaissir sans désaccorder ; au-delà de ±25, le son devient volontairement instable.',
            control: { type: 'knob', min: -50, max: 50, step: 1, value: 0, bipolar: true, format: signed },
            figure: detuneFigure,
            listen: (demo, v) =>
              demo.synth((p) => {
                p.osc1 = { wave: 'sawtooth', octave: 0, detune: -v, level: 0.6 };
                p.osc2 = { wave: 'sawtooth', octave: 0, detune: v, level: 0.6 };
                p.filter.cutoff = 0.75;
              }, { hold: 1.2 }),
          },
          {
            id: 'osc-level',
            name: 'Niveau',
            range: '0 – 100',
            effect: 'Dose la présence de cet oscillateur dans le mélange.',
            details: 'À 0, l’oscillateur est coupé. Les niveaux des deux oscillateurs et du bruit s’additionnent.',
            control: { type: 'knob', min: 0, max: 1, value: 0.7, format: percent },
            figure: levelFigure,
            listen: (demo, v) =>
              demo.synth((p) => {
                soloOsc1(p);
                p.osc1.level = v;
              }),
          },
        ],
      },
      {
        title: 'Filtre',
        entries: [
          {
            id: 'filter-type',
            name: 'Type (LP · BP · HP)',
            range: '3 types',
            effect: 'Choisit quelle partie du son est gardée.',
            details:
              'LP (passe-bas) : garde les graves, coupe les aigus — le plus courant. BP (passe-bande) : ne garde qu’une zone autour du cutoff, son nasal façon « wah ». HP (passe-haut) : coupe les graves, son fin et aérien.',
            control: { type: 'choice', options: ['LP', 'BP', 'HP'], value: 0 },
            figure: (v) => filterFigure(0.55, 4, FILTER_TYPES[v]),
            listen: (demo, v) =>
              demo.synth((p) => {
                p.filter.type = FILTER_TYPES[v];
                p.filter.envAmount = 0;
              }),
          },
          {
            id: 'filter-cutoff',
            name: 'Cutoff',
            range: '20 Hz – 20 kHz',
            effect: 'Rend le son plus sombre ou plus brillant.',
            details:
              'Fréquence à partir de laquelle le filtre agit. C’est le réglage qui change le plus la couleur du son. Échelle logarithmique : le milieu du potard ≈ 630 Hz.',
            control: { type: 'knob', min: 0, max: 1, value: 0.55, format: hz },
            figure: (v) => filterFigure(v, 4),
            listen: (demo, v) =>
              demo.synth((p) => {
                p.filter.cutoff = v;
                p.filter.envAmount = 0;
              }),
          },
          {
            id: 'filter-reso',
            name: 'Réso',
            range: '0,1 – 20',
            effect: 'Fait « siffler » le son autour du cutoff.',
            details:
              'La résonance accentue les fréquences proches du cutoff (le pic sur la courbe). Faible : son neutre. Élevée : son nasal et agressif, typique de l’« acid » avec une enveloppe de filtre.',
            tip: 'Réso vers 14–18 + Env vers 70 + Sustain filtre bas = basse acid 303.',
            control: { type: 'knob', min: 0.1, max: 20, value: 4, format: (v) => v.toFixed(1) },
            figure: (v) => filterFigure(0.55, v),
            listen: (demo, v) =>
              demo.synth((p) => {
                p.filter.resonance = v;
                p.filter.cutoff = 0.4;
                p.filter.envAmount = 0.6;
              }),
          },
          {
            id: 'filter-env',
            name: 'Env',
            range: '0 – 100',
            effect: 'Chaque note commence brillante puis s’assombrit (effet « wouah »).',
            details:
              'Quantité d’ouverture du filtre par l’enveloppe de filtre, jusqu’à 7 octaves au-dessus du cutoff. À 0, le filtre reste fixe et l’enveloppe de filtre n’a aucun effet.',
            tip: 'C’est ce qui donne le côté « pincé » d’un pluck ou d’une slap bass.',
            control: { type: 'knob', min: 0, max: 1, value: 0.4, format: percent },
            figure: (v) => filterEnvAmountFigure(v, FILTER_ENV),
            listen: (demo, v) =>
              demo.synth((p) => {
                p.filter.envAmount = v;
                p.filter.cutoff = 0.35;
              }),
          },
          {
            id: 'noise',
            name: 'Bruit',
            range: '0 – 100',
            effect: 'Ajoute un souffle au son.',
            details: 'Mélange du bruit blanc aux oscillateurs, avant le filtre. Utile pour les textures, le vent ou l’attaque des percussions.',
            control: { type: 'knob', min: 0, max: 1, value: 0, format: percent },
            figure: noiseFigure,
            listen: (demo, v) => demo.synth((p) => (p.noise = v)),
          },
        ],
      },
      {
        title: 'Enveloppe volume',
        intro: 'Décrit comment le volume évolue entre l’appui sur la touche et la fin du son (ADSR).',
        entries: [
          envelopeEntry('ampEnv', 'attack', {
            effect: 'Le son démarre progressivement au lieu d’attaquer net.',
            details: 'Temps pour atteindre le volume maximal après l’appui.',
            tip: 'Court (< 10 ms) pour les basses et les sons percussifs, long (0,5 à 2 s) pour les nappes.',
          }),
          envelopeEntry('ampEnv', 'decay', {
            effect: 'Règle la vitesse de la chute après l’attaque.',
            details: 'Temps pour redescendre du maximum vers le niveau de Sustain.',
          }),
          envelopeEntry('ampEnv', 'sustain', {
            effect: 'Niveau tenu tant que la touche reste enfoncée.',
            details: 'À 100, le son reste à fond. À 0, il s’éteint même si on garde la touche : c’est un son « pincé » (pluck).',
          }),
          envelopeEntry('ampEnv', 'release', {
            effect: 'Le son continue plus ou moins longtemps après avoir relâché la touche.',
            details: 'Durée de l’extinction après le relâchement.',
            tip: 'Court pour des notes nettes et rythmées, long pour des notes qui se fondent les unes dans les autres.',
          }),
        ],
      },
      {
        title: 'Enveloppe filtre',
        intro:
          'Mêmes réglages que l’enveloppe volume, mais ils pilotent l’ouverture du filtre dans le temps. Elle n’a d’effet que si le potard Env du filtre est au-dessus de 0.',
        entries: [
          envelopeEntry('filterEnv', 'attack', {
            effect: 'Le son s’éclaircit progressivement au début de la note.',
            details: 'Temps pour que le filtre s’ouvre au maximum.',
          }),
          envelopeEntry('filterEnv', 'decay', {
            effect: 'Règle la vitesse à laquelle le son se ré-assombrit.',
            details: 'Temps pour que le filtre se referme vers le niveau de Sustain.',
            tip: 'Decay court = son pincé (pluck, slap) ; decay long = balayage lent.',
          }),
          envelopeEntry('filterEnv', 'sustain', {
            effect: 'Brillance gardée pendant que la touche est tenue.',
            details: 'Ouverture du filtre maintenue tant que la touche est enfoncée.',
          }),
          envelopeEntry('filterEnv', 'release', {
            effect: 'Vitesse à laquelle le filtre se referme après le relâchement.',
            details: 'Durée de fermeture du filtre après le relâchement de la touche.',
          }),
        ],
      },
      {
        title: 'LFO & sortie',
        intro: 'Le LFO est un oscillateur très lent qui fait varier un réglage en boucle, pour animer le son.',
        entries: [
          {
            id: 'lfo-target',
            name: 'Cible',
            range: 'Pitch · Filtre · Volume',
            effect: 'Choisit ce qui ondule : la hauteur, la brillance ou le volume.',
            details:
              'Pitch : vibrato (jusqu’à ±1 demi-ton). Filtre : effet « wah » ou « wobble » (jusqu’à ±2 octaves de cutoff). Volume : trémolo (jusqu’au silence).',
            control: { type: 'choice', options: ['Pitch', 'Filtre', 'Volume'], value: 0 },
            figure: lfoTargetFigure,
            listen: (demo, v) =>
              demo.synth((p) => {
                p.lfo = { wave: 'sine', rate: 5, depth: 0.7, target: LFO_TARGETS[v] };
                p.filter.envAmount = 0;
              }, { hold: 1.4 }),
          },
          {
            id: 'lfo-rate',
            name: 'Vitesse',
            range: '0,1 – 20 Hz',
            effect: 'L’ondulation est lente ou rapide.',
            details: 'Nombre d’oscillations par seconde. Sous 1 Hz : lent balayage. 4 à 7 Hz : vibrato naturel. Au-delà de 10 Hz : effet grésillant.',
            control: { type: 'knob', min: 0.1, max: 20, value: 5, format: (v) => `${v.toFixed(1)}Hz` },
            figure: (v) => lfoCurveFigure(v, 0.8),
            listen: (demo, v) =>
              demo.synth((p) => {
                p.lfo = { wave: 'sine', rate: v, depth: 0.7, target: 'filter' };
                p.filter.envAmount = 0;
              }, { hold: 1.6 }),
          },
          {
            id: 'lfo-depth',
            name: 'Profondeur',
            range: '0 – 100',
            effect: 'L’ondulation est discrète ou très marquée.',
            details: 'Intensité de la modulation. À 0, le LFO est inactif.',
            control: { type: 'knob', min: 0, max: 1, value: 0.5, format: percent },
            figure: (v) => lfoCurveFigure(3, v),
            listen: (demo, v) =>
              demo.synth((p) => {
                p.lfo = { wave: 'sine', rate: 5.5, depth: v, target: 'pitch' };
              }, { hold: 1.4 }),
          },
          {
            id: 'lfo-wave',
            name: 'Forme du LFO',
            range: 'SIN · TRI · SAW · SQR',
            effect: 'Change la manière dont le son ondule.',
            details: 'Sinus et triangle : va-et-vient régulier. Dent de scie : montée puis retour brusque. Carré : alternance nette entre deux états, comme un trille.',
            control: { type: 'choice', options: WAVE_LABELS, value: 0 },
            figure: (v) => lfoCurveFigure(3, 0.8, v),
            listen: (demo, v) =>
              demo.synth((p) => {
                p.lfo = { wave: WAVES[v], rate: 3, depth: 0.7, target: 'filter' };
                p.filter.envAmount = 0;
              }, { hold: 1.6 }),
          },
          {
            id: 'synth-volume',
            name: 'Volume',
            range: '0 – 100',
            effect: 'Niveau de sortie du synthé.',
            details: 'Volume général du synthé, appliqué après le filtre et les enveloppes. Il s’applique aussi aux samples créés avec « Créer un sample ».',
            control: { type: 'knob', min: 0, max: 1, value: 0.7, format: percent },
            figure: levelFigure,
            listen: (demo, v) => demo.synth((p) => (p.volume = v)),
          },
          {
            id: 'synth-drive',
            name: 'Saturation',
            range: '0 – 100',
            effect: 'Le son devient plus chaud, puis granuleux et agressif.',
            details:
              'Écrase doucement les crêtes du signal après le filtre, comme un ampli poussé à fond : de nouvelles harmoniques apparaissent. Le volume est compensé pour rester comparable.',
            tip: '10 à 25 pour réchauffer une basse ou un saxophone, 60 à 80 pour une guitare rock.',
            control: { type: 'knob', min: 0, max: 1, value: 0, format: percent },
            figure: driveFigure,
            listen: (demo, v) =>
              demo.synth((p) => {
                p.drive = v;
                p.filter.cutoff = 0.62;
              }, { notes: [40, 47, 52], hold: 0.9 }),
          },
        ],
      },
      {
        title: 'Créer un sample',
        entries: [
          {
            id: 'render-note',
            name: 'Note',
            range: 'C1 – C7',
            effect: 'Hauteur de la note enregistrée dans le sample.',
            details: 'Le son du synthé est figé sur cette note. Sur un pad, le potard Tune permet ensuite de le transposer.',
            control: { type: 'knob', min: 24, max: 96, step: 1, value: 60, format: noteName },
            figure: (v) => oscPitchFigure((v - 60) / 12),
            listen: (demo, v) => demo.synth(() => {}, { notes: [v] }),
          },
          {
            id: 'render-hold',
            name: 'Durée',
            range: '50 ms – 4 s',
            effect: 'Temps pendant lequel la note est tenue avant le relâchement.',
            details: 'Le sample dure cette durée plus le Release de l’enveloppe de volume.',
            control: { type: 'knob', min: 0.05, max: 4, value: 0.6, format: formatSeconds },
            figure: (v) => adsrFigure(AMP_ENV, 'sustain', v),
            listen: (demo, v) => demo.synth(() => {}, { hold: v }),
          },
        ],
      },
    ],
  },
  {
    id: 'keyboard',
    title: 'Clavier',
    intro:
      'Le clavier joue le son réglé dans l’onglet Synthé, un instrument tout prêt (basses, guitares, vents, claviers, cordes, leads) ou un sample de la bibliothèque. Les réglages ci-dessous ne concernent que les samples : ils s’appliquent à toutes les notes.',
    groups: [
      {
        title: 'Réglages',
        entries: [
          {
            id: 'kb-volume',
            name: 'Volume',
            range: '0 – 100',
            effect: 'Les notes jouent plus ou moins fort.',
            details: 'Niveau de toutes les notes du clavier.',
            control: { type: 'knob', min: 0, max: 1, value: 0.8, format: percent },
            figure: levelFigure,
            listen: (demo, v) => demo.sample('chord', { volume: v }),
          },
          {
            id: 'kb-filter',
            name: 'Filtre',
            range: '20 Hz – 20 kHz',
            effect: 'Les notes deviennent plus sourdes.',
            details: 'Même filtre passe-bas que sur les pads.',
            control: { type: 'knob', min: 0, max: 1, value: 1, format: hz },
            figure: (v) => filterFigure(v, 0.8),
            listen: (demo, v) => demo.sample('chord', { cutoff: v }),
          },
          {
            id: 'kb-release',
            name: 'Release',
            range: '10 ms – 3 s',
            effect: 'Les notes continuent plus ou moins après avoir relâché la touche.',
            details: 'Durée du fondu de fin quand vous levez le doigt (sans Sustain).',
            control: { type: 'knob', min: 0.01, max: 3, value: 0.3, format: formatSeconds },
            figure: (v) => gateFigure(true, v),
            listen: (demo, v) => demo.sample('chord', { mode: 'gate' }, { holdFor: 0.35, release: v }),
          },
          {
            id: 'kb-root',
            name: 'Racine',
            range: 'C2 – C6',
            effect: 'Corrige la justesse du sample sur le clavier.',
            details:
              'Note à laquelle le sample sonne à sa hauteur d’origine. Si votre sample est un Do 4 (C4), laissez C4 : chaque touche jouera alors la bonne note. La démo joue la touche C4.',
            tip: 'Les samples créés par le synthé portent leur note dans leur nom (ex. « Synth C4 »).',
            control: { type: 'knob', min: 36, max: 84, step: 1, value: 60, format: noteName },
            figure: (v) => samplePitchFigure(60 - v),
            listen: (demo, v) => demo.sample('chord', {}, { pitch: 60 - v }),
          },
          {
            id: 'kb-sustain',
            name: 'Sustain',
            range: 'activé / désactivé',
            effect: 'Les notes continuent après avoir relâché les touches.',
            details: 'Comme la pédale d’un piano : les notes sont tenues jusqu’à ce que vous désactiviez Sustain.',
            control: { type: 'choice', options: ['Désactivé', 'Activé'], value: 0 },
            figure: (v) => gateFigure(v === 0, 0.3),
            listen: (demo, v) => demo.sample('chord', { mode: 'gate' }, v === 0 ? { holdFor: 0.35, release: 0.3 } : {}),
          },
        ],
      },
    ],
  },
  {
    id: 'recorder',
    title: 'Enregistreur & métronome',
    intro:
      'Dans l’onglet Clavier, ● lance le métronome puis enregistre tout ce que vous jouez, jusqu’au prochain appui. Le voyant en haut de l’écran clignote en jaune à chaque temps et en blanc au premier temps de chaque mesure ; touchez-le pour démarrer ou arrêter le métronome. Les réglages ci-dessous sont dans « Prises ».',
    groups: [
      {
        title: 'Réglages',
        entries: [
          {
            id: 'tempo',
            name: 'Tempo',
            range: '40 – 240 BPM',
            effect: 'Les temps du métronome se rapprochent ou s’écartent.',
            details:
              'Nombre de temps par minute. Une prise garde le tempo auquel elle a été enregistrée. Charger un kit règle automatiquement le tempo conseillé pour ce style.',
            tip: 'Hip-hop 85–95, funk 95–110, house 120–128, techno 128–135, drum n bass 170–175.',
            control: { type: 'knob', min: 40, max: 240, step: 1, value: 120, format: (v) => `${Math.round(v)} BPM` },
            figure: tempoFigure,
            listen: (demo, v) =>
              [0, 1, 2, 3, 4, 5, 6, 7].forEach((i) =>
                demo.sample('snare', { decay: 0.08 }, { delay: (i * 60) / v, velocity: i % 4 === 0 ? 1 : 0.45 }),
              ),
          },
          {
            id: 'meter',
            name: 'Mesure',
            range: '2/4 · 3/4 · 4/4',
            effect: 'Choisit le nombre de temps entre deux voyants blancs.',
            details:
              'Le premier temps de chaque mesure est accentué (clic plus aigu, voyant blanc). 4/4 pour la plupart des musiques actuelles, 3/4 pour une valse, 2/4 pour une marche.',
            control: { type: 'choice', options: ['2/4', '3/4', '4/4'], value: 2 },
            figure: (v) => meterFigure(v + 2),
            listen: (demo, v) =>
              Array.from({ length: (v + 2) * 2 }, (_, i) => i).forEach((i) =>
                demo.sample('snare', { decay: 0.08 }, { delay: i * 0.4, velocity: i % (v + 2) === 0 ? 1 : 0.45 }),
              ),
          },
          {
            id: 'count-in',
            name: 'Décompte',
            range: 'non · 1 mesure',
            effect: 'Laisse une mesure de clics avant que l’enregistrement commence.',
            details:
              'Le bouton ● clignote et l’écran affiche 4, 3, 2, 1. L’enregistrement démarre toujours au début d’une mesure, pour que la prise tombe juste quand elle est rejouée en boucle. Une note jouée un tout petit peu en avance est ramenée sur le premier temps.',
            control: { type: 'choice', options: ['Non', '1 mesure'], value: 1 },
            figure: (v) => countInFigure(v === 1),
          },
          {
            id: 'quantize',
            name: 'Calage',
            range: 'libre · croche · double croche',
            effect: 'Recale les notes sur la grille rythmique à la fin de la prise.',
            details:
              'Libre : les notes restent exactement où vous les avez jouées. Croche : elles sont ramenées au demi-temps le plus proche. Double croche : au quart de temps le plus proche (plus précis, garde plus de détails rythmiques). La durée des notes n’est pas modifiée.',
            tip: 'Double croche pour des lignes de basse ou des riffs rapides ; libre pour garder le groove d’un jeu humain.',
            control: { type: 'choice', options: ['Libre', 'Croche', 'Double'], value: 0 },
            figure: (v) => quantizeFigure([0, 8, 16][v]),
          },
        ],
      },
    ],
  },
  {
    id: 'samples',
    title: 'Samples',
    intro: 'Ces réglages modifient le fichier audio lui-même, au moment où vous cliquez sur « Sauver » : un nouveau sample est créé.',
    groups: [
      {
        title: 'Éditeur',
        entries: [
          {
            id: 'trim',
            name: 'Poignées de découpe',
            range: 'début / fin',
            effect: 'Garde seulement la partie utile de l’enregistrement.',
            details: 'Tout ce qui est hors des poignées (grisé) est supprimé. Un fondu très court est ajouté aux deux bords pour éviter les clics.',
            control: { type: 'knob', min: 0, max: 0.6, value: 0.15, format: percent },
            figure: startFigure,
          },
          {
            id: 'normalize',
            name: 'Normaliser',
            range: 'activé / désactivé',
            effect: 'Le sample est remonté au volume maximal sans saturer.',
            details: 'Le niveau est ajusté pour que le point le plus fort atteigne 98 % du maximum. Utile pour les enregistrements micro trop faibles.',
            control: { type: 'choice', options: ['Désactivé', 'Activé'], value: 1 },
            figure: (v) => levelFigure(v === 1 ? 0.98 : 0.3),
            listen: (demo, v) => demo.sample('chord', { volume: v === 1 ? 1 : 0.3 }),
          },
        ],
      },
    ],
  },
];

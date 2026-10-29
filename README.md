# MPC web

Sampler / boîte à rythmes façon MPC, pensé d'abord pour le mobile.
Front-end **Angular 20** (Web Audio API), back-end **Node.js / Express** pour stocker les samples, le kit et les presets.

## Vues

| Vue | Contenu |
| --- | --- |
| **Pads** | 4 banques × 16 pads multi-touch, potards du pad sélectionné (volume, tune, pan, filtre, attaque, decay, start, reverb), one-shot / gate, reverse, volume master, mode vélocité (« Full level » désactivé = plus fort en haut du pad). |
| **Samples** | Enregistrement au micro avec vu-mètre, découpe début/fin, normalisation, import de fichiers audio, bibliothèque (écoute, renommage, découpe, affectation au pad, suppression). |
| **Synthé** | Synthé soustractif : 2 oscillateurs, bruit, filtre LP/BP/HP + enveloppe, enveloppe de volume, LFO (pitch / filtre / volume), presets. « Créer un sample » fige le son en WAV et l'affecte au pad. |
| **Clavier** | Piano multi-touch avec glissando. Joue le synthé, un instrument tout prêt (basses, guitares, vents, claviers, cordes, leads) ou un sample transposé. Sustain, changement d'octave. **Enregistreur** : ● lance le métronome, compte une mesure, enregistre ce que vous jouez (calage optionnel à la croche ou double croche) ; les prises se rejouent (en boucle) et se transforment en sample sur un pad. |

Kits des pads (bouton **Kits**) : **Batteries** (acoustique, 808, 909, percussions), **Instruments** (guitares, basses, vents) et **Styles** (drum n bass, funk, dance, disco, hip-hop, techno).

Le **voyant du métronome** en haut de l'écran clignote en jaune à chaque temps et en blanc au premier temps de chaque mesure ; le toucher démarre ou arrête le métronome.

Le bouton **?** en haut de l'écran ouvre le **guide des potards** : pour chaque réglage, son effet sur le son, une courbe qui réagit quand on tourne le potard, et un bouton ▶ pour l'entendre.

Sur ordinateur : pads sur les touches `1 2 3 4 / A Z E R / Q S D F / W X C V` (AZERTY), clavier piano sur la rangée `Q S D F G H J K` (touches noires `Z E T Y U`).

## Lancer

```bash
npm install          # installe aussi server/ et client/
npm run dev          # API sur :3000 + Angular sur :4200 (proxy /api)
```

Version « production » (le serveur Node sert l'app compilée) :

```bash
npm run build
npm start            # http://localhost:3000
```

### Sur le téléphone

Le micro n'est accessible qu'en **HTTPS** (sauf sur `localhost`). Pour tester depuis un téléphone du même Wi-Fi :

```bash
npm run build
npm run start:https  # certificat auto-signé, affiche l'adresse https://<ip-du-pc>:3000
```

Accepter l'avertissement de certificat dans le navigateur du téléphone, puis « Ajouter à l'écran d'accueil » pour l'ouvrir en plein écran.
Sur iPhone, l'audio fonctionne même avec le bouton silencieux activé (Safari 16.4+).

## Structure

```
server/            API Express
  index.js         routes /api/samples, /api/kit, /api/presets + service du client compilé
  data/            samples audio et fichiers JSON (créé au démarrage)
client/src/app/
  core/            moteur audio, bibliothèque, kit, synthé, enregistreur, utilitaires WAV
  shared/          potard, forme d'onde, clavier piano
  features/        pads, samples, synth, keyboard
```

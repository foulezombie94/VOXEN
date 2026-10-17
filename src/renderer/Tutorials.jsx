import React, { useEffect, useRef, useState } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import {
  Mic,
  BookAudio,
  Scissors,
  WandSparkles,
  StickyNote,
  ChartNoAxesColumn,
  Settings,
  Clock3,
  ArrowRight,
  ArrowLeft,
  Check,
  X,
  Play,
  CircleHelp,
  Sparkles,
  Keyboard,
  ShieldCheck,
} from 'lucide-react';
import t from './Tutorials.module.scss';

const STORAGE = 'voxen.guides.v1';
export const GUIDES = {
  dictation: {
    label: 'La dictée',
    icon: Mic,
    title: 'De votre voix à vos mots.',
    subtitle: 'Trois gestes pour écrire en parlant, dans votre application habituelle.',
    steps: [
      [
        'Choisissez où écrire',
        'Ouvrez votre messagerie, votre document ou votre éditeur, puis cliquez dans le champ de texte.',
      ],
      [
        'Une pression. Et parlez.',
        'Appuyez une fois sur votre raccourci. La capsule noire apparaît et ses barres suivent votre voix. Inutile de maintenir les touches.',
      ],
      [
        'Laissez vos mots se poser',
        'Après le silence prévu dans vos réglages, Voxen arrête la capture, transcrit, reformule si l’option est active, puis insère votre texte.',
      ],
    ],
    tip: 'Le clic droit sur la capsule permet d’ouvrir les paramètres ou de masquer le micro.',
  },
  dictionary: {
    label: 'Le dictionnaire',
    icon: BookAudio,
    title: 'Les mots qui vous ressemblent.',
    subtitle: 'Votre prénom, vos projets, votre vocabulaire : donnez-leur la bonne orthographe.',
    steps: [
      [
        'Ajoutez un mot à vous',
        'Cliquez sur « Ajouter un mot », saisissez un nom propre, une marque ou un terme métier, puis enregistrez.',
      ],
      [
        'Un indice pour la transcription',
        'À chaque dictée, vos mots sont transmis à Deepgram comme indications de vocabulaire. Ils favorisent la reconnaissance, sans garantir le résultat.',
      ],
      [
        'Un dictionnaire qui évolue',
        'Retrouvez, modifiez ou supprimez vos mots. Le bouton Importer prévisualise une liste et ignore les doublons avant de l’ajouter.',
      ],
    ],
    tip: 'Pour remplacer une expression entière par un texte précis, utilisez plutôt la page Raccourcis.',
  },
  replacements: {
    label: 'Les raccourcis',
    icon: Scissors,
    title: 'Une phrase. Tout est dit.',
    subtitle: 'Créez vos propres expressions pour les textes que vous répétez.',
    steps: [
      [
        'Choisissez ce que vous dites',
        'Cliquez sur « Créer un raccourci », puis choisissez une expression facile à prononcer dans « Quand je dis ».',
      ],
      [
        'Choisissez ce qui s’écrit',
        'Dans « Écrire à la place », entrez le texte souhaité. Le remplacement est appliqué après la transcription.',
      ],
      [
        'Gardez la main sur le résultat',
        'Vos expansions sont protégées pendant la reformulation. Si un marqueur est altéré, Voxen conserve la transcription avec vos textes enregistrés intacts.',
      ],
    ],
    tip: 'Une expression comme « ma formule de politesse » évite les remplacements accidentels d’un mot courant.',
  },
  style: {
    label: 'Le style',
    icon: Sparkles,
    title: 'Toujours vous. Un peu plus fluide.',
    subtitle: 'Choisissez le degré de retouche qui convient à votre façon d’écrire.',
    steps: [
      [
        'Trouvez votre équilibre',
        'Minimal reste proche de vos mots. Naturel lisse les phrases. Soigné propose une structure plus travaillée.',
      ],
      [
        'Activez la reformulation',
        'Le style est utilisé lorsque la reformulation est activée et qu’une clé OpenRouter est configurée. Le texte transcrit lui est alors envoyé.',
      ],
      [
        'Enregistrez votre choix',
        'Enregistrez votre style général et ajoutez si besoin une règle par application Windows. Le résultat dépend du modèle choisi.',
      ],
    ],
    tip: 'Les exemples de ce guide sont illustratifs. Ils ne déclenchent aucun appel au modèle.',
  },
  rewrite: {
    label: 'Les transformations',
    icon: WandSparkles,
    title: 'Votre texte, sous un autre angle.',
    subtitle: 'Un atelier pour essayer une autre formulation avant de l’utiliser.',
    steps: [
      [
        'Choisissez votre intention',
        'Peaufiner, structurer un prompt ou organiser une liste : choisissez une carte, ou créez votre propre consigne.',
      ],
      [
        'Essayez sur votre brouillon',
        'Collez un texte de 1 à 1 000 mots. Le bouton Aperçu envoie ce texte à votre modèle OpenRouter, uniquement à votre demande.',
      ],
      [
        'Comparez avant de copier',
        'L’original reste à gauche, le résultat à droite. Copiez le résultat ou utilisez-le comme nouveau brouillon. Cette page ne modifie aucun champ d’une autre application.',
      ],
    ],
    tip: 'Les transformations sont distinctes de la reformulation automatique de vos dictées, configurable dans Système et Style.',
  },
  scratchpad: {
    label: 'Le bloc-notes',
    icon: StickyNote,
    title: 'Une petite place pour les idées.',
    subtitle: 'Plusieurs notes, leurs versions, et une fenêtre à garder à portée de main.',
    steps: [
      [
        'Posez vos premières lignes',
        'Créez une note avec le bouton +, donnez-lui un titre puis écrivez. « Dicter ici » insère votre voix dans la note choisie.',
      ],
      [
        'Votre brouillon se garde ici',
        'Vos notes s’enregistrent automatiquement sur cet ordinateur. Épinglez-les, retrouvez-les avec la recherche et consultez leurs versions précédentes.',
      ],
      [
        'Emportez vos mots',
        'Copiez ou exportez votre note. « Ouvrir à part » ouvre une fenêtre que vous pouvez garder au-dessus de vos applications.',
      ],
    ],
    tip: 'Quand la fenêtre principale de Voxen est au premier plan, Ctrl+V garde son rôle de collage habituel.',
  },
  insights: {
    label: 'Les statistiques',
    icon: ChartNoAxesColumn,
    title: 'Vos mots font du chemin.',
    subtitle: 'Un aperçu simple de votre activité vocale, calculé sur cet ordinateur.',
    steps: [
      [
        'Comptez vos idées',
        'Le nombre de mots et de dictées est calculé depuis les entrées conservées dans votre historique.',
      ],
      [
        'Retrouvez votre rythme',
        'Choisissez une période de 7, 30 ou 90 jours. Le graphique et la répartition par application suivent vos dictées. Il se remplit au fil de vos dictées.',
      ],
      [
        'Comprenez le temps gagné',
        'Il s’agit d’une estimation : Voxen compare votre temps de parole à une durée de frappe calculée avec votre vitesse configurée.',
      ],
    ],
    tip: 'Si vous effacez l’historique, les statistiques correspondantes disparaissent aussi.',
  },
  settings: {
    label: 'Les paramètres',
    icon: Settings,
    title: 'Une dictée à votre image.',
    subtitle: 'Quelques réglages pour que Voxen trouve sa place dans votre quotidien.',
    steps: [
      [
        'Préparez votre voix',
        'Choisissez votre langue, votre raccourci et le délai de silence. Deux secondes est le réglage initial.',
      ],
      [
        'Connectez les moteurs',
        'Deepgram sert à transcrire. OpenRouter sert à reformuler si vous activez cette option. Les clés sont conservées dans le gestionnaire d’identifiants Windows.',
      ],
      [
        'Vérifiez, puis enregistrez',
        'Les réglages se sauvegardent automatiquement. Les tests ne s’exécutent qu’à votre demande : le test micro est local, un test de connexion contacte le service concerné.',
      ],
    ],
    tip: 'Choisissez le microphone dans Général → Microphone et vérifiez son niveau réel avant de dicter.',
  },
  history: {
    label: 'L’historique',
    icon: Clock3,
    title: 'Retrouvez le fil de vos idées.',
    subtitle: 'Les textes de vos dictées, conservés sur votre ordinateur.',
    steps: [
      [
        'Retrouvez une dictée',
        'La recherche parcourt les textes et le nom de l’application associée à chaque entrée de l’historique.',
      ],
      [
        'Comparez ou copiez',
        'Ouvrez le détail d’une dictée pour comparer l’original et le résultat. Vous pouvez copier chacun des deux textes ou ouvrir le résultat dans les transformations.',
      ],
      [
        'Choisissez ce que vous gardez',
        'Vous pouvez supprimer une dictée ou tout effacer. La conservation de l’historique peut aussi être désactivée dans les paramètres.',
      ],
    ],
    tip: 'L’historique conserve le texte, pas un enregistrement audio de vos dictées.',
  },
};

function readProgress() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE) || '{}');
    return {
      seen: Array.isArray(value.seen) ? value.seen.filter((id) => GUIDES[id]) : [],
      completed: Array.isArray(value.completed) ? value.completed.filter((id) => GUIDES[id]) : [],
    };
  } catch {
    return { seen: [], completed: [] };
  }
}

export function useTutorials(page) {
  const [progress, setProgress] = useState(readProgress);
  const [active, setActive] = useState(null);
  const [step, setStep] = useState(0);
  const previousPage = useRef(page);
  const remember = (id, completed = false) =>
    setProgress((old) => {
      const next = {
        seen: [...new Set([...old.seen, id])],
        completed: completed ? [...new Set([...old.completed, id])] : old.completed,
      };
      try {
        localStorage.setItem(STORAGE, JSON.stringify(next));
      } catch {
        /* Guides remain usable without persistent storage. */
      }
      return next;
    });
  const open = (id = page) => {
    if (!GUIDES[id]) return;
    remember(id);
    setStep(0);
    setActive(id);
  };
  const close = () => setActive(null);
  const finish = () => {
    if (active) remember(active, true);
    close();
  };
  useEffect(() => {
    if (previousPage.current === page) return;
    previousPage.current = page;
    if (active) {
      setActive(null);
      return;
    }
    if (GUIDES[page] && page !== 'dictation' && !progress.seen.includes(page)) open(page);
  }, [page]);
  return { progress, active, step, setStep, open, close, finish };
}

export function GuideBanner({ page, guides }) {
  const guide = GUIDES[page];
  if (!guide) return null;
  const Icon = guide.icon;
  return (
    <div className={t.banner} data-guide-banner={page}>
      <span className={t.bannerIcon}>
        <Icon size={20} strokeWidth={1.6} />
      </span>
      <div>
        <strong>{guide.label}, en quelques gestes.</strong>
        <span>Un petit guide pour vous sentir chez vous.</span>
      </div>
      <button onClick={() => guides.open(page)} data-guide-open={page}>
        <Play size={13} fill="currentColor" />
        {guides.progress.completed.includes(page) ? 'Revoir le guide' : 'Voir le guide'}
        <ArrowRight size={15} />
      </button>
    </div>
  );
}

export function GuideCard({ guides }) {
  const ids = ['dictation', 'dictionary', 'replacements'];
  const completed = ids.filter((id) => guides.progress.completed.includes(id)).length;
  return (
    <section className={t.sidebarCard} aria-label="Découvrir Voxen">
      <div>
        <strong>Prenez vos marques</strong>
        <span>{completed}/3</span>
      </div>
      <div className={t.progress}>
        <span style={{ width: `${(completed / 3) * 100}%` }} />
      </div>
      {ids.map((id) => (
        <button key={id} onClick={() => guides.open(id)}>
          {guides.progress.completed.includes(id) ? (
            <Check size={15} />
          ) : (
            <span className={t.smallCircle} />
          )}
          {GUIDES[id].label}
          <ArrowRight size={13} />
        </button>
      ))}
    </section>
  );
}

function Demo({ id, step, shortcut, silence }) {
  const [selected, setSelected] = useState('Naturel');
  const [sample, setSample] = useState('Voxen');
  const [added, setAdded] = useState(false);
  const Icon = GUIDES[id].icon;
  return (
    <div className={t.demo} data-guide-demo={id}>
      <div className={t.demoTop}>
        <span>
          <span className={t.liveDot} />
          APERÇU VOXEN
        </span>
        <span>Démonstration · sans envoi</span>
      </div>
      {id === 'dictionary' ? (
        <div className={t.dictionaryDemo}>
          <span className={t.demoLabel}>Un mot que vous utilisez souvent</span>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (sample.trim()) setAdded(true);
            }}
          >
            <input
              aria-label="Mot de démonstration"
              value={sample}
              maxLength={40}
              onChange={(e) => {
                setSample(e.target.value);
                setAdded(false);
              }}
            />
            <button disabled={!sample.trim()} aria-label="Ajouter le mot de démonstration">
              {added ? <Check size={17} /> : <ArrowRight size={17} />}
            </button>
          </form>
          <div className={t.wordChips}>
            <span>
              Figtree
              <Check size={12} />
            </span>
            <span>
              OpenRouter
              <Check size={12} />
            </span>
            {added && (
              <span>
                {sample.trim()}
                <Check size={12} />
              </span>
            )}
          </div>
          <small>
            {added
              ? 'Exemple ajouté à cet aperçu uniquement.'
              : 'Essayez ici. Votre vrai dictionnaire reste sur la page.'}
          </small>
        </div>
      ) : id === 'replacements' ? (
        <div className={t.pairDemo}>
          <div>
            <span>VOUS DITES</span>
            <p>« ma formule de politesse »</p>
          </div>
          <span className={t.connector}>
            <ArrowRight size={20} />
          </span>
          <div>
            <span>VOXEN ÉCRIT</span>
            <p>Merci et belle journée !</p>
          </div>
        </div>
      ) : id === 'style' || id === 'rewrite' ? (
        <div className={t.styleDemo}>
          <div role="group" aria-label="Exemple de style">
            {['Minimal', 'Naturel', 'Soigné'].map((name) => (
              <button key={name} aria-pressed={selected === name} onClick={() => setSelected(name)}>
                {name}
              </button>
            ))}
          </div>
          <p>
            {
              {
                Minimal: 'On se voit demain à 10 h pour parler du projet.',
                Naturel: 'On se retrouve demain à 10 h pour discuter du projet.',
                Soigné: 'Retrouvons-nous demain à 10 h pour faire le point sur le projet.',
              }[selected]
            }
          </p>
          <span>
            <WandSparkles size={13} />
            Exemple illustratif, sans appel à un modèle
          </span>
        </div>
      ) : id === 'insights' ? (
        <div className={t.chartDemo} aria-label="Graphique d’exemple, sans données réelles">
          {[23, 44, 33, 70, 58, 87, 65].map((h, i) => (
            <span key={i} style={{ height: `${h}%` }} />
          ))}
          <small>Chaque jour, un peu plus de place pour vos idées.</small>
        </div>
      ) : id === 'scratchpad' || id === 'history' ? (
        <div className={t.paperDemo}>
          <Icon size={21} strokeWidth={1.5} />
          <p>
            Une idée pour demain :<br />
            <strong>prendre le temps de la dire.</strong>
          </p>
          <span>
            <Check size={13} />
            Votre espace, sur cet ordinateur
          </span>
        </div>
      ) : id === 'settings' ? (
        <div className={t.settingsDemo}>
          <div>
            <Keyboard size={18} />
            <span>Une pression pour parler</span>
            <kbd>{shortcut}</kbd>
          </div>
          <div>
            <Clock3 size={18} />
            <span>Puis un peu de silence</span>
            <strong>{silence} s</strong>
          </div>
          <div>
            <ShieldCheck size={18} />
            <span>Vos clés restent dans Windows</span>
            <Check size={16} />
          </div>
        </div>
      ) : (
        <div className={t.voiceDemo}>
          <div className={t.voiceCaption}>
            {step === 2
              ? 'Parlez à votre rythme.'
              : step === 3
                ? 'Vos mots trouvent leur place.'
                : 'Une idée commence par une voix.'}
          </div>
          <div className={t.voicePill}>
            <Mic size={19} />
            <div>
              {[4, 9, 15, 23, 13, 18, 25, 15, 8, 19, 12, 4].map((height, i) => (
                <span key={i} style={{ height }} />
              ))}
            </div>
          </div>
          <div className={t.shortcut}>
            <kbd>{shortcut}</kbd>
            <ArrowRight size={13} />
            <span>parlez</span>
            <ArrowRight size={13} />
            <span>{silence} s de silence</span>
          </div>
        </div>
      )}
    </div>
  );
}

export function TutorialDialog({ guides, status, settings, navigate }) {
  const guide = GUIDES[guides.active];
  if (!guide) return null;
  const Icon = guide.icon;
  const step = guides.step;
  const current = guide.steps[step - 1];
  return (
    <Dialog.Root
      open={Boolean(guides.active)}
      onOpenChange={(open) => {
        if (!open) guides.close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className={t.backdrop} />
        <Dialog.Popup className={t.popup} data-tutorial={guides.active} data-tutorial-step={step}>
          <div className={t.modalTop}>
            <span>
              <Icon size={16} />
              {guide.label}
            </span>
            <Dialog.Close className={t.close} aria-label="Fermer le guide">
              <X size={18} />
            </Dialog.Close>
          </div>
          <Demo
            key={guides.active}
            id={guides.active}
            step={step}
            shortcut={status.shortcut || 'Ctrl+V'}
            silence={settings.SilenceSeconds || 2}
          />
          <div className={t.copy}>
            <span className={t.eyebrow}>
              {step ? `EN PRATIQUE · ${step} / 3` : 'FAITES COMME CHEZ VOUS'}
            </span>
            <Dialog.Title className={t.title}>{step ? current[0] : guide.title}</Dialog.Title>
            <Dialog.Description className={t.description}>
              {step ? current[1] : guide.subtitle}
            </Dialog.Description>
            {step === 3 && (
              <div className={t.tip}>
                <CircleHelp size={16} />
                <p>{guide.tip}</p>
              </div>
            )}
            {guides.active === 'dictation' && step === 2 && (
              <p className={t.detail}>
                Raccourci actuel : <kbd>{status.shortcut || 'Ctrl+V'}</kbd> · arrêt après{' '}
                {settings.SilenceSeconds || 2} s de silence.
              </p>
            )}
            {guides.active === 'settings' && step === 2 && (
              <p className={t.detail}>
                Deepgram : {status.deepgramConfigured ? 'clé enregistrée' : 'à connecter'} ·
                OpenRouter :{' '}
                {status.openrouterConfigured ? 'clé enregistrée' : 'facultatif, à connecter'}.
              </p>
            )}
          </div>
          <footer className={t.footer}>
            <div className={t.stepControls}>
              {step ? (
                <button
                  className={t.back}
                  aria-label="Étape précédente"
                  onClick={() => guides.setStep(step - 1)}
                >
                  <ArrowLeft size={16} />
                </button>
              ) : null}
              <div className={t.dots} aria-label={`Étape ${step + 1} sur 4`}>
                {[0, 1, 2, 3].map((n) => (
                  <button
                    key={n}
                    aria-label={n === 0 ? 'Introduction' : `Étape ${n}`}
                    aria-current={n === step ? 'step' : undefined}
                    onClick={() => guides.setStep(n)}
                  />
                ))}
              </div>
            </div>
            <div className={t.actions}>
              {step === 0 && (
                <button className={t.later} onClick={guides.close}>
                  Plus tard
                </button>
              )}
              {step < 3 ? (
                <button className={t.primary} onClick={() => guides.setStep(step + 1)}>
                  {step === 0 ? 'Me laisser guider' : 'Continuer'}
                  <ArrowRight size={16} />
                </button>
              ) : (
                <button className={t.primary} onClick={guides.finish}>
                  À moi de jouer
                  <Check size={16} />
                </button>
              )}
            </div>
          </footer>
          {step === 3 && guides.active === 'dictation' && !status.deepgramConfigured && (
            <button
              className={t.configure}
              onClick={() => {
                guides.finish();
                navigate('settings');
              }}
            >
              Configurer la transcription
              <ArrowRight size={13} />
            </button>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
